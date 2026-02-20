import {
    BaseRule,
    RuleConstraintMode,
    RuleEndpoint,
    RuleEndpointRef,
    RuleInvokeKind,
    RuleMatchKind,
    RuleScopeConstraint,
    RuleStringConstraint,
    RuleValidationResult,
    SinkRule,
    SourceRule,
    SourceRuleKind,
    TaintRuleSet,
    TransferRule,
} from "./RuleSchema";

const MATCH_KINDS: RuleMatchKind[] = [
    "signature_contains",
    "signature_equals",
    "signature_regex",
    "callee_signature_equals",
    "declaring_class_equals",
    "method_name_equals",
    "method_name_regex",
    "local_name_regex",
];

const SOURCE_PROFILES = new Set(["seed_local_name", "entry_param"]);
const SOURCE_KINDS = new Set<SourceRuleKind>(["seed_local_name", "entry_param", "call_return", "call_arg", "field_read"]);
const SINK_PROFILES = new Set(["keyword", "signature"]);
const SINK_SEVERITIES = new Set(["low", "medium", "high"]);
const INVOKE_KINDS = new Set<RuleInvokeKind>(["any", "instance", "static"]);
const CONSTRAINT_MODES = new Set<RuleConstraintMode>(["equals", "contains", "regex"]);

