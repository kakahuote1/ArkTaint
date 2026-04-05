import {
    BaseRule,
    RuleLayer,
    RuleScopeConstraint,
    RuleStringConstraint,
    RuleTier,
    SanitizerRule,
    SinkRule,
    SourceRule,
    TaintRuleSet,
    TransferRule,
} from "./RuleSchema";

export type RuleGovernanceOriginKind =
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

export interface RuleGovernanceOrigin {
    kind: RuleGovernanceOriginKind;
    path?: string;
}

type GovernableRule = SourceRule | SinkRule | SanitizerRule | TransferRule;
type RuleSemanticKind = "source" | "sink" | "sanitizer" | "transfer";
type FrameworkGovernanceFamilyHint = {
    kind: RuleSemanticKind;
    pattern: RegExp;
    family: string | ((match: RegExpMatchArray) => string);
    defaultTier?: RuleTier;
    exactTier?: RuleTier;
    signatureTier?: RuleTier;
};

function isSourceRule(rule: GovernableRule): rule is SourceRule {
    return Object.prototype.hasOwnProperty.call(rule, "sourceKind");
}

function isTransferRule(rule: GovernableRule): rule is TransferRule {
    return Object.prototype.hasOwnProperty.call(rule, "from")
        && Object.prototype.hasOwnProperty.call(rule, "to");
}

function resolveRuleKind(rule: GovernableRule, explicitKind?: RuleSemanticKind): RuleSemanticKind {
    if (explicitKind) return explicitKind;
    if (isSourceRule(rule)) return "source";
    if (isTransferRule(rule)) return "transfer";
    return "sink";
}

const FRAMEWORK_GOVERNANCE_HINTS: readonly FrameworkGovernanceFamilyHint[] = [
    {
        kind: "sink",
        pattern: /^sink\.harmony\.hilog\.(info|error)\.arg3(?:\.(exact|sig))?$/,
        family: match => `sink.harmony.hilog.${match[1]}`,
        defaultTier: "B",
        exactTier: "A",
        signatureTier: "C",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.router\.pushUrl\.arg0(?:\.(exact|sig))?$/,
        family: "sink.harmony.router.pushUrl",
        defaultTier: "C",
        exactTier: "A",
        signatureTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.sms\.sendMessage(?:\.v2)?$/,
        family: "sink.harmony.sms",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.rpc\.sendMessageRequest$/,
        family: "sink.harmony.rpc",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.webview\.(loadData|registerJavaScriptProxy)$/,
        family: "sink.harmony.webview",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.hilog\.(debug|warn)$/,
        family: "sink.harmony.log",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.dataShare\.(insert|update|batchInsert|publish)$/,
        family: "sink.harmony.datashare",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.rdb\.(execute|insert|batchInsert|transaction\.(?:insert|update|execute))$/,
        family: "sink.harmony.database",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.(?:bt\.(?:sppWrite|sppWriteAsync)|ble\.(?:writeCharacteristic|writeDescriptor|notifyCharacteristic))$/,
        family: "sink.harmony.bluetooth",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.notification\.publish$/,
        family: "sink.harmony.notification",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.pasteboard\.(setData|setPasteData)$/,
        family: "sink.harmony.pasteboard",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.navPathStack\.(pushPath|pushPathByName|replacePath)$/,
        family: "sink.harmony.navigation",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.telephony\.(dial|dialCall|makeCall)$/,
        family: "sink.harmony.telephony",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.fs\.(writeSync|copyFile|moveFile)$/,
        family: "sink.harmony.file",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.(?:ability\.startServiceExtension|wantAgent\.trigger)$/,
        family: "sink.harmony.ability",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.router\.replaceUrl$/,
        family: "sink.harmony.router",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.contact\.(addContact|updateContact)$/,
        family: "sink.harmony.contact",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.calendar\.(addEvent|addEvents)$/,
        family: "sink.harmony.calendar",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.hiAppEvent\.write$/,
        family: "sink.harmony.logging",
        defaultTier: "B",
    },
    {
        kind: "sink",
        pattern: /^sink\.harmony\.print\.print$/,
        family: "sink.harmony.print",
        defaultTier: "B",
    },
    {
        kind: "transfer",
        pattern: /^transfer\.harmony\.json\.(stringify|parse)\.arg0_to_result(?:\.(exact|sig))?$/,
        family: match => `transfer.harmony.json.${match[1]}`,
        defaultTier: "B",
        exactTier: "A",
        signatureTier: "C",
    },
];

