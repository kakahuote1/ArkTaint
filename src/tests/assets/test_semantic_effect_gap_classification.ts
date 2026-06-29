import { ApiEffectRuntimeIndex } from "../../core/api/effects/ApiEffectRuntimeIndex";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function descriptor(canonicalApiId: string, returnType: string, parameterTypes: string[] = []): any {
    return {
        canonicalApiId,
        authority: "official",
        domain: "openharmony",
        moduleSpecifier: "@test/api",
        logicalDeclarationFile: "api/@test.api.d.ts",
        exportPath: [{ kind: "namespace", name: "testApi" }],
        declarationOwner: { kind: "namespace", path: ["testApi"], normalizedName: "testApi" },
        member: { kind: "function", name: "call" },
        invoke: { kind: "call" },
        signature: {
            parameters: parameterTypes.map((text, index) => ({ index, type: { text } })),
            returnType: { text: returnType },
        },
        provenance: {
            source: "official-declaration",
            declarationLocations: [{ file: "api/@test.api.d.ts" }],
        },
    };
}

function rawOccurrence(id: string, options: { resultText?: string; argCount?: number } = {}): any {
    return {
        rawOccurrenceId: `raw:${id}`,
        kind: "invoke",
        sourceLocation: { file: "Demo.ets", line: 10, column: 5 },
        enclosingMethodSignature: "Demo.main()",
        statementText: `test.${id}()`,
        ir: {
            unknownSignature: false,
            resultText: options.resultText,
            resultUseKind: options.resultText ? "assignment" : undefined,
            argCount: options.argCount || 0,
        },
    };
}

function acceptedOccurrence(id: string, canonicalApiId: string): any {
    return {
        occurrenceId: `occ:${id}`,
        rawOccurrenceId: `raw:${id}`,
        status: "accepted",
        canonicalApiId,
        resolutionKind: "import-member",
        reason: "accepted_exact_fixture",
        evidence: [],
    };
}

function unresolvedOccurrence(id: string, candidates: string[]): any {
    return {
        occurrenceId: `occ:${id}`,
        rawOccurrenceId: `raw:${id}`,
        status: "unresolved",
        reason: "fixture_identity_not_recovered",
        candidates,
        evidence: [],
    };
}

function ambiguousOccurrence(id: string, candidates: string[]): any {
    return {
        occurrenceId: `occ:${id}`,
        rawOccurrenceId: `raw:${id}`,
        status: "ambiguous",
        reason: "fixture_ambiguous_candidates",
        candidates,
        evidence: [],
    };
}

function sinkTemplate(id: string): any {
    return {
        id,
        kind: "rule.sink",
        value: { base: { kind: "arg", index: 0 } },
        sinkKind: "fixture",
        confidence: "certain",
    };
}

function sinkBinding(canonicalApiId: string, options: { templateRefs?: string[] } = {}): any {
    return {
        bindingId: `binding:${canonicalApiId}`,
        surfaceId: `surface:${canonicalApiId}`,
        assetId: `asset:${canonicalApiId}`,
        plane: "rule",
        role: "sink",
        canonicalApiId,
        endpoint: { base: { kind: "arg", index: 0 } },
        effectTemplateRefs: options.templateRefs === undefined ? ["template:sink"] : options.templateRefs,
        completeness: "complete",
        confidence: "certain",
    };
}

function assetWithBinding(canonicalApiId: string, binding: any = sinkBinding(canonicalApiId)): any {
    return {
        id: binding.assetId,
        plane: "rule",
        status: "official",
        surfaces: [{
            surfaceId: binding.surfaceId,
            kind: "invoke",
            canonicalApiId,
            confidence: "certain",
            provenance: { source: "manual" },
        }],
        bindings: [binding],
        effectTemplates: [],
        provenance: { source: "builtin" },
    };
}

function buildIndex(input: {
    descriptors: any[];
    bindings?: Record<string, any[]>;
    surfaces?: Record<string, any[]>;
    templates?: Record<string, any>;
    assets?: any[];
}): any {
    const descriptorsById = new Map(input.descriptors.map(item => [item.canonicalApiId, item]));
    const assetIdentityIndex = {
        findBindings: (canonicalApiId: string) => input.bindings?.[canonicalApiId] || [],
        findSurfaces: (canonicalApiId: string) => input.surfaces?.[canonicalApiId] || [],
        getTemplate: (templateId: string) => input.templates?.[templateId],
    };
    const canonicalApiRegistry = {
        listDescriptors: () => [...input.descriptors],
        get: (canonicalApiId: string) => descriptorsById.get(canonicalApiId),
        has: (canonicalApiId: string) => descriptorsById.has(canonicalApiId),
    };
    return ApiEffectRuntimeIndex.build({
        scene: { getMethods: () => [] } as any,
        assets: input.assets || [],
        assetIdentityIndex: assetIdentityIndex as any,
        canonicalApiRegistry: canonicalApiRegistry as any,
    });
}

function recordAccepted(index: any, raw: any, resolved: any): void {
    index.recordAcceptedOccurrenceEffectBindings({
        raw,
        resolved,
        attachRuntimeSite: false,
    });
}

function gapRows(index: any): any[] {
    return index.listSemanticEffectLedger().filter((row: any) => row.recordKind === "semantic_effect_gap");
}

