import { TaintFact } from "../kernel/model/TaintFact";
import type {
    CandidateFlow,
    CurrentnessObligation,
    CurrentnessVerdict,
    OclfsConfidence,
    SliceCompleteness,
    StateCell,
} from "../kernel/oclfs";
import { FactPredecessorRecord } from "../kernel/propagation/PropagationTypes";

export interface PathMaterializationOptions {
    maxPaths?: number;
    maxDepth?: number;
    maxDagFacts?: number;
    maxDagEdges?: number;
    maxElapsedMs?: number;
}

export type PathMaterializationStatus =
    | "complete"
    | "bounded-complete"
    | "truncated"
    | "incomplete"
    | "failed";

export type ProvenancePathStatus = PathMaterializationStatus;

export type ProvenancePathIncompleteReason =
    | "max_depth"
    | "max_paths"
    | "cycle_skipped"
    | "missing_derivation"
    | "missing_source_provenance"
    | "missing_currentness"
    | "missing_ude_edge"
    | "missing_model_hit"
    | "truncated_materialization"
    | "ambiguous_predecessor"
    | "unresolved_value_version"
    | "materialization_failed";

export type PathGapKind =
    | "missing-derivation"
    | "missing-source-provenance"
    | "missing-currentness"
    | "missing-ude-edge"
    | "missing-model-hit"
    | "truncated-materialization"
    | "ambiguous-predecessor"
    | "unresolved-value-version";

export interface PathGap {
    id: string;
    kind: PathGapKind;
    pathId?: string;
    flowId?: string;
    location?: string;
    producer?: string;
    reason: string;
}

export type CurrentnessDecisionScope =
    | "candidate-flow"
    | "path-segment"
    | "cell"
    | "unknown";

export type CurrentnessConservativePolicy =
    | "derive-on-may"
    | "drop-on-unknown"
    | "diagnostic-only";

export interface CurrentnessEvidence {
    id: string;
    kind: "currentness";
    candidateFlowId: string;
    candidateFlow: CandidateFlow;
    producerEffectId: string;
    consumerEffectId: string;
    producerFactId?: string;
    consumerFactId?: string;
    producerCell: StateCell;
    consumerCell: StateCell;
    label: string;
    epoch?: string;
    verdict: CurrentnessVerdict;
    obligations: CurrentnessObligation[];
    sliceCompleteness: SliceCompleteness;
    proofStatus:
        | "complete-proof"
        | "partial-proof"
        | "refutation-proof"
        | "unknown-proof";
    primaryReason: string;
    uncertaintyReasons?: string[];
    decisiveEffectIds?: string[];
    blockedByEffectIds?: string[];
    decisionScope: CurrentnessDecisionScope;
    conservativePolicy: CurrentnessConservativePolicy;
    confidence: OclfsConfidence;
    producer: "algorithm_e_oclfs";
}

export interface BaseEvidenceGraph {
    derivations: FactPredecessorRecord[];
    currentness: CurrentnessEvidence[];
    gaps: PathGap[];
}

export interface PathDecision {
    pathId: string;
    judgement:
        | "Kept"
        | "Refuted-Strong"
        | "Refuted-Weak"
        | "Unresolved"
        | "Incomplete";
    evidenceIds: string[];
    reason: string;
}

export interface FlowDecision {
    flowId: string;
    judgement:
        | "Confirmed"
        | "Reportable-Unresolved"
        | "Refuted-Strong"
        | "Refuted-Weak"
        | "Materialization-Incomplete";
    pathDecisionIds: string[];
    materializationStatus: PathMaterializationStatus;
    reason: string;
}

export interface PostsolveDecisionGraph {
    pathDecisions: PathDecision[];
    flowDecisions: FlowDecision[];
}

export interface ProvenanceDagEdge {
    fromFactId: string;
    toFactId: string;
    reason: string;
    currentnessEvidenceIds?: string[];
}

export interface ProvenanceDag {
    sinkFactId: string;
    factIds: Set<string>;
    edges: ProvenanceDagEdge[];
    sourceFactIds: Set<string>;
    incompleteReasons?: ProvenancePathIncompleteReason[];
}

export interface ProvenancePath {
    id?: string;
    flowId?: string;
    factIds: string[];
    edges: ProvenanceDagEdge[];
    status?: ProvenancePathStatus;
    materializationStatus?: PathMaterializationStatus;
    incompleteReasons?: ProvenancePathIncompleteReason[];
    truncated?: boolean;
    currentnessEvidenceIds?: string[];
    pathConditionAtomIds?: string[];
    blockedAtomIds?: string[];
    gapIds?: string[];
    /**
     * PathView is a materialized evidence view only. Postsolve must write
     * decisions into PathDecision/PostsolveDecisionGraph, not here.
     */
    judgement?: never;
}

export interface ProvenancePathEnumeration {
    paths: ProvenancePath[];
    status: ProvenancePathStatus;
    incompleteReasons: ProvenancePathIncompleteReason[];
}

export interface MaterializedTaintFlow {
    sinkFactId: string;
    status: ProvenancePathStatus;
    materializationStatus?: PathMaterializationStatus;
    incompleteReasons: ProvenancePathIncompleteReason[];
    paths: ProvenancePath[];
    pathClasses?: PathClass[];
    gaps?: PathGap[];
}

export interface PathClass {
    id: string;
    flowId: string;
    representativePathIds: string[];
    equivalentPathCount?: number;
    signature: {
        sourceId: string;
        sinkId: string;
        mechanismKinds: string[];
        sanitizerProfile?: string;
        currentnessProfile?: string;
    };
    materializationStatus: PathMaterializationStatus;
}

export interface ProvenancePathContext {
    observedFactsById: ReadonlyMap<string, TaintFact>;
    factPredecessorsByFactId: ReadonlyMap<string, readonly FactPredecessorRecord[]>;
    currentnessEvidenceById?: ReadonlyMap<string, CurrentnessEvidence>;
}
