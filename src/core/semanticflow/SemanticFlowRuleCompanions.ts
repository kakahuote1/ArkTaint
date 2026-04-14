import type { NormalizedCallsiteItem } from "../model/callsite/callsiteContextSlices";

export function buildRuleCandidateCompanionGroups(
    candidates: NormalizedCallsiteItem[],
): Map<string, NormalizedCallsiteItem[]> {
    const grouped = new Map<string, NormalizedCallsiteItem[]>();
    for (const candidate of candidates) {
        for (const key of semanticFlowCompanionGroupKeys(candidate)) {
            const bucket = grouped.get(key) || [];
            bucket.push(candidate);
            grouped.set(key, bucket);
        }
    }

    const out = new Map<string, NormalizedCallsiteItem[]>();
    for (const candidate of candidates) {
        const companions = dedupeCandidates(
            semanticFlowCompanionGroupKeys(candidate).flatMap(key => grouped.get(key) || []),
        ).filter(peer =>
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
    return semanticFlowCompanionGroupKeys(candidate)[0];
}

function semanticFlowCompanionGroupKeys(candidate: NormalizedCallsiteItem): string[] {
    const owner = semanticFlowDeclaringClassFromSignature(candidate.callee_signature);
    const carrierRoots = Array.isArray((candidate as any).carrierRoots)
        ? [...new Set(((candidate as any).carrierRoots as string[]).map(root => String(root || "").trim()).filter(Boolean))].sort()
        : [];
    if (!owner && carrierRoots.length > 0) {
        return carrierRoots.map(root => `__carrier__|${candidate.sourceFile}|${root}`);
    }
    return [owner
        ? `${owner}|${candidate.sourceFile}`
        : `__anchor__|${candidate.callee_signature}|${candidate.sourceFile}|${candidate.invokeKind}|${candidate.argCount}`];
}

export function semanticFlowDeclaringClassFromSignature(signature: string): string | undefined {
    const openParen = signature.indexOf("(");
    const searchEnd = openParen >= 0 ? openParen : signature.length;
    const lastColon = signature.lastIndexOf(":", searchEnd);
    const ownerStart = lastColon >= 0 ? lastColon + 1 : 0;
    const methodDot = signature.lastIndexOf(".", searchEnd);
    if (methodDot < ownerStart) return undefined;
    const owner = signature.slice(ownerStart, methodDot).trim();
    return owner || undefined;
}

function dedupeCandidates(candidates: NormalizedCallsiteItem[]): NormalizedCallsiteItem[] {
    const seen = new Set<string>();
    const out: NormalizedCallsiteItem[] = [];
    for (const candidate of candidates) {
        const key = semanticFlowRuleCandidateKey(candidate);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(candidate);
    }
    return out;
}