function main(): void {
    const noFlowId = "api:official:openharmony:module=%40test.api:file=api%2F%40test.api.d.ts:export=namespace%3AtestApi:decl=namespace%3AtestApi:member=function%3AcreateHandle:invoke=call:params=none:ret=Handle";
    const noFlow = buildIndex({
        descriptors: [descriptor(noFlowId, "Handle")],
    });
    recordAccepted(noFlow, rawOccurrence("createHandle", { resultText: "handle" }), acceptedOccurrence("createHandle", noFlowId));
    const noFlowGaps = gapRows(noFlow);
    assert(noFlow.listSemanticEffectSites().length === 0, "accepted no-flow API must not inject a semantic effect site");
    assert(noFlowGaps.length === 1, "accepted no-flow API should have one explicit gap row");
    assert(noFlowGaps[0].reasonCode === "no_flow_api", `expected no_flow_api, got ${noFlowGaps[0].reasonCode}`);
    assert(noFlowGaps[0].diagnosticDetails.consumerStatus === "non_consumer", "no-flow gap should be marked non-consumer");
    assert(noFlowGaps[0].occurrenceId === "occ:createHandle", "no-flow gap should retain occurrenceId");

    const templateGapId = "api:official:openharmony:module=%40test.api:file=api%2F%40test.api.d.ts:export=namespace%3AtestApi:decl=namespace%3AtestApi:member=function%3Asend:invoke=call:params=0%3Astring:ret=void";
    const unresolvedTemplateBinding = sinkBinding(templateGapId, { templateRefs: ["template:missing"] });
    const templateGap = buildIndex({
        descriptors: [descriptor(templateGapId, "void", ["string"])],
        bindings: { [templateGapId]: [unresolvedTemplateBinding] },
    });
    recordAccepted(templateGap, rawOccurrence("send", { argCount: 1 }), acceptedOccurrence("send", templateGapId));
    const templateGaps = gapRows(templateGap);
    assert(templateGap.listSemanticEffectSites().length === 0, "unresolved template must not inject a semantic effect site");
    assert(templateGaps.length === 1, "unresolved template should have one explicit gap row");
    assert(templateGaps[0].reasonCode === "template_ref_unresolved", `expected template_ref_unresolved, got ${templateGaps[0].reasonCode}`);
    assert(templateGaps[0].bindingId === unresolvedTemplateBinding.bindingId, "template gap should retain bindingId");
    assert(templateGaps[0].diagnosticDetails.template.id === "template:missing", "template gap should retain unresolved template ref");

    const unusedAssetId = "api:official:openharmony:module=%40test.api:file=api%2F%40test.api.d.ts:export=namespace%3AtestApi:decl=namespace%3AtestApi:member=function%3Aunused:invoke=call:params=0%3Astring:ret=void";
    const unusedBinding = sinkBinding(unusedAssetId);
    const unusedIndex = buildIndex({
        descriptors: [descriptor(unusedAssetId, "void", ["string"])],
        templates: { "template:sink": sinkTemplate("template:sink") },
        assets: [assetWithBinding(unusedAssetId, unusedBinding)],
    });
    assert(
        !gapRows(unusedIndex).some(row => row.gapKind === "effect_asset_without_accepted_occurrence"),
        "asset not used by the project must not be emitted as an effect gap",
    );

    const identityGapId = "api:official:openharmony:module=%40test.api:file=api%2F%40test.api.d.ts:export=namespace%3AtestApi:decl=namespace%3AtestApi:member=function%3AunresolvedSend:invoke=call:params=0%3Astring:ret=void";
    const identityBinding = sinkBinding(identityGapId);
    const identityGap = buildIndex({
        descriptors: [descriptor(identityGapId, "void", ["string"])],
        templates: { "template:sink": sinkTemplate("template:sink") },
        assets: [assetWithBinding(identityGapId, identityBinding)],
    });
    identityGap.resolvedOccurrences.push(unresolvedOccurrence("unresolvedSend", [identityGapId]));
    const identityRows = gapRows(identityGap);
    assert(identityGap.listSemanticEffectSites().length === 0, "unresolved occurrence must not inject a semantic effect site");
    assert(identityRows.length === 1, "identity-not-recovered asset should have one gap row");
    assert(identityRows[0].reasonCode === "identity_not_recovered", `expected identity_not_recovered, got ${identityRows[0].reasonCode}`);

    const ambiguousGapId = "api:official:openharmony:module=%40test.api:file=api%2F%40test.api.d.ts:export=namespace%3AtestApi:decl=namespace%3AtestApi:member=function%3AambiguousSend:invoke=call:params=0%3Astring:ret=void";
    const ambiguousBinding = sinkBinding(ambiguousGapId);
    const ambiguousGap = buildIndex({
        descriptors: [descriptor(ambiguousGapId, "void", ["string"])],
        templates: { "template:sink": sinkTemplate("template:sink") },
        assets: [assetWithBinding(ambiguousGapId, ambiguousBinding)],
    });
    ambiguousGap.resolvedOccurrences.push(ambiguousOccurrence("ambiguousSend", [ambiguousGapId, `${ambiguousGapId}:overload`]));
    const ambiguousRows = gapRows(ambiguousGap);
    assert(ambiguousGap.listSemanticEffectSites().length === 0, "ambiguous occurrence must not inject a semantic effect site");
    assert(ambiguousRows.length === 1, "ambiguous asset candidate should have one gap row");
    assert(ambiguousRows[0].reasonCode === "mirror_or_overload_conflict", `expected mirror_or_overload_conflict, got ${ambiguousRows[0].reasonCode}`);

    console.log("PASS test_semantic_effect_gap_classification");
}

main();
