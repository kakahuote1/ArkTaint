import { ArkMainActivationEdge } from "./ArkMainActivationTypes";
import { ArkMainEntryFact } from "../ArkMainTypes";
import {
    findCompositionAnchors,
    reasonFromFact,
} from "./ArkMainActivationBuilderUtils";

export function buildChannelEdges(facts: ArkMainEntryFact[]): ArkMainActivationEdge[] {
    const edges: ArkMainActivationEdge[] = [];
    const compositionFacts = facts.filter(f =>
        f.phase === "composition" && (f.kind === "page_build" || f.kind === "page_lifecycle"),
    );
    const routerSourceFacts = facts.filter(f => f.kind === "router_source");

    for (const fact of facts.filter(f => f.kind === "router_trigger")) {
        if (routerSourceFacts.length > 0) {
            for (const routerSourceFact of routerSourceFacts) {
                edges.push({
                    kind: "router_channel",
                    edgeFamily: "navigation_channel",
                    phaseHint: "reactive_handoff",
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
        for (const anchor of findCompositionAnchors(compositionFacts, fact.method, fact.sourceMethod)) {
            edges.push({
                kind: "router_channel",
                edgeFamily: "navigation_channel",
                phaseHint: "reactive_handoff",
                fromMethod: anchor,
                toMethod: fact.method,
                reasons: [reasonFromFact(fact)],
            });
        }
    }
    return edges;
}


