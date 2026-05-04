import { ArkAssignStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import {
    SemanticTransition,
    SemanticTransitionContext,
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
            const carrier = buildSemanticCarrierForValue(ctx.method, left instanceof ArkArrayRef ? left : right, ctx.stmt);
            if (!carrier) {
                return [];
            }
            return [{
                carrier,
                tainted: fact.tainted,
                state: fact.tainted ? "written" : "clean",
                sideState: { slotState: fact.tainted ? "written" : "cleared" },
                reason: "slot-transition",
            }];
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
