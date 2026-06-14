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
    assert(
        lowered.ruleSet.sources[0].callbackArgIndexes?.join(",") === "0",
        "direct callbackArg endpoint must lower callback locator to callbackArgIndexes",
    );
    assert(
        lowered.ruleSet.sources[0].callbackResolution === "direct_arg",
        "direct callbackArg endpoint must use direct_arg callback resolution",
    );

    const optionAsset = makeRuleAsset("asset.project.option-callback-source");
    optionAsset.status = "reviewed";
    optionAsset.provenance.source = "manual";
    optionAsset.surfaces[0] = {
        surfaceId: `${optionAsset.id}.component.surface`,
        kind: "invoke",
        modulePath: "components/chat/ChatComponents.ets",
        functionName: "ChatInputMenuView",
        invokeKind: "free-function",
        argCount: 1,
        confidence: "likely",
        provenance: {
            source: "llm-proposal",
            location: { file: "components/chat/ChatView.ets", line: 539 },
        },
    };
    optionAsset.bindings[0].surfaceId = `${optionAsset.id}.component.surface`;
    optionAsset.bindings[0].role = "source";
    optionAsset.bindings[0].endpoint = {
        base: {
            kind: "callbackArg",
            callback: {
                kind: "option",
                base: { base: { kind: "arg", index: 0 } },
                accessPath: ["onSendMessage"],
            },
            argIndex: 0,
        },
    };
    optionAsset.effectTemplates = [
        {
            id: "asset.project.option-callback-source.effect",
            kind: "rule.source",
            value: optionAsset.bindings[0].endpoint,
            sourceKind: "callback_param",
            confidence: "likely",
        },
    ];
    optionAsset.bindings[0].effectTemplateRefs = ["asset.project.option-callback-source.effect"];
    const loweredOption = lowerRuleAssetsToRuleSet([optionAsset]);
    assert(loweredOption.ruleSet.sources.length === 1, "expected option callback endpoint source lowering");
    assert(
        loweredOption.ruleSet.sources[0].callbackArgIndexes?.join(",") === "0",
        "option callback endpoint must lower option object base arg index",
    );
    assert(
        loweredOption.ruleSet.sources[0].callbackFieldNames?.join(",") === "onSendMessage",
        "option callback endpoint must lower callback access path to callbackFieldNames",
    );
    assert(
        loweredOption.ruleSet.sources[0].callbackResolution === "known_option",
        "option callback endpoint must use known_option callback resolution",
    );
    assert(
        loweredOption.ruleSet.sources[0].match.kind === "method_name_equals"
            && loweredOption.ruleSet.sources[0].match.value === "ChatInputMenuView",
        "caller-backed component callback source must lower to method-name selector",
    );
    assert(
        loweredOption.ruleSet.sources[0].scope?.file?.value === "components/chat/ChatView.ets",
        "caller-backed component callback source must be scoped to the analyzer-backed callsite file",
    );

    console.log("PASS test_callback_field_name_source_rule");
}

main();
