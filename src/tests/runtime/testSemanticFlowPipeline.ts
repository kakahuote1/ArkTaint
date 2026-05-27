import { runSemanticFlowSession } from "../../core/semanticflow/SemanticFlowPipeline";
import type { SemanticFlowDecider, SemanticFlowExpander, SemanticFlowSlicePackage } from "../../core/semanticflow/SemanticFlowTypes";
import { assert, makeRuleAsset } from "./SemanticFlowV2TestHelpers";

function initialSlice(): SemanticFlowSlicePackage {
    return {
        anchorId: "anchor:Logger.info",
        round: 0,
        template: "call-return",
        observations: [],
        snippets: [{ label: "callsite", code: "Logger.info(token)" }],
    };
}

async function main(): Promise<void> {
    const asset = makeRuleAsset();
    const decider: SemanticFlowDecider = {
        async decide() {
            return { status: "done", asset };
        },
    };
    const expander: SemanticFlowExpander = {
        async expand(input) {
            return {
                slice: input.slice,
                delta: {
                    id: "delta",
                    effective: false,
                    newObservations: [],
                    newSnippets: [],
                    newCompanions: [],
                },
            };
        },
    };
    const session = await runSemanticFlowSession([
        {
            anchor: { id: "anchor:Logger.info", surface: "Logger.info" },
            initialSlice: initialSlice(),
        },
    ], decider, expander, { maxRounds: 1 });
    const item = session.run.items[0];
    assert(item.resolution === "resolved", "expected resolved item");
    assert(item.plane === "rule", "expected plane from asset");
    assert(session.augment.assets.length === 1, "expected v2 asset augment");
    assert(session.augment.ruleSet.sinks.length === 0, "llm-generated asset must not lower into analysis rules before promotion");
    assert(!("classification" in item), "pipeline item must not expose legacy classification");
    console.log("PASS testSemanticFlowPipeline");
}

main().catch(error => {
    console.error("FAIL testSemanticFlowPipeline");
    console.error(error);
    process.exitCode = 1;
});
