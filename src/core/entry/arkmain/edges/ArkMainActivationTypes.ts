import { ArkMethod } from "../../../../../arkanalyzer/lib/core/model/ArkMethod";
import { ArkMainEntryFact, ArkMainPhaseName } from "../ArkMainTypes";

export type ArkMainActivationEdgeKind =
    | "baseline_root"
    | "callback_registration"
    | "channel_callback_activation"
    | "scheduler_activation"
    | "state_watch_trigger"
    | "router_channel"
    | "want_handoff";

export type ArkMainActivationEdgeFamily =
    | "baseline_root"
    | "ui_callback"
    | "channel_callback"
    | "scheduler_callback"
    | "state_watch"
    | "navigation_channel"
    | "ability_handoff";

export interface ArkMainActivationReason {
    kind: "entry_fact" | ArkMainActivationEdgeKind;
    summary: string;
    evidenceFactKind?: ArkMainEntryFact["kind"];
    evidenceMethod?: ArkMethod;
    entryFamily?: string;
    recognitionLayer?: string;
    callbackShape?: string;
    callbackSlotFamily?: string;
}

export interface ArkMainActivationEdge {
    kind: ArkMainActivationEdgeKind;
    edgeFamily: ArkMainActivationEdgeFamily;
    phaseHint: ArkMainPhaseName;
    fromMethod?: ArkMethod;
    toMethod: ArkMethod;
    reasons: ArkMainActivationReason[];
}

export interface ArkMainActivationGraph {
    facts: ArkMainEntryFact[];
    rootMethods: ArkMethod[];
    edges: ArkMainActivationEdge[];
}


