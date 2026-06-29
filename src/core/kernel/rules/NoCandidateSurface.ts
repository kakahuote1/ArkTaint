import { InvokeSite, TransferNoCandidateCallsite } from "./TransferTypes";
import type { ApiEffectRuntimeIndexLike } from "../../api/effects";

interface WrapperOwnerMethodLike {
    getSignature?: () => { toString?: () => string } | undefined;
}

export function buildNoCandidateCallsiteRecord(
    site: InvokeSite,
    owner?: WrapperOwnerMethodLike,
    apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike,
): TransferNoCandidateCallsite {
    void owner;
    const canonicalApiId = resolveExactCanonicalApiId(site, apiEffectRuntimeIndex);

    return {
        calleeSignature: site.signature,
        ...(canonicalApiId ? { canonicalApiId } : {}),
        method: site.methodName,
        invokeKind: site.invokeKind,
        argCount: site.args.length,
        sourceFile: site.calleeFilePath,
        count: 1,
    };
}

function resolveExactCanonicalApiId(
    site: InvokeSite,
    apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike,
): string | undefined {
    if (!apiEffectRuntimeIndex || !site.stmt) {
        return undefined;
    }
    const sites = apiEffectRuntimeIndex
        .getCanonicalOccurrenceSitesForStmt(site.stmt)
        .filter(occurrenceSite => occurrenceSite.resolvedOccurrence.status === "accepted")
        .map(occurrenceSite => occurrenceSite.resolvedOccurrence.canonicalApiId)
        .filter((value): value is string => typeof value === "string" && value.length > 0);
    const unique = [...new Set(sites)];
    return unique.length === 1 ? unique[0] : undefined;
}
