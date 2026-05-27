import {
    type AssetDocumentBase,
    type InvokeSurface,
    validateAssetDocument,
} from "../../core/assets/schema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

const invokeSurface: InvokeSurface = {
    surfaceId: "surface.console.log",
    kind: "invoke",
    modulePath: "@ohos.console",
    ownerName: "console",
    methodName: "log",
    invokeKind: "static",
    argCount: 1,
    confidence: "certain",
    provenance: {
        source: "sdk",
    },
};

function validRuleAsset(): AssetDocumentBase {
    return {
        id: "asset.rule.console.log",
        plane: "rule",
        status: "official",
        surfaces: [
            {
                ...invokeSurface,
                provenance: { ...invokeSurface.provenance },
            },
        ],
        bindings: [
            {
                bindingId: "binding.console.log.arg0.sink",
                surfaceId: "surface.console.log",
                assetId: "asset.rule.console.log",
                plane: "rule",
                role: "sink",
                selector: {
                    kind: "signature-contains",
                    value: "console.log",
                    invokeKind: "static",
                    argCount: 1,
                },
                endpoint: { base: { kind: "arg", index: 0 } },
                effectTemplateRefs: ["template.console.log.arg0.sink"],
                semanticsFamily: "privacy-log",
                completeness: "complete",
                confidence: "certain",
            },
        ],
        effectTemplates: [
            {
                id: "template.console.log.arg0.sink",
                kind: "rule.sink",
                value: { base: { kind: "arg", index: 0 } },
                sinkKind: "log",
                confidence: "certain",
            },
        ],
        provenance: {
            source: "builtin",
        },
    };
}

function expectValid(asset: unknown, name: string): void {
    const result = validateAssetDocument(asset);
    assert(result.valid, `${name} should be valid: ${result.errors.join("; ")}`);
}

function expectInvalid(asset: unknown, messagePart: string, name: string): void {
    const result = validateAssetDocument(asset);
    assert(!result.valid, `${name} should be invalid`);
    assert(
        result.errors.some(error => error.includes(messagePart)),
        `${name} should include error containing "${messagePart}", got: ${result.errors.join("; ")}`
    );
}

