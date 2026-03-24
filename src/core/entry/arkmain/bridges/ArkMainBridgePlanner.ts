import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import type { ArkMainPhaseName } from "../ArkMainTypes";
import { ArkMainActivationEdge, ArkMainActivationEdgeKind, ArkMainActivationGraph } from "../edges/ArkMainActivationTypes";
import { ArkMainSchedule } from "../scheduling/ArkMainScheduler";
import { ArkMainEntryFact } from "../ArkMainTypes";

export type ArkMainTriggerKind = "watch" | "state";
export type ArkMainChannelKind = "router";
export type ArkMainHandoffKind = "want";
export type ArkMainHandoffBoundaryKind = "serialized_copy";

export interface ArkMainTriggerPlan {
    kind: ArkMainTriggerKind;
    methods: ArkMethod[];
    facts: ArkMainEntryFact[];
}

export interface ArkMainChannelPlan {
    kind: ArkMainChannelKind;
    methods: ArkMethod[];
    facts: ArkMainEntryFact[];
}

export interface ArkMainHandoffPlan {
    kind: ArkMainHandoffKind;
    methods: ArkMethod[];
    facts: ArkMainEntryFact[];
    sourceMethods: ArkMethod[];
    targetMethods: ArkMethod[];
    boundary: ArkMainHandoffBoundarySemantics;
}

export interface ArkMainHandoffBoundarySemantics {
    kind: ArkMainHandoffBoundaryKind;
    summary: string;
    preservesFieldPath: boolean;
    preservesObjectIdentity: boolean;
}

export interface ArkMainBridgePlan {
    triggers: ArkMainTriggerPlan[];
    channels: ArkMainChannelPlan[];
    handoffs: ArkMainHandoffPlan[];
    phaseScheduling: ArkMainBridgePhaseScheduling[];
}

export interface ArkMainBridgePhaseScheduling {
    phase: ArkMainPhaseName;
    methods: ArkMethod[];
}

export function buildArkMainBridgePlan(
    graph: ArkMainActivationGraph,
    schedule: ArkMainSchedule,
): ArkMainBridgePlan {
    const facts = graph.facts;
    const triggers = buildTriggerPlans(graph, schedule);
    const channels = buildChannelPlans(graph, schedule);
    const handoffs = buildHandoffPlans(graph, schedule);
    return {
        triggers,
        channels,
        handoffs,
        phaseScheduling: buildPhaseScheduling(triggers, channels),
    };
}

function buildTriggerPlans(
    graph: ArkMainActivationGraph,
    schedule: ArkMainSchedule,
): ArkMainTriggerPlan[] {
    const factsByMethod = buildFactsByMethodSignature(graph.facts);
    const stateWatchEdges = collectActivatedEdgesByKind(schedule, "state_watch_trigger");
    const watchMethods = dedupeMethods(stateWatchEdges.map(edge => edge.toMethod));
    const stateMethods = dedupeMethods(stateWatchEdges.flatMap(edge => edge.fromMethod ? [edge.fromMethod] : []));
    const watchFacts = collectFactsForMethods(factsByMethod, watchMethods, new Set(["watch_handler"]));
    const stateFacts = collectFactsForMethods(factsByMethod, stateMethods, new Set(["watch_source"]));
    const out: ArkMainTriggerPlan[] = [];
    if (watchMethods.length > 0) {
        out.push({
            kind: "watch",
            methods: watchMethods,
            facts: watchFacts,
        });
    }
    if (stateMethods.length > 0) {
        out.push({
            kind: "state",
            methods: stateMethods,
            facts: stateFacts,
        });
    }
    return out;
}

function buildChannelPlans(
    graph: ArkMainActivationGraph,
    schedule: ArkMainSchedule,
): ArkMainChannelPlan[] {
    const factsByMethod = buildFactsByMethodSignature(graph.facts);
    const out: ArkMainChannelPlan[] = [];
    const routerEdges = collectActivatedEdgesByKind(schedule, "router_channel");
    const routerMethods = collectTargetMethods(routerEdges);
    const routerFacts = collectFactsForMethods(factsByMethod, routerMethods, new Set(["router_source", "router_trigger"]));

    if (routerMethods.length > 0) {
        out.push({
            kind: "router",
            methods: routerMethods,
            facts: routerFacts,
        });
    }

    return out;
}

