import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintFact } from "../../kernel/model/TaintFact";
import { FactPredecessorRecord } from "../../kernel/propagation/PropagationTypes";
import { SanitizerRule } from "../../rules/RuleSchema";
import {
    MaterializedTaintFlow,
    PathMaterializationOptions,
    ProvenancePathIncompleteReason,
    ProvenancePathStatus,
    ProvenancePathContext,
} from "../../provenance/ProvenancePathTypes";

export type PostsolveJudgementKind =
    | "Confirmed"
    | "Reportable-Unresolved"
    | "Refuted-Strong"
    | "Refuted-Weak"
    | "Unresolved"
    | "Materialization-Incomplete";

export type PostsolveEvidenceScope =
    | "path"
    | "path-segment"
    | "sink-argument"
    | "source-label"
    | "taint-flow"
    | "diagnostic";

export interface PostsolveEvidence {
    kind: string;
    polarity: "positive" | "negative" | "neutral";
    strength: "strong" | "weak";
    stability: "stable" | "overridable";
    scope: PostsolveEvidenceScope;
    subject: {
        pathId?: string;
        pathSegmentId?: string;
        factId?: string;
        valueVersion?: string;
        stateCell?: string;
        sourceLabel?: string;
        sinkFactId?: string;
        sinkNodeId?: number;
        sinkArgEndpoint?: string;
    };
    requiredForRefutation?: boolean;
    preconditions?: {
        pathComplete?: boolean;
        sinkValueAligned?: boolean;
        sameValueVersion?: boolean;
        noDirtyRemixAfter?: boolean;
        endpointResolved?: boolean;
    };
    sourceEvidenceIds: string[];
    position?: {
        factId?: string;
        stmtText?: string;
        methodSignature?: string;
        pathIndex?: number;
    };
    target?: {
        sinkFactId: string;
        sinkNodeId?: number;
    };
    meta: Record<string, unknown>;
}

export interface PostsolveJudgement {
    kind: PostsolveJudgementKind;
    primaryReason?: string;
    evidenceKinds: string[];
}

export type PostsolveCountabilityStatus =
    | "confirmed"
    | "near_hit_unresolved"
    | "truncated"
    | "cycle_blocked"
    | "out_of_scope"
    | "refuted";

export interface PostsolveCountability {
    status: PostsolveCountabilityStatus;
    reason: string;
}

export interface PostsolveSkeleton {
    sinkFactId: string;
    materialization?: {
        status?: ProvenancePathStatus;
        incompleteReasons: ProvenancePathIncompleteReason[];
        pathCount: number;
    };
    nodes: Array<{
        factId: string;
        stmtText?: string;
        methodSignature?: string;
    }>;
    edges: Array<{
        fromFactId: string;
        toFactId: string;
        reason: string;
    }>;
}

export interface PostsolveReport {
    sinkFactId: string;
    witness?: MaterializedTaintFlow;
    skeleton?: PostsolveSkeleton;
    evidence: PostsolveEvidence[];
    judgement: PostsolveJudgement;
    countability: PostsolveCountability;
    countabilityStatus?: PostsolveCountabilityStatus;
    temporalFingerprint?: {
        sinkFactId: string;
        pathCount: number;
    };
}

export interface PostsolveSeedResult {
    sinkFactId: string;
    witness?: MaterializedTaintFlow;
    skeleton?: PostsolveSkeleton;
    judgement: PostsolveJudgement;
    pathResults: Array<{
        factIds: string[];
        status?: ProvenancePathStatus;
        incompleteReasons?: ProvenancePathIncompleteReason[];
        truncated?: boolean;
        evidence: PostsolveEvidence[];
        judgement: PostsolveJudgement;
        countability: PostsolveCountability;
    }>;
    evidenceSummary: {
        evidenceKinds: string[];
        primaryReason?: string;
    };
    countability: PostsolveCountability;
    countabilityStatus?: PostsolveCountabilityStatus;
    report: PostsolveReport;
}

export interface PostsolveFlowResult {
    flow: {
        source: string;
        sinkText: string;
        sinkFactId?: string;
        sinkNodeId?: number;
        sinkFieldPath?: string[];
    };
    skeleton?: PostsolveSkeleton;
    paths: Array<{
        factIds: string[];
        status?: ProvenancePathStatus;
        incompleteReasons?: ProvenancePathIncompleteReason[];
        truncated?: boolean;
        evidence: PostsolveEvidence[];
        judgement: PostsolveJudgement;
        countability: PostsolveCountability;
    }>;
    evidenceSummary: {
        evidenceKinds: string[];
        primaryReason?: string;
    };
    judgement: PostsolveJudgement;
    countability: PostsolveCountability;
    countabilityStatus?: PostsolveCountabilityStatus;
    report: PostsolveReport;
}

export interface TaintFactWitness {
    facts: TaintFact[];
    predecessorRecords: FactPredecessorRecord[];
}

export interface PostsolveContext extends ProvenancePathContext {
    pag?: Pag;
    sanitizerRules?: readonly SanitizerRule[];
    materializationOptions?: PathMaterializationOptions;
}

export type TypeofTag =
    | "string"
    | "number"
    | "boolean"
    | "bigint"
    | "undefined"
    | "object"
    | "function"
    | "unknown";

export interface TypeofGuardFormula {
    variable: any;
    variableName: string;
    variableKey: string;
    allowedTypes: Set<TypeofTag>;
}

export interface TypeofGuardObligation {
    stmt: any;
    methodSignature: string;
    variableName: string;
    variableKey: string;
    variable: any;
    allowedTypes: Set<TypeofTag>;
    branchTaken: "true" | "false";
    guardText: string;
    witnessPosition: number;
}

export interface TypeofDeadBranchEvidence {
    kind: "type_narrowing_guard";
    branchTaken: "true" | "false";
    variableName: string;
    allowedTypes: TypeofTag[];
    possibleTypes: TypeofTag[];
    guardText: string;
    reason: string;
}
