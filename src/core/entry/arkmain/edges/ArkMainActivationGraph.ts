import { ArkMethod } from "../../../../../arkanalyzer/lib/core/model/ArkMethod";
import type { ArkMainEntryFact } from "../ArkMainTypes";
import { buildBaselineRootEdges } from "./ArkMainBaselineEdgeBuilder";
import { buildCallbackRegistrationEdges } from "./ArkMainCallbackEdgeBuilder";
import { buildChannelEdges } from "./ArkMainChannelEdgeBuilder";
import { buildHandoffEdges } from "./ArkMainHandoffEdgeBuilder";
import { buildStateWatchEdges } from "./ArkMainReactiveEdgeBuilder";
import { buildSchedulerActivationEdges } from "./ArkMainSchedulerEdgeBuilder";
import {
    ArkMainActivationEdge,
    ArkMainActivationGraph,
} from "./ArkMainActivationTypes";

export type {
    ArkMainActivationEdge,
    ArkMainActivationEdgeKind,
    ArkMainActivationGraph,
    ArkMainActivationReason,
} from "./ArkMainActivationTypes";

export function buildArkMainActivationGraph(
    facts: ArkMainEntryFact[],
    seedMethods: ArkMethod[] = [],
): ArkMainActivationGraph {
    const edges: ArkMainActivationEdge[] = [];
    const rootMethods = new Map<string, ArkMethod>();
    const seenEdges = new Set<string>();

    const addEdge = (edge: ArkMainActivationEdge): void => {
        const fromSignature = edge.fromMethod?.getSignature?.()?.toString?.() || "@root";
        const toSignature = edge.toMethod?.getSignature?.()?.toString?.();
        if (!toSignature) return;
        const key = `${edge.kind}|${edge.phaseHint}|${fromSignature}|${toSignature}`;
        if (seenEdges.has(key)) return;
        seenEdges.add(key);
        edges.push(edge);
        if (edge.kind === "baseline_root") {
            rootMethods.set(toSignature, edge.toMethod);
        }
    };

    for (const edge of buildBaselineRootEdges(facts, seedMethods)) addEdge(edge);
    for (const edge of buildCallbackRegistrationEdges(facts)) addEdge(edge);
    for (const edge of buildSchedulerActivationEdges(facts)) addEdge(edge);
    for (const edge of buildStateWatchEdges(facts)) addEdge(edge);
    for (const edge of buildChannelEdges(facts, seedMethods)) addEdge(edge);
    for (const edge of buildHandoffEdges(facts)) addEdge(edge);

    return {
        facts,
        rootMethods: [...rootMethods.values()],
        edges,
    };
}


