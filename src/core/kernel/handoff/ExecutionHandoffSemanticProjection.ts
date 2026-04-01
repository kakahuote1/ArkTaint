import type {
    ExecutionHandoffPortSummaryClassRecord,
    ExecutionHandoffRecoveredSemanticsRecord,
    ExecutionHandoffSemanticKernelRecord,
    ExecutionUnitSummaryRecord,
} from "./ExecutionHandoffContract";

export function buildExecutionHandoffSemanticKernel(
    semantics: ExecutionHandoffRecoveredSemanticsRecord,
): ExecutionHandoffSemanticKernelRecord {
    return {
        domain: semantics.domain,
        activation: semantics.activation,
    };
}

export function buildExecutionHandoffPortSummary(
    summary: ExecutionUnitSummaryRecord,
    semantics: ExecutionHandoffRecoveredSemanticsRecord,
): ExecutionHandoffPortSummaryClassRecord {
    return {
        payload: summary.payloadPorts > 0 ? "payload+" : "payload0",
        env: projectEnv(summary),
        completion: projectCompletion(summary, semantics),
        preserve: projectPreserve(summary),
    };
}

function projectEnv(summary: ExecutionUnitSummaryRecord): ExecutionHandoffPortSummaryClassRecord["env"] {
    const hasRead = summary.envReadPorts > 0;
    const hasWrite = summary.envWritePorts > 0;
    if (hasRead && hasWrite) {
        return "envIO";
    }
    if (hasRead) {
        return "envIn";
    }
    if (hasWrite) {
        return "envOut";
    }
    return "env0";
}

function projectCompletion(
    summary: ExecutionUnitSummaryRecord,
    semantics: ExecutionHandoffRecoveredSemanticsRecord,
): ExecutionHandoffPortSummaryClassRecord["completion"] {
    if (semantics.domain !== "deferred") {
        return "none";
    }
    if (
        semantics.activation === "settle(any)"
        && summary.returnKind === "none"
        && summary.payloadPorts === 0
    ) {
        return "none";
    }
    return semantics.completion;
}

function projectPreserve(summary: ExecutionUnitSummaryRecord): ExecutionHandoffPortSummaryClassRecord["preserve"] {
    const preserve = [...summary.preserve].sort();
    if (preserve.length === 0) {
        return "preserve0";
    }
    if (preserve.length > 1) {
        return "mixed";
    }
    switch (preserve[0]) {
        case "settle(rejected)":
            return "settle(rejected)";
        case "settle(fulfilled)":
            return "settle(fulfilled)";
        case "settle(any)":
            return "settle(any)";
        default:
            return "mixed";
    }
}
