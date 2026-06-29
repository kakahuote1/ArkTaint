import {
    AssetDocumentBase,
    AssetEndpoint,
    AssetSurface,
} from "../../core/assets/schema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import { canonicalApiIdFromTestDeclaration, indexedTestParameters } from "../helpers/CanonicalApiTestDeclarations";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

const arg0: AssetEndpoint = { base: { kind: "arg", index: 0 } };
const arg1: AssetEndpoint = { base: { kind: "arg", index: 1 } };
const rest1: AssetEndpoint = { base: { kind: "rest", startIndex: 1 } } as any;
const resultEndpoint: AssetEndpoint = { base: { kind: "return" } };

function ruleAsset(): AssetDocumentBase {
    return stampRuleAsset({
        id: "asset.rule.test",
        plane: "rule",
        status: "official",
        surfaces: [
            invokeSurface("surface.token.cache.load", "project/token", "TokenCache", "load", "instance", ["string"], "Object"),
            invokeSurface("surface.logger.info", "project/logger", "Logger", "info", "static", ["Object"], "void"),
            invokeSurface("surface.token.map.set", "project/token", "TokenMap", "set", "instance", ["string", "Object"], "void"),
        ],
        bindings: [
            {
                bindingId: "binding.source.result",
                surfaceId: "surface.token.cache.load",
                assetId: "asset.rule.test",
                plane: "rule",
                role: "source",
                endpoint: resultEndpoint,
                effectTemplateRefs: ["template.source.result"],
                semanticsFamily: "credential-source",
                metadata: {
                    severity: "high",
                    category: "credential",
                },
                completeness: "complete",
                confidence: "certain",
            },
            {
                bindingId: "binding.sink.arg0",
                surfaceId: "surface.logger.info",
                assetId: "asset.rule.test",
                plane: "rule",
                role: "sink",
                endpoint: arg0,
                effectTemplateRefs: ["template.sink.arg0"],
                semanticsFamily: "privacy-log",
                completeness: "complete",
                confidence: "certain",
            },
            {
                bindingId: "binding.transfer.arg1.to.slot",
                surfaceId: "surface.token.map.set",
                assetId: "asset.rule.test",
                plane: "rule",
                role: "transfer",
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
                    slotWriteMode: "append",
                },
                transferKind: "map-slot",
                confidence: "certain",
            },
        ],
        provenance: { source: "builtin" },
    });
}

function invokeSurface(
    surfaceId: string,
    modulePath: string,
    ownerName: string,
    methodName: string,
    invokeKind: "instance" | "static" | "free-function",
    parameterTypes: string[],
    returnType: string,
    options: {
        confidence?: AssetSurface["confidence"];
        provenance?: AssetSurface["provenance"];
    } = {},
): AssetSurface {
    const memberIsFunction = invokeKind === "free-function";
    const staticFlag = invokeKind === "static" || memberIsFunction;
    const canonicalApiId = canonicalApiIdFromTestDeclaration({
        authority: "project",
        domain: "local",
        moduleSpecifier: modulePath,
        logicalDeclarationFile: modulePath,
        exportPath: [{ kind: "named", name: memberIsFunction ? methodName : ownerName }],
        declarationOwner: memberIsFunction
            ? { kind: "namespace", path: [ownerName], normalizedName: ownerName }
            : { kind: "class", path: [ownerName], normalizedName: ownerName },
        member: memberIsFunction
            ? { kind: "function", name: methodName }
            : { kind: "method", name: methodName, static: staticFlag },
        invoke: { kind: "call" },
        signature: {
            parameters: indexedTestParameters(parameterTypes),
            returnType: { text: returnType },
        },
        arkanalyzer: {
            declaringFileName: modulePath,
            declaringNamespacePath: [],
            declaringClassName: ownerName,
            methodName,
            parameterTypes,
            returnType,
            staticFlag,
        },
        declarationLocations: [{ file: modulePath }],
    });
    return {
        surfaceId,
        kind: "invoke",
        canonicalApiId,
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: modulePath,
                    declaringNamespacePath: [],
                    declaringClassName: ownerName,
                    methodName,
                    parameterTypes,
                    returnType,
                    staticFlag,
                },
            },
        },
        confidence: options.confidence || "certain",
        provenance: options.provenance || { source: "manual" },
    };
}

