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

export function createAsyncTransitions(): SemanticTransition[] {
    return [{
        id: "async.task",
        label: "async-task",
        match: (_fact, ctx) => ctx.stmt instanceof ArkInvokeStmt || ctx.stmt.containsInvokeExpr?.(),
        project: (fact, ctx) => {
            const effect = readSemanticEffect(ctx);
            if (!effect || effect.family !== "async_task" || !effect.taskId) return [];
            const carrierKey = `task:${effect.taskId}`;
            if (effect.operation === "schedule") {
                return [{
                    carrier: createSemanticCarrier("task", carrierKey, effect.taskId, { taskId: effect.taskId }),
                    tainted: fact.tainted,
                    state: "scheduled",
                    sideState: { asyncState: "scheduled" },
                    reason: "async-schedule",
                }];
            }
            if (effect.operation !== "resume" || fact.carrier.kind !== "task") return [];
            if (fact.carrier.taskId !== effect.taskId || fact.sideState.asyncState !== "scheduled") {
                return [{
                    carrier: fact.carrier,
                    tainted: fact.tainted,
                    state: fact.state,
                    reason: "async-guard-failed",
                    guard: {
                        kind: "same_key",
                        enabled: false,
                        left: effect.taskId,
                        right: fact.carrier.taskId,
                        description: "async task mismatch or not scheduled",
                    },
                    gap: { blockedBy: fact.carrier.taskId !== effect.taskId ? "same_key" : "task_scheduled" },
                }];
            }
            return [{
                carrier: createSemanticCarrier("task", carrierKey, effect.taskId, { taskId: effect.taskId }),
                tainted: fact.tainted,
                state: "resumed",
                sideState: { asyncState: "resumed" },
                reason: "async-resume",
                guard: {
                    kind: "same_key",
                    enabled: true,
                    left: effect.taskId,
                    right: fact.carrier.taskId,
                    description: "async task matches scheduled payload",
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
                transitionId: "async.task",
                reason: projection.reason,
                methodSignature: resolveMethodSignatureText(ctx.method),
                stmtText: resolveStmtText(ctx.stmt),
                carrierKey: derived.carrier.key,
                tainted: derived.tainted,
            });
        },
    }];
}
