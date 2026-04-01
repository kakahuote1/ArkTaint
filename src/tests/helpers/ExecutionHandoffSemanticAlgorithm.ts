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

export interface ExecutionHandoffSemanticKernel {
    domain: SemanticDomain;
    activation: HandoffTriggerToken;
}

export interface ExecutionHandoffPortSummary {
    payload: PayloadPortClass;
    env: EnvPortClass;
    completion: CompletionClass;
    preserve: PreserveClass;
}

export interface ExecutionHandoffSemanticAlgorithm {
    kernel: ExecutionHandoffSemanticKernel;
    summary: ExecutionHandoffPortSummary;
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
    spec: ExecutionHandoffCompareCase,
): ExecutionHandoffSemanticAlgorithm {
    return {
        kernel: {
            domain: spec.factors.deferred ? "deferred" : "control",
            activation: expectedActivation(spec),
        },
        summary: {
            payload: spec.factors.payload === "none" ? "payload0" : "payload+",
            env: expectedEnv(spec),
            completion: expectedCompletion(spec),
            preserve: expectedPreserve(spec),
        },
    };
}

export function projectExecutionHandoffSemanticAlgorithm(
    item: ExecutionHandoffContractSnapshotItem,
): ExecutionHandoffSemanticAlgorithmProjection {
    return {
        algorithm: {
            kernel: {
                domain: item.kernel.domain,
                activation: item.kernel.activation,
            },
            summary: {
                payload: item.ports.payload,
                env: item.ports.env,
                completion: item.ports.completion,
                preserve: item.ports.preserve,
            },
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
        algorithm.kernel.domain,
        algorithm.kernel.activation,
        algorithm.summary.payload,
        algorithm.summary.env,
        algorithm.summary.completion,
        algorithm.summary.preserve,
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
    if (expected.kernel.domain === observed.kernel.domain) score += 3;
    if (expected.kernel.activation === observed.kernel.activation) score += 4;
    if (expected.summary.payload === observed.summary.payload) score += 2;
    if (expected.summary.env === observed.summary.env) score += 2;
    if (expected.summary.completion === observed.summary.completion) score += 2;
    if (expected.summary.preserve === observed.summary.preserve) score += 1;
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
