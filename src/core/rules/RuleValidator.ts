import {
    BaseRule,
    RuleEndpoint,
    RuleMatchKind,
    RuleValidationResult,
    SinkRule,
    SourceRule,
    TaintRuleSet,
    TransferRule,
} from "./RuleSchema";

const MATCH_KINDS: RuleMatchKind[] = [
    "signature_contains",
    "signature_regex",
    "method_name_equals",
    "method_name_regex",
    "local_name_regex",
];

const SOURCE_PROFILES = new Set(["seed_local_name", "entry_param"]);
const SINK_PROFILES = new Set(["keyword", "signature"]);
const SINK_SEVERITIES = new Set(["low", "medium", "high"]);

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuleEndpoint(value: string): value is RuleEndpoint {
    if (value === "base" || value === "result") return true;
    return /^arg\d+$/.test(value);
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
            // Validate regex pattern syntax.
            // eslint-disable-next-line no-new
            new RegExp(value);
        } catch (err: any) {
            out.errors.push(`${rulePath}.match.value regex is invalid: ${String(err?.message || err)}`);
        }
    }
}

function validateRuleCommon(rulePath: string, rule: unknown, out: RuleValidationResult): rule is BaseRule {
    if (!isObject(rule)) {
        out.errors.push(`${rulePath} must be an object`);
        return false;
    }

    if (typeof rule.id !== "string" || rule.id.trim().length === 0) {
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
    if (obj.target !== undefined) {
        if (typeof obj.target !== "string" || !isRuleEndpoint(obj.target)) {
            out.errors.push(`${rulePath}.target must be base/result/argN`);
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
    if (typeof schemaVersion !== "string" || schemaVersion.trim().length === 0) {
        out.errors.push("schemaVersion must be a non-empty string");
    } else if (!schemaVersion.startsWith("1.")) {
        out.warnings.push(`schemaVersion '${schemaVersion}' is not in 1.x range`);
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
