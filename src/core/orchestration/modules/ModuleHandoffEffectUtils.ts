import type { ModuleScannedInvoke } from "../../kernel/contracts/ModuleContract";
import type {
    ModuleBridgeEmitSpec,
    ModuleFieldPathSpec,
    ModuleTransferMode,
} from "../../kernel/contracts/ModuleRuntimeSpec";
import type { CellKindId } from "../../cellkind";
import { createHandoffHandle } from "../../kernel/semantic_handoff/SemanticHandoffTypes";
import type {
    HandoffEffect,
    HandoffHandle,
    HandoffSourceEndpoint,
    HandoffTargetEndpoint,
} from "../../kernel/semantic_handoff/SemanticHandoffTypes";

export type NormalizedBridgeEmitSpec = Required<ModuleBridgeEmitSpec>;

export function moduleHandoffHandle(cellKind: CellKindId, family: string, key: string, scope = ""): HandoffHandle {
    return createHandoffHandle(cellKind, family, key, {
        scope,
        precision: "exact",
    });
}

export function handoffInvokeEffectMeta(
    call: ModuleScannedInvoke,
    orderOffset = 0,
): { programPoint: string; flowScope: string; sequence?: number } {
    const stmtText = String(call.stmt?.toString?.() || call.call.signature || "").trim();
    const stmtIndex = resolveInvokeStmtIndex(call);
    return {
        programPoint: `${call.ownerMethodSignature}#${stmtIndex === undefined ? "stmt" : stmtIndex}:${stmtText}`,
        flowScope: call.ownerMethodSignature,
        sequence: stmtIndex === undefined ? undefined : stmtIndex * 10 + orderOffset,
    };
}

export function pushHandoffKillThenPut(
    effects: HandoffEffect[],
    args: {
        handle: HandoffHandle;
        source: HandoffSourceEndpoint;
        reason: string;
        originModel: string;
        call: ModuleScannedInvoke;
    },
): void {
    effects.push({
        kind: "kill",
        handle: args.handle,
        reason: args.reason,
        originModel: args.originModel,
        updateStrength: "strong",
        handlePrecision: "exact",
        confidence: "certain",
        ...handoffInvokeEffectMeta(args.call, 0),
    });
    effects.push({
        kind: "put",
        handle: args.handle,
        source: args.source,
        reason: args.reason,
        originModel: args.originModel,
        updateStrength: "strong",
        handlePrecision: "exact",
        confidence: "certain",
        ...handoffInvokeEffectMeta(args.call, 1),
    });
}

export function handoffTargetFromEmitSpec(
    nodeId: number,
    emitSpec: NormalizedBridgeEmitSpec,
    fieldPath?: ModuleFieldPathSpec,
): HandoffTargetEndpoint {
    const target: HandoffTargetEndpoint = {
        nodeId,
        allowUnreachableTarget: emitSpec.allowUnreachableTarget,
    };
    if (hasFieldPathSpec(fieldPath)) {
        applyFieldPathSpecToHandoffTarget(target, fieldPath!, emitSpec.mode);
        return target;
    }

    if (emitSpec.boundary === "clone_copy") {
        switch (emitSpec.mode) {
            case "plain":
                target.preserveSourceField = false;
                return target;
            case "current_field_tail":
                target.currentField = { mode: "tail" };
                return target;
            case "preserve":
            default:
                target.currentField = { mode: "preserve" };
                return target;
        }
    }

    if (emitSpec.boundary === "stringify_result") {
        target.preserveSourceField = false;
        return target;
    }

    switch (emitSpec.mode) {
        case "plain":
            target.preserveSourceField = false;
            break;
        case "current_field_tail":
            target.currentField = { mode: "tail" };
            break;
        case "preserve":
        default:
            break;
    }
    return target;
}

export function handoffTargetForDecoratedField(
    objectNodeId: number,
    fieldName: string,
    emitSpec: NormalizedBridgeEmitSpec,
): HandoffTargetEndpoint {
    if (emitSpec.boundary === "clone_copy" || emitSpec.boundary === "stringify_result") {
        return {
            nodeId: objectNodeId,
            fieldPath: [fieldName],
            allowUnreachableTarget: emitSpec.allowUnreachableTarget,
            preserveSourceField: false,
        };
    }
    switch (emitSpec.mode) {
        case "plain":
            return {
                nodeId: objectNodeId,
                fieldPath: [fieldName],
                allowUnreachableTarget: emitSpec.allowUnreachableTarget,
                preserveSourceField: false,
            };
        case "current_field_tail":
            return {
                nodeId: objectNodeId,
                currentField: { mode: "tail-prefix", prefix: [fieldName] },
                allowUnreachableTarget: emitSpec.allowUnreachableTarget,
            };
        case "preserve":
        default:
            return {
                nodeId: objectNodeId,
                currentField: { mode: "prefix", prefix: [fieldName] },
                allowUnreachableTarget: emitSpec.allowUnreachableTarget,
            };
    }
}

function resolveInvokeStmtIndex(call: ModuleScannedInvoke): number | undefined {
    const stmts = call.stmt?.getCfg?.()?.getStmts?.();
    if (!Array.isArray(stmts)) return undefined;
    const index = stmts.indexOf(call.stmt);
    return index >= 0 ? index : undefined;
}

function applyFieldPathSpecToHandoffTarget(
    target: HandoffTargetEndpoint,
    fieldPath: ModuleFieldPathSpec,
    mode: ModuleTransferMode,
): void {
    if (Array.isArray(fieldPath)) {
        switch (mode) {
            case "plain":
                target.fieldPath = [...fieldPath];
                target.preserveSourceField = false;
                break;
            case "current_field_tail":
                target.currentField = { mode: "tail-prefix", prefix: [...fieldPath] };
                break;
            case "preserve":
            default:
                target.currentField = { mode: "prefix", prefix: [...fieldPath] };
                break;
        }
        return;
    }

    const literalPrefix: string[] = [];
    for (const part of fieldPath.parts) {
        if (part.kind === "literal") {
            literalPrefix.push(part.value);
            continue;
        }
        if (part.kind === "current_field") {
            target.currentField = { mode: "prefix", prefix: literalPrefix };
            return;
        }
        if (part.kind === "current_tail") {
            target.currentField = { mode: "tail-prefix", prefix: literalPrefix };
            return;
        }
        if (part.kind === "current_field_without_prefix") {
            target.currentField = {
                mode: "prefix",
                prefix: literalPrefix,
                stripPrefixes: part.prefixes.map(prefix => [...prefix]),
            };
            return;
        }
    }
    target.fieldPath = literalPrefix;
    target.preserveSourceField = false;
}

function hasFieldPathSpec(spec: ModuleFieldPathSpec | undefined): boolean {
    if (!spec) return false;
    return Array.isArray(spec) ? spec.length > 0 : spec.parts.length > 0;
}