const SOURCE_PROFILE_TO_KIND: Record<string, SourceRuleKind> = {
    seed_local_name: "seed_local_name",
    entry_param: "entry_param",
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuleEndpoint(value: string): value is RuleEndpoint {
    if (value === "base" || value === "result") return true;
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

    if ((kind === "signature_regex" || kind === "method_name_regex" || kind === "local_name_regex") && typeof value === "string") {
        try {
            // eslint-disable-next-line no-new
            new RegExp(value);
        } catch (err: any) {
            out.errors.push(`${rulePath}.match.value regex is invalid: ${String(err?.message || err)}`);
        }
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

function validateScopeConstraint(rulePath: string, scope: unknown, out: RuleValidationResult): scope is RuleScopeConstraint {
    if (!isObject(scope)) {
        out.errors.push(`${rulePath}.scope must be an object`);
        return false;
    }

    const fields: Array<keyof RuleScopeConstraint> = ["file", "module", "className", "methodName"];
    for (const fieldName of fields) {
        const raw = scope[fieldName];
        if (raw === undefined) continue;
        validateStringConstraint(rulePath, `scope.${fieldName}`, raw, out);
    }
    return true;
}

function validateEndpointRef(rulePath: string, fieldName: string, value: unknown, out: RuleValidationResult): value is RuleEndpointRef {
    if (!isObject(value)) {
        out.errors.push(`${rulePath}.${fieldName} must be an object`);
        return false;
    }

    const endpoint = value.endpoint;
    if (typeof endpoint !== "string" || !isRuleEndpoint(endpoint)) {
        out.errors.push(`${rulePath}.${fieldName}.endpoint must be base/result/argN`);
    }

    const path = value.path;
    if (path !== undefined) {
        if (!Array.isArray(path) || path.some(x => typeof x !== "string" || x.trim().length === 0)) {
            out.errors.push(`${rulePath}.${fieldName}.path must be non-empty string[]`);
        }
    }

    return true;
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

    if (rule.scope !== undefined) {
        validateScopeConstraint(rulePath, rule.scope, out);
    }
    if (rule.invokeKind !== undefined) {
        if (typeof rule.invokeKind !== "string" || !INVOKE_KINDS.has(rule.invokeKind as RuleInvokeKind)) {
            out.errors.push(`${rulePath}.invokeKind must be any/instance/static`);
        }
    }
    if (rule.argCount !== undefined) {
        if (typeof rule.argCount !== "number" || !Number.isInteger(rule.argCount) || rule.argCount < 0) {
            out.errors.push(`${rulePath}.argCount must be a non-negative integer`);
        }
    }
    if (rule.typeHint !== undefined && !isNonEmptyString(rule.typeHint)) {
        out.errors.push(`${rulePath}.typeHint must be a non-empty string`);
    }

    validateMatch(rulePath, rule.match, out);
    return true;
}

function validateSourceRule(rulePath: string, rule: unknown, out: RuleValidationResult): rule is SourceRule {
    if (!validateRuleCommon(rulePath, rule, out)) return false;
    const obj: any = rule;

    if (obj.profile !== undefined) {
        if (typeof obj.profile !== "string" || !SOURCE_PROFILES.has(obj.profile)) {
            out.errors.push(`${rulePath}.profile is invalid for source rule`);
        }
    }
    if (obj.kind !== undefined) {
        if (typeof obj.kind !== "string" || !SOURCE_KINDS.has(obj.kind)) {
            out.errors.push(`${rulePath}.kind is invalid for source rule`);
        }
    }
    if (obj.profile !== undefined && obj.kind !== undefined) {
        const expected = SOURCE_PROFILE_TO_KIND[String(obj.profile)];
        if (expected && obj.kind !== expected) {
            out.warnings.push(`${rulePath}.profile (${obj.profile}) and kind (${obj.kind}) are inconsistent`);
        }
    }
    if (obj.target !== undefined) {
        if (typeof obj.target !== "string" || !isRuleEndpoint(obj.target)) {
            out.errors.push(`${rulePath}.target must be base/result/argN`);
        }
    }
    if (obj.targetRef !== undefined) {
        validateEndpointRef(rulePath, "targetRef", obj.targetRef, out);
        if (obj.target !== undefined && isObject(obj.targetRef) && obj.targetRef.endpoint !== obj.target) {
            out.errors.push(`${rulePath}.target and targetRef.endpoint must be the same when both are set`);
        }
    }
    return true;
}

function validateSinkRule(rulePath: string, rule: unknown, out: RuleValidationResult): rule is SinkRule {
    if (!validateRuleCommon(rulePath, rule, out)) return false;
    const obj: any = rule;

    if (obj.profile !== undefined) {
        if (typeof obj.profile !== "string" || !SINK_PROFILES.has(obj.profile)) {
            out.errors.push(`${rulePath}.profile is invalid for sink rule`);
        }
    }
    if (obj.severity !== undefined) {
        if (typeof obj.severity !== "string" || !SINK_SEVERITIES.has(obj.severity)) {
            out.errors.push(`${rulePath}.severity is invalid`);
        }
    }
    if (obj.category !== undefined && !isNonEmptyString(obj.category)) {
        out.errors.push(`${rulePath}.category must be a non-empty string`);
    }
    if (obj.sinkTarget !== undefined) {
        if (typeof obj.sinkTarget !== "string" || !isRuleEndpoint(obj.sinkTarget)) {
            out.errors.push(`${rulePath}.sinkTarget must be base/result/argN`);
        }
    }
    if (obj.sinkTargetRef !== undefined) {
        validateEndpointRef(rulePath, "sinkTargetRef", obj.sinkTargetRef, out);
        if (obj.sinkTarget !== undefined && isObject(obj.sinkTargetRef) && obj.sinkTargetRef.endpoint !== obj.sinkTarget) {
            out.errors.push(`${rulePath}.sinkTarget and sinkTargetRef.endpoint must be the same when both are set`);
        }
    }
    return true;
}

function validateTransferRule(rulePath: string, rule: unknown, out: RuleValidationResult): rule is TransferRule {
    if (!validateRuleCommon(rulePath, rule, out)) return false;
    const obj: any = rule;

    if (typeof obj.from !== "string" || !isRuleEndpoint(obj.from)) {
        out.errors.push(`${rulePath}.from must be base/result/argN`);
    }
    if (typeof obj.to !== "string" || !isRuleEndpoint(obj.to)) {
        out.errors.push(`${rulePath}.to must be base/result/argN`);
    }

    if (obj.fromRef !== undefined) {
        validateEndpointRef(rulePath, "fromRef", obj.fromRef, out);
        if (typeof obj.from === "string" && isObject(obj.fromRef) && obj.fromRef.endpoint !== obj.from) {
            out.errors.push(`${rulePath}.from and fromRef.endpoint must be the same when both are set`);
        }
    }
    if (obj.toRef !== undefined) {
        validateEndpointRef(rulePath, "toRef", obj.toRef, out);
        if (typeof obj.to === "string" && isObject(obj.toRef) && obj.toRef.endpoint !== obj.to) {
            out.errors.push(`${rulePath}.to and toRef.endpoint must be the same when both are set`);
        }
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
    } else if (schemaVersion !== "1.1") {
        out.errors.push(`schemaVersion must be '1.1', got '${schemaVersion}'`);
    }

    if (!Array.isArray(raw.sources)) {
        out.errors.push("sources must be an array");
    }
    if (!Array.isArray(raw.sinks)) {
        out.errors.push("sinks must be an array");
    }
    if (!Array.isArray(raw.transfers)) {
        out.errors.push("transfers must be an array");
    }

    const sourceRules: SourceRule[] = [];
    const sinkRules: SinkRule[] = [];
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
    if (Array.isArray(raw.transfers)) {
        raw.transfers.forEach((rule, idx) => {
            const p = `transfers[${idx}]`;
            if (validateTransferRule(p, rule, out)) transferRules.push(rule as TransferRule);
        });
    }

    checkDuplicateIds("sources", sourceRules, out);
    checkDuplicateIds("sinks", sinkRules, out);
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