function main(): void {
    expectValid(validRuleAsset(), "valid rule asset");

    const missingSurfaces = {
        ...validRuleAsset(),
        surfaces: [],
    };
    expectInvalid(missingSurfaces, "must declare at least one surface", "trusted asset without surfaces");

    const legacyFields: any = validRuleAsset();
    legacyFields.schemaVersion = "2.0";
    legacyFields.semantics = { effects: [] };
    legacyFields.surfaces[0].coverageSurfaces = [];
    expectInvalid(legacyFields, "forbidden legacy field", "legacy fields");
    expectInvalid(legacyFields, "semantics.effects", "legacy semantics effects");

    const llmCoreCapability = validRuleAsset();
    llmCoreCapability.id = "asset.llm.bad.core";
    llmCoreCapability.status = "llm-generated";
    llmCoreCapability.provenance = { source: "llm" };
    llmCoreCapability.effectTemplates = [
        {
            id: "template.bad.core",
            kind: "core.capability",
            capability: "unsafe-test-capability",
            payload: {},
        },
    ];
    expectInvalid(llmCoreCapability, "LLM assets must not declare core.capability", "llm core capability");

    const freeFunctionAsset = validRuleAsset();
    freeFunctionAsset.surfaces = [
        {
            surfaceId: "surface.request",
            kind: "invoke",
            modulePath: "@ohos.net.http",
            functionName: "request",
            invokeKind: "free-function",
            argCount: 1,
            confidence: "certain",
            provenance: { source: "sdk" },
        },
    ];
    freeFunctionAsset.bindings[0].surfaceId = "surface.request";
    expectValid(freeFunctionAsset, "free function surface without owner");

    const optionCallbackAsset = validRuleAsset();
    optionCallbackAsset.effectTemplates[0] = {
        id: "template.chat.onSendMessage.arg1.source",
        kind: "rule.source",
        sourceKind: "callback_param",
        value: {
            base: {
                kind: "callbackArg",
                callback: {
                    kind: "option",
                    base: { base: { kind: "arg", index: 0 } },
                    accessPath: ["onSendMessage"],
                },
                argIndex: 1,
            },
        },
        confidence: "likely",
    } as any;
    optionCallbackAsset.bindings[0].endpoint = {
        base: {
            kind: "callbackArg",
            callback: {
                kind: "option",
                base: { base: { kind: "arg", index: 0 } },
                accessPath: ["onSendMessage"],
            },
            argIndex: 1,
        },
    } as any;
    optionCallbackAsset.bindings[0].role = "source";
    optionCallbackAsset.bindings[0].effectTemplateRefs = ["template.chat.onSendMessage.arg1.source"];
    expectValid(optionCallbackAsset, "option-object callback endpoint");

    const unstableInvoke = validRuleAsset();
    unstableInvoke.surfaces = [
        {
            ...invokeSurface,
            surfaceId: "surface.unknown",
            modulePath: "@unk/module",
        },
    ];
    unstableInvoke.bindings[0].surfaceId = "surface.unknown";
    expectInvalid(unstableInvoke, "must be a stable non-empty string", "unstable invoke surface");

    const missingTemplateRef = validRuleAsset();
    missingTemplateRef.bindings[0].effectTemplateRefs = ["template.missing"];
    expectInvalid(missingTemplateRef, "references missing template", "missing effect template ref");

    const sinkTemplateEndpointField: any = validRuleAsset();
    sinkTemplateEndpointField.effectTemplates[0].endpoint = { base: { kind: "arg", index: 0 } };
    delete sinkTemplateEndpointField.effectTemplates[0].value;
    expectInvalid(
        sinkTemplateEndpointField,
        "endpoint is not a rule effect template field",
        "rule sink template endpoint field",
    );

    const sinkReturnEndpoint: any = validRuleAsset();
    sinkReturnEndpoint.bindings[0].endpoint = { base: { kind: "return" } };
    sinkReturnEndpoint.effectTemplates[0].value = { base: { kind: "return" } };
    expectInvalid(
        sinkReturnEndpoint,
        "rule.sink must be a consumed input endpoint",
        "rule sink return endpoint",
    );

    const invalidSourceKind: any = validRuleAsset();
    invalidSourceKind.bindings[0].role = "source";
    invalidSourceKind.effectTemplates[0] = {
        id: "template.bad.source.kind",
        kind: "rule.source",
        sourceKind: "callback_payload",
        value: { base: { kind: "arg", index: 0 } },
    };
    invalidSourceKind.bindings[0].effectTemplateRefs = ["template.bad.source.kind"];
    expectInvalid(invalidSourceKind, "sourceKind must be one of", "invalid source kind");

    const badSelectorRegex = validRuleAsset();
    badSelectorRegex.bindings[0].selector = {
        kind: "signature-regex",
        value: "(",
    };
    expectInvalid(badSelectorRegex, "regex is invalid", "invalid runtime selector regex");

    const facadeAsset = validRuleAsset();
    facadeAsset.relations = [
        {
            relationId: "relation.logger.to.hilog",
            kind: "facade",
            fromSurfaceId: "surface.console.log",
            target: {
                assetId: "asset.rule.hilog.info",
            },
            evidence: "transparent-wrapper",
            evidenceLocation: { file: "Logger.ets", line: 3 },
            argumentMap: [
                {
                    from: { base: { kind: "arg", index: 0 } },
                    to: { base: { kind: "arg", index: 3 } },
                },
            ],
            confidence: "certain",
        },
    ];
    facadeAsset.bindings[0].effectTemplateRefs = undefined;
    facadeAsset.bindings[0].relationRefs = ["relation.logger.to.hilog"];
    expectValid(facadeAsset, "facade relation asset");

    const aliasRelation: any = validRuleAsset();
    aliasRelation.relations = [
        {
            relationId: "relation.bad.alias",
            kind: "alias",
            fromSurfaceId: "surface.console.log",
            target: { assetId: "asset.rule.hilog.info" },
            confidence: "certain",
        },
    ];
    aliasRelation.bindings[0].relationRefs = ["relation.bad.alias"];
    expectInvalid(aliasRelation, "kind must be facade", "unsupported relation kind");

    console.log("PASS test_asset_schema_v2");
}

main();
