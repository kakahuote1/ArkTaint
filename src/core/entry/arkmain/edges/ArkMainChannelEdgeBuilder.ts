import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkMainActivationEdge } from "./ArkMainActivationTypes";
import { ArkMainEntryFact } from "../ArkMainTypes";
import {
    findCompositionAnchors,
    reasonFromFact,
} from "./ArkMainActivationBuilderUtils";
import { getArkMainTargetPhase } from "../scheduling/ArkMainSchedulingRules";

export function buildChannelEdges(
    facts: ArkMainEntryFact[],
    seedMethods: ArkMethod[] = [],
): ArkMainActivationEdge[] {
    const edges: ArkMainActivationEdge[] = [];
    const compositionFacts = facts.filter(f =>
        f.phase === "composition" && (f.kind === "page_build" || f.kind === "page_lifecycle"),
    );
    const routerSourceFacts = facts.filter(f => f.kind === "router_source");
    const allowRootlessFallback = seedMethods.length === 0;

    for (const fact of facts.filter(f => f.kind === "router_trigger")) {
        if (routerSourceFacts.length > 0) {
            for (const routerSourceFact of routerSourceFacts) {
                edges.push({
                    kind: "router_channel",
                    edgeFamily: "navigation_channel",
                    phaseHint: getArkMainTargetPhase("navigation_channel"),
                    fromMethod: routerSourceFact.method,
                    toMethod: fact.method,
                    reasons: [
                        reasonFromFact(routerSourceFact),
                        reasonFromFact(fact),
                    ],
                });
            }
            continue;
        }
        if (!allowRootlessFallback) {
            continue;
        }
        for (const anchor of findCompositionAnchors(compositionFacts, fact.method, fact.sourceMethod)) {
            edges.push({
                kind: "router_channel",
                edgeFamily: "navigation_channel",
                phaseHint: getArkMainTargetPhase("navigation_channel"),
                fromMethod: anchor,
                toMethod: fact.method,
                reasons: [reasonFromFact(fact)],
            });
        }
    }
    return edges;
}


