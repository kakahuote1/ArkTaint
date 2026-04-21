import type { Scene } from "../../../../arkanalyzer/out/src/Scene";
import type { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import type { FrameworkModuleProvider } from "./FrameworkModuleProvider";
import type { ModuleSetupCallbackApi } from "./ModuleContract";

export interface StatePropBridgeEdge {
    sourceNodeId: number;
    sourceFieldName: string;
    targetNodeId: number;
    targetFieldName: string;
    methodSignature: string;
}

export interface StateManagementSemanticModel {
    edgesBySourceField: Map<string, StatePropBridgeEdge[]>;
    targetFieldLoadNodeIdsBySourceField: Map<string, Set<number>>;
    bridgeEdgeCount: number;
    constructorCallCount: number;
    stateCaptureAssignCount: number;
    eventInvokeBridges: Map<number, Set<number>>;
    eventInvokeBridgeCount: number;
    eventDeferredBindings: Array<{
        sourceMethod: any;
        handlerMethod: any;
        anchorStmt: any;
        triggerLabel: string;
    }>;
}

export interface BuildStateManagementSemanticModelArgs {
    scene: Scene;
    pag: Pag;
    allowedMethodSignatures?: Set<string>;
    callbacks: ModuleSetupCallbackApi;
}

export interface StateModuleProvider extends FrameworkModuleProvider {
    readonly pluginId: "harmony.state";
    buildStateManagementModel(args: BuildStateManagementSemanticModelArgs): StateManagementSemanticModel;
}

export function createEmptyStateManagementSemanticModel(): StateManagementSemanticModel {
    return {
        edgesBySourceField: new Map(),
        targetFieldLoadNodeIdsBySourceField: new Map(),
        bridgeEdgeCount: 0,
        constructorCallCount: 0,
        stateCaptureAssignCount: 0,
        eventInvokeBridges: new Map(),
        eventInvokeBridgeCount: 0,
        eventDeferredBindings: [],
    };
}
