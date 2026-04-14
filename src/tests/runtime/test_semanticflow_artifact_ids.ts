import {
    buildSemanticFlowArtifact,
    buildSemanticFlowAnalysisAugment,
} from "../../core/semanticflow/SemanticFlowArtifacts";
import type { SemanticFlowItemResult, SemanticFlowSummary } from "../../core/semanticflow/SemanticFlowTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function transferSummary(): SemanticFlowSummary {
    return {
        inputs: [{ slot: "arg", index: 0 }],
        outputs: [{ slot: "result" }],
        transfers: [{ from: { slot: "arg", index: 0 }, to: { slot: "result" }, relation: "direct" }],
        confidence: "high",
        ruleKind: "transfer",
    };
}

function bridgeSummary(): SemanticFlowSummary {
    return {
        inputs: [{ surface: "publish", slot: "arg", index: 1 }],
        outputs: [{ surface: "bind", slot: "callback_param", callbackArgIndex: 0, paramIndex: 0 }],
        transfers: [{
            from: { surface: "publish", slot: "arg", index: 1 },
            to: { surface: "bind", slot: "callback_param", callbackArgIndex: 0, paramIndex: 0 },
            relation: "deferred",
        }],
        confidence: "high",
        moduleKind: "deferred",
        relations: {
            trigger: {
                preset: "callback_event",
            },
        },
    };
}

async function main(): Promise<void> {
    const ruleA = buildSemanticFlowArtifact({
        id: "rule.alpha.cloneValue",
        owner: "AlphaPipe",
        surface: "cloneValue",
        methodSignature: "@a: AlphaPipe.cloneValue(string)",
    }, transferSummary(), "rule");
    const ruleB = buildSemanticFlowArtifact({
        id: "rule.beta.cloneValue",
        owner: "BetaPipe",
        surface: "cloneValue",
        methodSignature: "@b: BetaPipe.cloneValue(string)",
    }, transferSummary(), "rule");

    assert(ruleA.kind === "rule" && ruleB.kind === "rule", "expected rule artifacts");
    const ruleAId = ruleA.ruleSet.transfers[0]?.id;
    const ruleBId = ruleB.ruleSet.transfers[0]?.id;
    assert(ruleAId !== ruleBId, `same-surface rules must not share ids: ${ruleAId}`);

    const moduleA = buildSemanticFlowArtifact({
        id: "module.alpha.publish",
        owner: "AlphaBus",
        surface: "publish",
    }, bridgeSummary(), "module");
    const moduleB = buildSemanticFlowArtifact({
        id: "module.beta.publish",
        owner: "BetaBus",
        surface: "publish",
    }, bridgeSummary(), "module");

    assert(moduleA.kind === "module" && moduleB.kind === "module", "expected module artifacts");
    assert(moduleA.moduleSpec.id !== moduleB.moduleSpec.id, "same-surface inferred modules must not share ids");

    const merged = buildSemanticFlowAnalysisAugment([
        {
            anchor: { id: "dup.rule", surface: "cloneValue", methodSignature: "@a: AlphaPipe.cloneValue(string)" },
            classification: "rule",
            resolution: "resolved",
            summary: transferSummary(),
            artifact: ruleA,
            finalSlice: { anchorId: "dup.rule", round: 0, template: "call-return", observations: [], snippets: [] },
            history: [],
        } satisfies SemanticFlowItemResult,
        {
            anchor: { id: "dup.rule.copy", surface: "cloneValue", methodSignature: "@a: AlphaPipe.cloneValue(string)" },
            classification: "rule",
            resolution: "resolved",
            summary: transferSummary(),
            artifact: ruleA,
            finalSlice: { anchorId: "dup.rule.copy", round: 0, template: "call-return", observations: [], snippets: [] },
            history: [],
        } satisfies SemanticFlowItemResult,
    ]);

    assert(merged.ruleSet.transfers.length === 1, `duplicate rule ids should dedupe, got ${merged.ruleSet.transfers.length}`);

    console.log("PASS test_semanticflow_artifact_ids");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_artifact_ids");
    console.error(error);
    process.exit(1);
});
