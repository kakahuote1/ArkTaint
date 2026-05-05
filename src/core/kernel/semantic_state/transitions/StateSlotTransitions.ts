import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import {
    SemanticTransition,
    resolveMethodSignatureText,
    resolveStmtText,
    buildSemanticCarrierForValue,
} from "../SemanticStateTypes";
import { createSemanticFact } from "../SemanticFact";

export function createStateSlotTransitions(): SemanticTransition[] {
    return [{
        id: "slot.state",
        label: "slot-state",
        match: (_fact, ctx) => ctx.stmt instanceof ArkAssignStmt,
        project: (fact, ctx) => {
            const stmt = ctx.stmt as ArkAssignStmt;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof ArkArrayRef) && !(right instanceof ArkArrayRef)) {
                return [];
            }

            const leftCarrier = buildSemanticCarrierForValue(ctx.method, left, ctx.stmt);
            const rightCarrier = buildSemanticCarrierForValue(ctx.method, right, ctx.stmt);
            if (left instanceof ArkArrayRef && rightCarrier?.key === fact.carrier.key) {
                const carrier = buildSemanticCarrierForValue(ctx.method, left, ctx.stmt);
                if (!carrier) return [];
                return [{
                    carrier,
                    tainted: fact.tainted,
                    state: fact.tainted ? "written" : "clean",
                    sideState: { slotState: fact.tainted ? "written" : "cleared" },
                    reason: "slot-write",
                    guard: {
                        kind: "same_key",
                        enabled: true,
                        left: rightCarrier.key,
                        right: fact.carrier.key,
                        description: "slot write source matches fact",
                    },
                }];
            }

            if (right instanceof ArkArrayRef && rightCarrier?.key === fact.carrier.key && leftCarrier) {
                if (fact.sideState.slotState !== "written") {
                    return [{
                        carrier: fact.carrier,
                        tainted: fact.tainted,
                        state: fact.state,
                        reason: "slot-uninitialized",
                        guard: {
                            kind: "slot_initialized",
                            enabled: false,
                            left: rightCarrier.key,
                            right: fact.sideState.slotState,
                            description: "slot must be initialized before read",
                        },
                        gap: { blockedBy: "slot_initialized" },
                    }];
                }
                return [{
                    carrier: leftCarrier,
                    tainted: fact.tainted,
                    state: fact.tainted ? "dirty" : "clean",
                    sideState: { slotState: "written" },
                    reason: "slot-read",
                    guard: {
                        kind: "slot_initialized",
                        enabled: true,
                        left: rightCarrier.key,
                        right: fact.carrier.key,
                        description: "slot initialized and key matches",
                    },
                }];
            }

            if (right instanceof ArkArrayRef && rightCarrier?.key !== fact.carrier.key && fact.carrier.kind === "unique_slot") {
                return [{
                    carrier: fact.carrier,
                    tainted: fact.tainted,
                    state: fact.state,
                    reason: "slot-key-mismatch",
                    guard: {
                        kind: "same_key",
                        enabled: false,
                        left: rightCarrier?.key,
                        right: fact.carrier.key,
                        description: "slot read key mismatch",
                    },
                    gap: { blockedBy: "same_key" },
                }];
            }

            return [];
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
                transitionId: "slot.state",
                reason: projection.reason,
                methodSignature: resolveMethodSignatureText(ctx.method),
                stmtText: resolveStmtText(ctx.stmt),
                carrierKey: derived.carrier.key,
                tainted: derived.tainted,
            });
        },
    }];
}
