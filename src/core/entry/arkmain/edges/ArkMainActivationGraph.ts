import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import type { ArkMainEntryFact } from "../ArkMainTypes";
import { buildBaselineRootEdges } from "./ArkMainBaselineEdgeBuilder";
import { buildLifecycleProgressionEdges } from "./ArkMainLifecycleEdgeBuilder";
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
    const edgesByKey = new Map<string, ArkMainActivationEdge>();

    const addEdge = (edge: ArkMainActivationEdge): void => {
        const fromSignature = edge.fromMethod?.getSignature?.()?.toString?.() || "@root";
        const toSignature = edge.toMethod?.getSignature?.()?.toString?.();
        if (!toSignature) return;
        const key = `${edge.kind}|${edge.phaseHint}|${fromSignature}|${toSignature}`;
        const existing = edgesByKey.get(key);
        if (existing) {
            mergeReasons(existing, edge);
            return;
        }
        edgesByKey.set(key, edge);
        edges.push(edge);
        if (edge.kind === "baseline_root") {
            rootMethods.set(toSignature, edge.toMethod);
        }
    };

    for (const edge of buildBaselineRootEdges(facts, seedMethods)) addEdge(edge);
    for (const edge of buildLifecycleProgressionEdges(facts)) addEdge(edge);

    return {
        facts,
        rootMethods: [...rootMethods.values()],
        edges,
    };
}

function mergeReasons(target: ArkMainActivationEdge, incoming: ArkMainActivationEdge): void {
    const existingKeys = new Set(target.reasons.map(reasonKeyOf));
    for (const reason of incoming.reasons) {
        const key = reasonKeyOf(reason);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        target.reasons.push(reason);
    }
}

function reasonKeyOf(reason: ArkMainActivationEdge["reasons"][number]): string {
    return [
        reason.kind,
        reason.summary,
        reason.evidenceFactKind || "",
        reason.evidenceMethod?.getSignature?.()?.toString?.() || "",
        reason.entryFamily || "",
        reason.recognitionLayer || "",
    ].join("|");
}


