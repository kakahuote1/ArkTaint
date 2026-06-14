import type { NormalizedCallsiteItem } from "../model/callsite/callsiteContextSlices";

export interface SemanticFlowRuleInputCandidateTraceSummary {
    key: string;
    method: string;
    calleeSignature: string;
    sourceFile: string;
    candidateOrigin?: string;
    semanticFocus?: string;
    returnType?: string;
}

export type SemanticFlowRuleInputNormalizationEventKind =
    | "input_candidate"
    | "returned_value_sibling_created"
    | "returned_value_sibling_skipped";

export interface SemanticFlowRuleInputNormalizationEvent {
    kind: SemanticFlowRuleInputNormalizationEventKind;
    item: SemanticFlowRuleInputCandidateTraceSummary;
    sibling?: SemanticFlowRuleInputCandidateTraceSummary;
    reason: string;
}

export interface SemanticFlowRuleInputNormalizationTrace {
    rawCount: number;
    normalizedCount: number;
    returnedValueSiblingCreatedCount: number;
    events: SemanticFlowRuleInputNormalizationEvent[];
}

export function normalizeSemanticFlowRuleInputCandidates(
    items: NormalizedCallsiteItem[],
): NormalizedCallsiteItem[] {
    return normalizeSemanticFlowRuleInputCandidatesWithTrace(items).items;
}

export function normalizeSemanticFlowRuleInputCandidatesWithTrace(
    items: NormalizedCallsiteItem[],
): { items: NormalizedCallsiteItem[]; trace: SemanticFlowRuleInputNormalizationTrace } {
    const normalized = [...items];
    const existingKeys = new Set(normalized.map(ruleInputCandidateKey));
    const out: NormalizedCallsiteItem[] = [];
    const events: SemanticFlowRuleInputNormalizationEvent[] = [];
    let returnedValueSiblingCreatedCount = 0;

    for (const item of normalized) {
        out.push(item);
        events.push({
            kind: "input_candidate",
            item: summarizeCandidate(item),
            reason: "rule_input_candidate_observed",
        });
        const skippedReason = returnedValueSiblingSkipReason(item);
        if (skippedReason) {
            events.push({
                kind: "returned_value_sibling_skipped",
                item: summarizeCandidate(item),
                reason: skippedReason,
            });
            continue;
        }
        const sibling = buildReturnedValueFocusSibling(item, existingKeys);
        if (sibling) {
            existingKeys.add(ruleInputCandidateKey(sibling));
            out.push(sibling);
            returnedValueSiblingCreatedCount++;
            events.push({
                kind: "returned_value_sibling_created",
                item: summarizeCandidate(item),
                sibling: summarizeCandidate(sibling),
                reason: "coverage_proven_wrapper_with_meaningful_return",
            });
        } else {
            events.push({
                kind: "returned_value_sibling_skipped",
                item: summarizeCandidate(item),
                reason: "returned_value_sibling_duplicate",
            });
        }
    }

    return {
        items: out,
        trace: {
            rawCount: normalized.length,
            normalizedCount: out.length,
            returnedValueSiblingCreatedCount,
            events,
        },
    };
}

function buildReturnedValueFocusSibling(
    item: NormalizedCallsiteItem,
    existingKeys: Set<string>,
): NormalizedCallsiteItem | undefined {
    if (!shouldAddReturnedValueFocusSibling(item)) {
        return undefined;
    }
    const sibling: NormalizedCallsiteItem = {
        ...item,
        topEntries: [
            ...(Array.isArray(item.topEntries) ? item.topEntries : []),
            "semanticFocus=returned_value_surface",
        ],
        candidateOrigin: "recall_returned_value_surface",
        semanticFocus: "returned_value_surface",
        evidence: [
            ...normalizeStringList((item as any).evidence),
            "origin=recall_returned_value_surface",
            "semanticFocus=returned_value_surface",
        ],
    };
    return existingKeys.has(ruleInputCandidateKey(sibling)) ? undefined : sibling;
}

function shouldAddReturnedValueFocusSibling(item: NormalizedCallsiteItem): boolean {
    return !returnedValueSiblingSkipReason(item);
}

