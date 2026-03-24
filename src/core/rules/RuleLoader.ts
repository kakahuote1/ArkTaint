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

function readJsonFile(absPath: string): unknown {
    const raw = fs.readFileSync(absPath, "utf-8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
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

function loadAndValidateLayer(layerName: RuleLayerName, absPath: string): TaintRuleSet {
    const raw = readJsonFile(absPath);
    assertValidRuleSet(raw, absPath);
    const validation = validateRuleSet(raw);
    if (!validation.valid) {
        throw new Error(`Rule set invalid (${layerName}): ${validation.errors.join("; ")}`);
    }
    return raw as TaintRuleSet;
}

export function loadRuleSet(options: RuleLoaderOptions = {}): LoadedRuleSet {
    const warnings: string[] = [];
    const autoDiscover = options.autoDiscoverLayers !== false;
    const defaultPath = path.resolve(options.defaultRulePath || getDefaultRulePath());
    if (!fs.existsSync(defaultPath)) {
        throw new Error(`Default rule file not found: ${defaultPath}`);
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
                throw new Error(`${spec.name} rule file not found: ${spec.path}`);
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
            throw new Error(`extra rule file not found: ${absPath}`);
        }
        const extraRules = loadAndValidateLayer("project", absPath);
        merged = normalizeRules(mergeRuleSets(merged, extraRules));
        extraRulePaths.push(absPath);
    }

    const mergedValidation = validateRuleSet(merged);
    if (!mergedValidation.valid) {
        throw new Error(`Merged rule set invalid: ${mergedValidation.errors.join("; ")}`);
    }
    warnings.push(...mergedValidation.warnings);

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
