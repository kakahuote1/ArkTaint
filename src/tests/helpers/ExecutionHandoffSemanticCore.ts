import type {
    ExecutionHandoffContractSnapshotItem,
    HandoffTriggerToken,
} from "../../core/kernel/handoff/ExecutionHandoffContract";
import type { ExecutionHandoffCompareCase } from "./ExecutionHandoffCompareManifest";

export type SemanticDomain = "deferred" | "control";
export type PayloadPortClass = "payload0" | "payload+";
export type EnvPortClass = "env0" | "envIn" | "envOut" | "envIO";
export type CompletionClass = "none" | "promise_chain" | "await_site";
export type PreserveClass = "preserve0" | "settle(rejected)" | "settle(fulfilled)" | "settle(any)" | "mixed";

export interface ExecutionHandoffSemanticCore {
    domain: SemanticDomain;
    activation: HandoffTriggerToken;
    payload: PayloadPortClass;
    env: EnvPortClass;
    completion: CompletionClass;
    preserve: PreserveClass;
}

export interface ExecutionHandoffSemanticWitness {
    contractId: string;
    unitSignature: string;
    carrierKind: string;
    pathLabels: string[];
}

export interface ExecutionHandoffSemanticProjection {
    core: ExecutionHandoffSemanticCore;
    witness: ExecutionHandoffSemanticWitness;
}

export function expectedExecutionHandoffSemanticCore(
    spec: ExecutionHandoffCompareCase,
): ExecutionHandoffSemanticCore {
    return {
        domain: spec.factors.deferred ? "deferred" : "control",
        activation: expectedActivation(spec),
        payload: spec.factors.payload === "none" ? "payload0" : "payload+",
        env: expectedEnv(spec),
        completion: expectedCompletion(spec),
        preserve: expectedPreserve(spec),
    };
}

export function projectExecutionHandoffSemanticCore(
    item: ExecutionHandoffContractSnapshotItem,
): ExecutionHandoffSemanticProjection {
    return {
        core: {
            domain: item.kernel.domain,
            activation: item.kernel.activation,
            payload: item.ports.payload,
            env: item.ports.env,
            completion: item.ports.completion,
            preserve: item.ports.preserve,
        },
        witness: {
            contractId: item.id,
            unitSignature: item.unitSignature,
            carrierKind: item.carrierKind,
            pathLabels: [...item.pathLabels],
        },
    };
}

export function executionHandoffSemanticCoreKey(core: ExecutionHandoffSemanticCore): string {
    return [
        core.domain,
        core.activation,
        core.payload,
        core.env,
        core.completion,
        core.preserve,
    ].join("|");
}

export function sameExecutionHandoffSemanticCore(
    expected: ExecutionHandoffSemanticCore,
    observed: ExecutionHandoffSemanticCore,
): boolean {
    return executionHandoffSemanticCoreKey(expected) === executionHandoffSemanticCoreKey(observed);
}

export function executionHandoffSemanticCoreScore(
    expected: ExecutionHandoffSemanticCore,
    observed: ExecutionHandoffSemanticCore,
): number {
    let score = 0;
    if (expected.domain === observed.domain) score += 3;
    if (expected.activation === observed.activation) score += 4;
    if (expected.payload === observed.payload) score += 2;
    if (expected.env === observed.env) score += 2;
    if (expected.completion === observed.completion) score += 2;
    if (expected.preserve === observed.preserve) score += 1;
    return score;
}

function expectedActivation(spec: ExecutionHandoffCompareCase): HandoffTriggerToken {
    switch (spec.factors.trigger) {
        case "event":
            return "event(c)";
        case "settle_fulfilled":
            return "settle(fulfilled)";
        case "settle_rejected":
            return "settle(rejected)";
        case "settle_any":
            return "settle(any)";
        case "call":
        default:
            return "call(c)";
    }
}

function expectedCompletion(spec: ExecutionHandoffCompareCase): CompletionClass {
    if (!spec.factors.deferred) {
        return "none";
    }
    return spec.factors.resume as CompletionClass;
}

function expectedEnv(spec: ExecutionHandoffCompareCase): EnvPortClass {
    switch (spec.factors.capture) {
        case "capture_in":
            return "envIn";
        case "capture_out":
            return "envOut";
        case "capture_in_out":
            return "envIO";
        case "none":
        default:
            return "env0";
    }
}

function expectedPreserve(spec: ExecutionHandoffCompareCase): PreserveClass {
    switch (spec.factors.trigger) {
        case "settle_fulfilled":
            return "settle(rejected)";
        case "settle_rejected":
            return "settle(fulfilled)";
        case "settle_any":
            return "settle(any)";
        default:
            return "preserve0";
    }
}
