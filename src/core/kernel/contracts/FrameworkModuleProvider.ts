import type { Scene } from "../../../../arkanalyzer/lib/Scene";
import type { Pag, PagNode } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import type { TaintFact } from "../model/TaintFact";

export interface PropagationContext {
    scene: Scene;
    pag: Pag;
    fact: TaintFact;
    currentNode: PagNode;
    currentContextId: number;
}

export interface AugmentedEdge {
    targetNodeId: number;
    targetContextId: number;
    fieldPath?: string[];
    reason: string;
}

export interface BridgeEdge {
    sourceNodeId: number;
    targetNodeId: number;
    fieldPath?: string[];
    reason: string;
}

export interface FrameworkModuleProvider {
    readonly pluginId: string;
    augmentPropagation?(context: PropagationContext): AugmentedEdge[];
    collectBridges?(scene: Scene, activeFacts: TaintFact[]): BridgeEdge[];
}
