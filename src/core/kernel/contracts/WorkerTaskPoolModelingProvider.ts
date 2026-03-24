import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { FrameworkModelingPlugin } from "./FrameworkModelingPlugin";
import type { SemanticPackQueryApi } from "./SemanticPack";

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
    queries: SemanticPackQueryApi;
}

export interface WorkerTaskPoolModelingProvider extends FrameworkModelingPlugin {
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
