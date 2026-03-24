import { ArkMainActivationEdge } from "./ArkMainActivationTypes";
import { ArkMainEntryFact } from "../ArkMainTypes";
import { reasonFromFact } from "./ArkMainActivationBuilderUtils";

export function buildCallbackRegistrationEdges(facts: ArkMainEntryFact[]): ArkMainActivationEdge[] {
    return facts
        .filter(f => f.kind === "callback")
        .map(fact => {
            const kind: ArkMainActivationEdge["kind"] = fact.callbackFlavor === "channel"
                ? "channel_callback_activation"
                : "callback_registration";
            const edgeFamily: ArkMainActivationEdge["edgeFamily"] = fact.callbackFlavor === "channel"
                ? "channel_callback"
                : "ui_callback";
            return {
                kind,
                edgeFamily,
                phaseHint: "interaction" as const,
                fromMethod: fact.sourceMethod,
                toMethod: fact.method,
                reasons: [reasonFromFact(fact)],
            };
        });
}


