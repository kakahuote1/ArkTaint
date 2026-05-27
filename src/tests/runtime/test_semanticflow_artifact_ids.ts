import { buildSemanticFlowAnalysisAugmentFromAssets } from "../../core/semanticflow/SemanticFlowArtifacts";
import { serializeSemanticFlowAssets } from "../../core/semanticflow/SemanticFlowSerialize";
import { assert, makeRuleAsset } from "./SemanticFlowV2TestHelpers";

function main(): void {
    const asset = makeRuleAsset("asset.project.logger.sink");
    const augment = buildSemanticFlowAnalysisAugmentFromAssets([asset, asset]);
    assert(augment.assets.length === 1, "semanticflow assets should dedupe by plane and id");
    const serialized = serializeSemanticFlowAssets(augment);
    assert(serialized[0].id === asset.id, "serialized asset should preserve id");
    assert(serialized[0].bindings[0].effectTemplateRefs?.[0] === "asset.project.logger.sink.effect", "binding must point to effect template");
    console.log("PASS test_semanticflow_artifact_ids");
}

main();
