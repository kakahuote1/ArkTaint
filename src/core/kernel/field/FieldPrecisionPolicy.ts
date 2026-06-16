import { FieldPrecision, NormalizedFieldPath, normalizeFieldPath } from "./FieldPath";

export type FieldUpdateStrength = "strong" | "weak" | "none";

export interface FieldPrecisionDecision {
    precision: FieldPrecision;
    reason: "exact-path" | "partial-path" | "unknown-path" | "missing-path" | "truncated-path";
    updateStrength: FieldUpdateStrength;
}

export function decideFieldPrecision(fieldPath?: readonly unknown[], requested: FieldPrecision = "exact"): FieldPrecisionDecision {
    const normalized = normalizeFieldPath(fieldPath, requested);
    if (!normalized) {
        return {
            precision: "unknown",
            reason: "missing-path",
            updateStrength: "none",
        };
    }
    return decideNormalizedFieldPrecision(normalized);
}

export function decideNormalizedFieldPrecision(path: NormalizedFieldPath): FieldPrecisionDecision {
    if (path.truncated) {
        return {
            precision: "unknown",
            reason: "truncated-path",
            updateStrength: "weak",
        };
    }
    if (path.precision === "exact") {
        return {
            precision: "exact",
            reason: "exact-path",
            updateStrength: "strong",
        };
    }
    if (path.precision === "partial") {
        return {
            precision: "partial",
            reason: "partial-path",
            updateStrength: "weak",
        };
    }
    return {
        precision: "unknown",
        reason: "unknown-path",
        updateStrength: "weak",
    };
}

export function canStronglyUpdateField(path?: NormalizedFieldPath): boolean {
    return !!path && decideNormalizedFieldPrecision(path).updateStrength === "strong";
}

export function canUseExactSiblingIsolation(path?: NormalizedFieldPath): boolean {
    return !!path && path.precision === "exact" && !path.truncated;
}
