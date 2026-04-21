import type { TaintFact } from "../model/TaintFact";

export interface CallEdgeEvent {
    reason: string;
    edgeType: "call" | "return" | "capture";
    callSiteId?: number;
    callerMethodName?: string;
    calleeMethodName?: string;
    callSignature?: string;
    methodName?: string;
    declaringClassName?: string;
    args?: any[];
    baseValue?: any;
    resultValue?: any;
    stmt?: any;
    invokeExpr?: any;
    sourceNodeId: number;
    targetNodeId: number;
    fromContextId: number;
    toContextId: number;
    fact: TaintFact;
}

export interface TaintFlowEvent {
    reason: string;
    fromFact: TaintFact;
    toFact: TaintFact;
}

export interface MethodReachedEvent {
    methodSignature: string;
    fact: TaintFact;
}
