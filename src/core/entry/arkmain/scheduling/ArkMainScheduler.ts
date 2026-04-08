import { ArkMethod } from "../../../../../arkanalyzer/lib/core/model/ArkMethod";
import type { ArkMainPhaseName } from "../ArkMainTypes";
import {
    ArkMainActivationEdge,
    ArkMainActivationEdgeFamily,
    ArkMainActivationGraph,
    ArkMainActivationReason,
} from "../edges/ArkMainActivationTypes";
import { matchesWatchTargets } from "../edges/ArkMainActivationBuilderUtils";
import {
    canScheduleArkMainActivationEdge,
    compareArkMainPhases,
    getArkMainTargetPhase,
} from "./ArkMainSchedulingRules";

export interface ArkMainScheduledMethod {
    method: ArkMethod;
    phase: ArkMainPhaseName;
    round: number;
    activationEdgeKinds: string[];
    activationEdgeFamilies: ArkMainActivationEdgeFamily[];
    reasons: ArkMainActivationReason[];
    supportingEdges: ArkMainActivationEdge[];
}

export interface ArkMainSchedule {
    activations: ArkMainScheduledMethod[];
    orderedMethods: ArkMethod[];
    convergence: ArkMainScheduleConvergence;
    warnings: string[];
}

export interface ArkMainSchedulerOptions {
    maxRounds?: number;
}

export interface ArkMainScheduleConvergence {
    maxRounds: number;
    roundsExecuted: number;
    lastChangedRound: number;
    converged: boolean;
    truncated: boolean;
}

export function buildArkMainSchedule(
    graph: ArkMainActivationGraph,
    options: ArkMainSchedulerOptions = {},
): ArkMainSchedule {
    const maxRounds = options.maxRounds ?? 4;
    const active = new Map<string, ArkMainScheduledMethod>();
    let roundsExecuted = 0;
    let lastChangedRound = 0;
    let converged = true;
    let truncated = false;
    const warnings: string[] = [];

    const rootEdges = graph.edges.filter(edge => edge.kind === "baseline_root");
    for (const edge of rootEdges) {
        activateMethod(active, edge.toMethod, edge.phaseHint, 0, edge);
    }

    const nonRootEdges = graph.edges.filter(edge => edge.kind !== "baseline_root");
    for (let round = 1; round <= maxRounds; round++) {
        roundsExecuted = round;
        let changed = false;
        for (const edge of nonRootEdges) {
            const fromSignature = signatureOf(edge.fromMethod);
            const sourceActivation = fromSignature ? active.get(fromSignature) : undefined;
            if (!canScheduleArkMainActivationEdge(edge, sourceActivation, round)) {
                continue;
            }
            const before = active.size;
            activateMethod(active, edge.toMethod, getArkMainTargetPhase(edge.edgeFamily), round, edge);
            if (active.size > before) {
                changed = true;
                continue;
            }
            const targetActivation = active.get(signatureOf(edge.toMethod)!);
            if (targetActivation && mergeSupportingEdge(targetActivation, edge)) {
                changed = true;
            }
        }
        if (!changed) {
            converged = true;
            break;
        }
        lastChangedRound = round;
        if (round === maxRounds) {
            converged = false;
            truncated = true;
        }
    }

    // Post-scheduling promotion: watch_handler facts whose owning class is
    // active but whose own method never got scheduled (e.g. watch_source methods
    // are closures not reachable through the activation graph).
    const promotionRound = roundsExecuted + 1;
    for (const fact of graph.facts) {
        if (fact.kind !== "watch_handler" || fact.schedule === false) continue;
        const sig = signatureOf(fact.method);
        if (!sig || active.has(sig)) continue;
        const hasMatchingWatchSource = graph.facts.some(candidate =>
            candidate.kind === "watch_source"
            && matchesWatchTargets(candidate, fact),
        );
        if (!hasMatchingWatchSource) {
            continue;
        }
        activateMethod(active, fact.method, "reactive_handoff", promotionRound, {
            kind: "state_watch_trigger",
            edgeFamily: "state_watch",
            phaseHint: getArkMainTargetPhase("state_watch"),
            toMethod: fact.method,
            reasons: [{
                kind: "entry_fact",
                summary: fact.reason,
                evidenceFactKind: fact.kind,
                evidenceMethod: fact.method,
                entryFamily: fact.entryFamily,
                recognitionLayer: fact.recognitionLayer,
            }],
        });
        const activation = active.get(sig);
        if (activation) {
            activation.phase = getArkMainTargetPhase("state_watch");
        }
    }

    const activations = [...active.values()].sort((a, b) => {
        if (a.round !== b.round) return a.round - b.round;
        const phaseCmp = compareArkMainPhases(a.phase, b.phase);
        if (phaseCmp !== 0) return phaseCmp;
        return (signatureOf(a.method) || "").localeCompare(signatureOf(b.method) || "");
    });

    return {
        activations,
        orderedMethods: activations.map(item => item.method),
        convergence: {
            maxRounds,
            roundsExecuted,
            lastChangedRound,
            converged,
            truncated,
        },
        warnings: truncated ? [
            `ArkMain scheduler reached maxRounds=${maxRounds} before convergence (lastChangedRound=${lastChangedRound}).`,
        ] : warnings,
    };
}

