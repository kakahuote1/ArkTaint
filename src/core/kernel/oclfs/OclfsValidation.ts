import {
    CellCompatibility,
    CurrentnessCertificate,
    CurrentnessVerdict,
    OclfsValidationResult,
    SliceCompleteness,
    StateCell,
    StateEffect,
} from "./OclfsTypes";
import {
    DEFAULT_CELL_KIND_REGISTRY,
    canCellKindStronglyUpdate,
    isMutableCellKind,
    isRegisteredCellKindId,
    isValueCellKind,
} from "../../cellkind";
import { fieldPathEquals, fieldPathKey } from "../field/FieldPath";

const VERDICTS: CurrentnessVerdict[] = [
    "live",
    "dead",
    "may-live",
    "unknown",
    "blocked-mismatch",
];

const SLICE_COMPLETENESS: SliceCompleteness[] = [
    "complete-for-cell",
    "bounded-complete",
    "truncated",
    "unknown",
];

export function validateStateCell(cell: StateCell): OclfsValidationResult {
    const errors: string[] = [];
    if (!cell) {
        return result(["cell is required"]);
    }
    if (!cell.id) errors.push("cell.id is required");
    if (!cell.kind) errors.push("cell.kind is required");
    if (!cell.precision) errors.push("cell.precision is required");
    if (cell.precision && !["exact", "partial", "unknown"].includes(cell.precision)) {
        errors.push(`invalid cell.precision ${cell.precision}`);
    }
    if (!isRegisteredCellKindId(cell.kind)) {
        errors.push(`cell.kind is not registered: ${String(cell.kind)}`);
        return result(errors);
    }
    const spec = DEFAULT_CELL_KIND_REGISTRY.require(cell.kind);
    for (const dimension of spec.requiredDimensions) {
        if (dimension === "owner" && !cell.owner) errors.push(`${cell.kind} requires owner`);
        if (dimension === "key" && !cell.key) errors.push(`${cell.kind} requires key`);
        if (dimension === "valueVersion" && !cell.valueVersion) errors.push(`${cell.kind} requires valueVersion`);
        if (dimension === "fieldPath" && (!cell.fieldPath || cell.fieldPath.length === 0)) {
            errors.push(`${cell.kind} requires fieldPath`);
        }
        if (dimension === "index" && cell.index === undefined) errors.push(`${cell.kind} requires index`);
        if (dimension === "scope" && !cell.scope) errors.push(`${cell.kind} requires scope`);
        if (dimension === "allocSite" && !cell.allocSite) errors.push(`${cell.kind} requires allocSite`);
    }
    return result(errors);
}

export function validateStateEffect(effect: StateEffect): OclfsValidationResult {
    const errors: string[] = [];
    if (!effect) return result(["effect is required"]);
    if (!effect.id) errors.push("effect.id is required");
    if (!effect.kind) errors.push("effect.kind is required");
    if (effect.sequence === undefined || effect.sequence === null) errors.push("effect.sequence is required");
    if (!effect.programPoint) errors.push("effect.programPoint is required");
    if (!effect.origin) errors.push("effect.origin is required");
    if (!effect.confidence) errors.push("effect.confidence is required");

    if (effect.kind === "store") {
        errors.push(...validateLocationCell(effect.location, "store.location"));
        errors.push(...validateValueCell(effect.value, "store.value"));
    } else if (effect.kind === "load") {
        errors.push(...validateLocationCell(effect.location, "load.location"));
        errors.push(...validateValueCell(effect.target, "load.target"));
    } else if (effect.kind === "store-clean" || effect.kind === "kill") {
        errors.push(...validateLocationCell(effect.location, `${effect.kind}.location`));
        if (effect.location?.precision === "unknown" && (effect.updateStrength || "infer") === "strong") {
            errors.push(`${effect.kind} cannot be strong on unknown-precision cell`);
        }
    } else if (effect.kind === "source") {
        errors.push(...validateValueCell(effect.target, "source.target"));
    } else if (effect.kind === "copy") {
        errors.push(...validateValueCell(effect.from, "copy.from"));
        errors.push(...validateValueCell(effect.to, "copy.to"));
    } else if (effect.kind === "sink") {
        errors.push(...validateValueCell(effect.value, "sink.value"));
    }

    return result(errors);
}

