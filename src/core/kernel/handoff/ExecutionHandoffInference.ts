import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import type { ModuleExplicitDeferredBindingRecord } from "../model/DeferredBindingDeclaration";
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
import { buildExecutionHandoffContractEdgeBindings } from "./ExecutionHandoffContractBindingResolver";
import {
    assertExecutionHandoffBudget,
    ExecutionHandoffBuildBudget,
} from "./ExecutionHandoffBudget";

export function buildExecutionHandoffContracts(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    explicitBindings: ModuleExplicitDeferredBindingRecord[] = [],
    budget?: ExecutionHandoffBuildBudget,
): ExecutionHandoffContractRecord[] {
    assertExecutionHandoffBudget(budget, "contracts.activation_paths.start");
    reportExecutionHandoffProgress(budget, "contracts activation_paths start", true);
    const activationPaths = buildExecutionHandoffActivationPaths(scene, cg, explicitBindings, budget);
    assertExecutionHandoffBudget(budget, "contracts.activation_paths.done");
    reportExecutionHandoffProgress(budget, `contracts activation_paths done paths=${activationPaths.length}`, true);
    const deferredPaths = activationPaths.filter(path => isDeferredHandoffActivationToken(path.semantics.activation));
    const out: ExecutionHandoffContractRecord[] = [];
    let index = 0;
    for (const path of deferredPaths) {
            index++;
            if (index === 1 || index % 50 === 0 || index === deferredPaths.length) {
                reportExecutionHandoffProgress(
                    budget,
                    `contracts export ${index}/${deferredPaths.length}`,
                );
            }
            assertExecutionHandoffBudget(budget, "contracts.export");
            out.push(exportExecutionHandoffContract(scene, cg, pag, path, budget));
    }
    reportExecutionHandoffProgress(budget, `contracts export done count=${out.length}`, true);
    return out;
}

function reportExecutionHandoffProgress(
    budget: ExecutionHandoffBuildBudget | undefined,
    msg: string,
    force: boolean = false,
): void {
    const progress = budget?.progress;
    if (!progress) return;
    const now = Date.now();
    const interval = budget.progressIntervalMs || 5000;
    if (!force && budget.lastProgressAtMs !== undefined && now - budget.lastProgressAtMs < interval) return;
    budget.lastProgressAtMs = now;
    progress(`[ExecutionHandoff] ${msg} elapsed_ms=${now - budget.startedAtMs}`);
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
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    path: ExecutionHandoffActivationPathRecord,
    budget?: ExecutionHandoffBuildBudget,
): ExecutionHandoffContractRecord {
    const summary = buildExecutionUnitSummary(path);
    const ports = buildExecutionHandoffPortSummary(summary, path.semantics);
    assertExecutionHandoffBudget(budget, "contracts.edge_bindings.start");
    const edgeBindings = buildExecutionHandoffContractEdgeBindings(
        scene,
        cg,
        pag,
        {
            ...path,
            activation: projectDeferredActivation(path.semantics),
            ports,
            summary,
            edgeBindings: [],
        },
        budget,
    );
    assertExecutionHandoffBudget(budget, "contracts.edge_bindings.done");
    return {
        ...path,
        activation: projectDeferredActivation(path.semantics),
        ports,
        summary,
        edgeBindings,
    };
}
