import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkMainEntryFact, ArkMainPhaseName } from "../ArkMainTypes";

export type ArkMainActivationEdgeKind =
    | "baseline_root"
    | "lifecycle_progression";

export type ArkMainActivationEdgeFamily =
    | "baseline_root"
    | "composition_lifecycle"
    | "interaction_lifecycle"
    | "teardown_lifecycle";

export interface ArkMainActivationReason {
    kind: "entry_fact" | ArkMainActivationEdgeKind;
    summary: string;
    evidenceFactKind?: ArkMainEntryFact["kind"];
    evidenceMethod?: ArkMethod;
    entryFamily?: string;
    recognitionLayer?: string;
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


