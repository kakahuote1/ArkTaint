import {
    BaseRule,
    RuleConstraintMode,
    RuleEndpoint,
    RuleLayer,
    EntryParamMatchMode,
    RuleEndpointRef,
    RuleInvokeKind,
    RuleMatchKind,
    RuleScopeConstraint,
    RuleSeverity,
    RuleStringConstraint,
    RuleTier,
    RuleValidationResult,
    SanitizerRule,
    SinkRule,
    SourceRule,
    SourceRuleKind,
    TaintRuleSet,
    TransferRule,
    normalizeEndpoint,
} from "./RuleSchema";

const MATCH_KINDS: RuleMatchKind[] = [
    "signature_contains",
    "signature_equals",
    "signature_regex",
    "declaring_class_equals",
    "method_name_equals",
    "method_name_regex",
    "local_name_regex",
];

const SOURCE_KINDS = new Set<SourceRuleKind>(["seed_local_name", "entry_param", "call_return", "call_arg", "field_read", "callback_param"]);
const RULE_SEVERITIES = new Set<RuleSeverity>(["low", "medium", "high", "critical"]);
const INVOKE_KINDS = new Set<RuleInvokeKind>(["any", "instance", "static"]);
const CONSTRAINT_MODES = new Set<RuleConstraintMode>(["equals", "contains", "regex"]);
const RULE_TIERS = new Set<RuleTier>(["A", "B", "C"]);
const RULE_LAYERS = new Set<RuleLayer>(["kernel", "project"]);
const HIGH_RISK_METHOD_NAMES = new Set(["get", "set", "update", "request", "on"]);
const ENTRY_PARAM_MATCH_MODES = new Set<EntryParamMatchMode>(["name_only", "name_and_type"]);

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuleEndpoint(value: string): value is RuleEndpoint {
    if (value === "base" || value === "result" || value === "matched_param") return true;
    return /^arg\d+$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function hasScopeAnchor(scope: RuleScopeConstraint | undefined): boolean {
    if (!scope) return false;
    return !!(scope.file || scope.module || scope.className || scope.methodName);
}

function hasAnyScopeAnchor(...scopes: Array<RuleScopeConstraint | undefined>): boolean {
    return scopes.some(scope => hasScopeAnchor(scope));
}

function validateMatch(rulePath: string, match: unknown, out: RuleValidationResult): void {
    if (!isObject(match)) {
        out.errors.push(`${rulePath}.match must be an object`);
        return;
    }

    const kind = match.kind;
    const value = match.value;
    if (typeof kind !== "string" || !MATCH_KINDS.includes(kind as RuleMatchKind)) {
        out.errors.push(`${rulePath}.match.kind is invalid`);
    }
    if (typeof value !== "string" || value.trim().length === 0) {
        out.errors.push(`${rulePath}.match.value must be a non-empty string`);
    }

    if ((kind === "signature_regex" || kind === "method_name_regex" || kind === "local_name_regex") && typeof value === "string") {
        try {
            // eslint-disable-next-line no-new
            new RegExp(value);
        } catch (err: any) {
            out.errors.push(`${rulePath}.match.value regex is invalid: ${String(err?.message || err)}`);
        }
    }

    if (match.calleeClass !== undefined) {
        validateStringConstraint(rulePath, "match.calleeClass", match.calleeClass, out);
    }
    if (match.invokeKind !== undefined) {
        if (typeof match.invokeKind !== "string" || !INVOKE_KINDS.has(match.invokeKind as RuleInvokeKind)) {
            out.errors.push(`${rulePath}.match.invokeKind must be any/instance/static`);
        }
    }
    if (match.argCount !== undefined) {
        if (typeof match.argCount !== "number" || !Number.isInteger(match.argCount) || match.argCount < 0) {
            out.errors.push(`${rulePath}.match.argCount must be a non-negative integer`);
        }
    }
    if (match.typeHint !== undefined && !isNonEmptyString(match.typeHint)) {
        out.errors.push(`${rulePath}.match.typeHint must be a non-empty string`);
    }
}

function validateStringConstraint(rulePath: string, fieldName: string, raw: unknown, out: RuleValidationResult): raw is RuleStringConstraint {
    if (!isObject(raw)) {
        out.errors.push(`${rulePath}.${fieldName} must be an object`);
        return false;
    }

    const mode = raw.mode;
    const value = raw.value;
    if (typeof mode !== "string" || !CONSTRAINT_MODES.has(mode as RuleConstraintMode)) {
        out.errors.push(`${rulePath}.${fieldName}.mode must be equals/contains/regex`);
    }
    if (!isNonEmptyString(value)) {
        out.errors.push(`${rulePath}.${fieldName}.value must be a non-empty string`);
    }

    if (mode === "regex" && typeof value === "string") {
        try {
            // eslint-disable-next-line no-new
            new RegExp(value);
        } catch (err: any) {
            out.errors.push(`${rulePath}.${fieldName}.value regex is invalid: ${String(err?.message || err)}`);
        }
    }

    return true;
}

function validateScopeConstraint(
    rulePath: string,
    scope: unknown,
    out: RuleValidationResult,
    fieldName = "scope"
): scope is RuleScopeConstraint {
    if (!isObject(scope)) {
        out.errors.push(`${rulePath}.${fieldName} must be an object`);
        return false;
    }

    const fields: Array<keyof RuleScopeConstraint> = ["file", "module", "className", "methodName"];
    for (const scopeFieldName of fields) {
        const raw = scope[scopeFieldName];
        if (raw === undefined) continue;
        validateStringConstraint(rulePath, `${fieldName}.${scopeFieldName}`, raw, out);
    }
    return true;
}

function validateEndpointRef(
    rulePath: string,
    fieldName: string,
    value: unknown,
    out: RuleValidationResult,
    options: { allowStaticPath?: boolean } = {}
): value is RuleEndpointRef {
    if (!isObject(value)) {
        out.errors.push(`${rulePath}.${fieldName} must be an object`);
        return false;
    }

    const endpoint = value.endpoint;
    if (typeof endpoint !== "string" || !isRuleEndpoint(endpoint)) {
        out.errors.push(`${rulePath}.${fieldName}.endpoint must be base/result/matched_param/argN`);
    }

    const allowStaticPath = options.allowStaticPath === true;
    const path = value.path;
    if (path !== undefined) {
        if (!allowStaticPath) {
            out.errors.push(`${rulePath}.${fieldName}.path is not supported for transfer rules; use pathFrom + slotKind instead`);
        } else if (!Array.isArray(path) || path.length === 0 || path.some(item => !isNonEmptyString(item))) {
            out.errors.push(`${rulePath}.${fieldName}.path must be a non-empty string[]`);
        }
    }

    const pathFrom = value.pathFrom;
    if (pathFrom !== undefined) {
        if (typeof pathFrom !== "string" || !isRuleEndpoint(pathFrom)) {
            out.errors.push(`${rulePath}.${fieldName}.pathFrom must be base/result/matched_param/argN`);
        }
    }

    const slotKind = value.slotKind;
    if (slotKind !== undefined && !isNonEmptyString(slotKind)) {
        out.errors.push(`${rulePath}.${fieldName}.slotKind must be a non-empty string`);
    }

    if (pathFrom !== undefined && !isNonEmptyString(slotKind)) {
        out.errors.push(`${rulePath}.${fieldName}.slotKind is required when pathFrom is set`);
    }
    if (pathFrom === undefined && slotKind !== undefined) {
        out.errors.push(`${rulePath}.${fieldName}.slotKind requires pathFrom`);
    }
    if (path !== undefined && pathFrom !== undefined) {
        out.errors.push(`${rulePath}.${fieldName}.path cannot be combined with pathFrom`);
    }
    if (path !== undefined && slotKind !== undefined) {
        out.errors.push(`${rulePath}.${fieldName}.path cannot be combined with slotKind`);
    }

    return true;
}

function validateEndpointOrRef(
    rulePath: string,
    fieldName: string,
    value: unknown,
    out: RuleValidationResult,
    options: { allowStaticPath?: boolean } = {}
): boolean {
    if (typeof value === "string") {
        if (!isRuleEndpoint(value)) {
            out.errors.push(`${rulePath}.${fieldName} must be base/result/matched_param/argN`);
            return false;
        }
        return true;
    }
    return validateEndpointRef(rulePath, fieldName, value, out, options);
}

function validateRuleCommon(rulePath: string, rule: unknown, out: RuleValidationResult): rule is BaseRule {
    if (!isObject(rule)) {
        out.errors.push(`${rulePath} must be an object`);
        return false;
    }

    if (!isNonEmptyString(rule.id)) {
        out.errors.push(`${rulePath}.id must be a non-empty string`);
        return false;
    }

    if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") {
        out.errors.push(`${rulePath}.enabled must be a boolean`);
    }
    if (rule.description !== undefined && typeof rule.description !== "string") {
        out.errors.push(`${rulePath}.description must be a string`);
    }
    if (rule.tags !== undefined && (!Array.isArray(rule.tags) || rule.tags.some(x => typeof x !== "string"))) {
        out.errors.push(`${rulePath}.tags must be string[]`);
    }
    if (rule.layer !== undefined) {
        if (typeof rule.layer !== "string" || !RULE_LAYERS.has(rule.layer as RuleLayer)) {
            out.errors.push(`${rulePath}.layer must be kernel/project`);
        }
    }
    if (rule.family !== undefined && !isNonEmptyString(rule.family)) {
        out.errors.push(`${rulePath}.family must be a non-empty string`);
    }
    if (rule.tier !== undefined) {
        if (typeof rule.tier !== "string" || !RULE_TIERS.has(rule.tier as RuleTier)) {
            out.errors.push(`${rulePath}.tier must be A/B/C`);
        } else if (!isNonEmptyString(rule.family)) {
            out.warnings.push(`${rulePath}.tier is set but family is missing; tier preference cannot be applied`);
        }
    }

    if (rule.severity !== undefined) {
        if (typeof rule.severity !== "string" || !RULE_SEVERITIES.has(rule.severity as RuleSeverity)) {
            out.errors.push(`${rulePath}.severity must be low/medium/high/critical`);
        }
    }
    if (rule.category !== undefined && !isNonEmptyString(rule.category)) {
        out.errors.push(`${rulePath}.category must be a non-empty string`);
    }

    if (rule.scope !== undefined) {
        validateScopeConstraint(rulePath, rule.scope, out, "scope");
    }
    const sourceLikeRule = rule as unknown as SourceRule;
    if (sourceLikeRule.calleeScope !== undefined) {
        validateScopeConstraint(rulePath, sourceLikeRule.calleeScope, out, "calleeScope");
    }

    validateMatch(rulePath, rule.match, out);
    const normalizedRule = rule as unknown as BaseRule;
    const m = isObject(normalizedRule.match) ? normalizedRule.match : undefined;

    // High-risk gate: generic method names must carry stronger constraints.
    if (m && m.kind === "method_name_equals" && typeof m.value === "string") {
        const methodName = m.value.trim();
        if (HIGH_RISK_METHOD_NAMES.has(methodName)) {
            const hasScopeConstraint = hasAnyScopeAnchor(
                normalizedRule.scope,
                (rule as any).calleeScope as RuleScopeConstraint | undefined
            );
            const invokeKind = m.invokeKind;
            const hasShapeConstraint = (
                (invokeKind !== undefined && invokeKind !== "any")
                || m.argCount !== undefined
                || isNonEmptyString(m.typeHint)
            );
            if (!hasScopeConstraint || !hasShapeConstraint) {
                const missing: string[] = [];
                if (!hasScopeConstraint) missing.push("scope anchor(file/module/className/methodName)");
                if (!hasShapeConstraint) missing.push("match.invokeKind(instance/static)/match.argCount/match.typeHint");
                out.warnings.push(
                    `${rulePath} uses high-risk method_name_equals('${methodName}') without combined constraints `
                    + `(${missing.join(", ")}); consider className/module + match.invokeKind/match.argCount/match.typeHint`
                );
            }
        }
    }

    if (normalizedRule.tier === "C" && m && m.kind === "method_name_equals") {
        const missing: string[] = [];
        if (!isNonEmptyString(normalizedRule.family)) missing.push("family");
        const mk = m.invokeKind;
        if (mk === undefined || mk === "any") missing.push("match.invokeKind(instance/static)");
        if (m.argCount === undefined) missing.push("match.argCount");
        if (!hasAnyScopeAnchor(normalizedRule.scope, (rule as any).calleeScope as RuleScopeConstraint | undefined)) {
            missing.push("scope/calleeScope anchor(file/module/className/methodName)");
        }
        if (missing.length > 0) {
            out.warnings.push(
                `${rulePath} tier C method fallback is under-constrained (${missing.join(", ")}); `
                + `Tier C is intended for anchored fallback only`
            );
        }
    }

    return true;
}

