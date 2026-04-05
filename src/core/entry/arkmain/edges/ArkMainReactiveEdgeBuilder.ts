import { ArkMainActivationEdge } from "./ArkMainActivationTypes";
import { ArkMainEntryFact } from "../ArkMainTypes";
import {
    findClassLocalAnchors,
    matchesWatchTargets,
    reasonFromFact,
} from "./ArkMainActivationBuilderUtils";
import { getArkMainTargetPhase } from "../scheduling/ArkMainSchedulingRules";

export function buildStateWatchEdges(facts: ArkMainEntryFact[]): ArkMainActivationEdge[] {
    const edges: ArkMainActivationEdge[] = [];
    const stateFacts = facts.filter(f => f.kind === "watch_source");
    const watchFacts = facts.filter(f => f.kind === "watch_handler");
    for (const watchFact of watchFacts) {
        const anchors = findClassLocalAnchors(stateFacts, watchFact.method)
            .filter(anchor => matchesWatchTargets(anchor, watchFact));
        for (const anchor of anchors) {
            edges.push({
                kind: "state_watch_trigger",
                edgeFamily: "state_watch",
                phaseHint: getArkMainTargetPhase("state_watch"),
                fromMethod: anchor.method,
                toMethod: watchFact.method,
                reasons: [reasonFromFact(anchor), reasonFromFact(watchFact)],
            });
        }
    }
    return edges;
}


