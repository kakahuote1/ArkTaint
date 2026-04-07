import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import type { ArkMainPhaseName } from "../ArkMainTypes";
import {
    ArkMainActivationEdge,
    ArkMainActivationEdgeFamily,
    ArkMainActivationGraph,
    ArkMainActivationReason,
} from "../edges/ArkMainActivationTypes";
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

interface ArkMainActivationMutation {
    activation?: ArkMainScheduledMethod;
    created: boolean;
    changed: boolean;
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
    const activeByMethod = new Map<string, ArkMainScheduledMethod[]>();
    let roundsExecuted = 0;
    let lastChangedRound = 0;
    let converged = true;
    let truncated = false;
    const warnings: string[] = [];

    const rootEdges = graph.edges.filter(edge => edge.kind === "baseline_root");
    for (const edge of rootEdges) {
        activateMethod(active, activeByMethod, edge.toMethod, edge.phaseHint, 0, edge);
    }

    const nonRootEdges = graph.edges.filter(edge => edge.kind !== "baseline_root");
    for (let round = 1; round <= maxRounds; round++) {
        roundsExecuted = round;
        let changed = false;
        for (const edge of nonRootEdges) {
            const sourceActivations = collectSourceActivations(activeByMethod, edge.fromMethod);
            if (!sourceActivations.some(sourceActivation => canScheduleArkMainActivationEdge(edge, sourceActivation, round))) {
                continue;
            }
            const mutation = activateMethod(
                active,
                activeByMethod,
                edge.toMethod,
                getArkMainTargetPhase(edge.edgeFamily),
                round,
                edge,
            );
            if (mutation.created || mutation.changed) {
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

    const activations = [...active.values()].sort((a, b) => {
        if (a.round !== b.round) return a.round - b.round;
        const phaseCmp = compareArkMainPhases(a.phase, b.phase);
        if (phaseCmp !== 0) return phaseCmp;
        return (signatureOf(a.method) || "").localeCompare(signatureOf(b.method) || "");
    });

    return {
        activations,
        orderedMethods: dedupeMethods(activations.map(item => item.method)),
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
    activeByMethod: Map<string, ArkMainScheduledMethod[]>,
    method: ArkMethod,
    phase: ArkMainPhaseName,
    round: number,
    viaEdge: ArkMainActivationEdge,
): ArkMainActivationMutation {
    const activationKey = activationKeyOf(method, phase, viaEdge.edgeFamily);
    if (!activationKey) {
        return {
            created: false,
            changed: false,
        };
    }
    const existing = active.get(activationKey);
    if (existing) {
        return {
            activation: existing,
            created: false,
            changed: mergeSupportingEdge(existing, viaEdge),
        };
    }
    const activation: ArkMainScheduledMethod = {
        method,
        phase,
        round,
        activationEdgeKinds: [viaEdge.kind],
        activationEdgeFamilies: [viaEdge.edgeFamily],
        reasons: [...viaEdge.reasons],
        supportingEdges: [viaEdge],
    };
    active.set(activationKey, activation);

    const methodSignature = signatureOf(method);
    if (methodSignature) {
        const existingByMethod = activeByMethod.get(methodSignature) || [];
        existingByMethod.push(activation);
        existingByMethod.sort((left, right) => {
            if (left.round !== right.round) return left.round - right.round;
            const phaseCmp = compareArkMainPhases(left.phase, right.phase);
            if (phaseCmp !== 0) return phaseCmp;
            return 0;
        });
        activeByMethod.set(methodSignature, existingByMethod);
    }
    return {
        activation,
        created: true,
        changed: true,
    };
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
        ].join("|");
        const exists = activation.reasons.some(existing =>
            [
                existing.kind,
                existing.summary,
                existing.evidenceFactKind || "",
                signatureOf(existing.evidenceMethod) || "",
                existing.entryFamily || "",
                existing.recognitionLayer || "",
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

function activationKeyOf(
    method: ArkMethod | undefined,
    phase: ArkMainPhaseName,
    edgeFamily: ArkMainActivationEdgeFamily,
): string | undefined {
    const signature = signatureOf(method);
    if (!signature) return undefined;
    return `${signature}|${phase}|${edgeFamily}`;
}

function collectSourceActivations(
    activeByMethod: Map<string, ArkMainScheduledMethod[]>,
    method: ArkMethod | undefined,
): ArkMainScheduledMethod[] {
    const signature = signatureOf(method);
    if (!signature) return [];
    return activeByMethod.get(signature) || [];
}

function dedupeMethods(methods: ArkMethod[]): ArkMethod[] {
    const out = new Map<string, ArkMethod>();
    for (const method of methods) {
        const signature = signatureOf(method);
        if (!signature || out.has(signature)) continue;
        out.set(signature, method);
    }
    return [...out.values()];
}


