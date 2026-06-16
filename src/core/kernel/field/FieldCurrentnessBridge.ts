import {
    KillStateEffect,
    LoadStateEffect,
    StateCell,
    StateEffect,
    StateUpdateStrength,
    StoreCleanStateEffect,
    StoreStateEffect,
} from "../oclfs/OclfsTypes";
import { StateEffectBuilder } from "../oclfs/StateEffectCanonicalizer";
import { FieldLocation } from "./FieldLocation";
import { FieldPrecision, fieldPathKey } from "./FieldPath";
import { canStronglyUpdateField } from "./FieldPrecisionPolicy";

export function toObjectFieldCell(
    builder: StateEffectBuilder,
    owner: string,
    fieldPath: readonly string[],
    scope = "",
    precision: FieldPrecision = "exact",
): StateCell {
    return builder.objectField(owner, [...fieldPath], scope, precision);
}

export function toStaticFieldCell(
    owner: string,
    fieldPath: readonly string[],
    scope = "",
    precision: FieldPrecision = "exact",
): StateCell {
    const normalized = [...fieldPath];
    return {
        id: `static-field|${scope}|${owner}|${fieldPathKey(normalized)}|${precision}`,
        kind: "static-field",
        scope,
        owner,
        fieldPath: normalized,
        precision,
    };
}

export function fieldLocationToStateCell(builder: StateEffectBuilder, location: FieldLocation): StateCell | undefined {
    const fieldPath = location.path?.segments || [];
    const precision = location.path?.precision || "unknown";
    if (location.kind === "object-field") {
        return toObjectFieldCell(builder, String(location.owner || location.ownerNodeId), fieldPath, String(location.contextId), precision);
    }
    if (location.kind === "static-field") {
        return toStaticFieldCell(String(location.owner || location.ownerNodeId), fieldPath, String(location.contextId), precision);
    }
    return undefined;
}

export function fieldStoreEffect(
    builder: StateEffectBuilder,
    location: StateCell,
    value: StateCell,
    label?: string,
    programPoint?: string,
): StoreStateEffect {
    return builder.store(location, value, label, programPoint, inferFieldUpdateStrength(location));
}

export function fieldLoadEffect(
    builder: StateEffectBuilder,
    location: StateCell,
    target: StateCell,
    label?: string,
    programPoint?: string,
): LoadStateEffect {
    return builder.load(location, target, label, programPoint);
}

export function fieldCleanEffect(
    builder: StateEffectBuilder,
    location: StateCell,
    programPoint?: string,
): StoreCleanStateEffect {
    return builder.storeClean(location, programPoint, inferFieldUpdateStrength(location));
}

export function fieldKillEffect(
    builder: StateEffectBuilder,
    location: StateCell,
    programPoint?: string,
): KillStateEffect {
    return builder.kill(location, programPoint, inferFieldUpdateStrength(location));
}

export function fieldCurrentnessEffectKind(effect: StateEffect): "store" | "load" | "clean" | "kill" | "other" {
    if (effect.kind === "store") return "store";
    if (effect.kind === "load") return "load";
    if (effect.kind === "store-clean") return "clean";
    if (effect.kind === "kill") return "kill";
    return "other";
}

function inferFieldUpdateStrength(location: StateCell): StateUpdateStrength {
    const precision = location.precision || "unknown";
    const path = location.fieldPath && location.fieldPath.length > 0
        ? { segments: location.fieldPath, precision, truncated: false }
        : undefined;
    return canStronglyUpdateField(path) ? "strong" : "weak";
}
