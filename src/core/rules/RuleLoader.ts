import * as fs from "fs";
import * as path from "path";
import { normalizeEndpoint, RuleLayer, SanitizerRule, SinkRule, SourceRule, TaintRuleSet, TransferRule } from "./RuleSchema";
import { assertValidRuleSet, validateRuleSet } from "./RuleValidator";
import { buildFrameworkCallbackSourceRules } from "./FrameworkCallbackSourceCatalog";
import { buildFrameworkApiSourceRules } from "./FrameworkApiSourceCatalog";
import { buildFrameworkSinkRules, isFrameworkSinkCatalogRule } from "./FrameworkSinkCatalog";
import { buildFrameworkSanitizerRules, isFrameworkSanitizerCatalogRule } from "./FrameworkSanitizerCatalog";
import {
    RuleGovernanceOrigin,
    normalizeRuleSetGovernance,
} from "./RuleGovernance";

export type RuleLayerName = RuleLayer;

export interface RuleLoaderOptions {
    kernelRulePath?: string;
    ruleCatalogPath?: string;
    enabledRulePacks?: string[];
    disabledRulePacks?: string[];
    projectRulePath?: string;
    candidateRulePath?: string;
    extraRulePaths?: string[];
    autoDiscoverLayers?: boolean;
    autoDiscoverProjectPacks?: boolean;
    allowMissingProject?: boolean;
    allowMissingCandidate?: boolean;
}

export interface RuleLayerStatus {
    name: RuleLayerName;
    path: string;
    source: "explicit" | "auto";
    exists: boolean;
    applied: boolean;
    packId?: string;
}

