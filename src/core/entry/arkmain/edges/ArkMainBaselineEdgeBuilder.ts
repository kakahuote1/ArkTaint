import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkMainActivationEdge } from "./ArkMainActivationTypes";
import { ArkMainEntryFact } from "../ArkMainTypes";
import { dedupeMethods, reasonFromFact, reasonFromScenarioSeed } from "./ArkMainActivationBuilderUtils";

export function buildBaselineRootEdges(
    facts: ArkMainEntryFact[],
    seedMethods: ArkMethod[],
): ArkMainActivationEdge[] {
    const edges: ArkMainActivationEdge[] = [];
    const baselineFacts = facts.filter(f =>
        f.schedule !== false
        && (f.kind === "ability_lifecycle" || f.kind === "page_build" || f.kind === "page_lifecycle"),
    );
    for (const fact of baselineFacts) {
        edges.push({
            kind: "baseline_root",
            edgeFamily: "baseline_root",
            phaseHint: fact.phase,
            toMethod: fact.method,
            reasons: [reasonFromFact(fact)],
        });
    }

    for (const method of dedupeMethods(seedMethods)) {
        edges.push({
            kind: "baseline_root",
            edgeFamily: "baseline_root",
            phaseHint: "bootstrap",
            toMethod: method,
            reasons: [reasonFromScenarioSeed(method)],
        });
    }
    return edges;
}


