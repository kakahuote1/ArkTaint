import { FieldLocation } from "./FieldLocation";
import { FieldPrecision, NormalizedFieldPath } from "./FieldPath";

export type FieldAccessKind =
    | "store"
    | "load"
    | "copy"
    | "destructure"
    | "spread"
    | "object-assign"
    | "return-object"
    | "getter"
    | "setter"
    | "json-stringify"
    | "json-parse"
    | "template-string"
    | "encode"
    | "delete"
    | "clean-overwrite";

export type FieldAccessOrderEvidence =
    | "same-cfg-order"
    | "summary-order"
    | "unknown";

export interface FieldAccess {
    id: string;
    kind: FieldAccessKind;
    programPoint: string;
    base?: FieldLocation;
    sourceValueNodeIds?: number[];
    targetValueNodeIds?: number[];
    sourceFieldPath?: NormalizedFieldPath;
    targetFieldPath?: NormalizedFieldPath;
    precision: FieldPrecision;
    orderEvidence: FieldAccessOrderEvidence;
    producer?: "ir" | "ordinary" | "module" | "asset" | "synthetic" | "trace";
}
