import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import { assert, makeRuleAsset } from "./SemanticFlowV2TestHelpers";

function main(): void {
    const asset = makeRuleAsset("asset.project.callback-source");
    asset.status = "reviewed";
    asset.provenance.source = "manual";
    asset.bindings[0].role = "source";
    asset.bindings[0].endpoint = {
        base: { kind: "callbackArg", callback: { kind: "arg", index: 0 }, argIndex: 1 },
        accessPath: ["data", "token"],
    };
    asset.effectTemplates = [
        {
            id: "asset.project.callback-source.effect",
            kind: "rule.source",
            value: asset.bindings[0].endpoint,
            sourceKind: "callback_param",
            confidence: "likely",
        },
    ];
    asset.bindings[0].effectTemplateRefs = ["asset.project.callback-source.effect"];
    const lowered = lowerRuleAssetsToRuleSet([asset]);
    assert(lowered.ruleSet.sources.length === 1, "expected callback endpoint source lowering");
    assert(lowered.ruleSet.sources[0].target === "arg1" || (lowered.ruleSet.sources[0].target as any).endpoint === "arg1", "expected callback arg endpoint lowering");
    console.log("PASS test_callback_field_name_source_rule");
}

main();