function buildHandoffPlans(
    graph: ArkMainActivationGraph,
    schedule: ArkMainSchedule,
): ArkMainHandoffPlan[] {
    const factsByMethod = buildFactsByMethodSignature(graph.facts);
    const wantEdges = collectActivatedEdgesByKind(schedule, "want_handoff");
    const sourceMethods = dedupeMethods(wantEdges.flatMap(edge => edge.fromMethod ? [edge.fromMethod] : []));
    const targetMethods = collectTargetMethods(wantEdges);
    const wantMethods = dedupeMethods([...sourceMethods, ...targetMethods]);
    const wantFacts = collectFactsForMethods(factsByMethod, wantMethods, new Set(["want_handoff"]));
    return wantEdges.length === 0
        ? []
        : [{
            kind: "want",
            methods: wantMethods,
            facts: wantFacts,
            sourceMethods,
            targetMethods,
            boundary: {
                kind: "serialized_copy",
                summary: "Want handoff copies payload taint across an inter-ability serialization boundary.",
                preservesFieldPath: true,
                preservesObjectIdentity: false,
            },
        }];
}

function buildPhaseScheduling(
    triggers: ArkMainTriggerPlan[],
    channels: ArkMainChannelPlan[],
): ArkMainBridgePhaseScheduling[] {
    const reactiveMethods = dedupeMethods([
        ...triggers.flatMap(plan => plan.methods),
        ...channels.flatMap(plan => plan.methods),
    ]);

    return reactiveMethods.length === 0
        ? []
        : [{
            phase: "reactive_handoff",
            methods: reactiveMethods,
        }];
}

function dedupeMethods(methods: ArkMethod[]): ArkMethod[] {
    const out = new Map<string, ArkMethod>();
    for (const method of methods) {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature || out.has(signature)) continue;
        out.set(signature, method);
    }
    return [...out.values()];
}

function collectActivatedEdgesByKind(
    schedule: ArkMainSchedule,
    kind: ArkMainActivationEdgeKind,
): ArkMainActivationEdge[] {
    const dedup = new Map<string, ArkMainActivationEdge>();
    for (const activation of schedule.activations) {
        for (const edge of activation.supportingEdges) {
            if (edge.kind !== kind) continue;
            const key = [
                edge.kind,
                edge.phaseHint,
                edge.fromMethod?.getSignature?.()?.toString?.() || "@root",
                edge.toMethod.getSignature?.()?.toString?.() || "@unknown",
            ].join("|");
            if (!dedup.has(key)) {
                dedup.set(key, edge);
            }
        }
    }
    return [...dedup.values()];
}

function collectFactsForMethods(
    factsByMethod: Map<string, ArkMainEntryFact[]>,
    methods: ArkMethod[],
    kinds: Set<ArkMainEntryFact["kind"]>,
): ArkMainEntryFact[] {
    const out: ArkMainEntryFact[] = [];
    const seen = new Set<string>();
    for (const method of methods) {
        const signature = method.getSignature?.()?.toString?.();
        if (!signature) continue;
        for (const fact of factsByMethod.get(signature) || []) {
            if (!kinds.has(fact.kind)) continue;
            const key = `${fact.kind}|${signature}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(fact);
        }
    }
    return out;
}

function buildFactsByMethodSignature(facts: ArkMainEntryFact[]): Map<string, ArkMainEntryFact[]> {
    const out = new Map<string, ArkMainEntryFact[]>();
    for (const fact of facts) {
        const signature = fact.method.getSignature?.()?.toString?.();
        if (!signature) continue;
        if (!out.has(signature)) out.set(signature, []);
        out.get(signature)!.push(fact);
    }
    return out;
}

function collectTargetMethods(edges: ArkMainActivationEdge[]): ArkMethod[] {
    return dedupeMethods(edges.map(edge => edge.toMethod));
}



