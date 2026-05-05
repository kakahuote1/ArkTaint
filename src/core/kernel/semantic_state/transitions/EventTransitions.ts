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

function readSemanticEffect(ctx: SemanticTransitionContext): any {
    const invokeExpr = ctx.stmt.getInvokeExpr?.() as any;
    return invokeExpr?.getSemanticEffect?.()
        || invokeExpr?.semanticEffect
        || (ctx.stmt as any).getSemanticEffect?.()
        || (ctx.stmt as any).semanticEffect;
}

export function createEventTransitions(): SemanticTransition[] {
    const event: SemanticTransition = {
        id: "event.channel",
        label: "event-channel",
        match: (_fact, ctx) => ctx.stmt instanceof ArkInvokeStmt || ctx.stmt.containsInvokeExpr?.(),
        project: (fact, ctx) => {
            const effect = readSemanticEffect(ctx);
            if (!effect || effect.family !== "callback_event") return [];
            const channel = effect.channel;
            const callback = effect.callback;
            if (!channel || !callback) return [];
            const carrierKey = `event:${channel}:${callback}`;
            if (effect.operation === "bind") {
                return [{
                    carrier: createSemanticCarrier("event", carrierKey, `${channel}:${callback}`, { channel, callback }),
                    tainted: fact.tainted,
                    state: "bound",
                    sideState: { eventState: "bound" },
                    reason: "event-bind",
                    guard: {
                        kind: "binding_active",
                        enabled: true,
                        left: channel,
                        right: callback,
                        description: "callback binding recorded",
                    },
                }];
            }
            if (effect.operation !== "emit") return [];
            if (fact.carrier.kind !== "event") return [];
            const sameChannel = fact.carrier.channel === channel;
            const sameCallback = fact.carrier.callback === callback;
            const bindingActive = fact.sideState.eventState === "bound" || fact.sideState.eventState === "active";
            const blockedBy = !sameChannel
                ? "same_channel"
                : !sameCallback
                    ? "same_callback"
                    : !bindingActive
                        ? "binding_active"
                        : "";
            if (blockedBy) {
                return [{
                    carrier: fact.carrier,
                    tainted: fact.tainted,
                    state: fact.state,
                    reason: "event-guard-failed",
                    guard: {
                        kind: blockedBy as any,
                        enabled: false,
                        left: `${channel}:${callback}`,
                        right: `${fact.carrier.channel || ""}:${fact.carrier.callback || ""}`,
                        description: "event emit guard failed",
                    },
                    gap: { blockedBy },
                }];
            }
            return [{
                carrier: createSemanticCarrier("event", carrierKey, `${channel}:${callback}`, { channel, callback }),
                tainted: fact.tainted,
                state: "active",
                sideState: { eventState: "active" },
                reason: "event-emit",
                guard: {
                    kind: "binding_active",
                    enabled: true,
                    left: `${channel}:${callback}`,
                    right: `${fact.carrier.channel}:${fact.carrier.callback}`,
                    description: "event emit binding active",
                },
            }];
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
