import { ContextID } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/context/Context";
import { FieldPrecision, NormalizedFieldPath, fieldPathKey, normalizeFieldPath } from "./FieldPath";

export type FieldLocationKind =
    | "object-field"
    | "static-field"
    | "array-element"
    | "indexed-element"
    | "map-entry"
    | "object-entry"
    | "collection-element"
    | "unknown-field";

export interface FieldLocation {
    kind: FieldLocationKind;
    ownerNodeId: number;
    contextId: ContextID;
    path?: NormalizedFieldPath;
    owner?: string;
    method?: string;
}

export function makeFieldLocation(
    kind: FieldLocationKind,
    ownerNodeId: number,
    contextId: ContextID,
    fieldPath?: readonly unknown[],
    precision: FieldPrecision = "exact",
): FieldLocation {
    return {
        kind,
        ownerNodeId,
        contextId,
        path: normalizeFieldPath(fieldPath, precision),
    };
}

export function fieldLocationKey(location: FieldLocation): string {
    const base = `${location.kind}:${location.ownerNodeId}@${location.contextId}`;
    const pathKey = fieldPathKey(location.path?.segments);
    return pathKey ? `${base}.${pathKey}` : base;
}
