import { ArkInvokeStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import {
    SemanticTransition,
    SemanticTransitionContext,
    SemanticTransitionProjection,
    createSemanticCarrier,
    resolveMethodSignatureText,
    resolveStmtText,
} from "../SemanticStateTypes";
import { createSemanticFact } from "../SemanticFact";

export function createEventTransitions(): SemanticTransition[] {
    const event: SemanticTransition = {
        id: "event.channel",
        label: "event-channel",
        match: (_fact, ctx) => ctx.stmt instanceof ArkInvokeStmt || ctx.stmt.containsInvokeExpr?.(),
        project: (fact, ctx) => {
            const invokeExpr = ctx.stmt.getInvokeExpr?.();
            const signature = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
            if (!signature) return [];
            if (!/on|emit|callback|listener/i.test(signature)) return [];
            return [{
                carrier: createSemanticCarrier("event", `event:${signature}`, signature, { channel: signature, callback: signature }),
                tainted: fact.tainted,
                state: fact.state,
                sideState: { eventState: fact.tainted ? "bound" : "unbound" },
                reason: "event-transition",
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
                transitionId: event.id,
                reason: projection.reason,
                methodSignature: resolveMethodSignatureText(ctx.method),
                stmtText: resolveStmtText(ctx.stmt),
                carrierKey: derived.carrier.key,
                tainted: derived.tainted,
            });
        },
    };

    return [event];
}