function stampRuleAsset<T extends AssetDocumentBase>(asset: T): T {
    const bySurfaceId = new Map<string, string>();
    for (const surface of asset.surfaces) {
        assert(surface.canonicalApiId, `${surface.surfaceId} must declare canonicalApiId`);
        bySurfaceId.set(surface.surfaceId, surface.canonicalApiId);
    }
    for (const binding of asset.bindings) {
        const canonicalApiId = bySurfaceId.get(binding.surfaceId);
        if (canonicalApiId) binding.canonicalApiId = canonicalApiId;
    }
    return asset;
}

function semanticFlowGeneratedProjectSinkAsset(): AssetDocumentBase {
    return stampRuleAsset({
        id: "project.semanticflow.chat.rule",
        plane: "rule",
        status: "schema-valid",
        surfaces: [
            invokeSurface(
                "surface.MessageViewModel.sendTextMessage",
                "chatuikit/src/main/ets/viewmodels/MessageViewModel.ets",
                "MessageViewModel",
                "sendTextMessage",
                "instance",
                ["MessageParam", "string", "SendOptions", "Callback"],
                "Promise<void>",
                {
                    confidence: "likely",
                    provenance: {
                        source: "llm-proposal",
                        location: {
                            file: "chatuikit/src/main/ets/viewmodels/MessageViewModel.ets",
                            line: 228,
                        },
                    },
                },
            ),
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
    });
}

function semanticFlowGeneratedProjectReceiverFieldSinkAsset(): AssetDocumentBase {
    return stampRuleAsset({
        id: "project.semanticflow.receiver.field.rule",
        plane: "rule",
        status: "schema-valid",
        surfaces: [
            invokeSurface(
                "surface.WebDavClient._request",
                "entry/src/main/ets/common/utils/webdav/client.ts",
                "WebDavClient",
                "_request",
                "instance",
                ["string", "string", "Headers", "Object", "RequestOptions"],
                "Promise<Response>",
                {
                    confidence: "likely",
                    provenance: {
                        source: "llm-proposal",
                        location: {
                            file: "entry/src/main/ets/common/utils/webdav/client.ts",
                            line: 283,
                        },
                    },
                },
            ),
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
    });
}

function semanticFlowGeneratedProjectComponentSourceAsset(): AssetDocumentBase {
    return stampRuleAsset({
        id: "project.semanticflow.component.source",
        plane: "rule",
        status: "schema-valid",
        surfaces: [
            invokeSurface(
                "surface.ExternalButton.onBtnClick",
                "action_button_callback.ets",
                "file",
                "ExternalButton",
                "free-function",
                ["ExternalButtonOptions"],
                "void",
                {
                    confidence: "likely",
                    provenance: {
                        source: "llm-proposal",
                        location: {
                            file: "action_button_callback.ets",
                            line: 12,
                        },
                    },
                },
            ),
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
    });
}

function entryParamRuleAsset(): AssetDocumentBase {
    const canonicalApiId = canonicalApiIdFromTestDeclaration({
        authority: "project",
        domain: "local",
        moduleSpecifier: "tests/demo/harmony_router_bridge/router_bridge_001_T.ets",
        logicalDeclarationFile: "tests/api/harmony_router_bridge_entries.d.ts",
        exportPath: [{ kind: "entry", name: "component.RouterBridgeCase" }],
        declarationOwner: {
            kind: "entry",
            path: ["component.RouterBridgeCase"],
            normalizedName: "component.RouterBridgeCase",
            arkanalyzerName: "RouterBridgeCase",
        },
        member: { kind: "lifecycle", name: "test.case.router_bridge_001_T" },
        invoke: { kind: "entry" },
        signature: {
            parameters: indexedTestParameters(["string"]),
            returnType: { text: "void" },
        },
        declarationLocations: [{ file: "tests/api/harmony_router_bridge_entries.d.ts" }],
    });
    return {
        id: "asset.rule.test.entry_param",
        plane: "rule",
        status: "official",
        surfaces: [{
            surfaceId: "surface.source.entry_param.router_bridge_001_T",
            canonicalApiId,
            kind: "entry",
            evidence: {
                arkanalyzer: {
                    methodKey: {
                        declaringFileName: "tests/demo/harmony_router_bridge/router_bridge_001_T.ets",
                        declaringNamespacePath: [],
                        declaringClassName: "RouterBridgeCase",
                        methodName: "router_bridge_001_T",
                        parameterTypes: ["string"],
                        returnType: "void",
                        staticFlag: false,
                    },
                },
            },
            confidence: "certain",
            provenance: { source: "manual" },
        } as any],
        bindings: [{
            bindingId: "binding.source.entry_param.router_bridge_001_T.arg0",
            surfaceId: "surface.source.entry_param.router_bridge_001_T",
            assetId: "asset.rule.test.entry_param",
            plane: "rule",
            role: "source",
            endpoint: arg0,
            effectTemplateRefs: ["template.source.entry_param.router_bridge_001_T.arg0"],
            semanticsFamily: "source",
            completeness: "complete",
            confidence: "certain",
            canonicalApiId,
        }],
        effectTemplates: [{
            id: "template.source.entry_param.router_bridge_001_T.arg0",
            kind: "rule.source",
            value: arg0,
            sourceKind: "entry_param",
            confidence: "certain",
        }],
        provenance: { source: "builtin" },
    };
}

function main(): void {
    const lowered = lowerRuleAssetsToRuleSet([ruleAsset()]);
    assert(lowered.diagnostics.length === 0, `unexpected diagnostics: ${lowered.diagnostics.join("; ")}`);
    assert(lowered.ruleSet.sources.length === 1, "source should be lowered");
    assert(lowered.ruleSet.sinks.length === 1, "sink should be lowered");
    assert(lowered.ruleSet.transfers.length === 1, "transfer should be lowered");

    const source = lowered.ruleSet.sources[0];
    assert(source.match.kind === "canonical_api_id_equals", "canonical surface should lower to canonical API identity gate");
    assert(source.match.value === source.apiEffect?.canonicalApiId, "source match value should equal apiEffect canonicalApiId");
    assert(source.sourceKind === "call_return", "source kind should be preserved");
    assert(source.target === "result", "return endpoint should lower to result");
    assert(source.category === "credential", "metadata category should be preserved");
    assert(source.severity === "high", "metadata severity should be preserved");

    const sink = lowered.ruleSet.sinks[0];
    assert(sink.match.kind === "canonical_api_id_equals", "sink should lower to canonical API identity gate");
    assert(sink.match.value === sink.apiEffect?.canonicalApiId, "sink match value should equal apiEffect canonicalApiId");
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

    const restEndpointAsset = ruleAsset();
    restEndpointAsset.surfaces[1] = invokeSurface("surface.logger.info", "project/logger", "Logger", "info", "static", ["Object", "rest:Object[]"], "void");
    restEndpointAsset.bindings[1].endpoint = rest1;
    (restEndpointAsset.effectTemplates!.find(template => template.id === "template.sink.arg0") as any).value = rest1;
    stampRuleAsset(restEndpointAsset);
    const loweredRestEndpoint = lowerRuleAssetsToRuleSet([restEndpointAsset]);
    assert(loweredRestEndpoint.diagnostics.length === 0, `rest endpoint lowering should not produce diagnostics: ${loweredRestEndpoint.diagnostics.join("; ")}`);
    const restSink = loweredRestEndpoint.ruleSet.sinks[0].target as any;
    assert(typeof restSink === "object", "rest endpoint should lower to an endpoint ref");
    assert(restSink.endpoint === "arg1", `rest endpoint should lower to the rest start arg, got ${restSink.endpoint}`);
    assert(restSink.semanticEndpointKind === "rest", `rest endpoint lowering should retain rest semantics, got ${restSink.semanticEndpointKind}`);

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
    assert(transfer.to.slotWriteMode === "append", "slot write mode should lower");
    assert(transfer.match.kind === "canonical_api_id_equals", "transfer should lower to canonical API identity gate");
    assert(transfer.match.value === transfer.apiEffect?.canonicalApiId, "transfer match value should equal apiEffect canonicalApiId");
    assert((transfer as any).scope === undefined, "transfer should not carry owner-name runtime scope");

    const surfaceGateAsset = ruleAsset();
    const inferred = lowerRuleAssetsToRuleSet([surfaceGateAsset]);
    assert(inferred.diagnostics.length === 0, "invoke surface should provide a surface-derived execution gate");
    assert(inferred.ruleSet.sources[0].match.kind === "canonical_api_id_equals", "surface-derived gate should use canonical identity");
    assert(
        inferred.ruleSet.sources[0].match.value === inferred.ruleSet.sources[0].apiEffect?.canonicalApiId,
        "surface-derived gate should use the apiEffect canonicalApiId",
    );
    assert((inferred.ruleSet.sources[0] as any).scope === undefined, "surface-derived gate must not constrain the caller scope");
    assert((inferred.ruleSet.sources[0] as any).calleeScope === undefined, "surface-derived gate must not carry callee owner runtime scope");

    const generatedProjectLowering = lowerRuleAssetsToRuleSet(
        [semanticFlowGeneratedProjectSinkAsset()],
        { loadMode: "semanticflow-evaluation" },
    );
    assert(
        generatedProjectLowering.diagnostics.length === 0,
        `semanticflow generated project asset should lower cleanly: ${generatedProjectLowering.diagnostics.join("; ")}`,
    );
    const generatedSink = generatedProjectLowering.ruleSet.sinks[0];
    assert(generatedSink.match.kind === "canonical_api_id_equals", "generated project sink should use canonical identity");
    assert(
        generatedSink.match.value === generatedSink.apiEffect?.canonicalApiId,
        "generated project sink should use the apiEffect canonicalApiId",
    );
    assert(
        (generatedSink.match as any).argCount === undefined,
        "generated project sink should not use declaration argCount as a runtime exact arity guard",
    );
    assert(
        (generatedSink as any).scope === undefined,
        "generated project sink should not constrain the caller scope from an invoke surface",
    );
    assert((generatedSink as any).calleeScope === undefined, "generated project sink should not carry owner/file runtime scope");

    const generatedReceiverFieldSinkLowering = lowerRuleAssetsToRuleSet(
        [semanticFlowGeneratedProjectReceiverFieldSinkAsset()],
        { loadMode: "semanticflow-evaluation" },
    );
    assert(
        generatedReceiverFieldSinkLowering.diagnostics.length === 0,
        `semanticflow generated receiver-field sink asset should lower cleanly: ${generatedReceiverFieldSinkLowering.diagnostics.join("; ")}`,
    );
    const generatedReceiverSink = generatedReceiverFieldSinkLowering.ruleSet.sinks[0];
    assert(generatedReceiverSink.match.kind === "canonical_api_id_equals", "receiver-field project sink should use canonical identity");
    assert(
        generatedReceiverSink.match.value === generatedReceiverSink.apiEffect?.canonicalApiId,
        "receiver-field project sink should use the apiEffect canonicalApiId",
    );
    assert((generatedReceiverSink as any).calleeScope === undefined, "receiver-field project sink should not carry owner runtime scope");
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
        (officialSurfaceLowering.ruleSet.sinks[0].match as any).argCount === undefined,
        "official assets should not preserve legacy surface argCount in runtime gate",
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
        "generated component source should keep exact component identity in the runtime gate",
    );
    assert(
        (generatedComponentSource.match as any).argCount === undefined,
        "generated component source should not use source surface argCount as a runtime exact arity guard",
    );
    assert(
        (generatedComponentSource as any).callbackResolution === undefined,
        "generated component source should not lower legacy callback resolution fields",
    );
    assert(
        (generatedComponentSource as any).callbackFieldNames === undefined,
        "generated component source should not lower legacy callback field selector fields",
    );

    const entryParamLowering = lowerRuleAssetsToRuleSet([entryParamRuleAsset()]);
    assert(
        entryParamLowering.diagnostics.length === 0,
        `entry-param source asset should lower cleanly: ${entryParamLowering.diagnostics.join("; ")}`,
    );
    const entryParamSource = entryParamLowering.ruleSet.sources[0];
    assert(entryParamSource.sourceKind === "entry_param", "entry source kind should be preserved");
    assert(entryParamSource.match.kind === "canonical_api_id_equals", "entry source should lower to canonical identity");
    assert(
        entryParamSource.match.value === entryParamSource.apiEffect?.canonicalApiId,
        "entry source should bind apiEffect canonical identity",
    );
    assert(entryParamSource.target === "arg0", "entry source endpoint should lower to arg0");

    console.log("PASS test_rule_asset_lowering");
}

main();