function validateSourceRule(rulePath: string, rule: unknown, out: RuleValidationResult): rule is SourceRule {
    if (!validateRuleCommon(rulePath, rule, out)) return false;
    const obj: any = rule;

    if (obj.sourceKind === undefined) {
        out.errors.push(`${rulePath}.sourceKind is required`);
    } else if (typeof obj.sourceKind !== "string" || !SOURCE_KINDS.has(obj.sourceKind)) {
        out.errors.push(`${rulePath}.sourceKind is invalid for source rule`);
    }

    if (obj.target === undefined) {
        out.errors.push(`${rulePath}.target is required`);
    } else {
        validateEndpointOrRef(rulePath, "target", obj.target, out, { allowStaticPath: true });
    }

    if (obj.calleeScope !== undefined) {
        validateScopeConstraint(rulePath, obj.calleeScope, out, "calleeScope");
    }

    if (obj.callbackArgIndexes !== undefined) {
        if (!Array.isArray(obj.callbackArgIndexes) || obj.callbackArgIndexes.length === 0) {
            out.errors.push(`${rulePath}.callbackArgIndexes must be a non-empty array`);
        } else if (obj.callbackArgIndexes.some((x: unknown) => typeof x !== "number" || !Number.isInteger(x) || x < 0)) {
            out.errors.push(`${rulePath}.callbackArgIndexes must contain non-negative integers only`);
        }
    }
    if (obj.paramNameIncludes !== undefined) {
        if (!Array.isArray(obj.paramNameIncludes) || obj.paramNameIncludes.length === 0 || obj.paramNameIncludes.some((x: unknown) => !isNonEmptyString(x))) {
            out.errors.push(`${rulePath}.paramNameIncludes must be a non-empty string[]`);
        }
    }
    if (obj.paramTypeIncludes !== undefined) {
        if (!Array.isArray(obj.paramTypeIncludes) || obj.paramTypeIncludes.length === 0 || obj.paramTypeIncludes.some((x: unknown) => !isNonEmptyString(x))) {
            out.errors.push(`${rulePath}.paramTypeIncludes must be a non-empty string[]`);
        }
    }
    if (obj.paramMatchMode !== undefined) {
        if (typeof obj.paramMatchMode !== "string" || !ENTRY_PARAM_MATCH_MODES.has(obj.paramMatchMode as EntryParamMatchMode)) {
            out.errors.push(`${rulePath}.paramMatchMode must be name_only/name_and_type`);
        }
    }
    if (obj.sourceKind === "callback_param") {
        const endpoint = normalizeEndpoint(obj.target).endpoint;
        if (typeof endpoint !== "string" || !/^arg\d+$/.test(endpoint)) {
            out.errors.push(`${rulePath}.callback_param requires target endpoint in form argN`);
        }
    }
    return true;
}

