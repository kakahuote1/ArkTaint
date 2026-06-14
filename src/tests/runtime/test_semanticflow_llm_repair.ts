import { createSemanticFlowLlmDecider, parseSemanticFlowAssetDecision } from "../../core/semanticflow/SemanticFlowLlm";
import type { SemanticFlowDecisionInput } from "../../core/semanticflow/SemanticFlowTypes";
import { assert, expectThrows, makeHandoffAsset } from "./SemanticFlowV2TestHelpers";

async function main(): Promise<void> {
    const decision = parseSemanticFlowAssetDecision(JSON.stringify({
        status: "done",
        asset: makeHandoffAsset(),
        rationale: ["TokenCache.save publishes arg1 under arg0."],
    }), {
        analyzerBackedSurfaceIds: new Set(["asset.project.token-cache.save.surface"]),
    });
    assert(decision.status === "done", "expected v2 asset decision");
    assert(decision.asset.plane === "module", "expected module plane");

    const normalizedObjectField = parseSemanticFlowAssetDecision(JSON.stringify({
        status: "done",
        asset: makeObjectFieldHandoffShorthandAsset(),
    }));
    assert(normalizedObjectField.status === "done", "expected object-field shorthand to normalize to a v2 asset");
    if (normalizedObjectField.status === "done") {
        const handle = (normalizedObjectField.asset.effectTemplates[0] as any).handle;
        assert(handle.key[0].kind === "const" && handle.key[0].value === "appIndex", "string handle key should normalize to const key part");
        assert(handle.scope === undefined, "empty optional handle scope should be omitted");
        assert(handle.owner[0].kind === "const" && handle.owner[0].value === "DMPWebViewProxy", "string handle owner should normalize to const key part");
        assert(handle.precision === "infer", "missing handle precision should normalize to infer");
        assert((normalizedObjectField.asset.bindings[0] as any).completeness === "partial", "incomplete binding completeness should normalize to partial");
        assert((normalizedObjectField.asset.bindings[0] as any).endpoint.accessPath === undefined, "empty endpoint accessPath should be omitted");
        assert((normalizedObjectField.asset.effectTemplates[0] as any).value.accessPath === undefined, "empty value accessPath should be omitted");
    }

    expectThrows(() => parseSemanticFlowAssetDecision(JSON.stringify({
        status: "done",
        classification: "module",
        summary: {},
    })), "legacy semanticflow output field");

    const invalid = makeHandoffAsset("asset.project.repair-token-cache");
    invalid.bindings[0].completeness = "likely" as never;
    const repaired = makeHandoffAsset("asset.project.repair-token-cache");
    let calls = 0;
    const decider = createSemanticFlowLlmDecider({
        model: "mock",
        maxRepairAttempts: 1,
        modelInvoker: async input => {
            calls++;
            if (calls === 1) {
                assert(input.user.includes("anchorId: anchor.repair"), "initial request should contain the original slice");
                return JSON.stringify({ status: "done", asset: invalid });
            }
            assert(input.user.includes("validationError:"), "repair request should include validator feedback");
            return JSON.stringify({ status: "done", asset: repaired });
        },
    });
    const repairedDecision = await decider.decide(makeDecisionInput());
    assert(calls === 2, `expected one initial LLM call and one repair call, got ${calls}`);
    assert(repairedDecision.status === "done", "expected repaired decision to parse as done");
    assert(repairedDecision.status === "done" && repairedDecision.asset.bindings[0].completeness === "partial", "expected repaired asset to preserve valid completeness");

    console.log("PASS test_semanticflow_llm_repair");
}

function makeDecisionInput(): SemanticFlowDecisionInput {
    return {
        anchor: {
            id: "anchor.repair",
            surface: "TokenCache.save",
            methodSignature: "@project/TokenCache: TokenCache.save(string, string)",
            filePath: "TokenCache.ets",
        },
        draftId: "draft.repair",
        slice: {
            anchorId: "anchor.repair",
            round: 0,
            template: "multi-surface",
            observations: ["TokenCache.save stores arg1 under arg0."],
            snippets: [{ label: "method", code: "save(key: string, value: string) { this.map.set(key, value); }" }],
        },
        round: 0,
        history: [],
    };
}

function makeObjectFieldHandoffShorthandAsset(): any {
    return {
        id: "project.DMPWebViewProxy.appIndex.handoff",
        plane: "module",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: "surface.construct.DMPWebViewProxy",
                kind: "construct",
                modulePath: "dimina/src/main/ets/HybridContainer/DMPWebViewProxy.ets",
                className: "DMPWebViewProxy",
                argCount: 2,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "DMPWebViewProxy.ets", line: 17 } },
            },
            {
                surfaceId: "surface.invoke.DMPWebViewProxy.invoke",
                kind: "invoke",
                modulePath: "dimina/src/main/ets/HybridContainer/DMPWebViewProxy.ets",
                ownerName: "DMPWebViewProxy",
                methodName: "invoke",
                invokeKind: "instance",
                argCount: 1,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "DMPWebViewProxy.ets", line: 22 } },
            },
        ],
        bindings: [
            {
                bindingId: "binding.construct.appIndex.put",
                surfaceId: "surface.construct.DMPWebViewProxy",
                assetId: "project.DMPWebViewProxy.appIndex.handoff",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 1 }, accessPath: [] },
                effectTemplateRefs: ["template.construct.appIndex.put"],
                semanticsFamily: "project.dmp_webview_proxy",
                completeness: "incomplete",
                confidence: "likely",
            },
            {
                bindingId: "binding.invoke.appIndex.get",
                surfaceId: "surface.invoke.DMPWebViewProxy.invoke",
                assetId: "project.DMPWebViewProxy.appIndex.handoff",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["appIndex"] },
                effectTemplateRefs: ["template.invoke.appIndex.get"],
                semanticsFamily: "project.dmp_webview_proxy",
                completeness: "incomplete",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.construct.appIndex.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "object-field",
                    family: "project.dmp_webview_proxy",
                    key: ["appIndex"],
                    scope: [],
                    owner: "DMPWebViewProxy",
                    precision: "field-exact",
                },
                value: { base: { kind: "arg", index: 1 }, accessPath: [] },
                updateStrength: "weak",
                confidence: "likely",
            },
            {
                id: "template.invoke.appIndex.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "object-field",
                    family: "project.dmp_webview_proxy",
                    key: ["appIndex"],
                    scope: [],
                    owner: "DMPWebViewProxy",
                },
                target: { base: { kind: "receiver" }, accessPath: ["appIndex"] },
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "dimina",
            evidenceLocations: [{ file: "dimina/src/main/ets/HybridContainer/DMPWebViewProxy.ets", line: 17 }],
        },
    };
}

main().catch(error => {
    console.error("FAIL test_semanticflow_llm_repair");
    console.error(error);
    process.exitCode = 1;
});
