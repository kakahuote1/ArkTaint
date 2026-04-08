import type { Scene } from "../../../../arkanalyzer/lib/Scene";
import type { Pag } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import type { FrameworkModuleProvider } from "./FrameworkModuleProvider";

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
}

export interface EmitterModuleProvider extends FrameworkModuleProvider {
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
