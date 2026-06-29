import {
    BaseRule,
    SanitizerRule,
    SinkRule,
    SourceRule,
    TaintRuleSet,
    TransferRule,
} from "./RuleSchema";

export type RuleOriginKind =
    | "builtin_kernel_json"
    | "builtin_project_pack_json"
    | "kernel_callback_catalog"
    | "kernel_api_catalog"
    | "entry_contract"
    | "external_project_json"
    | "user_project_extra_json"
    | "llm_candidate_json"
    | "runtime_project"
    | "plugin_runtime";

export interface RuleOrigin {
    kind: RuleOriginKind;
    path?: string;
}

type RuleWithFamily = SourceRule | SinkRule | SanitizerRule | TransferRule;
type RuleSemanticKind = "source" | "sink" | "sanitizer" | "transfer";

function isSourceRule(rule: RuleWithFamily): rule is SourceRule {
    return Object.prototype.hasOwnProperty.call(rule, "sourceKind");
}

function isTransferRule(rule: RuleWithFamily): rule is TransferRule {
    return Object.prototype.hasOwnProperty.call(rule, "from")
        && Object.prototype.hasOwnProperty.call(rule, "to");
}

function resolveRuleKind(rule: RuleWithFamily, explicitKind?: RuleSemanticKind): RuleSemanticKind {
    if (explicitKind) return explicitKind;
    if (isSourceRule(rule)) return "source";
    if (isTransferRule(rule)) return "transfer";
    return "sink";
}

function resolveRuleSubkind(rule: RuleWithFamily, explicitKind?: RuleSemanticKind): string {
    if (isSourceRule(rule)) return rule.sourceKind;
    return resolveRuleKind(rule, explicitKind);
}

function stableHash(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeFamilySegment(text: string): string {
    const normalized = String(text || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_$]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized.length > 0 ? normalized : `h${stableHash(text).slice(0, 8)}`;
}

function resolveFamilyAnchor(rule: BaseRule): string {
    const match = rule.match;
    return `canonical.${stableHash(match.value).slice(0, 12)}`;
}

export function inferRuleFamily(rule: RuleWithFamily, _origin: RuleOrigin, explicitKind?: RuleSemanticKind): string {
    const explicitFamily = typeof rule.family === "string" ? rule.family.trim() : "";
    if (explicitFamily.length > 0) return explicitFamily;
    if (rule.apiEffect) {
        const role = normalizeFamilySegment(rule.apiEffect.role || resolveRuleKind(rule, explicitKind));
        const asset = normalizeFamilySegment(rule.apiEffect.assetId || "asset");
        const binding = normalizeFamilySegment(rule.apiEffect.bindingId || rule.id || "binding");
        return `api.${role}.${asset}.${binding}`;
    }
    throw new Error(`rule ${rule.id} has no apiEffect; trusted runtime rules must be backed by canonical effect identity`);
}

export function normalizeRuleFamily<T extends RuleWithFamily>(
    rule: T,
    origin: RuleOrigin,
    explicitKind?: RuleSemanticKind,
): T {
    return {
        ...rule,
        family: inferRuleFamily(rule, origin, explicitKind),
    };
}

function normalizeRuleArray<T extends RuleWithFamily>(
    rules: T[] | undefined,
    origin: RuleOrigin,
    explicitKind: RuleSemanticKind,
): T[] {
    return (rules || []).map(rule => normalizeRuleFamily(rule, origin, explicitKind));
}

export function normalizeRuleSetFamilies(ruleSet: TaintRuleSet, origin: RuleOrigin): TaintRuleSet {
    return {
        ...ruleSet,
        sources: normalizeRuleArray(ruleSet.sources, origin, "source"),
        sinks: normalizeRuleArray(ruleSet.sinks, origin, "sink"),
        sanitizers: normalizeRuleArray(ruleSet.sanitizers, origin, "sanitizer"),
        transfers: normalizeRuleArray(ruleSet.transfers, origin, "transfer"),
    };
}

export function collectRulesMissingFamily(ruleSet: TaintRuleSet): string[] {
    const missing: string[] = [];
    const visit = (rules: RuleWithFamily[] | undefined): void => {
        for (const rule of rules || []) {
            const family = typeof rule.family === "string" ? rule.family.trim() : "";
            if (family.length === 0) missing.push(rule.id);
        }
    };
    visit(ruleSet.sources);
    visit(ruleSet.sinks);
    visit(ruleSet.sanitizers);
    visit(ruleSet.transfers);
    return missing.sort();
}
