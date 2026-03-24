import { ArkMainActivationEdge } from "./ArkMainActivationTypes";
import { ArkMainEntryFact } from "../ArkMainTypes";
import { reasonFromFact } from "./ArkMainActivationBuilderUtils";

export function buildSchedulerActivationEdges(facts: ArkMainEntryFact[]): ArkMainActivationEdge[] {
    return facts
        .filter(f => f.kind === "scheduler_callback")
        .map(fact => ({
            kind: "scheduler_activation" as const,
            edgeFamily: "scheduler_callback" as const,
            phaseHint: "interaction" as const,
            fromMethod: fact.sourceMethod,
            toMethod: fact.method,
            reasons: [reasonFromFact(fact)],
        }));
}


