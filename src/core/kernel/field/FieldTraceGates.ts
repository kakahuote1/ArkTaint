export type FieldTraceGateKind =
    | "field.access.extract"
    | "field.store"
    | "field.load"
    | "field.copy"
    | "field.currentness.store"
    | "field.currentness.kill"
    | "field.sibling.blocked"
    | "field.dynamic.degraded"
    | "field.depth.truncated";

export interface FieldTraceGate {
    kind: FieldTraceGateKind;
    stage: string;
    status: "emitted" | "blocked" | "skipped";
    reason: string;
    ownerNodeId?: number;
    fieldPath?: string[];
    source?: string;
}

export const FIELD_TRACE_GATES: Record<string, FieldTraceGateKind> = {
    accessExtract: "field.access.extract",
    store: "field.store",
    load: "field.load",
    copy: "field.copy",
    currentnessStore: "field.currentness.store",
    currentnessKill: "field.currentness.kill",
    siblingBlocked: "field.sibling.blocked",
    dynamicDegraded: "field.dynamic.degraded",
    depthTruncated: "field.depth.truncated",
};
