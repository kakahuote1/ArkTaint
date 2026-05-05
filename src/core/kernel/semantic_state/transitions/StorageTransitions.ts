import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ArkStaticFieldRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import { createSemanticFact } from "../SemanticFact";
import {
    SemanticFact,
    SemanticSolveResultMutable,
    SemanticTransition,
    SemanticTransitionContext,
    SemanticTransitionProjection,
    createSemanticCarrier,
    resolveMethodSignatureText,
    resolveStmtText,
    buildSemanticCarrierForValue,
} from "../SemanticStateTypes";

function resolveStorageCarrierKey(value: any, ctx: SemanticTransitionContext): string | undefined {
    if (value instanceof ArkInstanceFieldRef) {
        const baseName = String(value.getBase?.()?.getName?.() || "base");
        return `storage:${ctx.method.getSignature().toString()}:${baseName}.${value.getFieldName?.() || value.toString()}`;
    }
    if (value instanceof ArkStaticFieldRef) {
        return `storage:${ctx.method.getSignature().toString()}:static.${value.getFieldName?.() || value.toString()}`;
    }
    return undefined;
}

export function createStorageTransitions(): SemanticTransition[] {
    const fieldIO: SemanticTransition = {
        id: "storage.field",
        label: "storage-field",
        match: (_fact, ctx) => ctx.stmt instanceof ArkAssignStmt,
        project: (fact, ctx) => {
            const stmt = ctx.stmt as ArkAssignStmt;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            const leftKey = resolveStorageCarrierKey(left, ctx);
            const rightKey = resolveStorageCarrierKey(right, ctx);
            const leftCarrier = buildSemanticCarrierForValue(ctx.method, left, ctx.stmt);
            const projections: SemanticTransitionProjection[] = [];
            if (leftKey && rightKey === fact.carrier.key && fact.tainted) {
                projections.push({
                    carrier: createSemanticCarrier("storage", leftKey, leftKey, { ownerKey: leftKey }),
                    tainted: true,
                    state: "written",
                    sideState: { storageState: "written", slotState: "written" },
                    reason: "storage-write",
                    guard: {
                        kind: "same_key",
                        enabled: true,
                        left: rightKey,
                        right: fact.carrier.key,
                        description: "storage write source matches fact carrier",
                    },
                });
            }
            if (rightKey && rightKey === fact.carrier.key && fact.tainted && leftCarrier) {
                projections.push({
                    carrier: createSemanticCarrier(leftCarrier.kind, leftCarrier.key, leftCarrier.label, leftCarrier),
                    tainted: true,
                    state: "dirty",
                    sideState: { storageState: "written", slotState: "written" },
                    reason: "storage-read",
                    guard: {
                        kind: "same_key",
                        enabled: true,
                        left: rightKey,
                        right: fact.carrier.key,
                        description: "storage read key matches fact carrier",
                    },
                });
            } else if (rightKey && fact.carrier.kind === "storage" && rightKey !== fact.carrier.key) {
                projections.push({
                    carrier: fact.carrier,
                    tainted: fact.tainted,
                    state: fact.state,
                    reason: "storage-read-key-mismatch",
                    guard: {
                        kind: "same_key",
                        enabled: false,
                        left: rightKey,
                        right: fact.carrier.key,
                        description: "storage read key mismatch",
                    },
                    gap: { blockedBy: "same_key" },
                });
            }
            return projections;
        },
        check: (_fact, _ctx, projection) => projection.guard?.enabled !== false,
        update: (_fact, _ctx, projection) => projection.carrier
            ? createSemanticFact({
                source: "semantic_state",
                carrier: projection.carrier,
                tainted: projection.tainted ?? false,
                state: projection.state || "clean",
                contextId: 0,
                order: 0,
                sideState: projection.sideState,
            })
            : undefined,
        derive: (_fact, _ctx, projection) => projection.carrier ? [createSemanticFact({
            source: "semantic_state",
            carrier: projection.carrier,
            tainted: projection.tainted ?? false,
            state: projection.state || "clean",
            contextId: 0,
            order: 0,
            sideState: projection.sideState,
        })] : [],
        record: (fact, ctx, projection, derivedFacts, result) => {
            const derived = derivedFacts[0];
            if (!derived) return;
            result.provenance.push({
                fromFactId: fact.id,
                toFactId: derived.id,
                transitionId: fieldIO.id,
                reason: projection.reason,
                methodSignature: resolveMethodSignatureText(ctx.method),
                stmtText: resolveStmtText(ctx.stmt),
                carrierKey: derived.carrier.key,
                tainted: derived.tainted,
            });
        },
    };

    return [fieldIO];
}
