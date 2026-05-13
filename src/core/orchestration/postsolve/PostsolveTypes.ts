import { TaintFact } from "../../kernel/model/TaintFact";
import { FactPredecessorRecord } from "../../kernel/propagation/PropagationTypes";

export interface PathMaterializationOptions {
    maxPaths?: number;
    maxDepth?: number;
}

export interface WitnessDagEdge {
    fromFactId: string;
    toFactId: string;
    reason: string;
}

export interface WitnessDag {
    sinkFactId: string;
    factIds: Set<string>;
    edges: WitnessDagEdge[];
    sourceFactIds: Set<string>;
}

export interface WitnessPath {
    factIds: string[];
    edges: WitnessDagEdge[];
    truncated?: boolean;
}

export interface MaterializedTaintFlow {
    sinkFactId: string;
    paths: WitnessPath[];
}

export interface TaintFactWitness {
    facts: TaintFact[];
    predecessorRecords: FactPredecessorRecord[];
}

export interface PostsolveContext {
    observedFactsById: ReadonlyMap<string, TaintFact>;
    factPredecessorsByFactId: ReadonlyMap<string, readonly FactPredecessorRecord[]>;
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
