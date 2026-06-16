import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkMainActivationEdge } from "./ArkMainActivationTypes";
import { ArkMainEntryFact } from "../ArkMainTypes";
import { reasonFromFact } from "./ArkMainActivationBuilderUtils";
import { getArkMainTargetPhase } from "../scheduling/ArkMainSchedulingRules";

export function buildChannelEdges(
    facts: ArkMainEntryFact[],
    seedMethods: ArkMethod[] = [],
): ArkMainActivationEdge[] {
    const edges: ArkMainActivationEdge[] = [];
    const routerSourceFacts = facts.filter(f => f.kind === "router_source");

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
    }
    return edges;
}


