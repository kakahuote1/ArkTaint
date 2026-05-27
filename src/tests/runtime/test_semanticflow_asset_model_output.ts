import { parseSemanticFlowAssetModelOutput } from "../../core/semanticflow/SemanticFlowAssetModelOutput";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function expectThrows(fn: () => unknown, contains: string): void {
    try {
        fn();
    } catch (error) {
        const text = String((error as any)?.message || error);
        assert(text.includes(contains), `expected "${contains}", got "${text}"`);
        return;
    }
    throw new Error(`expected error containing "${contains}"`);
}

function validAssetOutput(): any {
    return {
        status: "done",
        asset: {
            id: "asset.project.token-cache",
            plane: "module",
            status: "llm-generated",
            surfaces: [
                {
                    surfaceId: "surface.TokenCache.save",
                    kind: "invoke",
                    modulePath: "project/TokenCache",
                    ownerName: "TokenCache",
                    methodName: "save",
                    invokeKind: "static",
                    argCount: 2,
                    confidence: "likely",
                    provenance: {
                        source: "llm-proposal",
                        location: { file: "TokenCache.ets", line: 3 },
                    },
                },
            ],
            bindings: [
                {
                    bindingId: "binding.TokenCache.save.handoff",
                    surfaceId: "surface.TokenCache.save",
                    assetId: "asset.project.token-cache",
                    plane: "module",
                    role: "handoff",
                    endpoint: { base: { kind: "arg", index: 1 } },
                    effectTemplateRefs: ["template.TokenCache.save.put"],
                    completeness: "partial",
                    confidence: "likely",
                },
            ],
            effectTemplates: [
                {
                    id: "template.TokenCache.save.put",
                    kind: "handoff.put",
                    handle: {
                        cellKind: "keyed-semantic-slot",
                        family: "project.token_cache",
                        key: [{ kind: "fromLiteralArg", index: 0 }],
                    },
                    value: { base: { kind: "arg", index: 1 } },
                    updateStrength: "infer",
                    confidence: "likely",
                },
            ],
            provenance: {
                source: "llm",
                projectId: "project-a",
            },
        },
        rationale: ["TokenCache.save stores arg1 under key arg0."],
    };
}

function main(): void {
    const parsed = parseSemanticFlowAssetModelOutput(JSON.stringify(validAssetOutput()));
    assert(parsed.status === "done", "expected done asset output");
    assert(parsed.asset.effectTemplates?.[0]?.kind === "handoff.put", "expected handoff put template");

    const needMore = parseSemanticFlowAssetModelOutput(JSON.stringify({
        status: "need-more-evidence",
        request: {
            kind: "q_effect",
            why: ["reader surface is missing"],
            ask: "show TokenCache.load body",
        },
    }));
    assert(needMore.status === "need-more-evidence", "expected need-more-evidence output");
    assert(needMore.request.kind === "q_effect", "expected q_effect request");

    expectThrows(() => parseSemanticFlowAssetModelOutput(JSON.stringify({
        status: "done",
        classification: "module",
        resolution: "resolved",
        summary: {},
    })), "legacy semanticflow output field");

    const missingTemplate = validAssetOutput();
    missingTemplate.asset.effectTemplates = [];
    expectThrows(() => parseSemanticFlowAssetModelOutput(JSON.stringify(missingTemplate)), "references missing template");

    const coreCapability = validAssetOutput();
    coreCapability.asset.effectTemplates = [
        {
            id: "template.bad.core",
            kind: "core.capability",
            capability: "bad",
            payload: {},
        },
    ];
    coreCapability.asset.bindings[0].effectTemplateRefs = ["template.bad.core"];
    expectThrows(() => parseSemanticFlowAssetModelOutput(JSON.stringify(coreCapability)), "LLM assets must not declare core.capability");

    const promotedByLlm = validAssetOutput();
    promotedByLlm.asset.status = "official";
    expectThrows(() => parseSemanticFlowAssetModelOutput(JSON.stringify(promotedByLlm)), "LLM output cannot publish");

    const schemaValidWithoutAnchor = validAssetOutput();
    schemaValidWithoutAnchor.asset.status = "schema-valid";
    schemaValidWithoutAnchor.asset.provenance.source = "manual";
    expectThrows(() => parseSemanticFlowAssetModelOutput(JSON.stringify(schemaValidWithoutAnchor)), "is not analyzer-backed");

    const schemaValidWithAnchor = parseSemanticFlowAssetModelOutput(JSON.stringify(schemaValidWithoutAnchor), {
        analyzerBackedSurfaceIds: new Set(["surface.TokenCache.save"]),
    });
    assert(schemaValidWithAnchor.status === "done", "schema-valid manual asset should parse with analyzer anchor");

    console.log("PASS test_semanticflow_asset_model_output");
}

main();
