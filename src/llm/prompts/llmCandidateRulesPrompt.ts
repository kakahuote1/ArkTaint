import { allowedSourceKindsForPrompt } from "../normalizeLlmRuleSet";

export interface LlmCandidateBudget {
    maxSources: number;
    maxSinks: number;
    maxTransfers: number;
}

const RULE_SET_SHAPE = [
    "Return ONE JSON object with exactly two top-level keys: \"evidenceAck\" and \"taintRuleSet\".",
    "\"evidenceAck\" is string[] (0-24 short bullets). For each major evidence cluster, state what semantic role you infer (source/sink/transfer/ignore) and why, in <= 200 chars per bullet.",
    "\"taintRuleSet\" MUST be TaintRuleSet: { schemaVersion: '2.0', meta?: {...}, sources: SourceRule[], sinks: SinkRule[], sanitizers?: SanitizerRule[], transfers: TransferRule[] }.",
    "Do NOT put rules outside taintRuleSet.",
].join("\n");

const SOURCE_KIND_ENUM = allowedSourceKindsForPrompt().replace(/, /g, " | ");

const RULE_CONSTRAINTS = [
    "All rules must have: id, match {kind,value}, and correct endpoint fields.",
    `SourceRule: id, match, sourceKind (EXACTLY one of: ${SOURCE_KIND_ENUM}), target`,
    "SinkRule: id, match",
    "TransferRule: id, match, from, to",
    "scope.file / scope.module / scope.className / scope.methodName MUST be object: {\"mode\":\"contains|equals|regex\",\"value\":\"...\"}, never plain string",
    "target/from/to MUST be one of: \"base\" | \"result\" | \"matched_param\" | \"argN\" OR endpoint ref object",
    "Prefer precision and low false-positives over recall. If uncertain, omit the rule.",
    "DO NOT output legacy fields like kind/profile/sinkTarget/fromRef/toRef/targetRef.",
].join("\n");

export function buildLlmCandidateRulesPrompt(input: {
    candidates: any[];
    budget: LlmCandidateBudget;
}): { system: string; user: string } {
    const system = [
        "You are a security rules engineer for a taint analysis engine.",
        "Work in two phases internally: (1) read evidence and optional source windows, (2) emit concise evidenceAck bullets, (3) emit only high-confidence rules inside taintRuleSet.",
        RULE_SET_SHAPE,
        RULE_CONSTRAINTS,
        "Your ONLY output must be a single JSON object (no markdown fences, no commentary outside JSON).",
    ].join("\n");

    const user = [
        "Task:",
        "Given no-candidate callsite evidence — including optional CFG/source line windows — propose candidate taint rules.",
        "When the input comes from analyze feedback, prefer pre-filtered pools such as no_candidate_project_candidates.json (C2 project wrappers) over raw no_candidate_callsites.json to reduce UI noise.",
        "",
        "Hard constraints:",
        "- Output JSON only. Parseable as one object.",
        "- Top-level keys MUST be exactly: \"evidenceAck\" (string[]) and \"taintRuleSet\" (object).",
        "- taintRuleSet.schemaVersion MUST be '2.0'.",
        "- Prefer TransferRule over Source/Sink unless evidence clearly indicates source/sink semantics.",
        `- For SourceRule.sourceKind use ONLY these exact strings (no synonyms): ${SOURCE_KIND_ENUM}.`,
        "- Prefer match.kind='signature_equals' with the exact callee_signature from evidence when stable; include match.invokeKind and match.argCount when known.",
        "- If you use method_name_equals or method_name_regex, you MUST add scope.file or scope.className AND match.invokeKind AND match.argCount.",
        "- Avoid generic method names (get/set/update/request/on) unless tightly scoped; otherwise set enabled:false or omit.",
        "- Rule ids MUST be unique. Prefix 'llm_candidate.'",
        "- Each rule tags MUST include 'llm_candidate' and one of 'source'/'sink'/'transfer'.",
        "",
        "Evidence field hints:",
        "- contextSlices[].windowLines: numbered source excerpt around the invoke (caller file).",
        "- contextSlices[].cfgNeighborStmts: nearby three-address / IR-like stmts from CFG ordering when present.",
        "- contextError: slice enrichment failed; rely on callee_signature + method + shape only.",
        "",
        `Budget inside taintRuleSet: sources<=${input.budget.maxSources}, sinks<=${input.budget.maxSinks}, transfers<=${input.budget.maxTransfers}.`,
        "",
        "Evidence items JSON (each item includes: callee_signature, method, invokeKind, argCount, sourceFile, count, topEntries, reason):",
        JSON.stringify({ items: input.candidates }, null, 2),
        "",
        "Output the JSON object now (evidenceAck + taintRuleSet).",
    ].join("\n");

    return { system, user };
}
