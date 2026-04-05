import type {
    ExecutionHandoffContractSnapshotItem,
    HandoffTriggerToken,
} from "../../core/kernel/handoff/ExecutionHandoffContract";
import type { ExecutionHandoffSemanticCase } from "./ExecutionHandoffSemanticManifest";

export type PayloadPortClass = "payload0" | "payload+";
export type EnvPortClass = "env0" | "envIn" | "envOut" | "envIO";
export type CompletionClass = "none" | "promise_chain" | "await_site";
export type PreserveClass = "preserve0" | "settle(rejected)" | "settle(fulfilled)" | "settle(any)" | "mixed";

export interface ExecutionHandoffSemanticAlgorithm {
    activation: HandoffTriggerToken;
    payload: PayloadPortClass;
    env: EnvPortClass;
    completion: CompletionClass;
    preserve: PreserveClass;
}

export interface ExecutionHandoffSemanticAlgorithmWitness {
    contractId: string;
    unitSignature: string;
    carrierKind: string;
    pathLabels: string[];
}

export interface ExecutionHandoffSemanticAlgorithmProjection {
    algorithm: ExecutionHandoffSemanticAlgorithm;
    witness: ExecutionHandoffSemanticAlgorithmWitness;
}

export function expectedExecutionHandoffSemanticAlgorithm(
    spec: ExecutionHandoffSemanticCase,
): ExecutionHandoffSemanticAlgorithm {
    return {
        activation: expectedActivation(spec),
        payload: spec.factors.payload === "none" ? "payload0" : "payload+",
        env: expectedEnv(spec),
        completion: expectedCompletion(spec),
        preserve: expectedPreserve(spec),
    };
}

export function projectExecutionHandoffSemanticAlgorithm(
    item: ExecutionHandoffContractSnapshotItem,
): ExecutionHandoffSemanticAlgorithmProjection {
    return {
        algorithm: {
            activation: item.activation,
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

export function executionHandoffSemanticAlgorithmKey(
    algorithm: ExecutionHandoffSemanticAlgorithm,
): string {
    return [
        algorithm.activation,
        algorithm.payload,
        algorithm.env,
        algorithm.completion,
        algorithm.preserve,
    ].join("|");
}

export function sameExecutionHandoffSemanticAlgorithm(
    expected: ExecutionHandoffSemanticAlgorithm,
    observed: ExecutionHandoffSemanticAlgorithm,
): boolean {
    return executionHandoffSemanticAlgorithmKey(expected) === executionHandoffSemanticAlgorithmKey(observed);
}

export function executionHandoffSemanticAlgorithmScore(
    expected: ExecutionHandoffSemanticAlgorithm,
    observed: ExecutionHandoffSemanticAlgorithm,
): number {
    let score = 0;
    if (expected.activation === observed.activation) score += 4;
    if (expected.payload === observed.payload) score += 2;
    if (expected.env === observed.env) score += 2;
    if (expected.completion === observed.completion) score += 2;
    if (expected.preserve === observed.preserve) score += 1;
    return score;
}

function expectedActivation(spec: ExecutionHandoffSemanticCase): HandoffTriggerToken {
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

function expectedCompletion(spec: ExecutionHandoffSemanticCase): CompletionClass {
    if (!spec.factors.deferred) {
        return "none";
    }
    return spec.factors.resume as CompletionClass;
}

function expectedEnv(spec: ExecutionHandoffSemanticCase): EnvPortClass {
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

function expectedPreserve(spec: ExecutionHandoffSemanticCase): PreserveClass {
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
