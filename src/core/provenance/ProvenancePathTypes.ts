import { TaintFact } from "../kernel/model/TaintFact";
import { FactPredecessorRecord } from "../kernel/propagation/PropagationTypes";

export interface PathMaterializationOptions {
    maxPaths?: number;
    maxDepth?: number;
}

export type ProvenancePathStatus = "complete" | "incomplete";

export type ProvenancePathIncompleteReason =
    | "max_depth"
    | "max_paths"
    | "cycle_skipped";

export interface ProvenanceDagEdge {
    fromFactId: string;
    toFactId: string;
    reason: string;
}

export interface ProvenanceDag {
    sinkFactId: string;
    factIds: Set<string>;
    edges: ProvenanceDagEdge[];
    sourceFactIds: Set<string>;
}

export interface ProvenancePath {
    factIds: string[];
    edges: ProvenanceDagEdge[];
    status?: ProvenancePathStatus;
    incompleteReasons?: ProvenancePathIncompleteReason[];
    truncated?: boolean;
}

export interface ProvenancePathEnumeration {
    paths: ProvenancePath[];
    status: ProvenancePathStatus;
    incompleteReasons: ProvenancePathIncompleteReason[];
}

export interface MaterializedTaintFlow {
    sinkFactId: string;
    status: ProvenancePathStatus;
    incompleteReasons: ProvenancePathIncompleteReason[];
    paths: ProvenancePath[];
}

export interface ProvenancePathContext {
    observedFactsById: ReadonlyMap<string, TaintFact>;
    factPredecessorsByFactId: ReadonlyMap<string, readonly FactPredecessorRecord[]>;
}