export interface LoadedRuleSet {
    ruleSet: TaintRuleSet;
    kernelRulePath?: string;
    ruleCatalogPath: string;
    enabledRulePacks: string[];
    discoveredRulePacks: string[];
    projectRulePath?: string;
    candidateRulePath?: string;
    extraRulePaths: string[];
    appliedLayerOrder: RuleLayerName[];
    layerStatus: RuleLayerStatus[];
    secondarySinkSweep: SecondarySinkSweepConfig;
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

interface SecondarySinkSweepConfig {
    sinkKeywords: string[];
    sinkSignatures: string[];
}

type RuleBundleKind = "sources" | "sinks" | "sanitizers" | "transfers";

interface LoadedLayerEntry {
    ruleSet: TaintRuleSet;
    knownFiles: string[];
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

function auditRuleDirectories(knownRuleFiles: string[], auditRoots: string[] = []): string[] {
    const warnings: string[] = [];
    const knownFiles = new Set(knownRuleFiles.map(item => path.resolve(item)));
    const dirs = new Set<string>();
    for (const file of knownRuleFiles) {
        dirs.add(path.dirname(path.resolve(file)));
    }
    for (const root of auditRoots) {
        if (!root) continue;
        const resolved = path.resolve(root);
        if (!fs.existsSync(resolved)) continue;
        if (fs.statSync(resolved).isDirectory()) {
            dirs.add(resolved);
        } else {
            dirs.add(path.dirname(resolved));
        }
    }
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
                    const normalized = fullPath.replace(/\\/g, "/");
                    if (/\/(sources|sinks|sanitizers|transfers)\/project\/[^/]+\/.+\.rules\.json$/i.test(normalized)) {
                        continue;
                    }
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

export function getRuleCatalogPath(): string {
    return resolveBuiltInRuleRoot();
}

export function getCandidateRulePath(): string {
    return resolveRepoRelativePath("tmp/rules/candidate.rules.json");
}

function resolveBuiltInRuleRoot(): string {
    return resolveRepoRelativePath("src/rules");
}

function resolveRepoRelativePath(repoRelativePath: string): string {
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

function buildEmptyRuleSet(): TaintRuleSet {
    return {
        schemaVersion: "2.0",
        sources: [],
        sinks: [],
        sanitizers: [],
        transfers: [],
    };
}

function assertSingleKindRuleSet(layerName: RuleLayerName | "extra", kind: RuleBundleKind, ruleSet: TaintRuleSet, absPath: string): void {
    const counts: Record<RuleBundleKind, number> = {
        sources: (ruleSet.sources || []).length,
        sinks: (ruleSet.sinks || []).length,
        sanitizers: (ruleSet.sanitizers || []).length,
        transfers: (ruleSet.transfers || []).length,
    };
    const offending = (Object.keys(counts) as RuleBundleKind[])
        .filter(name => name !== kind && counts[name] > 0);
    if (offending.length === 0) {
        return;
    }
    throwRuleLoadError({
        kind: "schema_assert",
        layerName,
        path: absPath,
        message: `bundle member for ${kind} must not define ${offending.join(", ")}`,
    });
}

interface ProjectPackSpec {
    packId: string;
    files: string[];
}

const RULE_BUNDLE_KINDS: RuleBundleKind[] = ["sources", "sinks", "sanitizers", "transfers"];

function listRuleJsonFilesRecursive(dirPath: string): string[] {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        return [];
    }

    const files: string[] = [];
    const queue = [path.resolve(dirPath)];
    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        const entries = fs.readdirSync(current, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const fullPath = path.resolve(path.join(current, entry.name));
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }
            if (entry.isFile() && entry.name.endsWith(".rules.json")) {
                files.push(fullPath);
            }
        }
    }
    return files.sort((a, b) => a.localeCompare(b));
}

function loadAndValidateRuleFile(layerName: RuleLayerName | "extra", absPath: string): TaintRuleSet {
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

function loadAndValidateKindFile(layerName: RuleLayerName | "extra", kind: RuleBundleKind, memberPath: string): LoadedLayerEntry {
    const ruleSet = loadAndValidateRuleFile(layerName, memberPath);
    assertSingleKindRuleSet(layerName, kind, ruleSet, memberPath);
    return {
        ruleSet,
        knownFiles: [memberPath],
    };
}

function loadAndValidateRuleFiles(
    layerName: RuleLayerName | "extra",
    files: string[],
    kind: RuleBundleKind | undefined,
): LoadedLayerEntry {
    let merged = buildEmptyRuleSet();
    const knownFiles: string[] = [];
    for (const file of files) {
        const loaded = kind
            ? loadAndValidateKindFile(layerName, kind, file)
            : {
                ruleSet: loadAndValidateRuleFile(layerName, file),
                knownFiles: [file],
            };
        merged = normalizeRules(mergeRuleSets(merged, loaded.ruleSet));
        for (const knownFile of loaded.knownFiles) {
            if (!knownFiles.includes(knownFile)) {
                knownFiles.push(knownFile);
            }
        }
    }
    return { ruleSet: merged, knownFiles };
}

function loadAndValidateLayerEntry(layerName: RuleLayerName | "extra", absPath: string): LoadedLayerEntry {
    if (!fs.statSync(absPath).isDirectory()) {
        return {
            ruleSet: loadAndValidateRuleFile(layerName, absPath),
            knownFiles: [absPath],
        };
    }

    const directRuleFiles = listRuleJsonFilesRecursive(absPath);
    const kindDirs = RULE_BUNDLE_KINDS
        .map(kind => ({ kind, dir: path.join(absPath, kind) }))
        .filter(item => fs.existsSync(item.dir) && fs.statSync(item.dir).isDirectory());

    if (kindDirs.length === 0) {
        return loadAndValidateRuleFiles(layerName, directRuleFiles, undefined);
    }

    let merged = buildEmptyRuleSet();
    const knownFiles: string[] = [];
    for (const { kind, dir } of kindDirs) {
        const files = listRuleJsonFilesRecursive(dir);
        if (files.length === 0) {
            continue;
        }
        const member = loadAndValidateRuleFiles(layerName, files, kind);
        merged = normalizeRules(mergeRuleSets(merged, member.ruleSet));
        for (const file of member.knownFiles) {
            if (!knownFiles.includes(file)) {
                knownFiles.push(file);
            }
        }
    }

    return {
        ruleSet: merged,
        knownFiles,
    };
}

function isSecondarySinkSweepRule(rule: SinkRule): boolean {
    return rule.match.kind === "signature_contains"
        && !rule.target
        && (
            String(rule.id || "").startsWith("sink.sig.")
            || String(rule.id || "").startsWith("sink.keyword.")
        );
}

function collectSecondarySinkSweepConfig(rules: SinkRule[]): SecondarySinkSweepConfig {
    const keywordValues = [...new Set(
        rules
            .filter(rule => isSecondarySinkSweepRule(rule) && String(rule.id || "").startsWith("sink.keyword."))
            .map(rule => rule.match.value)
            .filter(Boolean)
    )];
    const signatureValues = [...new Set(
        rules
            .filter(rule => isSecondarySinkSweepRule(rule) && String(rule.id || "").startsWith("sink.sig."))
            .map(rule => rule.match.value)
            .filter(Boolean)
    )];
    return {
        sinkKeywords: keywordValues.length > 0 ? keywordValues : FALLBACK_SINK_KEYWORDS,
        sinkSignatures: signatureValues.length > 0 ? signatureValues : FALLBACK_SINK_SIGNATURES,
    };
}

function normalizeKernelLayerRules(ruleSet: TaintRuleSet): TaintRuleSet {
    const retainedSources = (ruleSet.sources || []).filter(
        rule => rule.sourceKind !== "callback_param"
            && rule.sourceKind !== "call_return"
            && rule.sourceKind !== "field_read"
    );
    const retainedSinks = (ruleSet.sinks || []).filter(
        rule => !isFrameworkSinkCatalogRule(rule) && !isSecondarySinkSweepRule(rule)
    );
    const retainedSanitizers = (ruleSet.sanitizers || []).filter(rule => !isFrameworkSanitizerCatalogRule(rule));
    return {
        ...ruleSet,
        sources: [
            ...retainedSources,
            ...buildFrameworkCallbackSourceRules(),
            ...buildFrameworkApiSourceRules(),
        ],
        sinks: [
            ...retainedSinks,
            ...buildFrameworkSinkRules(ruleSet.sinks || []),
        ],
        sanitizers: [
            ...retainedSanitizers,
            ...buildFrameworkSanitizerRules(ruleSet.sanitizers || []),
        ],
    };
}

function normalizeKernelLayerInventory(ruleSet: TaintRuleSet): { ruleSet: TaintRuleSet; secondarySinkSweep: SecondarySinkSweepConfig } {
    return {
        ruleSet: normalizeKernelLayerRules(ruleSet),
        secondarySinkSweep: collectSecondarySinkSweepConfig(ruleSet.sinks || []),
    };
}

function normalizeLoadedLayerRules(ruleSet: TaintRuleSet, origin: RuleGovernanceOrigin): TaintRuleSet {
    return normalizeRuleSetGovernance(ruleSet, origin);
}

function mergeKnownFiles(target: string[], incoming: string[]): void {
    for (const file of incoming) {
        if (!target.includes(file)) {
            target.push(file);
        }
    }
}

function collectProjectPackSpecs(ruleCatalogPath: string): ProjectPackSpec[] {
    const packFiles = new Map<string, string[]>();
    for (const kind of RULE_BUNDLE_KINDS) {
        const projectRoot = path.join(ruleCatalogPath, kind, "project");
        if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
            continue;
        }
        const entries = fs.readdirSync(projectRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const packId = entry.name;
            const files = listRuleJsonFilesRecursive(path.join(projectRoot, packId));
            if (files.length === 0) {
                continue;
            }
            const current = packFiles.get(packId) || [];
            current.push(...files);
            packFiles.set(packId, current);
        }
    }
    return [...packFiles.entries()]
        .map(([packId, files]) => ({ packId, files: files.sort((a, b) => a.localeCompare(b)) }))
        .sort((a, b) => a.packId.localeCompare(b.packId));
}

function resolveEnabledProjectPacks(
    discovered: string[],
    enabled: string[] | undefined,
    disabled: string[] | undefined,
): string[] {
    const disabledSet = new Set((disabled || []).map(item => item.trim()).filter(Boolean));
    if (!enabled || enabled.length === 0) {
        return [];
    }
    const out: string[] = [];
    const requested = [...new Set(enabled.map(item => item.trim()).filter(Boolean))];
    for (const packId of requested) {
        if (disabledSet.has(packId)) {
            continue;
        }
        out.push(packId);
    }
    return out;
}

function isKindFirstRuleRoot(absPath: string): boolean {
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
        return false;
    }
    return RULE_BUNDLE_KINDS.some(kind => fs.existsSync(path.join(absPath, kind)));
}

