import * as fs from "fs";
import * as path from "path";
import { normalizeEndpoint, SanitizerRule, SinkRule, SourceRule, TaintRuleSet, TransferRule } from "./RuleSchema";
import { assertValidRuleSet, validateRuleSet } from "./RuleValidator";

export type RuleLayerName = "default" | "framework" | "project" | "llm_candidate";

export interface RuleLoaderOptions {
    defaultRulePath?: string;
    frameworkRulePath?: string;
    projectRulePath?: string;
    llmCandidateRulePath?: string;
    extraRulePaths?: string[];
    autoDiscoverLayers?: boolean;
    allowMissingFramework?: boolean;
    allowMissingProject?: boolean;
    allowMissingLlmCandidate?: boolean;
}

export interface RuleLayerStatus {
    name: RuleLayerName;
    path: string;
    source: "explicit" | "auto";
    exists: boolean;
    applied: boolean;
}

export interface LoadedRuleSet {
    ruleSet: TaintRuleSet;
    defaultRulePath: string;
    frameworkRulePath?: string;
    projectRulePath?: string;
    llmCandidateRulePath?: string;
    extraRulePaths: string[];
    appliedLayerOrder: RuleLayerName[];
    layerStatus: RuleLayerStatus[];
    warnings: string[];
}

export interface RuleLoadIssue {
    kind: "file_missing" | "json_parse" | "schema_assert" | "validation" | "merged_validation";
    layerName: RuleLayerName | "extra" | "merged";
    path: string;
    message: string;
    fieldPath?: string;
    line?: number;
    column?: number;
    userMessage: string;
}

export class RuleLoadError extends Error {
    readonly issues: RuleLoadIssue[];

    constructor(message: string, issues: RuleLoadIssue[]) {
        super(message);
        this.name = "RuleLoadError";
        this.issues = issues;
    }
}

export interface SmokeRuleConfig {
    sourceLocalNamePattern: RegExp;
    sinkKeywords: string[];
    sinkSignatures: string[];
}

const FALLBACK_SOURCE_LOCAL_PATTERN = /a^/;
const FALLBACK_SINK_KEYWORDS = [
    "axios",
    "fetch",
    "request",
    "router",
    "pushUrl",
    "relationalStore",
    "rdb",
    "preferences",
    "console",
];
const FALLBACK_SINK_SIGNATURES = [
    "router.pushUrl",
    "router.back",
    "router.getParams",
    "fetch(",
    "axios.get",
    "axios.post",
    "relationalStore",
    "getRdbStore",
    "execDML",
    "execDQL",
    "insertSync",
    "querySqlSync",
    "preferences.getPreferencesSync",
    "dataPreferences.putSync",
    "dataPreferences.getSync",
    "dataPreferences.deleteSync",
];
const SAFE_RULE_DIR_EXTENSIONS = new Set([".json", ".ts", ".md"]);

function extractValidationFieldPath(message: string): string | undefined {
    const lineMatch = message.match(/(?:^|\n)-\s*([A-Za-z0-9_.\[\]]+)/);
    if (lineMatch?.[1]) {
        return lineMatch[1];
    }
    const match = message.match(/^([A-Za-z0-9_.\[\]]+)/);
    return match?.[1];
}

interface RuleIssueLocation {
    line?: number;
    column?: number;
}

function createJsonSourceFile(absPath: string, raw: string): any | undefined {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ts = require("typescript");
        const normalizedPath = absPath.replace(/\\/g, "/");
        return ts.createSourceFile(normalizedPath, raw, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JSON);
    } catch {
        return undefined;
    }
}

function formatRuleIssueLocation(issue: Omit<RuleLoadIssue, "userMessage">): string {
    if (issue.line && issue.column) {
        return `${issue.path}:${issue.line}:${issue.column}`;
    }
    return issue.path;
}

function parseRuleFieldPath(fieldPath: string): Array<string | number> {
    const tokens: Array<string | number> = [];
    const matcher = /([^[.\]]+)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(fieldPath)) !== null) {
        if (match[1]) {
            tokens.push(match[1]);
        } else if (match[2]) {
            tokens.push(Number(match[2]));
        }
    }
    return tokens;
}