function resolveFrameworkGovernanceHint(
    rule: GovernableRule,
    explicitKind?: RuleSemanticKind,
): { family?: string; tier?: RuleTier } | undefined {
    const ruleId = typeof rule.id === "string" ? rule.id.trim() : "";
    if (ruleId.length === 0) {
        return undefined;
    }
    const kind = resolveRuleKind(rule, explicitKind);
    for (const hint of FRAMEWORK_GOVERNANCE_HINTS) {
        if (hint.kind !== kind) continue;
        const match = ruleId.match(hint.pattern);
        if (!match) continue;
        const family = typeof hint.family === "function" ? hint.family(match) : hint.family;
        let tier = hint.defaultTier;
        if (ruleId.endsWith(".exact") && hint.exactTier) {
            tier = hint.exactTier;
        } else if (ruleId.endsWith(".sig") && hint.signatureTier) {
            tier = hint.signatureTier;
        }
        return { family, tier };
    }
    return undefined;
}

function resolveRuleSubkind(rule: GovernableRule, explicitKind?: RuleSemanticKind): string {
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
    if (normalized.length > 0) {
        return normalized;
    }
    return `h${stableHash(text).slice(0, 8)}`;
}

function resolveMethodTokenFromSignatureLike(text: string): string | undefined {
    const signatureMethodMatch = String(text || "").match(/:\s+.*?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^()]*\)\s*>?$/);
    if (signatureMethodMatch?.[1]) {
        return signatureMethodMatch[1];
    }
    const identifiers = String(text || "").match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
    if (identifiers.length === 0) return undefined;
    return identifiers[identifiers.length - 1];
}

function resolveScopeToken(constraint: RuleStringConstraint | undefined): string | undefined {
    if (!constraint || typeof constraint.value !== "string") return undefined;
    if (constraint.mode === "regex") {
        return `re_${stableHash(constraint.value).slice(0, 8)}`;
    }
    return normalizeFamilySegment(constraint.value);
}

function resolveFamilyAnchor(rule: GovernableRule): string {
    const match = rule.match;
    const scopeClass = resolveScopeToken(rule.scope?.className);
    const scopeMethod = resolveScopeToken(rule.scope?.methodName);

    if (match.kind === "method_name_equals") {
        return `method.${normalizeFamilySegment(match.value)}`;
    }
    if (match.kind === "method_name_regex") {
        return scopeClass
            ? `method_re.${scopeClass}.${stableHash(match.value).slice(0, 8)}`
            : `method_re.${stableHash(match.value).slice(0, 8)}`;
    }
    if (match.kind === "local_name_regex") {
        return `local_re.${stableHash(match.value).slice(0, 8)}`;
    }
    if (match.kind === "declaring_class_equals") {
        const klass = normalizeFamilySegment(match.value);
        return scopeMethod
            ? `class_method.${klass}.${scopeMethod}`
            : `class.${klass}`;
    }
    if (match.kind === "signature_equals" || match.kind === "signature_contains") {
        const method = resolveMethodTokenFromSignatureLike(match.value);
        if (method) {
            return `method.${normalizeFamilySegment(method)}`;
        }
        return `signature.${stableHash(match.value).slice(0, 8)}`;
    }
    if (match.kind === "signature_regex") {
        return `signature_re.${stableHash(match.value).slice(0, 8)}`;
    }

    const fallbackMethod = resolveMethodTokenFromSignatureLike(match.value);
    if (fallbackMethod) {
        return `method.${normalizeFamilySegment(fallbackMethod)}`;
    }
    return `match.${normalizeFamilySegment(match.kind)}.${stableHash(match.value).slice(0, 8)}`;
}

function hasStrongScopeConstraint(scope: RuleScopeConstraint | undefined): boolean {
    if (!scope) return false;
    return !!(scope.file || scope.module || scope.className || scope.methodName);
}

function hasStrongScopeAnchor(rule: GovernableRule): boolean {
    const sourceRule = isSourceRule(rule) ? rule : undefined;
    return hasStrongScopeConstraint(rule.scope)
        || hasStrongScopeConstraint(sourceRule?.calleeScope);
}

