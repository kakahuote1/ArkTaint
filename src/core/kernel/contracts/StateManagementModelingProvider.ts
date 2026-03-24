import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { FrameworkModelingPlugin } from "./FrameworkModelingPlugin";
import type { SemanticPackQueryApi } from "./SemanticPack";

export interface StatePropBridgeEdge {
    sourceObjectNodeId: number;
    sourceFieldName: string;
    targetObjectNodeId: number;
    targetFieldName: string;
    methodSignature: string;
}

export interface StateManagementSemanticModel {
    edgesBySourceField: Map<string, StatePropBridgeEdge[]>;
    bridgeEdgeCount: number;
    constructorCallCount: number;
    stateCaptureAssignCount: number;
    eventInvokeBridges: Map<number, Set<number>>;
    eventInvokeBridgeCount: number;
}

export interface BuildStateManagementSemanticModelArgs {
    scene: Scene;
    pag: Pag;
    allowedMethodSignatures?: Set<string>;
    queries: SemanticPackQueryApi;
}

export interface StateManagementModelingProvider extends FrameworkModelingPlugin {
    readonly pluginId: "harmony.state";
    buildStateManagementModel(args: BuildStateManagementSemanticModelArgs): StateManagementSemanticModel;
}

export function createEmptyStateManagementSemanticModel(): StateManagementSemanticModel {
    return {
        edgesBySourceField: new Map(),
        bridgeEdgeCount: 0,
        constructorCallCount: 0,
        stateCaptureAssignCount: 0,
        eventInvokeBridges: new Map(),
        eventInvokeBridgeCount: 0,
    };
}
