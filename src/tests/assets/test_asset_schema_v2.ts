import {
    type AssetDocumentBase,
    validateAssetDocument,
} from "../../core/assets/schema";
import { exactOfficialInvokeSurface, exactProjectInvokeSurface } from "../helpers/AssetIdentityTestUtils";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

const invokeSurface = exactOfficialInvokeSurface({
    surfaceId: "surface.console.log",
    moduleSpecifier: "@ohos.console",
    logicalDeclarationFile: "api/@ohos.console.d.ts",
    exportName: "console",
    ownerName: "console",
    methodName: "log",
    invokeKind: "static",
    parameterTypes: ["Object"],
    returnType: "void",
});

function validRuleAsset(): AssetDocumentBase {
    return stampAssetIdentities({
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
    });
}

function stampAssetIdentities<T extends AssetDocumentBase>(asset: T): T {
    const bySurfaceId = new Map<string, string>();
    for (const surface of asset.surfaces || []) {
        if (surface.canonicalApiId) {
            bySurfaceId.set(surface.surfaceId, surface.canonicalApiId);
        }
    }
    for (const binding of asset.bindings || []) {
        const canonicalApiId = bySurfaceId.get(binding.surfaceId);
        if (canonicalApiId) {
            binding.canonicalApiId = canonicalApiId;
        }
    }
    return asset;
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

    const restEndpointAsset = validRuleAsset();
    restEndpointAsset.surfaces[0] = exactOfficialInvokeSurface({
        surfaceId: "surface.console.log",
        moduleSpecifier: "@ohos.console",
        logicalDeclarationFile: "api/@ohos.console.d.ts",
        exportName: "console",
        ownerName: "console",
        methodName: "log",
        invokeKind: "static",
        parameterTypes: ["string", "rest:any[]"],
        returnType: "void",
    });
    restEndpointAsset.bindings[0].endpoint = { base: { kind: "rest", startIndex: 1 } } as any;
    (restEndpointAsset.effectTemplates[0] as any).value = { base: { kind: "rest", startIndex: 1 } };
    stampAssetIdentities(restEndpointAsset);
    expectValid(restEndpointAsset, "valid rest endpoint asset");

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
        exactOfficialInvokeSurface({
            surfaceId: "surface.request",
            moduleSpecifier: "@ohos.net.http",
            logicalDeclarationFile: "api/@ohos.net.http.d.ts",
            exportName: "request",
            ownerName: "http",
            methodName: "request",
            invokeKind: "free-function",
            parameterTypes: ["RequestOptions"],
            returnType: "Promise<HttpResponse>",
        }),
    ];
    freeFunctionAsset.bindings[0].surfaceId = "surface.request";
    stampAssetIdentities(freeFunctionAsset);
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
    stampAssetIdentities(optionCallbackAsset);
    expectValid(optionCallbackAsset, "option-object callback endpoint");

    const unstableInvoke = validRuleAsset();
    unstableInvoke.surfaces = [
        {
            ...invokeSurface,
            surfaceId: "surface.unknown",
            canonicalApiId: "api:official:openharmony:@unk/module",
        },
    ];
    unstableInvoke.bindings[0].surfaceId = "surface.unknown";
    stampAssetIdentities(unstableInvoke);
    expectInvalid(unstableInvoke, "must be a stable canonicalApiId", "unstable invoke surface");

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

    const missingHandoffCellKind: any = validRuleAsset();
    missingHandoffCellKind.plane = "module";
    missingHandoffCellKind.bindings[0].plane = "module";
    missingHandoffCellKind.bindings[0].role = "handoff";
    missingHandoffCellKind.bindings[0].semanticsFamily = "project-keyed-storage";
    missingHandoffCellKind.bindings[0].effectTemplateRefs = ["template.bad.handoff.missing.cellKind"];
    missingHandoffCellKind.effectTemplates = [
        {
            id: "template.bad.handoff.missing.cellKind",
            kind: "handoff.put",
            handle: {
                family: "project.storage_box",
                key: [{ kind: "fromLiteralArg", index: 0 }],
            },
            value: { base: { kind: "arg", index: 1 } },
        },
    ];
    stampAssetIdentities(missingHandoffCellKind);
    expectInvalid(
        missingHandoffCellKind,
        "cellKind is not a registered CellKindId",
        "handoff template without cellKind",
    );

    const unknownHandoffCellKind: any = validRuleAsset();
    unknownHandoffCellKind.plane = "module";
    unknownHandoffCellKind.bindings[0].plane = "module";
    unknownHandoffCellKind.bindings[0].role = "handoff";
    unknownHandoffCellKind.bindings[0].semanticsFamily = "project-keyed-storage";
    unknownHandoffCellKind.bindings[0].effectTemplateRefs = ["template.bad.handoff.unknown.cellKind"];
    unknownHandoffCellKind.effectTemplates = [
        {
            id: "template.bad.handoff.unknown.cellKind",
            kind: "handoff.put",
            handle: {
                cellKind: "route" as any,
                family: "project.storage_box",
                key: [{ kind: "fromLiteralArg", index: 0 }],
            },
            value: { base: { kind: "arg", index: 1 } },
        },
    ];
    stampAssetIdentities(unknownHandoffCellKind);
    expectInvalid(
        unknownHandoffCellKind,
        "cellKind is not a registered CellKindId",
        "handoff template with unknown cellKind",
    );

    const validModuleAsset: any = validRuleAsset();
    validModuleAsset.id = "asset.module.token-cache";
    validModuleAsset.plane = "module";
    validModuleAsset.bindings[0].assetId = validModuleAsset.id;
    validModuleAsset.bindings[0].plane = "module";
    validModuleAsset.bindings[0].role = "handoff";
    validModuleAsset.bindings[0].effectTemplateRefs = ["template.token-cache.put"];
    validModuleAsset.effectTemplates = [
        {
            id: "template.token-cache.put",
            kind: "handoff.put",
            handle: {
                cellKind: "keyed-semantic-slot",
                family: "project.token_cache",
                key: [{ kind: "fromLiteralArg", index: 0 }],
                precision: "exact",
            },
            value: { base: { kind: "arg", index: 1 } },
            updateStrength: "weak",
            confidence: "likely",
        },
    ];
    stampAssetIdentities(validModuleAsset);
    expectValid(validModuleAsset, "valid module handoff asset");

    const validPairedHandoffAsset: any = validRuleAsset();
    validPairedHandoffAsset.id = "asset.module.project-kvdb";
    validPairedHandoffAsset.plane = "module";
    validPairedHandoffAsset.surfaces = [
        exactProjectInvokeSurface({
            surfaceId: "surface.ProjectKv.put",
            modulePath: "project/storage/Kv.ets",
            ownerName: "ProjectKv",
            methodName: "put",
            invokeKind: "namespace",
            parameterTypes: ["string", "Object"],
            returnType: "void",
            confidence: "likely",
            provenanceSource: "llm-proposal",
        }),
        exactProjectInvokeSurface({
            surfaceId: "surface.ProjectKv.get",
            modulePath: "project/storage/Kv.ets",
            ownerName: "ProjectKv",
            methodName: "get",
            invokeKind: "namespace",
            parameterTypes: ["string"],
            returnType: "Object",
            confidence: "likely",
            provenanceSource: "llm-proposal",
        }),
    ];
    validPairedHandoffAsset.bindings = [
        {
            bindingId: "binding.ProjectKv.put",
            surfaceId: "surface.ProjectKv.put",
            assetId: validPairedHandoffAsset.id,
            plane: "module",
            role: "handoff",
            effectTemplateRefs: ["template.ProjectKv.put"],
            semanticsFamily: "project-keyed-storage",
            completeness: "partial",
            confidence: "likely",
        },
        {
            bindingId: "binding.ProjectKv.get",
            surfaceId: "surface.ProjectKv.get",
            assetId: validPairedHandoffAsset.id,
            plane: "module",
            role: "handoff",
            effectTemplateRefs: ["template.ProjectKv.get"],
            semanticsFamily: "project-keyed-storage",
            completeness: "partial",
            confidence: "likely",
        },
    ];
    validPairedHandoffAsset.effectTemplates = [
        {
            id: "template.ProjectKv.put",
            kind: "handoff.put",
            handle: {
                cellKind: "persistent-storage-slot",
                family: "project.kvdb",
                key: [{ kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } }],
                precision: "exact",
            },
            value: { base: { kind: "arg", index: 1 } },
            updateStrength: "weak",
            confidence: "likely",
        },
        {
            id: "template.ProjectKv.get",
            kind: "handoff.get",
            handle: {
                cellKind: "persistent-storage-slot",
                family: "project.kvdb",
                key: [{ kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } }],
                precision: "exact",
            },
            target: { base: { kind: "return" } },
            confidence: "likely",
        },
    ];
    stampAssetIdentities(validPairedHandoffAsset);
    expectValid(validPairedHandoffAsset, "valid paired module handoff asset");

    const sameSurfacePairedHandoff: any = JSON.parse(JSON.stringify(validModuleAsset));
    sameSurfacePairedHandoff.bindings[0].effectTemplateRefs = ["template.TokenCache.put", "template.TokenCache.get"];
    sameSurfacePairedHandoff.effectTemplates = [
        {
            id: "template.TokenCache.put",
            kind: "handoff.put",
            handle: {
                cellKind: "keyed-semantic-slot",
                family: "project.token_cache",
                key: [{ kind: "fromLiteralArg", index: 0 }],
                precision: "exact",
            },
            value: { base: { kind: "arg", index: 1 } },
            updateStrength: "weak",
        },
        {
            id: "template.TokenCache.get",
            kind: "handoff.get",
            handle: {
                cellKind: "keyed-semantic-slot",
                family: "project.other_token_cache",
                key: [{ kind: "fromLiteralArg", index: 0 }],
                precision: "exact",
            },
            target: { base: { kind: "return" } },
        },
    ];
    expectInvalid(
        sameSurfacePairedHandoff,
        "same handle.family",
        "paired handoff asset with mismatched families",
    );

    const unrelatedDifferentKeyFamily: any = JSON.parse(JSON.stringify(sameSurfacePairedHandoff));
    unrelatedDifferentKeyFamily.effectTemplates[1].handle.key = [
        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 }, accessPath: ["name"] } },
    ];
    expectValid(unrelatedDifferentKeyFamily, "different keyed handoff families are independent");

    const moduleWithRuleEffect: any = validRuleAsset();
    moduleWithRuleEffect.id = "asset.module.bad.rule-effect";
    moduleWithRuleEffect.plane = "module";
    moduleWithRuleEffect.bindings[0].assetId = moduleWithRuleEffect.id;
    moduleWithRuleEffect.bindings[0].plane = "module";
    expectInvalid(
        moduleWithRuleEffect,
        "rule.sink is not compatible with asset plane module",
        "module asset with rule effect",
    );

    const ruleWithHandoffEffect: any = validModuleAsset;
    ruleWithHandoffEffect.id = "asset.rule.bad.handoff-effect";
    ruleWithHandoffEffect.plane = "rule";
    ruleWithHandoffEffect.bindings[0].assetId = ruleWithHandoffEffect.id;
    ruleWithHandoffEffect.bindings[0].plane = "rule";
    expectInvalid(
        ruleWithHandoffEffect,
        "handoff.put is not compatible with asset plane rule",
        "rule asset with handoff effect",
    );

    const bindingPlaneMismatch: any = validRuleAsset();
    bindingPlaneMismatch.bindings[0].plane = "module";
    expectInvalid(
        bindingPlaneMismatch,
        "plane must match asset plane rule",
        "binding plane mismatch",
    );

    const selectorAsset: any = validRuleAsset();
    selectorAsset.bindings[0].selector = {
        kind: ["method", "name", "equals"].join("-"),
        value: "log",
    };
    expectInvalid(selectorAsset, "selector is not an asset identity field", "runtime selector field");

    const candidateWithoutCanonical: any = validRuleAsset();
    candidateWithoutCanonical.status = "candidate";
    delete candidateWithoutCanonical.surfaces[0].canonicalApiId;
    delete candidateWithoutCanonical.bindings[0].canonicalApiId;
    expectInvalid(candidateWithoutCanonical, "canonicalApiId is required", "candidate without canonical identity");

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
