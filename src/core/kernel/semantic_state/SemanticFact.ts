import { SemanticCarrier, SemanticFact, SemanticSideState, createDefaultSemanticSideState, semanticFactKey } from "./SemanticStateTypes";

export function createSemanticFact(input: {
    source: string;
    carrier: SemanticCarrier;
    tainted: boolean;
    state: SemanticFact["state"];
    contextId: number;
    order: number;
    nodeId?: number;
    fieldPath?: string[];
    methodSignature?: string;
    stmtText?: string;
    stmtIndex?: number;
    parentFactId?: string;
    transitionId?: string;
    reason?: string;
    sideState?: Partial<SemanticSideState>;
}): SemanticFact {
    const baseSideState = createDefaultSemanticSideState();
    const sideState = {
        ...baseSideState,
        ...(input.sideState || {}),
    } as SemanticSideState;
    const fact: SemanticFact = {
        id: "",
        source: input.source,
        carrier: input.carrier,
        tainted: input.tainted,
        state: input.state,
        sideState,
        contextId: input.contextId,
        nodeId: input.nodeId,
        fieldPath: input.fieldPath ? [...input.fieldPath] : undefined,
        methodSignature: input.methodSignature,
        stmtText: input.stmtText,
        stmtIndex: input.stmtIndex,
        order: input.order,
        parentFactId: input.parentFactId,
        transitionId: input.transitionId,
        reason: input.reason,
    };
    fact.id = semanticFactKey(fact);
    return fact;
}

