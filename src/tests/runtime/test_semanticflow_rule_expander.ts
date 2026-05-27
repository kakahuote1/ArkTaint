import { createSemanticFlowExpandPlan, materializeSemanticFlowDeficit } from "../../core/semanticflow/SemanticFlowIncremental";
import type { SemanticFlowExpansionRequest } from "../../core/semanticflow/SemanticFlowTypes";
import { assert } from "./SemanticFlowV2TestHelpers";

function main(): void {
    const request: SemanticFlowExpansionRequest = {
        kind: "q_endpoint",
        why: ["role is known but endpoint is missing"],
        ask: "show argument object fields",
        focus: {
            surfaceId: "surface.HttpClient.request",
            role: "sink",
            endpoint: "arg[0].body",
        },
        scope: {
            owner: "HttpClient",
            locality: "owner",
            surface: "HttpClient.request",
        },
        budgetClass: "owner_local",
    };
    const anchor = { id: "anchor:HttpClient.request", surface: "HttpClient.request", owner: "HttpClient" };
    const deficit = materializeSemanticFlowDeficit(anchor, request);
    const plan = createSemanticFlowExpandPlan(anchor, deficit);
    assert(deficit.kind === "q_endpoint", "expected v2 endpoint deficit");
    assert(plan.kind === "q_endpoint", "expected expansion plan to preserve v2 request kind");
    assert(plan.seed.mode === "owner", "owner-local deficit should expand owner context");
    console.log("PASS test_semanticflow_rule_expander");
}

main();
