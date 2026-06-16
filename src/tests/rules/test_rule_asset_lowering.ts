import {
    AssetDocumentBase,
    AssetEndpoint,
} from "../../core/assets/schema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

const arg0: AssetEndpoint = { base: { kind: "arg", index: 0 } };
const arg1: AssetEndpoint = { base: { kind: "arg", index: 1 } };
const resultEndpoint: AssetEndpoint = { base: { kind: "return" } };

function ruleAsset(): AssetDocumentBase {
    return {
        id: "asset.rule.test",
        plane: "rule",
        status: "official",
        surfaces: [
            {
                surfaceId: "surface.token.cache",
                kind: "invoke",
                modulePath: "project/token",
                ownerName: "TokenCache",
                methodName: "save",
                invokeKind: "instance",
                argCount: 2,
                confidence: "certain",
                provenance: { source: "manual" },
            },
        ],
        bindings: [
            {
                bindingId: "binding.source.result",
                surfaceId: "surface.token.cache",
                assetId: "asset.rule.test",
                plane: "rule",
                role: "source",
                selector: {
                    kind: "method-name-equals",
                    value: "load",
                    invokeKind: "instance",
                    argCount: 1,
                    scope: { className: { mode: "equals", value: "TokenCache" } },
                },
                endpoint: resultEndpoint,
                effectTemplateRefs: ["template.source.result"],
                semanticsFamily: "credential-source",
                metadata: {
                    severity: "high",
                    category: "credential",
                    layer: "kernel",
                    tier: "A",
                },
                completeness: "complete",
                confidence: "certain",
            },
            {
                bindingId: "binding.sink.arg0",
                surfaceId: "surface.token.cache",
                assetId: "asset.rule.test",
                plane: "rule",
                role: "sink",
                selector: {
                    kind: "method-name-equals",
                    value: "info",
                },
                endpoint: arg0,
                effectTemplateRefs: ["template.sink.arg0"],
                semanticsFamily: "privacy-log",
                completeness: "complete",
                confidence: "certain",
            },
            {
                bindingId: "binding.transfer.arg1.to.slot",
                surfaceId: "surface.token.cache",
                assetId: "asset.rule.test",
                plane: "rule",
                role: "transfer",
                selector: {
                    kind: "method-name-equals",
                    value: "set",
                    invokeKind: "instance",
                    argCount: 2,
                    scope: {
                        className: { mode: "contains", value: "TokenMap" },
                    },
                },
                endpoint: { base: { kind: "receiver" } },
                effectTemplateRefs: ["template.transfer.arg1.to.slot"],
                semanticsFamily: "container-transfer",
                completeness: "complete",
                confidence: "certain",
            },
        ],
        effectTemplates: [
            {
                id: "template.source.result",
                kind: "rule.source",
                value: resultEndpoint,
                sourceKind: "call_return",
                confidence: "certain",
            },
            {
                id: "template.sink.arg0",
                kind: "rule.sink",
                value: arg0,
                sinkKind: "log",
                confidence: "certain",
            },
            {
                id: "template.transfer.arg1.to.slot",
                kind: "rule.transfer",
                from: arg1,
                to: {
                    endpoint: { base: { kind: "receiver" } },
                    pathFrom: arg0,
                    slotKind: "map",
                },
                transferKind: "map-slot",
                confidence: "certain",
            },
        ],
        provenance: { source: "builtin" },
    };
}

function semanticFlowGeneratedProjectSinkAsset(): AssetDocumentBase {
    return {
        id: "project.semanticflow.chat.rule",
        plane: "rule",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.MessageViewModel.sendTextMessage",
                kind: "invoke",
                modulePath: "chatuikit/src/main/ets/viewmodels/MessageViewModel.ets",
                ownerName: "MessageViewModel",
                methodName: "sendTextMessage",
                invokeKind: "instance",
                argCount: 4,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: {
                        file: "chatuikit/src/main/ets/viewmodels/MessageViewModel.ets",
                        line: 228,
                    },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.MessageViewModel.sendTextMessage.arg0.sink",
                surfaceId: "surface.MessageViewModel.sendTextMessage",
                assetId: "project.MessageViewModel.sendTextMessage",
                plane: "rule",
                role: "sink",
                endpoint: arg0,
                effectTemplateRefs: ["template.MessageViewModel.sendTextMessage.arg0.sink"],
                semanticsFamily: "network-send",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.MessageViewModel.sendTextMessage.arg0.sink",
                kind: "rule.sink",
                value: arg0,
                sinkKind: "network",
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            projectId: "semanticflow",
            evidenceLocations: [
                {
                    file: "chatuikit/src/main/ets/viewmodels/MessageViewModel.ets",
                    line: 228,
                },
            ],
        },
    };
}

