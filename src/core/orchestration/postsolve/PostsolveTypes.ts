import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintFact } from "../../kernel/model/TaintFact";
import { FactPredecessorRecord } from "../../kernel/propagation/PropagationTypes";
import { SanitizerRule } from "../../rules/RuleSchema";
import {
    MaterializedTaintFlow,
    ProvenancePathIncompleteReason,
    ProvenancePathStatus,
    ProvenancePathContext,
} from "../../provenance/ProvenancePathTypes";

export type PostsolveJudgementKind =
    | "Confirmed"
    | "Refuted-Strong"
    | "Refuted-Weak"
    | "Unresolved";

export interface PostsolveEvidence {
    kind: string;
    polarity: "positive" | "negative";
    strength: "strong" | "weak";
    stability: "stable" | "overridable";
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

export interface PostsolveSkeleton {
    sinkFactId: string;
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
    }>;
    evidenceSummary: {
        evidenceKinds: string[];
        primaryReason?: string;
    };
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
    }>;
    evidenceSummary: {
        evidenceKinds: string[];
        primaryReason?: string;
    };
    judgement: PostsolveJudgement;
    report: PostsolveReport;
}

export interface SafeOverwriteHit {
    sinkNodeId?: number;
    sinkFieldPath?: string[];
    keyLiteral?: string;
    overwriteStmtText?: string;
}

export interface TaintFactWitness {
    facts: TaintFact[];
    predecessorRecords: FactPredecessorRecord[];
}

export interface PostsolveContext extends ProvenancePathContext {
    pag?: Pag;
    sanitizerRules?: readonly SanitizerRule[];
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
