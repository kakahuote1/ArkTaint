import type { Scene } from "../../../../arkanalyzer/out/src/Scene";
import type { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import type { FrameworkModuleProvider } from "./FrameworkModuleProvider";
import type { ModuleAnalysisApi, ModuleSetupCallbackApi } from "./ModuleContract";

export interface RouterValueFieldTarget {
    fieldName: string;
    routerKey: string;
    ungrouped: boolean;
    passthrough?: boolean;
}

export interface RouterSemanticModel {
    pushArgNodeIdsByRouterKey: Map<string, Set<number>>;
    pushArgNodeIdToRouterKeys: Map<number, Set<string>>;
    pushFieldEndpointToRouterKeys: Map<string, Set<string>>;
    pushValueFieldTargetsByNodeId: Map<number, RouterValueFieldTarget[]>;
    getResultNodeIdsByRouterKey: Map<string, Set<number>>;
    getResultObjectNodeIdsByRouterKey: Map<string, Set<number>>;
    ungroupedPushNodeIds: Set<number>;
    ungroupedPushFieldEndpoints: Set<string>;
    pushCallCountByRouterKey: Map<string, number>;
    distinctRouteKeyCountByRouterKey: Map<string, number>;
    pushCallCount: number;
    getCallCount: number;
    suspiciousCallCount: number;
}

export interface BuildRouterSemanticModelArgs {
    scene: Scene;
    pag: Pag;
    allowedMethodSignatures?: Set<string>;
    analysis: ModuleAnalysisApi;
    callbacks: ModuleSetupCallbackApi;
    log?: (msg: string) => void;
}

export interface RouterModuleProvider extends FrameworkModuleProvider {
    readonly pluginId: "harmony.router";
    buildRouterModel(args: BuildRouterSemanticModelArgs): RouterSemanticModel;
}

export function createEmptyRouterSemanticModel(): RouterSemanticModel {
    return {
        pushArgNodeIdsByRouterKey: new Map(),
        pushArgNodeIdToRouterKeys: new Map(),
        pushFieldEndpointToRouterKeys: new Map(),
        pushValueFieldTargetsByNodeId: new Map(),
        getResultNodeIdsByRouterKey: new Map(),
        getResultObjectNodeIdsByRouterKey: new Map(),
        ungroupedPushNodeIds: new Set(),
        ungroupedPushFieldEndpoints: new Set(),
        pushCallCountByRouterKey: new Map(),
        distinctRouteKeyCountByRouterKey: new Map(),
        pushCallCount: 0,
        getCallCount: 0,
        suspiciousCallCount: 0,
    };
}