function semanticFlowGeneratedProjectReceiverFieldSinkAsset(): AssetDocumentBase {
    return {
        id: "project.semanticflow.receiver.field.rule",
        plane: "rule",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.WebDavClient._request",
                kind: "invoke",
                modulePath: "entry/src/main/ets/common/utils/webdav/client.ts",
                ownerName: "WebDavClient",
                methodName: "_request",
                invokeKind: "instance",
                argCount: 5,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: {
                        file: "entry/src/main/ets/common/utils/webdav/client.ts",
                        line: 283,
                    },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.WebDavClient._request.authHeaders.networkSink",
                surfaceId: "surface.WebDavClient._request",
                assetId: "project.semanticflow.receiver.field.rule",
                plane: "rule",
                role: "sink",
                endpoint: {
                    base: { kind: "receiver" },
                    accessPath: ["authHeaders"],
                },
                effectTemplateRefs: ["template.WebDavClient._request.authHeaders.networkSink"],
                semanticsFamily: "network-request",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.WebDavClient._request.authHeaders.networkSink",
                kind: "rule.sink",
                value: {
                    base: { kind: "receiver" },
                    accessPath: ["authHeaders"],
                },
                sinkKind: "network_request",
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            projectId: "semanticflow",
            evidenceLocations: [
                {
                    file: "entry/src/main/ets/common/utils/webdav/client.ts",
                    line: 283,
                },
            ],
        },
    };
}

function semanticFlowGeneratedProjectComponentSourceAsset(): AssetDocumentBase {
    return {
        id: "project.semanticflow.component.source",
        plane: "rule",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.ExternalButton.onBtnClick",
                kind: "invoke",
                modulePath: "action_button_callback.ets",
                functionName: "ExternalButton",
                invokeKind: "free-function",
                argCount: 1,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: {
                        file: "action_button_callback.ets",
                        line: 12,
                    },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.ExternalButton.onBtnClick.arg0.source",
                surfaceId: "surface.ExternalButton.onBtnClick",
                assetId: "project.ExternalButton.onBtnClick",
                plane: "rule",
                role: "source",
                endpoint: {
                    base: {
                        kind: "callbackArg",
                        callback: {
                            kind: "option",
                            base: { base: { kind: "arg", index: 0 } },
                            accessPath: ["onBtnClick"],
                        },
                        argIndex: 0,
                    },
                },
                effectTemplateRefs: ["template.ExternalButton.onBtnClick.arg0.source"],
                semanticsFamily: "ui-input",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.ExternalButton.onBtnClick.arg0.source",
                kind: "rule.source",
                value: {
                    base: {
                        kind: "callbackArg",
                        callback: {
                            kind: "option",
                            base: { base: { kind: "arg", index: 0 } },
                            accessPath: ["onBtnClick"],
                        },
                        argIndex: 0,
                    },
                },
                sourceKind: "callback_param",
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            projectId: "semanticflow",
            evidenceLocations: [
                {
                    file: "action_button_callback.ets",
                    line: 12,
                },
            ],
        },
    };
}

