import type { SyntheticInvokeEdgeInfo } from "../builders/SyntheticInvokeEdgeBuilder";

export type HandoffTriggerToken =
    | "call(c)"
    | "event(c)"
    | "settle(fulfilled)"
    | "settle(rejected)"
    | "settle(any)";
export type ExecutionHandoffActivationToken = Exclude<HandoffTriggerToken, "call(c)">;

export type HandoffResumeKind = "none" | "promise_chain" | "await_site";
export type ExecutionHandoffPayloadClass = "payload0" | "payload+";
export type ExecutionHandoffEnvClass = "env0" | "envIn" | "envOut" | "envIO";
export type ExecutionHandoffCompletionClass = HandoffResumeKind;
export type ExecutionHandoffPreserveClass =
    | "preserve0"
    | "settle(rejected)"
    | "settle(fulfilled)"
    | "settle(any)"
    | "mixed";

export type HandoffActivationLabel =
    | "invoke"
    | "register"
    | "settle_f"
    | "settle_r"
    | "settle_a";

export type HandoffPathLabel =
    | "pass"
    | "return"
    | "store"
    | "load"
    | "register"
    | "invoke"
    | "settle_f"
    | "settle_r"
    | "settle_a"
    | "resume";

export type HandoffCarrierKind = "direct" | "returned" | "relay" | "field" | "slot" | "unknown";

export type HandoffReturnKind = "none" | "payload" | "capture" | "value";
export type ExecutionHandoffContinuationRole = "none" | "value" | "error" | "observe";

export interface ExecutionHandoffPortSummaryClassRecord {
    payload: ExecutionHandoffPayloadClass;
    env: ExecutionHandoffEnvClass;
    completion: ExecutionHandoffCompletionClass;
    preserve: ExecutionHandoffPreserveClass;
}

export interface ExecutionHandoffRecoveredSemanticsRecord {
    activation: HandoffTriggerToken;
    completion: HandoffResumeKind;
    preserve: ExecutionHandoffActivationToken[];
    continuationRole: ExecutionHandoffContinuationRole;
}

export interface ExecutionHandoffFeatures {
    invokeText: string;
    invokeName: string | null;
    matchingArgIndexes: number[];
    callableArgIndexes: number[];
    localRegistration: boolean;
    registrationReachabilityDepth: number | null;
    usesPtrInvoke: boolean;
    hasAwaitResume: boolean;
    payloadPorts: number;
    capturePorts: number;
}

export interface ExecutionHandoffActivationPathRecord extends ExecutionHandoffFeatures {
    id: string;
    caller: any;
    stmt: any;
    invokeExpr: any;
    unit: any;
    sourceMethods: any[];
    callerSignature: string;
    unitSignature: string;
    lineNo: number;
    carrierKind: HandoffCarrierKind;
    activationLabel: HandoffActivationLabel;
    pathLabels: HandoffPathLabel[];
    hasResumeAnchor: boolean;
    semantics: ExecutionHandoffRecoveredSemanticsRecord;
}

export interface ExecutionUnitSummaryRecord {
    payloadPorts: number;
    capturePorts: number;
    envReadPorts: number;
    envWritePorts: number;
    returnKind: HandoffReturnKind;
    preserve: ExecutionHandoffActivationToken[];
}

export interface ExecutionHandoffContractRecord extends ExecutionHandoffActivationPathRecord {
    activation: ExecutionHandoffActivationToken;
    ports: ExecutionHandoffPortSummaryClassRecord;
    summary: ExecutionUnitSummaryRecord;
}

export interface ExecutionHandoffContractSnapshotItem {
    id: string;
    callerSignature: string;
    unitSignature: string;
    lineNo: number;
    carrierKind: HandoffCarrierKind;
    activationLabel: HandoffActivationLabel;
    pathLabels: HandoffPathLabel[];
    hasResumeAnchor: boolean;
    activation: ExecutionHandoffActivationToken;
    ports: ExecutionHandoffPortSummaryClassRecord;
}

export interface ExecutionHandoffContractSnapshot {
    totalContracts: number;
    contracts: ExecutionHandoffContractSnapshotItem[];
}

export interface ExecutionHandoffEdgeBuildStats {
    siteCount: number;
    callEdges: number;
    returnEdges: number;
}

export interface ExecutionHandoffEdgeBuildResult {
    edgeMap: Map<number, SyntheticInvokeEdgeInfo[]>;
    stats: ExecutionHandoffEdgeBuildStats;
}

export function isDeferredHandoffActivationToken(
    token: HandoffTriggerToken,
): token is ExecutionHandoffActivationToken {
    return token !== "call(c)";
}
