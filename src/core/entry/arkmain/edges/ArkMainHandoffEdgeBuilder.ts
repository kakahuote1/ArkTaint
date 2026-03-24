import { ArkMainActivationEdge } from "./ArkMainActivationTypes";
import { ArkMainEntryFact } from "../ArkMainTypes";
import {
    findAbilityBootstrapAnchors,
    reasonFromFact,
} from "./ArkMainActivationBuilderUtils";

export function buildHandoffEdges(facts: ArkMainEntryFact[]): ArkMainActivationEdge[] {
    const edges: ArkMainActivationEdge[] = [];
    const bootstrapFacts = facts.filter(f =>
        f.phase === "bootstrap" && f.kind === "ability_lifecycle",
    );
    for (const fact of facts.filter(f => f.kind === "want_handoff")) {
        if (fact.method.getName?.() !== "onNewWant") continue;
        const anchors = findAbilityBootstrapAnchors(bootstrapFacts, fact.method);
        for (const anchor of anchors) {
            edges.push({
                kind: "want_handoff",
                edgeFamily: "ability_handoff",
                phaseHint: "reactive_handoff",
                fromMethod: anchor,
                toMethod: fact.method,
                reasons: [reasonFromFact(fact)],
            });
        }
    }
    return edges;
}


