import { parseSemanticFlowAssetDecision } from "../../core/semanticflow/SemanticFlowLlm";
import { assert, expectThrows, makeHandoffAsset } from "./SemanticFlowV2TestHelpers";

function main(): void {
    const decision = parseSemanticFlowAssetDecision(JSON.stringify({
        status: "done",
        asset: makeHandoffAsset(),
        rationale: ["TokenCache.save publishes arg1 under arg0."],
    }), {
        analyzerBackedSurfaceIds: new Set(["asset.project.token-cache.save.surface"]),
    });
    assert(decision.status === "done", "expected v2 asset decision");
    assert(decision.asset.plane === "module", "expected module plane");

    expectThrows(() => parseSemanticFlowAssetDecision(JSON.stringify({
        status: "done",
        classification: "module",
        summary: {},
    })), "legacy semanticflow output field");

    console.log("PASS test_semanticflow_llm_repair");
}

main();
