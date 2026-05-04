import { ArkAssignStmt, ArkIfStmt, ArkInvokeStmt, ArkReturnStmt, ArkReturnVoidStmt, ArkThrowStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { Constant } from "../../../../../arkanalyzer/out/src/core/base/Constant";
import { AbstractInvokeExpr, ArkDeleteExpr, ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../../arkanalyzer/out/src/core/base/Expr";
import {
    SemanticFact,
    SemanticSolveResultMutable,
    SemanticTransition,
    SemanticTransitionContext,
    SemanticTransitionProjection,
    SemanticCarrier,
    buildSemanticCarrierForValue,
    createSemanticCarrier,
    resolveMethodSignatureText,
    resolveStmtText,
} from "../SemanticStateTypes";
import { createSemanticFact } from "../SemanticFact";

function isCleanValue(value: any): boolean {
    return value instanceof Constant;
}

function buildOverwriteProjection(
    fact: SemanticFact,
    ctx: SemanticTransitionContext,
    leftCarrier: SemanticCarrier,
    reason: string,
    tainted: boolean,
): SemanticTransitionProjection {
    return {
        carrier: createSemanticCarrier(leftCarrier.kind, leftCarrier.key, leftCarrier.label, {
            ownerKey: leftCarrier.ownerKey,
            slotKey: leftCarrier.slotKey,
            channel: leftCarrier.channel,
            callback: leftCarrier.callback,
            routeId: leftCarrier.routeId,
            paramKey: leftCarrier.paramKey,
            taskId: leftCarrier.taskId,
        }),
        tainted,
        state: tainted ? "dirty" : "clean",
        sideState: tainted
            ? {
                storageState: "written",
                slotState: "written",
            }
            : {
                storageState: "cleared",
                slotState: "cleared",
            },
        reason,
        guard: {
            kind: "same_key",
            enabled: true,
            left: leftCarrier.key,
            right: fact.carrier.key,
            description: leftCarrier.label,
        },
    };
}

export function createNativeTransitions(): SemanticTransition[] {
    const assignment: SemanticTransition = {
        id: "native.assignment",
        label: "assignment",
        match: (_fact, ctx) => ctx.stmt instanceof ArkAssignStmt,
        project: (fact, ctx) => {
            const stmt = ctx.stmt as ArkAssignStmt;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            const leftCarrier = buildSemanticCarrierForValue(ctx.method, left, ctx.stmt);
            const rightCarrier = buildSemanticCarrierForValue(ctx.method, right, ctx.stmt);
            const leftKey = leftCarrier?.key;
            const rightKey = rightCarrier?.key;
            const projections: SemanticTransitionProjection[] = [];
            if (!leftKey) {
                return projections;
            }
            if (rightKey && rightKey === fact.carrier.key) {
                projections.push(buildOverwriteProjection(fact, ctx, leftCarrier!, "assign-tainted", fact.tainted));
            } else if (right instanceof ArkDeleteExpr) {
                projections.push(buildOverwriteProjection(fact, ctx, leftCarrier!, "delete-before-read", false));
            } else if (isCleanValue(right)) {
                projections.push(buildOverwriteProjection(fact, ctx, leftCarrier!, "assign-clean", false));
            } else if (!rightKey && fact.tainted && fact.carrier.key === leftKey) {
                projections.push(buildOverwriteProjection(fact, ctx, leftCarrier!, "self-overwrite", fact.tainted));
            }
            return projections;
        },
        check: () => true,
        update: (_fact, _ctx, projection) => projection.carrier
            ? createSemanticFact({
                source: "semantic_state",
                carrier: projection.carrier,
                tainted: projection.tainted ?? false,
                state: projection.state || (projection.tainted ? "dirty" : "clean"),
                contextId: 0,
                order: 0,
                sideState: projection.sideState,
            })
            : undefined,
        derive: (_fact, _ctx, projection) => projection.carrier ? [createSemanticFact({
            source: "semantic_state",
            carrier: projection.carrier,
            tainted: projection.tainted ?? false,
            state: projection.state || (projection.tainted ? "dirty" : "clean"),
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
                transitionId: assignment.id,
                reason: projection.reason,
                methodSignature: resolveMethodSignatureText(ctx.method),
                stmtText: resolveStmtText(ctx.stmt),
                carrierKey: derived.carrier.key,
                tainted: derived.tainted,
            });
        },
    };

    const branch: SemanticTransition = {
        id: "native.branch",
        label: "branch",
        match: (_fact, ctx) => ctx.stmt instanceof ArkIfStmt,
        project: (fact, ctx) => {
            const ifStmt = ctx.stmt as ArkIfStmt;
            const condText = ifStmt.getConditionExpr?.()?.toString?.() || ifStmt.toString();
            const normalized = condText.replace(/\s+/g, "").toLowerCase();
            const isConstTrue = normalized === "if(true)" || normalized === "true";
            const isConstFalse = normalized === "if(false)" || normalized === "false";
            if (isConstTrue || isConstFalse) {
                return [{
                    carrier: fact.carrier,
                    tainted: fact.tainted,
                    state: fact.state,
                    reason: isConstTrue ? "branch-true" : "branch-false",
                    guard: {
                        kind: "binding_active",
                        enabled: true,
                        left: condText,
                        right: isConstTrue ? "true" : "false",
                        description: condText,
                    },
                }];
            }
            return [{
                carrier: fact.carrier,
                tainted: fact.tainted,
                state: fact.state,
                reason: "branch-unknown",
            }];
        },
        check: (_fact, _ctx, projection) => {
            if (projection.guard && projection.guard.enabled === false) return false;
            return true;
        },
        update: (fact) => fact,
        derive: (fact) => [fact],
        record: (fact, ctx, projection, derivedFacts, result) => {
            const derived = derivedFacts[0];
            if (derived && projection.guard) {
                result.provenance.push({
                    fromFactId: fact.id,
                    toFactId: derived.id,
                    transitionId: branch.id,
                    reason: projection.reason,
                    methodSignature: resolveMethodSignatureText(ctx.method),
                    stmtText: resolveStmtText(ctx.stmt),
                    carrierKey: derived.carrier.key,
                    tainted: derived.tainted,
                });
            }
        },
    };

    const returnFlow: SemanticTransition = {
        id: "native.return",
        label: "return",
        match: (_fact, ctx) => ctx.stmt instanceof ArkReturnStmt || ctx.stmt instanceof ArkReturnVoidStmt,
        project: (fact, ctx) => [{
            carrier: fact.carrier,
            tainted: fact.tainted,
            state: fact.state,
            reason: "return-observation",
            candidateSeed: fact.tainted,
        }],
        check: () => true,
        update: (fact) => fact,
        derive: (fact, ctx) => [fact],
        record: (fact, ctx, projection, derivedFacts, result) => {
            if (projection.candidateSeed) {
                result.candidateSeeds.push({
                    factId: fact.id,
                    carrierKey: fact.carrier.key,
                    source: fact.source,
                    reason: projection.reason,
                    methodSignature: resolveMethodSignatureText(ctx.method),
                    stmtText: resolveStmtText(ctx.stmt),
                });
            }
        },
    };

    const call: SemanticTransition = {
        id: "native.call",
        label: "call",
        match: (_fact, ctx) => ctx.stmt instanceof ArkInvokeStmt || ctx.stmt.containsInvokeExpr?.(),
        project: (fact, ctx) => {
            const invokeExpr = ctx.stmt.getInvokeExpr?.() as AbstractInvokeExpr | undefined;
            const signature = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
            const sinkSignatures = ctx.sinkSignatures;
            const projections: SemanticTransitionProjection[] = [];
            if (signature && sinkSignatures.has(signature)) {
                const args = invokeExpr?.getArgs?.() || [];
                for (let i = 0; i < args.length; i++) {
                    const argCarrierKey = buildSemanticCarrierForValue(ctx.method, args[i], ctx.stmt)?.key;
                    if (!argCarrierKey || argCarrierKey !== fact.carrier.key || !fact.tainted) {
                        continue;
                    }
                    projections.push({
                        carrier: fact.carrier,
                        tainted: fact.tainted,
                        state: fact.state,
                        reason: "sink-hit",
                        sinkHit: {
                            sinkSignature: signature,
                            sinkRuleId: ctx.sinkRuleIds.size === 1 ? [...ctx.sinkRuleIds][0] : undefined,
                            argIndex: i,
                        },
                    });
                }
            }
            return projections;
        },
        check: () => true,
        update: (fact) => fact,
        derive: (fact) => [fact],
        record: () => {},
    };

    return [assignment, branch, returnFlow, call];
}