function returnedValueSiblingSkipReason(item: NormalizedCallsiteItem): string | undefined {
    if (isReturnedValueFocus(item)) {
        return "already_returned_value_focus";
    }
    if (!hasMeaningfulReturnValue(item)) {
        return "no_meaningful_return_value";
    }
    if (!hasProjectApiModelingEvidence(item)) {
        return "no_project_api_modeling_evidence";
    }
    return undefined;
}

function hasMeaningfulReturnValue(item: NormalizedCallsiteItem): boolean {
    const returnType = String((item as any).returnType || "").trim().toLowerCase();
    if (!returnType) {
        return methodSnippetHasMeaningfulReturnValue(item);
    }
    return !["void", "undefined", "never", "null"].includes(returnType);
}

function methodSnippetHasMeaningfulReturnValue(item: NormalizedCallsiteItem): boolean {
    const methodSnippet = String((item as any).methodSnippet || "");
    if (!methodSnippet.trim()) {
        return false;
    }
    const normalized = methodSnippet
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*\d+\s*\|\s?/, ""))
        .join("\n");
    if (!/\breturn\s+/.test(normalized)) {
        return false;
    }
    if (/\breturn\s+(?:undefined|null|void\b)/.test(normalized)) {
        return false;
    }
    return /\breturn\s+(?:await\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*(?:<[^;\n]+>)?\s*\(/.test(normalized)
        || /\breturn\s+(?:await\s+)?new\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\s*\(/.test(normalized)
        || /\breturn\s+(?:await\s+)?[A-Za-z_$][\w$]*\s*\(/.test(normalized);
}

function hasProjectApiModelingEvidence(item: NormalizedCallsiteItem): boolean {
    const origin = String((item as any).candidateOrigin || "").trim();
    const entries = Array.isArray(item.topEntries)
        ? item.topEntries.map(entry => String(entry || "").trim())
        : [];
    if (origin === "recall_api_surface" || origin === "recall_direct_boundary_surface") {
        return true;
    }
    return entries.some(entry =>
        entry === "coverageGapReason=coverage.role_endpoint_guard_gap"
        || entry.startsWith("coverageGapSource=")
        || entry === "candidateTier=project-wrapper"
        || entry === "candidateTier=declared-owner-wrapper"
        || entry === "candidateTier=returned-value-wrapper"
        || entry === "candidateReason=network-boundary-effect"
        || entry === "candidateReason=payload-forwarding-boundary"
        || entry === "candidateBoundary=project_or_third_party_wrapper_evidence"
        || entry === "candidateBoundary=direct_project_or_third_party_callsite_evidence");
}

function isReturnedValueFocus(item: NormalizedCallsiteItem): boolean {
    return String((item as any).semanticFocus || "").trim() === "returned_value_surface"
        || String((item as any).candidateOrigin || "").trim() === "recall_returned_value_surface";
}

function ruleInputCandidateKey(item: NormalizedCallsiteItem): string {
    return [
        normalizeSlashes(String(item.sourceFile || "")),
        String(item.callee_signature || ""),
        String(item.method || ""),
        String(item.invokeKind || ""),
        String(item.argCount ?? ""),
        String((item as any).candidateOrigin || ""),
        String((item as any).semanticFocus || ""),
    ].join("\u0000");
}

function summarizeCandidate(item: NormalizedCallsiteItem): SemanticFlowRuleInputCandidateTraceSummary {
    return {
        key: ruleInputCandidateKey(item),
        method: String(item.method || ""),
        calleeSignature: String(item.callee_signature || ""),
        sourceFile: normalizeSlashes(String(item.sourceFile || "")),
        candidateOrigin: String((item as any).candidateOrigin || "") || undefined,
        semanticFocus: String((item as any).semanticFocus || "") || undefined,
        returnType: String((item as any).returnType || "") || undefined,
    };
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map(entry => String(entry || "").trim()).filter(Boolean);
}

function normalizeSlashes(value: string): string {
    return String(value || "").replace(/\\/g, "/");
}
