import { FieldFact } from "./FieldFact";
import { makeFieldLocation } from "./FieldLocation";
import { FieldPrecision } from "./FieldPath";

export function makeObjectFieldFact(
    ownerNodeId: number,
    contextId: number,
    source: string,
    fieldPath: readonly unknown[],
    precision: FieldPrecision = "exact",
): FieldFact {
    return {
        location: makeFieldLocation("object-field", ownerNodeId, contextId, fieldPath, precision),
        source,
        valueKind: "field",
        confidence: "certain",
    };
}

export function makeStaticFieldFact(
    ownerNodeId: number,
    contextId: number,
    source: string,
    fieldPath: readonly unknown[],
    precision: FieldPrecision = "exact",
): FieldFact {
    return {
        location: makeFieldLocation("static-field", ownerNodeId, contextId, fieldPath, precision),
        source,
        valueKind: "field",
        confidence: "certain",
    };
}
