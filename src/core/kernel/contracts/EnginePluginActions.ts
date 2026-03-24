export interface EnginePluginRuleChain {
    sourceRuleId?: string;
    transferRuleIds?: string[];
}

export interface FlowDecl {
    nodeId: number;
    contextId?: number;
    field?: string[];
    source?: string;
    reason?: string;
    allowUnreachableTarget?: boolean;
    chain?: EnginePluginRuleChain;
}

export interface BridgeDecl {
    targetObjectNodeId: number;
    targetFieldName: string;
    contextId?: number;
    source?: string;
    preserveFieldSuffix?: boolean;
    reason?: string;
    allowUnreachableTarget?: boolean;
    chain?: EnginePluginRuleChain;
}

export interface SyntheticEdgeDecl {
    edgeType: "call" | "return";
    targetNodeId: number;
    callSiteId: number;
    callerMethodName: string;
    calleeMethodName: string;
    targetContextId?: number;
    source?: string;
    field?: string[];
    reason?: string;
    allowUnreachableTarget?: boolean;
    chain?: EnginePluginRuleChain;
}

export interface EnqueueFactDecl {
    nodeId: number;
    contextId?: number;
    field?: string[];
    source?: string;
    reason?: string;
    allowUnreachableTarget?: boolean;
    chain?: EnginePluginRuleChain;
}

export interface PropagationContributionBatch {
    flows: FlowDecl[];
    bridges: BridgeDecl[];
    syntheticEdges: SyntheticEdgeDecl[];
    facts: EnqueueFactDecl[];
}

export function createEmptyPropagationContributionBatch(): PropagationContributionBatch {
    return {
        flows: [],
        bridges: [],
        syntheticEdges: [],
        facts: [],
    };
}
