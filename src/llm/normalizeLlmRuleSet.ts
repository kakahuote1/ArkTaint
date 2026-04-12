import { SourceRuleKind, TaintRuleSet } from "../core/rules/RuleSchema";

const SOURCE_KIND_ALLOWED = new Set<string>([
    "seed_local_name",
    "entry_param",
    "call_return",
    "call_arg",
    "field_read",
    "callback_param",
]);

/** Common model mistakes / alternate spellings → engine enum */
const SOURCE_KIND_ALIASES: Record<string, SourceRuleKind> = {
    entry_parameters: "entry_param",
    entry_parameter: "entry_param",
    entryparam: "entry_param",
    callback_parameters: "callback_param",
    callback_parameter: "callback_param",
    callback: "callback_param",
    field: "field_read",
    fieldread: "field_read",
    seed: "seed_local_name",
    seedlocalname: "seed_local_name",
    callreturn: "call_return",
    call_return_value: "call_return",
    callargument: "call_arg",
    call_arguments: "call_arg",
    callargumentvalue: "call_arg",
    /** Some models invent names */
    api_source: "call_return",
    parameter_source: "entry_param",
    intent_source: "entry_param",
    user_input: "entry_param",
    external_input: "entry_param",
};

function slugSourceKind(raw: string): string {
    return raw
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLowerCase();
}

function resolveSourceKind(raw: unknown): SourceRuleKind | undefined {
    if (typeof raw !== "string") return undefined;
    const s = raw.trim();
    if (!s) return undefined;
    if (SOURCE_KIND_ALLOWED.has(s)) return s as SourceRuleKind;
    const slug = slugSourceKind(s);
    if (SOURCE_KIND_ALLOWED.has(slug)) return slug as SourceRuleKind;
    const alias = SOURCE_KIND_ALIASES[slug] ?? SOURCE_KIND_ALIASES[s.toLowerCase()];
    return alias;
}

/**
 * Fix invalid LLM output before schema validation (sourceKind, etc.).
 * Drops source rules that cannot be fixed; logs warnings to console.
 */
export function normalizeLlmTaintRuleSet(ruleSet: TaintRuleSet): TaintRuleSet {
    const sources = ruleSet.sources || [];
    const kept: typeof sources = [];
    const dropped: string[] = [];

    for (const r of sources) {
        const fixed = resolveSourceKind(r.sourceKind);
        if (fixed) {
            kept.push({ ...r, sourceKind: fixed });
        } else {
            dropped.push(`${r.id}: sourceKind=${JSON.stringify((r as { sourceKind?: unknown }).sourceKind)}`);
        }
    }

    if (dropped.length) {
        // eslint-disable-next-line no-console
        console.warn(
            `normalizeLlmTaintRuleSet: dropped ${dropped.length} invalid source rule(s):\n  ${dropped.join("\n  ")}`,
        );
    }

    return {
        ...ruleSet,
        sources: kept,
    };
}

export function allowedSourceKindsForPrompt(): string {
    return [...SOURCE_KIND_ALLOWED].sort().join(", ");
}