export function loadRuleSet(options: RuleLoaderOptions = {}): LoadedRuleSet {
    const warnings: string[] = [];
    const explicitKernelRulePath = options.kernelRulePath ? path.resolve(options.kernelRulePath) : undefined;
    const explicitRuleCatalogPath = options.ruleCatalogPath ? path.resolve(options.ruleCatalogPath) : undefined;
    const useKernelRuleAsCatalog = !!(explicitKernelRulePath && isKindFirstRuleRoot(explicitKernelRulePath));
    const builtInRuleCatalogPath = explicitRuleCatalogPath
        || (useKernelRuleAsCatalog ? explicitKernelRulePath! : !explicitKernelRulePath ? getRuleCatalogPath() : undefined);
    const ruleCatalogPath = builtInRuleCatalogPath || explicitKernelRulePath || getRuleCatalogPath();
    if (builtInRuleCatalogPath && !fs.existsSync(builtInRuleCatalogPath)) {
        throwRuleLoadError({
            kind: "file_missing",
            layerName: "kernel",
            path: builtInRuleCatalogPath,
            message: `rule catalog not found: ${builtInRuleCatalogPath}`,
        });
    }

    const knownRuleFiles: string[] = [];
    let merged = buildEmptyRuleSet();
    let secondarySinkSweep: SecondarySinkSweepConfig = {
        sinkKeywords: [...FALLBACK_SINK_KEYWORDS],
        sinkSignatures: [...FALLBACK_SINK_SIGNATURES],
    };
    const appliedLayerOrder: RuleLayerName[] = [];
    const layerStatus: RuleLayerStatus[] = [];

    const shouldLoadExplicitDefault = !!(
        explicitKernelRulePath
        && (!useKernelRuleAsCatalog || explicitKernelRulePath !== ruleCatalogPath)
    );
    if (shouldLoadExplicitDefault) {
        if (!fs.existsSync(explicitKernelRulePath!)) {
            throwRuleLoadError({
                kind: "file_missing",
                layerName: "kernel",
                path: explicitKernelRulePath!,
                message: `kernel rule file not found: ${explicitKernelRulePath!}`,
            });
        }
        const explicitKernelRules = loadAndValidateLayerEntry("kernel", explicitKernelRulePath!);
        mergeKnownFiles(knownRuleFiles, explicitKernelRules.knownFiles);
        merged = normalizeRules(mergeRuleSets(
            merged,
            normalizeLoadedLayerRules(explicitKernelRules.ruleSet, {
                kind: "builtin_kernel_json",
                path: explicitKernelRulePath!,
            }),
        ));
        layerStatus.push({
            name: "kernel",
            path: explicitKernelRulePath!,
            source: "explicit",
            exists: true,
            applied: true,
        });
    }

    const kernelKnownFiles: string[] = [];
    if (builtInRuleCatalogPath && isKindFirstRuleRoot(builtInRuleCatalogPath)) {
        for (const kind of RULE_BUNDLE_KINDS) {
            const kernelDir = path.join(builtInRuleCatalogPath, kind, "kernel");
            const kernelFiles = listRuleJsonFilesRecursive(kernelDir);
            if (kernelFiles.length === 0) {
                continue;
            }
            const loadedKernelKind = loadAndValidateRuleFiles("kernel", kernelFiles, kind);
            merged = normalizeRules(mergeRuleSets(merged, loadedKernelKind.ruleSet));
            mergeKnownFiles(kernelKnownFiles, loadedKernelKind.knownFiles);
        }
    } else if (builtInRuleCatalogPath && (!shouldLoadExplicitDefault || builtInRuleCatalogPath !== explicitKernelRulePath)) {
        const standaloneKernelRules = loadAndValidateLayerEntry("kernel", builtInRuleCatalogPath);
        merged = normalizeRules(mergeRuleSets(merged, standaloneKernelRules.ruleSet));
        mergeKnownFiles(kernelKnownFiles, standaloneKernelRules.knownFiles);
    }
    if (kernelKnownFiles.length === 0) {
        if (!shouldLoadExplicitDefault) {
            throwRuleLoadError({
                kind: "file_missing",
                layerName: "kernel",
                path: builtInRuleCatalogPath || ruleCatalogPath,
                message: `no kernel rule files found under ${builtInRuleCatalogPath || ruleCatalogPath}`,
            });
        }
    } else {
        mergeKnownFiles(knownRuleFiles, kernelKnownFiles);
        const normalizedKernel = normalizeKernelLayerInventory(merged);
        secondarySinkSweep = normalizedKernel.secondarySinkSweep;
        merged = normalizeRules(normalizeLoadedLayerRules(
            normalizedKernel.ruleSet,
            { kind: "builtin_kernel_json", path: builtInRuleCatalogPath || ruleCatalogPath },
        ));
        layerStatus.push({
            name: "kernel",
            path: builtInRuleCatalogPath || ruleCatalogPath,
            source: explicitRuleCatalogPath || useKernelRuleAsCatalog ? "explicit" : "auto",
            exists: true,
            applied: true,
        });
    }
    appliedLayerOrder.push("kernel");

    let projectPath: string | undefined;
    let candidateRulePath: string | undefined;
    const extraRulePaths: string[] = [];
    const discoveredRulePacks = builtInRuleCatalogPath
        ? collectProjectPackSpecs(builtInRuleCatalogPath).map(spec => spec.packId)
        : [];
    const enabledRulePacks = resolveEnabledProjectPacks(
        discoveredRulePacks,
        options.enabledRulePacks,
        options.disabledRulePacks,
    );
    const enabledPackSet = new Set(enabledRulePacks);
    let projectLayerApplied = false;

    for (const requestedPack of enabledRulePacks) {
        if (!discoveredRulePacks.includes(requestedPack)) {
            throwRuleLoadError({
                kind: "file_missing",
                layerName: "project",
                path: path.join(ruleCatalogPath, "*", "project", requestedPack),
                message: `project rule pack not found: ${requestedPack}`,
            });
        }
    }

    for (const spec of builtInRuleCatalogPath ? collectProjectPackSpecs(builtInRuleCatalogPath) : []) {
        const packRootPath = path.dirname(spec.files[0]);
        if (!enabledPackSet.has(spec.packId)) {
            layerStatus.push({
                name: "project",
                path: packRootPath,
                source: "auto",
                exists: true,
                applied: false,
                packId: spec.packId,
            });
            continue;
        }
        const rawPackRules = loadAndValidateRuleFiles("project", spec.files, undefined);
        mergeKnownFiles(knownRuleFiles, rawPackRules.knownFiles);
        const layerRules = normalizeLoadedLayerRules(rawPackRules.ruleSet, {
            kind: "builtin_project_pack_json",
            path: packRootPath,
        });
        merged = normalizeRules(mergeRuleSets(merged, layerRules));
        if (!projectLayerApplied) {
            appliedLayerOrder.push("project");
            projectLayerApplied = true;
        }
        layerStatus.push({
            name: "project",
            path: packRootPath,
            source: "auto",
            exists: true,
            applied: true,
            packId: spec.packId,
        });
    }

    if (options.projectRulePath) {
        projectPath = path.resolve(options.projectRulePath);
        if (!fs.existsSync(projectPath)) {
            if (options.allowMissingProject) {
                warnings.push(`project rule file not found (ignored): ${projectPath}`);
            } else {
                throwRuleLoadError({
                    kind: "file_missing",
                    layerName: "project",
                    path: projectPath,
                    message: `project rule file not found: ${projectPath}`,
                });
            }
        } else {
            const rawProjectRules = loadAndValidateLayerEntry("project", projectPath);
            mergeKnownFiles(knownRuleFiles, rawProjectRules.knownFiles);
            merged = normalizeRules(mergeRuleSets(merged, normalizeLoadedLayerRules(rawProjectRules.ruleSet, {
                kind: "external_project_json",
                path: projectPath,
            })));
            if (!projectLayerApplied) {
                appliedLayerOrder.push("project");
                projectLayerApplied = true;
            }
            layerStatus.push({
                name: "project",
                path: projectPath,
                source: "explicit",
                exists: true,
                applied: true,
            });
        }
    }

    if (options.candidateRulePath) {
        candidateRulePath = path.resolve(options.candidateRulePath);
        if (!fs.existsSync(candidateRulePath)) {
            if (options.allowMissingCandidate) {
                warnings.push(`candidate rule file not found (ignored): ${candidateRulePath}`);
            } else {
                throwRuleLoadError({
                    kind: "file_missing",
                    layerName: "project",
                    path: candidateRulePath,
                    message: `candidate rule file not found: ${candidateRulePath}`,
                });
            }
        } else {
            const rawCandidateRules = loadAndValidateLayerEntry("project", candidateRulePath);
            mergeKnownFiles(knownRuleFiles, rawCandidateRules.knownFiles);
            merged = normalizeRules(mergeRuleSets(merged, normalizeLoadedLayerRules(rawCandidateRules.ruleSet, {
                kind: "llm_candidate_json",
                path: candidateRulePath,
            })));
            if (!projectLayerApplied) {
                appliedLayerOrder.push("project");
                projectLayerApplied = true;
            }
            layerStatus.push({
                name: "project",
                path: candidateRulePath,
                source: "explicit",
                exists: true,
                applied: true,
            });
        }
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
        const extraRules = loadAndValidateLayerEntry("extra", absPath);
        mergeKnownFiles(knownRuleFiles, extraRules.knownFiles);
        merged = normalizeRules(mergeRuleSets(merged, normalizeLoadedLayerRules(extraRules.ruleSet, {
            kind: "user_project_extra_json",
            path: absPath,
        })));
        if (!projectLayerApplied) {
            appliedLayerOrder.push("project");
            projectLayerApplied = true;
        }
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
    warnings.push(...auditRuleDirectories(knownRuleFiles, [
        builtInRuleCatalogPath || ruleCatalogPath,
        projectPath,
        candidateRulePath,
        ...extraRulePaths,
    ].filter((item): item is string => typeof item === "string" && item.trim().length > 0)));

    return {
        ruleSet: merged,
        kernelRulePath: shouldLoadExplicitDefault ? explicitKernelRulePath : undefined,
        ruleCatalogPath,
        enabledRulePacks,
        discoveredRulePacks,
        projectRulePath: projectPath,
        candidateRulePath,
        extraRulePaths,
        appliedLayerOrder,
        layerStatus,
        secondarySinkSweep,
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
    const sinkKeywords = loaded?.secondarySinkSweep?.sinkKeywords;
    const sinkSignatures = loaded?.secondarySinkSweep?.sinkSignatures;

    return {
        sourceLocalNamePattern: sourcePattern,
        sinkKeywords: sinkKeywords && sinkKeywords.length > 0 ? sinkKeywords : FALLBACK_SINK_KEYWORDS,
        sinkSignatures: sinkSignatures && sinkSignatures.length > 0 ? sinkSignatures : FALLBACK_SINK_SIGNATURES,
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
