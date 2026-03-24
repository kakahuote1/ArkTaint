import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintFact } from "../TaintFact";

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

export interface FrameworkModelingPlugin {
    readonly pluginId: string;
    augmentPropagation?(context: PropagationContext): AugmentedEdge[];
    collectBridges?(scene: Scene, activeFacts: TaintFact[]): BridgeEdge[];
}