function validateSinkRule(rulePath: string, rule: unknown, out: RuleValidationResult): rule is SinkRule {
    if (!validateRuleCommon(rulePath, rule, out)) return false;
    const obj: any = rule;

    if (obj.target !== undefined) {
        validateEndpointOrRef(rulePath, "target", obj.target, out, { allowStaticPath: true });
    }
    return true;
}

function validateTransferRule(rulePath: string, rule: unknown, out: RuleValidationResult): rule is TransferRule {
    if (!validateRuleCommon(rulePath, rule, out)) return false;
    const obj: any = rule;

    if (obj.from === undefined) {
        out.errors.push(`${rulePath}.from is required`);
    } else {
        validateEndpointOrRef(rulePath, "from", obj.from, out, { allowStaticPath: true });
    }
    if (obj.to === undefined) {
        out.errors.push(`${rulePath}.to is required`);
    } else {
        validateEndpointOrRef(rulePath, "to", obj.to, out, { allowStaticPath: true });
    }

    return true;
}

function validateSanitizerRule(rulePath: string, rule: unknown, out: RuleValidationResult): rule is SanitizerRule {
    if (!validateRuleCommon(rulePath, rule, out)) return false;
    const obj: any = rule;

    if (obj.target !== undefined) {
        validateEndpointOrRef(rulePath, "target", obj.target, out, { allowStaticPath: true });
    }

    return true;
}

