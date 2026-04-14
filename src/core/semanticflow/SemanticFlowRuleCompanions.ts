import type { NormalizedCallsiteItem } from "../model/callsite/callsiteContextSlices";

export function buildRuleCandidateCompanionGroups(
    candidates: NormalizedCallsiteItem[],
): Map<string, NormalizedCallsiteItem[]> {
    const grouped = new Map<string, NormalizedCallsiteItem[]>();
    for (const candidate of candidates) {
        const key = semanticFlowCompanionGroupKey(candidate);
        const bucket = grouped.get(key) || [];
        bucket.push(candidate);
        grouped.set(key, bucket);
    }

    const out = new Map<string, NormalizedCallsiteItem[]>();
    for (const candidate of candidates) {
        const key = semanticFlowCompanionGroupKey(candidate);
        const companions = (grouped.get(key) || []).filter(peer =>
            peer.callee_signature !== candidate.callee_signature
            || peer.method !== candidate.method
            || peer.argCount !== candidate.argCount,
        );
        out.set(semanticFlowRuleCandidateKey(candidate), companions);
    }
    return out;
}

export function semanticFlowRuleCandidateKey(candidate: NormalizedCallsiteItem): string {
    return [
        candidate.callee_signature,
        candidate.sourceFile,
        String(candidate.argCount),
        candidate.invokeKind,
    ].join("|");
}

export function semanticFlowCompanionGroupKey(candidate: NormalizedCallsiteItem): string {
    const owner = semanticFlowDeclaringClassFromSignature(candidate.callee_signature);
    return owner
        ? `${owner}|${candidate.sourceFile}`
        : `__anchor__|${candidate.callee_signature}|${candidate.sourceFile}|${candidate.invokeKind}|${candidate.argCount}`;
}

export function semanticFlowDeclaringClassFromSignature(signature: string): string | undefined {
    const openParen = signature.indexOf("(");
    const methodDot = signature.lastIndexOf(".", openParen >= 0 ? openParen : signature.length);
    if (methodDot < 0) return undefined;
    return signature.slice(0, methodDot).trim();
}