function locateJsonNodeByFieldPath(absPath: string, raw: string, fieldPath: string): RuleIssueLocation | undefined {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ts = require("typescript");
        const sourceFile = createJsonSourceFile(absPath, raw);
        const root = sourceFile?.statements?.[0]?.expression;
        if (!root) return undefined;

        const locationOfNode = (node: any): RuleIssueLocation | undefined => {
            if (!node) return undefined;
            const start = node.name?.getStart?.(sourceFile) ?? node.getStart?.(sourceFile);
            if (typeof start !== "number") return undefined;
            const pos = sourceFile.getLineAndCharacterOfPosition(start);
            return {
                line: pos.line + 1,
                column: pos.character + 1,
            };
        };

        let current = root;
        for (const segment of parseRuleFieldPath(fieldPath)) {
            if (typeof segment === "string") {
                if (!ts.isObjectLiteralExpression(current)) {
                    return locationOfNode(current);
                }
                const property = current.properties.find((item: any) => {
                    const nameText = item.name?.text || item.name?.getText?.(sourceFile)?.replace(/^['"]|['"]$/g, "");
                    return nameText === segment;
                });
                if (!property) {
                    return locationOfNode(current);
                }
                current = property.initializer || property;
                continue;
            }
            if (!ts.isArrayLiteralExpression(current)) {
                return locationOfNode(current);
            }
            const element = current.elements?.[segment];
            if (!element) {
                return locationOfNode(current);
            }
            current = element;
        }

        return locationOfNode(current);
    } catch {
        return undefined;
    }
}

function locateJsonSyntaxError(absPath: string, raw: string): RuleIssueLocation | undefined {
    try {
        const sourceFile = createJsonSourceFile(absPath, raw);
        if (!sourceFile) return undefined;
        const diagnostic = sourceFile.parseDiagnostics?.[0];
        if (!diagnostic || typeof diagnostic.start !== "number") {
            return undefined;
        }
        const pos = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
        return {
            line: pos.line + 1,
            column: pos.character + 1,
        };
    } catch {
        return undefined;
    }
}

function toUserRuleMessage(issue: Omit<RuleLoadIssue, "userMessage">): string {
    const location = `[${issue.layerName}] ${formatRuleIssueLocation(issue)}`;
    switch (issue.kind) {
        case "file_missing":
            return `${location}: rule file not found`;
        case "json_parse":
            return `${location}: JSON syntax invalid: ${issue.message}`;
        case "schema_assert":
            return `${location}: rule schema invalid: ${issue.message}`;
        case "validation":
            return `${location}: rule field invalid${issue.fieldPath ? ` (${issue.fieldPath})` : ""}: ${issue.message}`;
        case "merged_validation":
            return `${location}: merged rule set invalid${issue.fieldPath ? ` (${issue.fieldPath})` : ""}: ${issue.message}`;
    }
    return `${location}: ${issue.message}`;
}

function createRuleLoadIssue(issue: Omit<RuleLoadIssue, "userMessage">): RuleLoadIssue {
    return {
        ...issue,
        userMessage: toUserRuleMessage(issue),
    };
}

function throwRuleLoadError(issue: Omit<RuleLoadIssue, "userMessage">): never {
    const full = createRuleLoadIssue(issue);
    throw new RuleLoadError(full.userMessage, [full]);
}

function auditRuleDirectories(knownRuleFiles: string[]): string[] {
    const warnings: string[] = [];
    const knownFiles = new Set(knownRuleFiles.map(item => path.resolve(item)));
    const dirs = new Set(knownRuleFiles.map(item => path.dirname(path.resolve(item))));
    for (const dir of dirs) {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        const queue = [dir];
        for (let head = 0; head < queue.length; head++) {
            const current = queue[head];
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                const fullPath = path.resolve(path.join(current, entry.name));
                if (entry.isDirectory()) {
                    queue.push(fullPath);
                    continue;
                }
                if (!entry.isFile()) continue;
                if (entry.name.startsWith(".")) continue;
                if (knownFiles.has(fullPath)) continue;
                const ext = path.extname(entry.name).toLowerCase();
                if (entry.name.endsWith(".rules.json")) {
                    warnings.push(`rule-like file ignored because it is not part of the active rule layers: ${fullPath}`);
                    continue;
                }
                if (SAFE_RULE_DIR_EXTENSIONS.has(ext)) {
                    continue;
                }
                warnings.push(`unexpected file ignored in rules directory: ${fullPath}`);
            }
        }
    }
    return warnings;
}

