import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import { assert, makeRuleAsset } from "./SemanticFlowV2TestHelpers";
import { exactProjectInvokeSurface } from "../helpers/AssetIdentityTestUtils";

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
    const directSource = lowered.ruleSet.sources[0] as any;
    assert(directSource.target?.endpoint === "arg1", "expected callback arg endpoint lowering");
    assert(directSource.target?.path?.join(".") === "data.token", "expected callback access path lowering");
    assert(
        lowered.ruleSet.sources[0].match.kind === "canonical_api_id_equals"
            && lowered.ruleSet.sources[0].match.value === lowered.ruleSet.sources[0].apiEffect?.canonicalApiId,
        "direct callbackArg endpoint must lower to canonical identity gate",
    );
    assert(
        directSource.callbackArgIndexes === undefined
            && directSource.callbackFieldNames === undefined
            && directSource.callbackResolution === undefined,
        "callback locator must not be lowered to removed SourceRule compatibility fields",
    );

    const optionAsset = makeRuleAsset("asset.project.option-callback-source");
    optionAsset.status = "reviewed";
    optionAsset.provenance.source = "manual";
    optionAsset.surfaces[0] = exactProjectInvokeSurface({
        surfaceId: `${optionAsset.id}.component.surface`,
        modulePath: "components/chat/ChatComponents.ets",
        ownerName: "file",
        methodName: "ChatInputMenuView",
        invokeKind: "free-function",
        parameterTypes: ["ChatInputMenuViewOptions"],
        returnType: "void",
        confidence: "likely",
        provenanceSource: "llm-proposal",
    });
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
    optionAsset.bindings[0].canonicalApiId = optionAsset.surfaces[0].canonicalApiId;
    const loweredOption = lowerRuleAssetsToRuleSet([optionAsset]);
    assert(loweredOption.ruleSet.sources.length === 1, "expected option callback endpoint source lowering");
    const optionSource = loweredOption.ruleSet.sources[0] as any;
    assert(
        loweredOption.ruleSet.sources[0].target === "arg0",
        "option callback endpoint must lower callback payload arg to rule endpoint",
    );
    assert(
        optionSource.callbackArgIndexes === undefined
            && optionSource.callbackFieldNames === undefined
            && optionSource.callbackResolution === undefined,
        "option callback locator must not be lowered to removed SourceRule compatibility fields",
    );
    assert(
        loweredOption.ruleSet.sources[0].match.kind === "canonical_api_id_equals"
            && loweredOption.ruleSet.sources[0].match.value === loweredOption.ruleSet.sources[0].apiEffect?.canonicalApiId,
        "caller-backed component callback source must lower to canonical identity gate",
    );
    assert(
        optionSource.scope === undefined,
        "caller-backed component callback source must not carry caller file runtime scope",
    );

    console.log("PASS test_callback_field_name_source_rule");
}

main();
