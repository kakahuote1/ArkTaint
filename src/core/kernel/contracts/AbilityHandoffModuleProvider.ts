import type { Scene } from "../../../../arkanalyzer/out/src/Scene";
import type { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import type { FrameworkModuleProvider } from "./FrameworkModuleProvider";

export type AbilityHandoffBoundaryKind = "serialized_copy";

export interface AbilityHandoffBoundarySemantics {
    kind: AbilityHandoffBoundaryKind;
    summary: string;
    preservesFieldPath: boolean;
    preservesObjectIdentity: boolean;
}

export interface AbilityHandoffSemanticModel {
    targetNodeIdsBySourceNodeId: Map<number, Set<number>>;
    targetFieldLoadNodeIdsBySourceFieldKey: Map<string, Set<number>>;
    continuedFieldLoadNodeIdsBySourceFieldKey: Map<string, Set<number>>;
    callCount: number;
    targetMethodCount: number;
    boundary: AbilityHandoffBoundarySemantics;
}

export interface BuildAbilityHandoffSemanticModelArgs {
    scene: Scene;
    pag: Pag;
    allowedMethodSignatures?: Set<string>;
}

export interface AbilityHandoffModuleProvider extends FrameworkModuleProvider {
    readonly pluginId: "harmony.ability_handoff";
    buildAbilityHandoffModel(args: BuildAbilityHandoffSemanticModelArgs): AbilityHandoffSemanticModel;
}

export function createEmptyAbilityHandoffSemanticModel(): AbilityHandoffSemanticModel {
    return {
        targetNodeIdsBySourceNodeId: new Map(),
        targetFieldLoadNodeIdsBySourceFieldKey: new Map(),
        continuedFieldLoadNodeIdsBySourceFieldKey: new Map(),
        callCount: 0,
        targetMethodCount: 0,
        boundary: {
            kind: "serialized_copy",
            summary: "Ability handoff modeling disabled.",
            preservesFieldPath: true,
            preservesObjectIdentity: false,
        },
    };
}
