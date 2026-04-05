import type {
    ExecutionHandoffActivationToken,
    ExecutionHandoffContinuationRole,
    HandoffActivationLabel,
    HandoffResumeKind,
} from "../handoff/ExecutionHandoffContract";

export type DeferredCompletionContinuationKind = "then" | "catch" | "finally";
export type DeferredCompletionSettlementHint = "fulfilled" | "rejected" | "unknown";

export interface DeferredCompletionSemantics {
    activationLabel: HandoffActivationLabel;
    activation: ExecutionHandoffActivationToken;
    completion: HandoffResumeKind;
    preserve: ExecutionHandoffActivationToken[];
    continuationKind: DeferredCompletionContinuationKind;
    continuationRole: ExecutionHandoffContinuationRole;
}

export function detectDeferredCompletionKind(value: any): DeferredCompletionContinuationKind | undefined {
    const methodName = value?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || value || "";
    if (methodName === "then" || methodName === "catch" || methodName === "finally") {
        return methodName;
    }
    const sig = value?.getMethodSignature?.()?.toString?.() || String(value || "");
    if (sig.includes(".then()")) return "then";
    if (sig.includes(".catch()")) return "catch";
    if (sig.includes(".finally()")) return "finally";
    return undefined;
}

export function recoverDeferredCompletionSemantics(options: {
    invokeName: string | null;
    matchingArgIndexes: number[];
    payloadPorts: number;
    hasResumeAnchor: boolean;
}): DeferredCompletionSemantics | undefined {
    const continuationKind = detectDeferredCompletionKind(options.invokeName);
    if (!continuationKind) {
        return undefined;
    }

    if (continuationKind === "finally" && options.matchingArgIndexes.includes(0) && options.payloadPorts === 0) {
        return {
            activationLabel: "settle_a",
            activation: "settle(any)",
            completion: options.hasResumeAnchor ? "await_site" : "promise_chain",
            preserve: ["settle(any)"],
            continuationKind,
            continuationRole: "observe",
        };
    }

    if (continuationKind === "catch" && options.matchingArgIndexes.includes(0)) {
        return {
            activationLabel: "settle_r",
            activation: "settle(rejected)",
            completion: options.hasResumeAnchor ? "await_site" : "promise_chain",
            preserve: ["settle(fulfilled)"],
            continuationKind,
            continuationRole: "error",
        };
    }

    if (continuationKind === "then" && options.matchingArgIndexes.includes(0)) {
        return {
            activationLabel: "settle_f",
            activation: "settle(fulfilled)",
            completion: options.hasResumeAnchor ? "await_site" : "promise_chain",
            preserve: options.matchingArgIndexes.includes(1) ? [] : ["settle(rejected)"],
            continuationKind,
            continuationRole: "value",
        };
    }

    if (continuationKind === "then" && options.matchingArgIndexes.includes(1)) {
        return {
            activationLabel: "settle_r",
            activation: "settle(rejected)",
            completion: options.hasResumeAnchor ? "await_site" : "promise_chain",
            preserve: [],
            continuationKind,
            continuationRole: "error",
        };
    }

    return undefined;
}

export function resolveDeferredCompletionCallbackArgIndexes(
    continuationKind: DeferredCompletionContinuationKind,
    argCount: number,
    settlementHint: DeferredCompletionSettlementHint,
): number[] {
    if (continuationKind === "finally") {
        return argCount >= 1 ? [0] : [];
    }
    if (continuationKind === "catch") {
        return argCount >= 1 && settlementHint !== "fulfilled" ? [0] : [];
    }
    if (argCount === 0) return [];
    if (settlementHint === "fulfilled") return [0];
    if (settlementHint === "rejected") return argCount >= 2 ? [1] : [];

    const indexes: number[] = [];
    if (argCount >= 1) indexes.push(0);
    if (argCount >= 2) indexes.push(1);
    return indexes;
}

export function shouldPassthroughDeferredCompletion(
    continuationKind: DeferredCompletionContinuationKind,
    argCount: number,
    settlementHint: DeferredCompletionSettlementHint,
): boolean {
    const hasFirstCallback = argCount >= 1;
    const hasSecondCallback = argCount >= 2;

    if (continuationKind === "finally") return true;
    if (continuationKind === "catch") {
        return settlementHint === "fulfilled";
    }
    if (settlementHint === "fulfilled") return !hasFirstCallback;
    if (settlementHint === "rejected") return !hasSecondCallback;
    return !hasSecondCallback;
}
