import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { FrameworkModelingPlugin } from "./FrameworkModelingPlugin";
import type { SemanticPackQueryApi } from "./SemanticPack";

export interface EmitterSemanticModel {
    forwardTargetNodeIdsBySourceNodeId: Map<number, Set<number>>;
    onRegistrationCount: number;
    emitCount: number;
    bridgeCount: number;
    dynamicEventSkipCount: number;
}

export interface BuildEmitterSemanticModelArgs {
    scene: Scene;
    pag: Pag;
    allowedMethodSignatures?: Set<string>;
    queries: SemanticPackQueryApi;
}

export interface EmitterModelingProvider extends FrameworkModelingPlugin {
    readonly pluginId: "harmony.emitter";
    buildEmitterModel(args: BuildEmitterSemanticModelArgs): EmitterSemanticModel;
}

export function createEmptyEmitterSemanticModel(): EmitterSemanticModel {
    return {
        forwardTargetNodeIdsBySourceNodeId: new Map(),
        onRegistrationCount: 0,
        emitCount: 0,
        bridgeCount: 0,
        dynamicEventSkipCount: 0,
    };
}