function readJsonFile(layerName: RuleLayerName | "extra", absPath: string): unknown {
    const raw = fs.readFileSync(absPath, "utf-8").replace(/^\uFEFF/, "");
    try {
        return JSON.parse(raw);
    } catch (error: any) {
        const location = locateJsonSyntaxError(absPath, raw);
        throwRuleLoadError({
            kind: "json_parse",
            layerName,
            path: absPath,
            message: String(error?.message || error),
            line: location?.line,
            column: location?.column,
        });
    }
}

function mergeById<T extends { id: string }>(base: T[], override: T[]): T[] {
    const map = new Map<string, T>();
    for (const item of base) map.set(item.id, item);
    for (const item of override) map.set(item.id, item);
    return Array.from(map.values());
}

function normalizeRules(rules: TaintRuleSet): TaintRuleSet {
    return {
        ...rules,
        sources: (rules.sources || []).filter(r => r.enabled !== false),
        sinks: (rules.sinks || []).filter(r => r.enabled !== false),
        sanitizers: (rules.sanitizers || []).filter(r => r.enabled !== false),
        transfers: (rules.transfers || []).filter(r => r.enabled !== false),
    };
}

function mergeRuleSets(base: TaintRuleSet, override: TaintRuleSet): TaintRuleSet {
    return {
        schemaVersion: override.schemaVersion || base.schemaVersion,
        meta: { ...(base.meta || {}), ...(override.meta || {}) },
        sources: mergeById(base.sources || [], override.sources || []),
        sinks: mergeById(base.sinks || [], override.sinks || []),
        sanitizers: mergeById(base.sanitizers || [], override.sanitizers || []),
        transfers: mergeById(base.transfers || [], override.transfers || []),
    };
}

export function getDefaultRulePath(): string {
    return resolveBundledRulePath("src/rules/default.rules.json");
}

export function getFrameworkRulePath(): string {
    return resolveBundledRulePath("src/rules/framework.rules.json");
}

export function getProjectRulePath(): string {
    return resolveBundledRulePath("src/rules/project.rules.json");
}

export function getLlmCandidateRulePath(): string {
    return resolveBundledRulePath("src/rules/llm_candidate.rules.json");
}

