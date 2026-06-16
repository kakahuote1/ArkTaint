import { ArkInstanceFieldRef, ArkStaticFieldRef, ArkArrayRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { toContainerFieldKey } from "../model/ContainerSlotKeys";
import { FieldAccess, FieldAccessKind } from "./FieldAccess";
import { FieldLocation, makeFieldLocation } from "./FieldLocation";
import { decideFieldPrecision } from "./FieldPrecisionPolicy";

export interface ExtractedFieldAccess {
    access: FieldAccess;
    location: FieldLocation;
}

export function extractFieldAccessFromAssign(stmt: ArkAssignStmt, ownerNodeId: number, contextId: number): ExtractedFieldAccess[] {
    const out: ExtractedFieldAccess[] = [];
    const left = stmt.getLeftOp?.();
    const right = stmt.getRightOp?.();
    if (left instanceof ArkInstanceFieldRef) {
        out.push(makeAccess("store", ownerNodeId, contextId, getInstanceFieldPath(left), stmt));
    }
    if (right instanceof ArkInstanceFieldRef) {
        out.push(makeAccess("load", ownerNodeId, contextId, getInstanceFieldPath(right), stmt));
    }
    if (left instanceof ArkStaticFieldRef) {
        out.push(makeAccess("store", ownerNodeId, contextId, getStaticFieldPath(left), stmt, "static-field"));
    }
    if (right instanceof ArkStaticFieldRef) {
        out.push(makeAccess("load", ownerNodeId, contextId, getStaticFieldPath(right), stmt, "static-field"));
    }
    if (left instanceof ArkArrayRef) {
        out.push(makeAccess("store", ownerNodeId, contextId, [toContainerFieldKey(String(left.getIndex?.() || "*"))], stmt, "array-element"));
    }
    if (right instanceof ArkArrayRef) {
        out.push(makeAccess("load", ownerNodeId, contextId, [toContainerFieldKey(String(right.getIndex?.() || "*"))], stmt, "array-element"));
    }
    return out;
}

export function getInstanceFieldPath(ref: ArkInstanceFieldRef): string[] {
    const name = ref.getFieldSignature?.().getFieldName?.() || ref.getFieldName?.();
    return name ? [String(name)] : [];
}

export function getStaticFieldPath(ref: ArkStaticFieldRef): string[] {
    const name = ref.getFieldSignature?.().getFieldName?.() || ref.getFieldName?.();
    return name ? [String(name)] : [];
}

function makeAccess(
    kind: FieldAccessKind,
    ownerNodeId: number,
    contextId: number,
    fieldPath: string[],
    stmt: ArkAssignStmt,
    locationKind: "object-field" | "static-field" | "array-element" = "object-field",
): ExtractedFieldAccess {
    const precision = decideFieldPrecision(fieldPath);
    const location = makeFieldLocation(locationKind, ownerNodeId, contextId, fieldPath, precision.precision);
    const access: FieldAccess = {
        id: `${kind}:${ownerNodeId}:${stmt.toString?.() || ""}:${fieldPath.join(".")}`,
        kind,
        programPoint: stmt.toString?.() || "",
        base: location,
        targetFieldPath: location.path,
        precision: precision.precision,
        orderEvidence: "same-cfg-order",
        producer: "ir",
    };
    return { access, location };
}
