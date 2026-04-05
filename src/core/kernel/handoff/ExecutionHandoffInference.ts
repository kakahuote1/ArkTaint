import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import {
    ExecutionHandoffActivationPathRecord,
    ExecutionHandoffContractRecord,
    ExecutionHandoffContractSnapshot,
    ExecutionHandoffContractSnapshotItem,
    isDeferredHandoffActivationToken,
} from "./ExecutionHandoffContract";
import { buildExecutionHandoffActivationPaths } from "./ExecutionHandoffProvenance";
import {
    buildExecutionHandoffPortSummary,
    projectDeferredActivation,
} from "./ExecutionHandoffSemanticProjection";
import { buildExecutionUnitSummary } from "./ExecutionUnitSummary";

export function buildExecutionHandoffContracts(
    scene: Scene,
    cg: CallGraph,
): ExecutionHandoffContractRecord[] {
    const activationPaths = buildExecutionHandoffActivationPaths(scene, cg);
    return activationPaths
        .filter(path => isDeferredHandoffActivationToken(path.semantics.activation))
        .map(path => exportExecutionHandoffContract(path));
}

export function buildExecutionHandoffSnapshot(
    records: ExecutionHandoffContractRecord[],
): ExecutionHandoffContractSnapshot {
    const contracts: ExecutionHandoffContractSnapshotItem[] = [];

    for (const record of records) {
        contracts.push({
            id: record.id,
            callerSignature: record.callerSignature,
            unitSignature: record.unitSignature,
            lineNo: record.lineNo,
            carrierKind: record.carrierKind,
            activationLabel: record.activationLabel,
            pathLabels: [...record.pathLabels],
            hasResumeAnchor: record.hasResumeAnchor,
            activation: record.activation,
            ports: { ...record.ports },
        });
    }

    return {
        totalContracts: records.length,
        contracts,
    };
}

function exportExecutionHandoffContract(
    path: ExecutionHandoffActivationPathRecord,
): ExecutionHandoffContractRecord {
    const summary = buildExecutionUnitSummary(path);
    const ports = buildExecutionHandoffPortSummary(summary, path.semantics);
    return {
        ...path,
        activation: projectDeferredActivation(path.semantics),
        ports,
        summary,
    };
}