function inferTierFromMatch(rule: GovernableRule): RuleTier {
    const match = rule.match;
    if (match.kind === "signature_equals") return "A";
    if (match.kind === "declaring_class_equals") return "B";
    if (match.kind === "signature_contains" || match.kind === "signature_regex" || match.kind === "method_name_regex") {
        return "B";
    }
    if (match.kind === "method_name_equals") {
        const anchoredByShape = !!(
            (match.invokeKind && match.invokeKind !== "any")
            || match.argCount !== undefined
            || (typeof match.typeHint === "string" && match.typeHint.trim().length > 0)
            || hasStrongScopeAnchor(rule)
        );
        return anchoredByShape ? "B" : "C";
    }
    if (match.kind === "local_name_regex") {
        return "B";
    }
    return "B";
}

export function inferRuleLayer(origin: RuleGovernanceOrigin): RuleLayer {
    switch (origin.kind) {
        case "builtin_kernel_json":
        case "kernel_callback_catalog":
        case "kernel_api_catalog":
        case "entry_contract":
            return "kernel";
        case "builtin_project_pack_json":
        case "external_project_json":
        case "user_project_extra_json":
        case "runtime_project":
        case "plugin_runtime":
        case "llm_candidate_json":
            return "project";
    }
}

export function inferRuleFamily(rule: GovernableRule, origin: RuleGovernanceOrigin, explicitKind?: RuleSemanticKind): string {
    const explicitFamily = typeof rule.family === "string" ? rule.family.trim() : "";
    if (explicitFamily.length > 0) {
        return explicitFamily;
    }
    if (origin.kind === "builtin_kernel_json") {
        const hinted = resolveFrameworkGovernanceHint(rule, explicitKind);
        if (hinted?.family) {
            return hinted.family;
        }
    }

    const kind = resolveRuleKind(rule, explicitKind);
    const subkind = resolveRuleSubkind(rule, explicitKind);
    const anchor = resolveFamilyAnchor(rule);
    return `auto.${kind}.${subkind}.${anchor}`;
}

export function inferRuleTier(rule: GovernableRule, origin: RuleGovernanceOrigin): RuleTier {
    if (rule.tier) {
        return rule.tier;
    }
    if (origin.kind === "builtin_kernel_json") {
        const hinted = resolveFrameworkGovernanceHint(rule);
        if (hinted?.tier) {
            return hinted.tier;
        }
    }
    if (origin.kind === "llm_candidate_json") {
        return "C";
    }
    return inferTierFromMatch(rule);
}

export function normalizeRuleGovernance<T extends GovernableRule>(
    rule: T,
    origin: RuleGovernanceOrigin,
    explicitKind?: RuleSemanticKind,
): T {
    const layer = inferRuleLayer(origin);
    const family = inferRuleFamily(rule, origin, explicitKind);
    const tier = inferRuleTier(rule, origin);
    return {
        ...rule,
        layer,
        family,
        tier,
    };
}

function normalizeRuleArray<T extends GovernableRule>(
    rules: T[] | undefined,
    origin: RuleGovernanceOrigin,
    explicitKind: RuleSemanticKind,
): T[] {
    return (rules || []).map(rule => normalizeRuleGovernance(rule, origin, explicitKind));
}

export function normalizeRuleSetGovernance(ruleSet: TaintRuleSet, origin: RuleGovernanceOrigin): TaintRuleSet {
    return {
        ...ruleSet,
        sources: normalizeRuleArray(ruleSet.sources, origin, "source"),
        sinks: normalizeRuleArray(ruleSet.sinks, origin, "sink"),
        sanitizers: normalizeRuleArray(ruleSet.sanitizers, origin, "sanitizer"),
        transfers: normalizeRuleArray(ruleSet.transfers, origin, "transfer"),
    };
}

export function hasCompleteRuleGovernance(rule: GovernableRule): boolean {
    const family = typeof rule.family === "string" ? rule.family.trim() : "";
    return !!rule.layer && family.length > 0 && !!rule.tier;
}

export function collectRulesMissingGovernance(ruleSet: TaintRuleSet): string[] {
    const missing: string[] = [];
    const visit = (rules: GovernableRule[] | undefined): void => {
        for (const rule of rules || []) {
            if (!hasCompleteRuleGovernance(rule)) {
                missing.push(rule.id);
            }
        }
    };
    visit(ruleSet.sources);
    visit(ruleSet.sinks);
    visit(ruleSet.sanitizers);
    visit(ruleSet.transfers);
    return missing.sort();
}