function main(): void {
    const lowered = lowerRuleAssetsToRuleSet([ruleAsset()]);
    assert(lowered.diagnostics.length === 0, `unexpected diagnostics: ${lowered.diagnostics.join("; ")}`);
    assert(lowered.ruleSet.sources.length === 1, "source should be lowered");
    assert(lowered.ruleSet.sinks.length === 1, "sink should be lowered");
    assert(lowered.ruleSet.transfers.length === 1, "transfer should be lowered");

    const source = lowered.ruleSet.sources[0];
    assert(source.match.kind === "method_name_equals", "selector should lower to old rule matcher");
    assert(source.sourceKind === "call_return", "source kind should be preserved");
    assert(source.target === "result", "return endpoint should lower to result");
    assert(source.category === "credential", "metadata category should be preserved");
    assert(source.severity === "high", "metadata severity should be preserved");

    const sink = lowered.ruleSet.sinks[0];
    assert(sink.match.kind === "method_name_equals", "exact method selector should be preserved");
    assert(sink.target === "arg0", "arg endpoint should lower to arg0");

    const bindingEndpointAsset = ruleAsset();
    const bindingEndpointSinkTemplate = bindingEndpointAsset.effectTemplates!.find(template => template.id === "template.sink.arg0") as any;
    delete bindingEndpointSinkTemplate.value;
    bindingEndpointAsset.bindings[1].endpoint = arg0;
    const loweredFromBindingEndpoint = lowerRuleAssetsToRuleSet([bindingEndpointAsset]);
    assert(loweredFromBindingEndpoint.diagnostics.length === 0, "binding endpoint should not produce diagnostics");
    assert(
        loweredFromBindingEndpoint.ruleSet.sinks[0].target === "arg0",
        "rule.sink without template value should lower from binding.endpoint",
    );

    const sharedTemplateEndpointAsset = ruleAsset();
    const sharedTemplate = sharedTemplateEndpointAsset.effectTemplates!.find(template => template.id === "template.sink.arg0") as any;
    delete sharedTemplate.value;
    sharedTemplate.id = "template.logger.shared.sink";
    sharedTemplateEndpointAsset.bindings[1] = {
        ...sharedTemplateEndpointAsset.bindings[1],
        bindingId: "binding.logger.shared.arg0.sink",
        endpoint: arg0,
        effectTemplateRefs: ["template.logger.shared.sink"],
    };
    sharedTemplateEndpointAsset.bindings.push({
        ...sharedTemplateEndpointAsset.bindings[1],
        bindingId: "binding.logger.shared.arg1.sink",
        endpoint: arg1,
        effectTemplateRefs: ["template.logger.shared.sink"],
    });
    const loweredSharedEndpointSinks = lowerRuleAssetsToRuleSet([sharedTemplateEndpointAsset]);
    assert(loweredSharedEndpointSinks.diagnostics.length === 0, "shared template endpoint sinks should not produce diagnostics");
    assert(loweredSharedEndpointSinks.ruleSet.sinks.length === 2, "shared template should lower once per binding endpoint");
    assert(
        new Set(loweredSharedEndpointSinks.ruleSet.sinks.map(item => item.id)).size === 2,
        "shared template endpoint sinks must have distinct runtime ids",
    );
    assert(
        loweredSharedEndpointSinks.ruleSet.sinks.some(item => item.id === "logger.shared.arg0.sink" && item.target === "arg0") &&
        loweredSharedEndpointSinks.ruleSet.sinks.some(item => item.id === "logger.shared.arg1.sink" && item.target === "arg1"),
        "shared template endpoint sinks should use binding ids and binding endpoints",
    );

    const transfer = lowered.ruleSet.transfers[0];
    assert(transfer.from === "arg1", "transfer from endpoint should lower");
    assert(typeof transfer.to === "object", "slot transfer target should be object ref");
    assert(transfer.to.endpoint === "base", "slot target should lower to base endpoint");
    assert(transfer.to.pathFrom === "arg0", "slot path source should lower to pathFrom");
    assert(transfer.to.slotKind === "map", "slot kind should lower");
    assert(
        transfer.scope?.className?.value === "TokenMap",
        "transfer selector scope should lower into runtime transfer scope",
    );

    const missingSelectorAsset = ruleAsset();
    missingSelectorAsset.bindings[0].selector = undefined;
    missingSelectorAsset.surfaces[0] = {
        ...(missingSelectorAsset.surfaces[0] as any),
        methodName: "load",
        argCount: 1,
    };
    const inferred = lowerRuleAssetsToRuleSet([missingSelectorAsset]);
    assert(inferred.diagnostics.length === 0, "invoke surface should provide a surface-derived selector");
    assert(inferred.ruleSet.sources[0].match.value === "load", "surface-derived selector should use invoke surface method");
    assert(inferred.ruleSet.sources[0].scope === undefined, "surface-derived selector must not constrain the caller scope");
    assert(
        inferred.ruleSet.sources[0].calleeScope?.className?.value === "TokenCache",
        "surface-derived selector should constrain the callee owner through calleeScope",
    );

    const generatedProjectLowering = lowerRuleAssetsToRuleSet(
        [semanticFlowGeneratedProjectSinkAsset()],
        { loadMode: "semanticflow-evaluation" },
    );
    assert(
        generatedProjectLowering.diagnostics.length === 0,
        `semanticflow generated project asset should lower cleanly: ${generatedProjectLowering.diagnostics.join("; ")}`,
    );
    const generatedSink = generatedProjectLowering.ruleSet.sinks[0];
    assert(generatedSink.match.value === "sendTextMessage", "generated project sink should keep exact method name");
    assert(
        generatedSink.match.argCount === undefined,
        "generated project sink should not use declaration argCount as a runtime exact arity guard",
    );
    assert(
        generatedSink.scope === undefined,
        "generated project sink should not constrain the caller scope from an invoke surface",
    );
    assert(
        generatedSink.calleeScope?.className?.value === "MessageViewModel",
        "generated project sink should keep exact owner calleeScope",
    );
    assert(
        generatedSink.calleeScope?.file?.value === "ets/viewmodels/MessageViewModel.ets",
        `generated project sink should keep analyzer-backed callee file scope, got ${generatedSink.calleeScope?.file?.value}`,
    );

    const generatedReceiverFieldSinkLowering = lowerRuleAssetsToRuleSet(
        [semanticFlowGeneratedProjectReceiverFieldSinkAsset()],
        { loadMode: "semanticflow-evaluation" },
    );
    assert(
        generatedReceiverFieldSinkLowering.diagnostics.length === 0,
        `semanticflow generated receiver-field sink asset should lower cleanly: ${generatedReceiverFieldSinkLowering.diagnostics.join("; ")}`,
    );
    const generatedReceiverSink = generatedReceiverFieldSinkLowering.ruleSet.sinks[0];
    assert(generatedReceiverSink.match.value === "_request", "receiver-field project sink should keep exact method name");
    assert(generatedReceiverSink.calleeScope?.className?.value === "WebDavClient", "receiver-field project sink should keep exact owner calleeScope");
    assert(typeof generatedReceiverSink.target === "object", "receiver-field sink target should lower to an endpoint ref");
    assert(generatedReceiverSink.target.endpoint === "base", "receiver-field sink target should lower receiver to base endpoint");
    assert(generatedReceiverSink.target.path?.join(".") === "authHeaders", "receiver-field sink target should preserve accessPath");

    const officialSurfaceLowering = lowerRuleAssetsToRuleSet([{
        ...semanticFlowGeneratedProjectSinkAsset(),
        id: "asset.official.chat.rule",
        status: "official",
        provenance: { source: "builtin" },
    } as AssetDocumentBase]);
    assert(
        officialSurfaceLowering.ruleSet.sinks[0].match.argCount === 4,
        "official assets should preserve surface argCount in runtime selector",
    );

    const generatedComponentSourceLowering = lowerRuleAssetsToRuleSet(
        [semanticFlowGeneratedProjectComponentSourceAsset()],
        { loadMode: "semanticflow-evaluation" },
    );
    assert(
        generatedComponentSourceLowering.diagnostics.length === 0,
        `generated component source should lower cleanly: ${generatedComponentSourceLowering.diagnostics.join("; ")}`,
    );
    const generatedComponentSource = generatedComponentSourceLowering.ruleSet.sources[0];
    assert(
        generatedComponentSource.match.value.includes("ExternalButton"),
        "generated component source should keep exact component identity in the runtime selector",
    );
    assert(
        generatedComponentSource.match.argCount === undefined,
        "generated component source should not use source surface argCount as a runtime exact arity guard",
    );
    assert(
        generatedComponentSource.callbackResolution === "known_option",
        "generated component source should use known-option callback resolution",
    );
    assert(
        generatedComponentSource.callbackFieldNames?.[0] === "onBtnClick",
        "generated component source should preserve callback field endpoint",
    );

    console.log("PASS test_rule_asset_lowering");
}

main();