function activateMethod(
    active: Map<string, ArkMainScheduledMethod>,
    method: ArkMethod,
    phase: ArkMainPhaseName,
    round: number,
    viaEdge: ArkMainActivationEdge,
): void {
    const signature = signatureOf(method);
    if (!signature) return;
    const existing = active.get(signature);
    if (existing) {
        mergeSupportingEdge(existing, viaEdge);
        return;
    }
    active.set(signature, {
        method,
        phase,
        round,
        activationEdgeKinds: [viaEdge.kind],
        activationEdgeFamilies: [viaEdge.edgeFamily],
        reasons: [...viaEdge.reasons],
        supportingEdges: [viaEdge],
    });
}

function mergeSupportingEdge(
    activation: ArkMainScheduledMethod,
    edge: ArkMainActivationEdge,
): boolean {
    const edgeKey = supportingEdgeKey(edge);
    const hasEdge = activation.supportingEdges.some(existing => supportingEdgeKey(existing) === edgeKey);
    let changed = false;
    if (!hasEdge) {
        activation.supportingEdges.push(edge);
        changed = true;
    }
    if (!activation.activationEdgeKinds.includes(edge.kind)) {
        activation.activationEdgeKinds.push(edge.kind);
        activation.activationEdgeKinds.sort();
        changed = true;
    }
    if (!activation.activationEdgeFamilies.includes(edge.edgeFamily)) {
        activation.activationEdgeFamilies.push(edge.edgeFamily);
        activation.activationEdgeFamilies.sort();
        changed = true;
    }
    for (const reason of edge.reasons) {
        const reasonKey = [
            reason.kind,
            reason.summary,
            reason.evidenceFactKind || "",
            signatureOf(reason.evidenceMethod) || "",
            reason.entryFamily || "",
            reason.recognitionLayer || "",
            reason.callbackShape || "",
            reason.callbackSlotFamily || "",
        ].join("|");
        const exists = activation.reasons.some(existing =>
            [
                existing.kind,
                existing.summary,
                existing.evidenceFactKind || "",
                signatureOf(existing.evidenceMethod) || "",
                existing.entryFamily || "",
                existing.recognitionLayer || "",
                existing.callbackShape || "",
                existing.callbackSlotFamily || "",
            ].join("|") === reasonKey,
        );
        if (!exists) {
            activation.reasons.push(reason);
            changed = true;
        }
    }
    return changed;
}

function supportingEdgeKey(edge: ArkMainActivationEdge): string {
    return [
        edge.kind,
        edge.edgeFamily,
        edge.phaseHint,
        signatureOf(edge.fromMethod) || "@root",
        signatureOf(edge.toMethod) || "@unknown",
    ].join("|");
}

function signatureOf(method?: ArkMethod): string | undefined {
    return method?.getSignature?.()?.toString?.();
}


