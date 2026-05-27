import { buildSemanticFlowAnalysisAugment } from "../../core/semanticflow/SemanticFlowArtifacts";
import type { SemanticFlowItemResult } from "../../core/semanticflow/SemanticFlowTypes";
import { assert, makeRuleAsset } from "./SemanticFlowV2TestHelpers";

function main(): void {
    const asset = makeRuleAsset();
    const item: SemanticFlowItemResult = {
        anchor: { id: "anchor:Logger.info", surface: "Logger.info" },
        draftId: "draft:Logger.info",
        plane: "rule",
        resolution: "resolved",
        asset,
        finalSlice: {
            anchorId: "anchor:Logger.info",
            round: 0,
            template: "call-return",
            observations: [],
            snippets: [],
        },
        history: [],
    };
    const augment = buildSemanticFlowAnalysisAugment([item]);
    assert(augment.assets.length === 1, "expected one v2 asset");
    assert(augment.ruleSet.sinks.length === 1, "expected one lowered sink rule");
    assert(!("classification" in item), "item result must not carry old classification");
    console.log("PASS test_semanticflow_classification");
}

main();