function checkDuplicateIds(categoryPath: string, rules: BaseRule[], out: RuleValidationResult): void {
    const seen = new Set<string>();
    for (const rule of rules) {
        if (seen.has(rule.id)) {
            out.errors.push(`${categoryPath} contains duplicate id: ${rule.id}`);
            continue;
        }
        seen.add(rule.id);
    }
}

export function validateRuleSet(raw: unknown): RuleValidationResult {
    const out: RuleValidationResult = {
        valid: false,
        errors: [],
        warnings: [],
    };

    if (!isObject(raw)) {
        out.errors.push("rule set must be an object");
        return out;
    }

    const schemaVersion = raw.schemaVersion;
    if (!isNonEmptyString(schemaVersion)) {
        out.errors.push("schemaVersion must be a non-empty string");
    } else if (schemaVersion !== "2.0") {
        out.errors.push(`schemaVersion must be '2.0', got '${schemaVersion}'`);
    }

    if (!Array.isArray(raw.sources)) {
        out.errors.push("sources must be an array");
    }
    if (!Array.isArray(raw.sinks)) {
        out.errors.push("sinks must be an array");
    }
    if (raw.sanitizers !== undefined && !Array.isArray(raw.sanitizers)) {
        out.errors.push("sanitizers must be an array");
    }
    if (!Array.isArray(raw.transfers)) {
        out.errors.push("transfers must be an array");
    }

    const sourceRules: SourceRule[] = [];
    const sinkRules: SinkRule[] = [];
    const sanitizerRules: SanitizerRule[] = [];
    const transferRules: TransferRule[] = [];

    if (Array.isArray(raw.sources)) {
        raw.sources.forEach((rule, idx) => {
            const p = `sources[${idx}]`;
            if (validateSourceRule(p, rule, out)) sourceRules.push(rule as SourceRule);
        });
    }
    if (Array.isArray(raw.sinks)) {
        raw.sinks.forEach((rule, idx) => {
            const p = `sinks[${idx}]`;
            if (validateSinkRule(p, rule, out)) sinkRules.push(rule as SinkRule);
        });
    }
    if (Array.isArray(raw.sanitizers)) {
        raw.sanitizers.forEach((rule, idx) => {
            const p = `sanitizers[${idx}]`;
            if (validateSanitizerRule(p, rule, out)) sanitizerRules.push(rule as SanitizerRule);
        });
    }
    if (Array.isArray(raw.transfers)) {
        raw.transfers.forEach((rule, idx) => {
            const p = `transfers[${idx}]`;
            if (validateTransferRule(p, rule, out)) transferRules.push(rule as TransferRule);
        });
    }

    checkDuplicateIds("sources", sourceRules, out);
    checkDuplicateIds("sinks", sinkRules, out);
    checkDuplicateIds("sanitizers", sanitizerRules, out);
    checkDuplicateIds("transfers", transferRules, out);

    if (sourceRules.length === 0) out.warnings.push("sources is empty");
    if (sinkRules.length === 0) out.warnings.push("sinks is empty");
    if (transferRules.length === 0) out.warnings.push("transfers is empty");

    out.valid = out.errors.length === 0;
    return out;
}

export function assertValidRuleSet(raw: unknown, label: string): asserts raw is TaintRuleSet {
    const result = validateRuleSet(raw);
    if (!result.valid) {
        const details = result.errors.map(e => `- ${e}`).join("\n");
        throw new Error(`Invalid rule set '${label}':\n${details}`);
    }
}
