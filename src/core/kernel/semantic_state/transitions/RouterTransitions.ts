import { ArkInvokeStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import {
    SemanticTransition,
    SemanticTransitionContext,
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

export function createRouterTransitions(): SemanticTransition[] {
    return [{
        id: "route.param",
        label: "route-param",
        match: (_fact, ctx) => ctx.stmt instanceof ArkInvokeStmt || ctx.stmt.containsInvokeExpr?.(),
        project: (fact, ctx) => {
            const effect = readSemanticEffect(ctx);
            if (!effect || effect.family !== "router_param" || !effect.routeId || !effect.paramKey) return [];
            const carrierKey = `route:${effect.routeId}:${effect.paramKey}`;
            if (effect.operation === "push") {
                return [{
                    carrier: createSemanticCarrier("route", carrierKey, `${effect.routeId}:${effect.paramKey}`, {
                        routeId: effect.routeId,
                        paramKey: effect.paramKey,
                    }),
                    tainted: fact.tainted,
                    state: "active",
                    sideState: { routeState: "active" },
                    reason: "route-push",
                }];
            }
            if (effect.operation !== "read" || fact.carrier.kind !== "route") return [];
            const sameRoute = fact.carrier.routeId === effect.routeId;
            const sameKey = fact.carrier.paramKey === effect.paramKey;
            if (!sameRoute || !sameKey) {
                return [{
                    carrier: fact.carrier,
                    tainted: fact.tainted,
                    state: fact.state,
                    reason: "route-guard-failed",
                    guard: {
                        kind: sameRoute ? "same_key" : "route_target_match",
                        enabled: false,
                        left: `${effect.routeId}:${effect.paramKey}`,
                        right: `${fact.carrier.routeId || ""}:${fact.carrier.paramKey || ""}`,
                        description: "route read guard failed",
                    },
                    gap: { blockedBy: sameRoute ? "same_key" : "route_target_match" },
                }];
            }
            return [{
                carrier: createSemanticCarrier("route", carrierKey, `${effect.routeId}:${effect.paramKey}`, {
                    routeId: effect.routeId,
                    paramKey: effect.paramKey,
                }),
                tainted: fact.tainted,
                state: "active",
                sideState: { routeState: "active" },
                reason: "route-read",
                guard: {
                    kind: "route_target_match",
                    enabled: true,
                    left: `${effect.routeId}:${effect.paramKey}`,
                    right: `${fact.carrier.routeId}:${fact.carrier.paramKey}`,
                    description: "route target and param key match",
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
                transitionId: "route.param",
                reason: projection.reason,
                methodSignature: resolveMethodSignatureText(ctx.method),
                stmtText: resolveStmtText(ctx.stmt),
                carrierKey: derived.carrier.key,
                tainted: derived.tainted,
            });
        },
    }];
}
