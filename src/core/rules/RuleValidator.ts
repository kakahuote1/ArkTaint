import {
    BaseRule,
    RuleEndpoint,
    RuleEndpointRef,
    RuleMatchKind,
    RuleSeverity,
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
    "canonical_api_id_equals",
];

const SOURCE_KINDS = new Set<SourceRuleKind>([
    "seed_local_name",
    "entry_param",
    "call_return",
    "call_arg",
    "field_read",
    "callback_param",
    "bound_state",
]);
const RULE_SEVERITIES = new Set<RuleSeverity>(["low", "medium", "high", "critical"]);
const FORBIDDEN_MATCH_SELECTOR_FIELDS = [
    "calleeClass",
    "invokeKind",
    "argCount",
    "typeHint",
    "literalArgs",
];
const FORBIDDEN_RULE_SELECTOR_FIELDS = [
    "callee" + "Scope",
    "scope",
    "callbackArgIndexes",
    "callbackFieldNames",
    "callbackResolution",
    "paramName",
    "paramType",
    "paramMatchMode",
    "paramNameIncludes",
    "paramTypeIncludes",
];
const API_EFFECT_ROLES = new Set(["source", "sink", "sanitizer", "transfer", "arkmain", "module"]);

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

    for (const field of FORBIDDEN_MATCH_SELECTOR_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(match, field)) {
            out.errors.push(`${rulePath}.match.${field} is a legacy API selector field; use canonical apiEffect binding/effect instead`);
        }
    }
}

function validateApiEffect(rulePath: string, raw: unknown, match: unknown, out: RuleValidationResult): void {
    if (!isObject(raw)) {
        out.errors.push(`${rulePath}.apiEffect is required for trusted runtime rules`);
        return;
    }
    const requiredStringFields = ["canonicalApiId", "assetId", "surfaceId", "bindingId", "effectTemplateId"];
    for (const field of requiredStringFields) {
        if (!isNonEmptyString(raw[field])) {
            out.errors.push(`${rulePath}.apiEffect.${field} must be a non-empty string`);
        }
    }
    if (typeof raw.role !== "string" || !API_EFFECT_ROLES.has(raw.role)) {
        out.errors.push(`${rulePath}.apiEffect.role is invalid`);
    }
    if (isObject(match) && isNonEmptyString(match.value) && isNonEmptyString(raw.canonicalApiId) && match.value !== raw.canonicalApiId) {
        out.errors.push(`${rulePath}.match.value must equal apiEffect.canonicalApiId`);
    }
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

    const slotWriteMode = value.slotWriteMode;
    if (slotWriteMode !== undefined && slotWriteMode !== "replace" && slotWriteMode !== "append") {
        out.errors.push(`${rulePath}.${fieldName}.slotWriteMode must be replace/append`);
    }

    const taintScope = value.taintScope;
    if (taintScope !== undefined && taintScope !== "self" && taintScope !== "contained-values") {
        out.errors.push(`${rulePath}.${fieldName}.taintScope must be self/contained-values`);
    }

    if (pathFrom !== undefined && !isNonEmptyString(slotKind)) {
        out.errors.push(`${rulePath}.${fieldName}.slotKind is required when pathFrom is set`);
    }
    if (pathFrom === undefined && slotKind !== undefined) {
        out.errors.push(`${rulePath}.${fieldName}.slotKind requires pathFrom`);
    }
    if (slotWriteMode !== undefined && (pathFrom === undefined || !isNonEmptyString(slotKind))) {
        out.errors.push(`${rulePath}.${fieldName}.slotWriteMode requires pathFrom and slotKind`);
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
    if (rule.family !== undefined && !isNonEmptyString(rule.family)) {
        out.errors.push(`${rulePath}.family must be a non-empty string`);
    }
    const obsoletePriorityField = "ti" + "er";
    if (Object.prototype.hasOwnProperty.call(rule, obsoletePriorityField)) {
        out.errors.push(`${rulePath}.${obsoletePriorityField} is an obsolete priority field; use canonical apiEffect identity, family, and endpoint binding`);
    }

    if (rule.severity !== undefined) {
        if (typeof rule.severity !== "string" || !RULE_SEVERITIES.has(rule.severity as RuleSeverity)) {
            out.errors.push(`${rulePath}.severity must be low/medium/high/critical`);
        }
    }
    if (rule.category !== undefined && !isNonEmptyString(rule.category)) {
        out.errors.push(`${rulePath}.category must be a non-empty string`);
    }
    for (const field of FORBIDDEN_RULE_SELECTOR_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(rule, field)) {
            out.errors.push(`${rulePath}.${field} is a legacy API selector field; use canonical apiEffect binding/effect instead`);
        }
    }

    validateMatch(rulePath, rule.match, out);
    validateApiEffect(rulePath, rule.apiEffect, rule.match, out);

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