function resolveBundledRulePath(repoRelativePath: string): string {
    const repoRelative = repoRelativePath.replace(/\//g, path.sep);
    const candidates = [
        path.resolve(__dirname, "../../../", repoRelative),
        path.resolve(process.cwd(), repoRelative),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return candidates[0];
}

interface OptionalLayerSpec {
    name: Exclude<RuleLayerName, "default">;
    path: string;
    source: "explicit" | "auto";
    allowMissing: boolean;
}

function appendOptionalLayerSpec(
    out: OptionalLayerSpec[],
    name: Exclude<RuleLayerName, "default">,
    explicitPath: string | undefined,
    autoPath: string,
    allowMissingExplicit: boolean,
    autoDiscover: boolean
): void {
    if (explicitPath) {
        out.push({
            name,
            path: path.resolve(explicitPath),
            source: "explicit",
            allowMissing: allowMissingExplicit,
        });
        return;
    }

    if (!autoDiscover) return;
    out.push({
        name,
        path: path.resolve(autoPath),
        source: "auto",
        allowMissing: true,
    });
}

function loadAndValidateLayer(layerName: RuleLayerName | "extra", absPath: string): TaintRuleSet {
    const rawText = fs.readFileSync(absPath, "utf-8").replace(/^\uFEFF/, "");
    const raw = readJsonFile(layerName, absPath);
    try {
        assertValidRuleSet(raw, absPath);
    } catch (error: any) {
        const message = String(error?.message || error);
        const fieldPath = extractValidationFieldPath(message);
        const location = fieldPath ? locateJsonNodeByFieldPath(absPath, rawText, fieldPath) : undefined;
        throwRuleLoadError({
            kind: "schema_assert",
            layerName,
            path: absPath,
            message,
            fieldPath,
            line: location?.line,
            column: location?.column,
        });
    }
    const validation = validateRuleSet(raw);
    if (!validation.valid) {
        const issues = validation.errors.map(message => {
            const fieldPath = extractValidationFieldPath(message);
            const location = fieldPath ? locateJsonNodeByFieldPath(absPath, rawText, fieldPath) : undefined;
            return createRuleLoadIssue({
                kind: "validation",
                layerName,
                path: absPath,
                message,
                fieldPath,
                line: location?.line,
                column: location?.column,
            });
        });
        throw new RuleLoadError(
            issues[0]?.userMessage || `Rule set invalid (${layerName}): ${absPath}`,
            issues,
        );
    }
    return raw as TaintRuleSet;
}

export function loadRuleSet(options: RuleLoaderOptions = {}): LoadedRuleSet {
    const warnings: string[] = [];
    const autoDiscover = options.autoDiscoverLayers !== false;
    const defaultPath = path.resolve(options.defaultRulePath || getDefaultRulePath());
    if (!fs.existsSync(defaultPath)) {
        throwRuleLoadError({
            kind: "file_missing",
            layerName: "default",
            path: defaultPath,
            message: `Default rule file not found: ${defaultPath}`,
        });
    }

    const defaultRules = loadAndValidateLayer("default", defaultPath);
    let merged = normalizeRules(defaultRules);
    const appliedLayerOrder: RuleLayerName[] = ["default"];
    const layerStatus: RuleLayerStatus[] = [{
        name: "default",
        path: defaultPath,
        source: "explicit",
        exists: true,
        applied: true,
    }];

    const explicitProjectPath = options.projectRulePath;
    const explicitProjectAllowMissing = options.allowMissingProject ?? false;

    const layerSpecs: OptionalLayerSpec[] = [];
    appendOptionalLayerSpec(
        layerSpecs,
        "framework",
        options.frameworkRulePath,
        getFrameworkRulePath(),
        options.allowMissingFramework ?? false,
        autoDiscover
    );
    appendOptionalLayerSpec(
        layerSpecs,
        "project",
        explicitProjectPath,
        getProjectRulePath(),
        explicitProjectAllowMissing,
        autoDiscover
    );
    appendOptionalLayerSpec(
        layerSpecs,
        "llm_candidate",
        options.llmCandidateRulePath,
        getLlmCandidateRulePath(),
        options.allowMissingLlmCandidate ?? false,
        autoDiscover
    );

    let frameworkPath: string | undefined;
    let projectPath: string | undefined;
    let llmCandidatePath: string | undefined;
    const extraRulePaths: string[] = [];
    for (const spec of layerSpecs) {
        const exists = fs.existsSync(spec.path);
        if (!exists) {
            layerStatus.push({
                name: spec.name,
                path: spec.path,
                source: spec.source,
                exists: false,
                applied: false,
            });
            if (spec.allowMissing) {
                if (spec.source === "explicit") {
                    warnings.push(`${spec.name} rule file not found (ignored): ${spec.path}`);
                }
            } else {
                throwRuleLoadError({
                    kind: "file_missing",
                    layerName: spec.name,
                    path: spec.path,
                    message: `${spec.name} rule file not found: ${spec.path}`,
                });
            }
            continue;
        }

        const layerRules = loadAndValidateLayer(spec.name, spec.path);
        merged = normalizeRules(mergeRuleSets(merged, layerRules));
        appliedLayerOrder.push(spec.name);
        layerStatus.push({
            name: spec.name,
            path: spec.path,
            source: spec.source,
            exists: true,
            applied: true,
        });

        if (spec.name === "framework") frameworkPath = spec.path;
        if (spec.name === "project") projectPath = spec.path;
        if (spec.name === "llm_candidate") llmCandidatePath = spec.path;
    }

    for (const extraRulePath of options.extraRulePaths || []) {
        const absPath = path.resolve(extraRulePath);
        if (!fs.existsSync(absPath)) {
            throwRuleLoadError({
                kind: "file_missing",
                layerName: "extra",
                path: absPath,
                message: `extra rule file not found: ${absPath}`,
            });
        }
        const extraRules = loadAndValidateLayer("extra", absPath);
        merged = normalizeRules(mergeRuleSets(merged, extraRules));
        extraRulePaths.push(absPath);
    }

    const mergedValidation = validateRuleSet(merged);
    if (!mergedValidation.valid) {
        const issues = mergedValidation.errors.map(message => createRuleLoadIssue({
            kind: "merged_validation",
            layerName: "merged",
            path: "<merged>",
            message,
            fieldPath: extractValidationFieldPath(message),
        }));
        throw new RuleLoadError(
            issues[0]?.userMessage || "Merged rule set invalid",
            issues,
        );
    }
    warnings.push(...mergedValidation.warnings);
    warnings.push(...auditRuleDirectories([
        defaultPath,
        ...(frameworkPath ? [frameworkPath] : []),
        ...(projectPath ? [projectPath] : []),
        ...(llmCandidatePath ? [llmCandidatePath] : []),
        ...extraRulePaths,
    ]));

    return {
        ruleSet: merged,
        defaultRulePath: defaultPath,
        frameworkRulePath: frameworkPath,
        projectRulePath: projectPath,
        llmCandidateRulePath: llmCandidatePath,
        extraRulePaths,
        appliedLayerOrder,
        layerStatus,
        warnings,
    };
}

export function tryLoadRuleSet(options: RuleLoaderOptions = {}): LoadedRuleSet | undefined {
    try {
        return loadRuleSet(options);
    } catch {
        return undefined;
    }
}

function sourceRegexRules(rules: SourceRule[]): SourceRule[] {
    return rules.filter(r => r.match.kind === "local_name_regex");
}

function sinkSignatureContainsRules(rules: SinkRule[]): SinkRule[] {
    return rules.filter(r => r.match.kind === "signature_contains");
}

function firstRegexPattern(rules: SourceRule[]): RegExp | undefined {
    const first = rules.find(r => typeof r.match.value === "string" && r.match.value.trim().length > 0);
    if (!first) return undefined;
    return new RegExp(first.match.value, "i");
}

export function buildSmokeRuleConfig(loaded?: LoadedRuleSet): SmokeRuleConfig {
    const rules = loaded?.ruleSet;
    if (!rules) {
        return {
            sourceLocalNamePattern: FALLBACK_SOURCE_LOCAL_PATTERN,
            sinkKeywords: FALLBACK_SINK_KEYWORDS,
            sinkSignatures: FALLBACK_SINK_SIGNATURES,
        };
    }

    const sourcePattern = firstRegexPattern(sourceRegexRules(rules.sources || [])) || FALLBACK_SOURCE_LOCAL_PATTERN;
    const sinkContainsValues = sinkSignatureContainsRules(rules.sinks || []).map(r => r.match.value);

    return {
        sourceLocalNamePattern: sourcePattern,
        sinkKeywords: sinkContainsValues.length > 0 ? sinkContainsValues : FALLBACK_SINK_KEYWORDS,
        sinkSignatures: sinkContainsValues.length > 0 ? sinkContainsValues : FALLBACK_SINK_SIGNATURES,
    };
}

export function summarizeRuleSet(rules: TaintRuleSet): { sources: number; sinks: number; sanitizers: number; transfers: number } {
    return {
        sources: (rules.sources || []).length,
        sinks: (rules.sinks || []).length,
        sanitizers: (rules.sanitizers || []).length,
        transfers: (rules.transfers || []).length,
    };
}

export function summarizeTransferEndpoints(transfers: TransferRule[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of transfers) {
        const key = `${t.from}->${t.to}`;
        out[key] = (out[key] || 0) + 1;
    }
    return out;
}

export function summarizeSanitizerTargets(sanitizers: SanitizerRule[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of sanitizers) {
        const endpoint = s.target ? normalizeEndpoint(s.target).endpoint : "result";
        out[endpoint] = (out[endpoint] || 0) + 1;
    }
    return out;
}
