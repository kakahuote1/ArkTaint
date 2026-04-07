import type { CallableResolveOptions } from "../../substrate/queries/CalleeResolver";
import type {
    RawModuleCopyEdgeEvent,
    RawModuleFactEvent,
    RawModuleInvokeEvent,
    RawModuleSetupContext,
} from "./ModuleContract";
import type { Scene } from "../../../../arkanalyzer/out/src/Scene";

export interface InternalModuleQueryApi {
    resolveMethodsFromCallable(scene: Scene, value: any, options?: CallableResolveOptions): any[];
    collectParameterAssignStmts(calleeMethod: any): any[];
    collectFiniteStringCandidatesFromValue(scene: Scene, value: any, maxDepth?: number): string[];
}

export type InternalRawModuleSetupContext = RawModuleSetupContext & {
    queries: InternalModuleQueryApi;
};

export type InternalRawModuleFactEvent = RawModuleFactEvent & {
    queries: InternalModuleQueryApi;
};

export type InternalRawModuleInvokeEvent = RawModuleInvokeEvent & {
    queries: InternalModuleQueryApi;
};

export type InternalRawModuleCopyEdgeEvent = RawModuleCopyEdgeEvent;
