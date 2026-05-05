import { createSemanticFact } from "./SemanticFact";
import {
    SemanticCarrier,
    SemanticGuard,
    SemanticStateStatus,
    SemanticTransition,
    SemanticTransitionProjection,
    createSemanticCarrier,
    resolveMethodSignatureText,
    resolveStmtText,
} from "./SemanticStateTypes";

export type SemanticSolverEffectFamily =
    | "keyed_storage"
    | "callback_event"
    | "async_task"
    | "state_slot"
    | "router_param";

export interface SemanticEffectProvenance {
    source: "stage2";
    recordId: string;
    replayable: boolean;
}

export interface FiniteSemanticSolverEffect {
    id: string;
    family: SemanticSolverEffectFamily;
    fromCarrier: SemanticCarrier;
    toCarrier: SemanticCarrier;
    state: SemanticStateStatus;
    tainted?: boolean;
    guards?: SemanticGuard[];
    reason?: string;
    provenance: SemanticEffectProvenance;
    freeTextReasoning?: string;
    requiresSinkFamily?: boolean;
}

export interface CompiledSemanticSolverEffect {
    id: string;
    family: SemanticSolverEffectFamily;
    transition: SemanticTransition;
    provenance: SemanticEffectProvenance;
}

const allowedFamilies = new Set<SemanticSolverEffectFamily>([
    "keyed_storage",
    "callback_event",
    "async_task",
    "state_slot",
    "router_param",
]);

function cloneCarrier(carrier: SemanticCarrier): SemanticCarrier {
    return createSemanticCarrier(carrier.kind, carrier.key, carrier.label, carrier);
}

function isFiniteCarrier(carrier: SemanticCarrier | undefined): carrier is SemanticCarrier {
    if (!carrier || !carrier.kind || !carrier.key || !carrier.label) return false;
    if (carrier.key.includes("unknown") || carrier.key.includes("?")) return false;
    return true;
}

function firstFailedGuard(guards: SemanticGuard[] | undefined): SemanticGuard | undefined {
    return (guards || []).find(guard => guard.enabled === false);
}

export function compileSemanticSolverEffect(effect: FiniteSemanticSolverEffect): CompiledSemanticSolverEffect | undefined {
    if (!effect || !effect.id || !allowedFamilies.has(effect.family)) return undefined;
    if (!effect.provenance?.replayable || !effect.provenance.recordId) return undefined;
    if (effect.freeTextReasoning || effect.requiresSinkFamily) return undefined;
    if (!isFiniteCarrier(effect.fromCarrier) || !isFiniteCarrier(effect.toCarrier)) return undefined;

    const transition: SemanticTransition = {
        id: `solver.${effect.id}`,
        label: `solver-${effect.family}`,
        match: fact => fact.carrier.key === effect.fromCarrier.key,
        project: fact => {
            const failed = firstFailedGuard(effect.guards);
            const projection: SemanticTransitionProjection = {
                carrier: cloneCarrier(effect.toCarrier),
                tainted: effect.tainted ?? fact.tainted,
                state: effect.state,
                reason: effect.reason || `solver-effect:${effect.family}`,
                guard: failed || effect.guards?.[0],
            };
            if (failed) {
                projection.gap = { blockedBy: failed.kind };
            }
            return [projection];
        },
        check: (_fact, _ctx, projection) => projection.guard?.enabled !== false,
        update: (fact, _ctx, projection) => projection.carrier
            ? createSemanticFact({
                source: fact.source,
                carrier: projection.carrier,
                tainted: projection.tainted ?? fact.tainted,
                state: projection.state || effect.state,
                contextId: fact.contextId,
                order: fact.order,
                sideState: projection.sideState || fact.sideState,
            })
            : undefined,
        derive: (fact, _ctx, projection) => projection.carrier ? [createSemanticFact({
            source: fact.source,
            carrier: projection.carrier,
            tainted: projection.tainted ?? fact.tainted,
            state: projection.state || effect.state,
            contextId: fact.contextId,
            order: fact.order,
            sideState: projection.sideState || fact.sideState,
        })] : [],
        record: (fact, ctx, projection, derivedFacts, result) => {
            const derived = derivedFacts[0];
            if (!derived) return;
            result.provenance.push({
                fromFactId: fact.id,
                toFactId: derived.id,
                transitionId: `solver.${effect.id}`,
                reason: projection.reason,
                methodSignature: resolveMethodSignatureText(ctx.method),
                stmtText: resolveStmtText(ctx.stmt),
                carrierKey: derived.carrier.key,
                tainted: derived.tainted,
            });
        },
    };

    return {
        id: effect.id,
        family: effect.family,
        transition,
        provenance: { ...effect.provenance },
    };
}

export function compileSemanticSolverEffects(effects: FiniteSemanticSolverEffect[]): CompiledSemanticSolverEffect[] {
    return (effects || [])
        .map(effect => compileSemanticSolverEffect(effect))
        .filter((effect): effect is CompiledSemanticSolverEffect => !!effect);
}
