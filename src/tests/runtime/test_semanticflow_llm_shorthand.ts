import { parseSemanticFlowAssetDecision } from "../../core/semanticflow/SemanticFlowLlm";
import { buildSemanticFlowPrompt } from "../../core/semanticflow/SemanticFlowPrompt";
import { assert, expectThrows, makeHandoffAsset, makeRuleAsset } from "./SemanticFlowV2TestHelpers";

function main(): void {
    const ruleDecision = parseSemanticFlowAssetDecision(JSON.stringify({
        status: "done",
        asset: makeRuleAsset(),
        rationale: ["Logger.info sends arg0 to logging sink."],
    }), {
        analyzerBackedSurfaceIds: new Set(["asset.project.logger.sink.surface"]),
    });
    assert(ruleDecision.status === "done", "expected rule asset decision");
    assert(ruleDecision.asset.bindings[0].role === "sink", "expected sink binding");

    const handoffDecision = parseSemanticFlowAssetDecision(JSON.stringify({
        status: "done",
        asset: makeHandoffAsset(),
    }), {
        analyzerBackedSurfaceIds: new Set(["asset.project.token-cache.save.surface"]),
    });
    assert(handoffDecision.status === "done", "expected module asset decision");
    assert(handoffDecision.asset.effectTemplates?.[0]?.kind === "handoff.put", "expected handoff put template");

    const prompt = buildSemanticFlowPrompt({
        anchor: { id: "anchor", surface: "Logger.info" },
        draftId: "draft",
        slice: {
            anchorId: "anchor",
            round: 0,
            template: "call-return",
            observations: [],
            snippets: [],
        },
        round: 0,
        history: [],
    });
    const combinedPrompt = `${prompt.system}\n${prompt.user}`;
    assert(!combinedPrompt.includes("classification"), "prompt must not ask for legacy classification");
    assert(combinedPrompt.includes("effectTemplates"), "prompt must ask for declarative effectTemplates");
    assert(
        combinedPrompt.includes("Every rule.sink effect template must include a non-empty sinkKind"),
        "prompt must require sinkKind on rule.sink templates",
    );

    expectThrows(() => parseSemanticFlowAssetDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        resolution: "resolved",
        summary: { sinks: [] },
    })), "legacy semanticflow output field");

    console.log("PASS test_semanticflow_llm_shorthand");
}

main();
