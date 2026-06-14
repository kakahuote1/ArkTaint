import { parseSemanticFlowAssetModelOutput } from "../../core/semanticflow/SemanticFlowAssetModelOutput";
import { assert, expectThrows, makeHandoffAsset, makeRuleAsset } from "./SemanticFlowV2TestHelpers";

function main(): void {
    const asset = makeRuleAsset();
    const parsed = parseSemanticFlowAssetModelOutput(JSON.stringify({ status: "done", asset }));
    assert(parsed.status === "done", "expected done output");
    assert(parsed.asset.effectTemplates?.[0]?.kind === "rule.sink", "expected rule sink template");

    const promoted = makeRuleAsset();
    promoted.status = "official";
    promoted.provenance.source = "manual";
    expectThrows(() => parseSemanticFlowAssetModelOutput(JSON.stringify({ status: "done", asset: promoted })), "not analyzer-backed");

    const withAnchor = parseSemanticFlowAssetModelOutput(JSON.stringify({ status: "done", asset: promoted }), {
        analyzerBackedSurfaceIds: new Set([promoted.surfaces[0].surfaceId]),
    });
    assert(withAnchor.status === "done", "manual promoted asset should parse with analyzer anchor");

    const core = makeHandoffAsset();
    core.effectTemplates = [{ id: "core.bad", kind: "core.capability", capability: "bad", payload: {} } as any];
    core.bindings[0].effectTemplateRefs = ["core.bad"];
    expectThrows(() => parseSemanticFlowAssetModelOutput(JSON.stringify({ status: "done", asset: core })), "core.capability");

    const moduleWithRuleEffect = makeRuleAsset("asset.project.weather.searchCity", "module");
    expectThrows(
        () => parseSemanticFlowAssetModelOutput(JSON.stringify({ status: "done", asset: moduleWithRuleEffect })),
        "rule.sink is not compatible with asset plane module",
    );

    const ruleWithHandoffEffect = makeHandoffAsset("asset.project.token-cache.bad-plane");
    ruleWithHandoffEffect.plane = "rule";
    ruleWithHandoffEffect.bindings[0].plane = "rule";
    expectThrows(
        () => parseSemanticFlowAssetModelOutput(JSON.stringify({ status: "done", asset: ruleWithHandoffEffect })),
        "handoff.put is not compatible with asset plane rule",
    );

    const bindingPlaneMismatch = makeRuleAsset("asset.project.binding-plane-mismatch");
    bindingPlaneMismatch.bindings[0].plane = "module";
    expectThrows(
        () => parseSemanticFlowAssetModelOutput(JSON.stringify({ status: "done", asset: bindingPlaneMismatch })),
        "plane must match asset plane rule",
    );

    const needMore = parseSemanticFlowAssetModelOutput(JSON.stringify({
        status: "need-more-evidence",
        request: {
            kind: "q_relation",
            why: ["wrapper transparency is not proven"],
            ask: "show wrapper body",
        },
        draft: { id: "asset.project.logger" },
    }));
    assert(needMore.status === "need-more-evidence", "expected need-more-evidence");
    assert(needMore.request.kind === "q_relation", "expected relation request");

    console.log("PASS test_semanticflow_llm_validation");
}

main();
