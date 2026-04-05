import { ArkMainActivationEdge } from "./ArkMainActivationTypes";
import { ArkMainEntryFact } from "../ArkMainTypes";
import { ARK_MAIN_LIFECYCLE_FACT_KINDS } from "../ArkMainTypes";
import {
    findAbilityBootstrapAnchors,
    reasonFromFact,
} from "./ArkMainActivationBuilderUtils";
import { getArkMainTargetPhase } from "../scheduling/ArkMainSchedulingRules";

export function buildHandoffEdges(facts: ArkMainEntryFact[]): ArkMainActivationEdge[] {
    const edges: ArkMainActivationEdge[] = [];
    const bootstrapFacts = facts.filter(f =>
        f.phase === "bootstrap" && ARK_MAIN_LIFECYCLE_FACT_KINDS.has(f.kind),
    );
    for (const fact of facts.filter(f => f.kind === "want_handoff")) {
        if (fact.method.getName?.() !== "onNewWant") continue;
        const anchors = findAbilityBootstrapAnchors(bootstrapFacts, fact.method);
        for (const anchor of anchors) {
            edges.push({
                kind: "want_handoff",
                edgeFamily: "ability_handoff",
                phaseHint: getArkMainTargetPhase("ability_handoff"),
                fromMethod: anchor,
                toMethod: fact.method,
                reasons: [reasonFromFact(fact)],
            });
        }
    }
    return edges;
}


