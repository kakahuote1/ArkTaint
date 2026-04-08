import type { Scene } from "../../../../arkanalyzer/lib/Scene";
import type { Pag } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import type { FrameworkModuleProvider } from "./FrameworkModuleProvider";

export interface WorkerTaskPoolSemanticModel {
    forwardTargetNodeIdsBySourceNodeId: Map<number, Set<number>>;
    workerRegistrationCount: number;
    workerSendCount: number;
    taskpoolExecuteCount: number;
    bridgeCount: number;
}

export interface BuildWorkerTaskPoolSemanticModelArgs {
    scene: Scene;
    pag: Pag;
    allowedMethodSignatures?: Set<string>;
}

export interface WorkerTaskPoolModuleProvider extends FrameworkModuleProvider {
    readonly pluginId: "harmony.worker_taskpool";
    buildWorkerTaskPoolModel(args: BuildWorkerTaskPoolSemanticModelArgs): WorkerTaskPoolSemanticModel;
}

export function createEmptyWorkerTaskPoolSemanticModel(): WorkerTaskPoolSemanticModel {
    return {
        forwardTargetNodeIdsBySourceNodeId: new Map(),
        workerRegistrationCount: 0,
        workerSendCount: 0,
        taskpoolExecuteCount: 0,
        bridgeCount: 0,
    };
}