export function validateCurrentnessCertificate(cert: CurrentnessCertificate): OclfsValidationResult {
    const errors: string[] = [];
    if (!cert) return result(["certificate is required"]);
    if (!cert.id) errors.push("certificate.id is required");
    if (!cert.candidateFlow) errors.push("certificate.candidateFlow is required");
    if (!VERDICTS.includes(cert.verdict)) errors.push(`invalid certificate verdict ${cert.verdict}`);
    if (!SLICE_COMPLETENESS.includes(cert.sliceCompleteness)) {
        errors.push(`invalid slice completeness ${cert.sliceCompleteness}`);
    }
    if (!cert.obligations || cert.obligations.length === 0) {
        errors.push("certificate must include at least one obligation");
    }
    if (!cert.primaryReason) errors.push("certificate.primaryReason is required");
    if (!cert.proofStatus) errors.push("certificate.proofStatus is required");
    if (!cert.confidence) errors.push("certificate.confidence is required");
    if (cert.verdict === "dead" && cert.proofStatus !== "refutation-proof") {
        errors.push("dead certificate requires refutation-proof");
    }
    if (cert.verdict === "live" && cert.proofStatus !== "complete-proof") {
        errors.push("live certificate requires complete-proof");
    }
    if (cert.verdict === "dead" && (cert.sliceCompleteness === "truncated" || cert.sliceCompleteness === "unknown")) {
        errors.push("dead certificate requires complete or bounded-complete slice");
    }
    return result(errors);
}

export function compatibleStateCells(left: StateCell, right: StateCell): CellCompatibility {
    if (stateCellKey(left) === stateCellKey(right)) {
        return "exact";
    }
    if (left.kind !== right.kind) return "no";
    if (left.precision === "unknown" || right.precision === "unknown") return "may";
    if (left.precision === "partial" || right.precision === "partial") return "may";
    if ((left.scope || "") !== (right.scope || "")) return "no";
    if ((left.owner || "") !== (right.owner || "")) return "no";
    if ((left.allocSite || "") !== (right.allocSite || "")) return "no";
    if (left.index !== right.index) return "no";
    if (!fieldPathEquals(left.fieldPath, right.fieldPath)) return "no";
    if ((left.key || "") !== (right.key || "")) return "no";
    if ((left.valueVersion || "") !== (right.valueVersion || "")) return "no";
    return "exact";
}

export function stateCellKey(cell: StateCell): string {
    return [
        cell.kind,
        cell.scope || "",
        cell.owner || "",
        cell.key || "",
        fieldPathKey(cell.fieldPath),
        cell.index === undefined ? "" : String(cell.index),
        cell.allocSite || "",
        cell.valueVersion || "",
        cell.precision,
    ].join("|");
}

export function canStronglyInvalidateCell(cell: StateCell): boolean {
    if (!isMutableCellKind(cell.kind)) return false;
    if (!canCellKindStronglyUpdate(cell.kind)) return false;
    return cell.precision === "exact";
}

function validateLocationCell(cell: StateCell, fieldName: string): string[] {
    const errors = validateStateCell(cell).errors.map(error => `${fieldName}: ${error}`);
    if (cell && !isMutableCellKind(cell.kind)) {
        errors.push(`${fieldName} must be a mutable location cell`);
    }
    return errors;
}

function validateValueCell(cell: StateCell, fieldName: string): string[] {
    const errors = validateStateCell(cell).errors.map(error => `${fieldName}: ${error}`);
    if (cell && !isValueCellKind(cell.kind)) {
        errors.push(`${fieldName} must be a ValueCell`);
    }
    return errors;
}

function result(errors: string[]): OclfsValidationResult {
    return {
        valid: errors.length === 0,
        errors,
    };
}
