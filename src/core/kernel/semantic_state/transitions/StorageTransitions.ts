import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef, ArkInstanceFieldRef, ArkStaticFieldRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
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
} from "../SemanticStateTypes";

function resolveStorageCarrierKey(value: any, ctx: SemanticTransitionContext): string | undefined {
    if (value instanceof ArkInstanceFieldRef) {
        const baseName = String(value.getBase?.()?.getName?.() || "base");
        return `storage:${ctx.method.getSignature().toString()}:${baseName}.${value.getFieldName?.() || value.toString()}`;
    }
    if (value instanceof ArkStaticFieldRef) {
        return `storage:${ctx.method.getSignature().toString()}:static.${value.getFieldName?.() || value.toString()}`;
    }
    if (value instanceof ArkArrayRef) {
        const baseName = String(value.getBase?.()?.getName?.() || "array");
        return `slot:${ctx.method.getSignature().toString()}:${baseName}[${value.getIndex?.()?.toString?.() || "?"}]`;
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
            const projections: SemanticTransitionProjection[] = [];
            if (leftKey && rightKey === fact.carrier.key && fact.tainted) {
                projections.push({
                    carrier: createSemanticCarrier("storage", leftKey, leftKey, { ownerKey: leftKey }),
                    tainted: true,
                    state: "written",
                    sideState: { storageState: "written", slotState: "written" },
                    reason: "storage-write",
                });
            }
            if (rightKey && leftKey === fact.carrier.key && fact.tainted) {
                projections.push({
                    carrier: createSemanticCarrier("same_lvalue", leftKey, leftKey),
                    tainted: true,
                    state: "dirty",
                    sideState: { storageState: "written", slotState: "written" },
                    reason: "storage-read",
                });
            }
            return projections;
        },
        check: () => true,
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
