import { runSemanticFlowPipeline } from "../../core/semanticflow/SemanticFlowPipeline";
import type {
    SemanticFlowAnchor,
    SemanticFlowDecider,
    SemanticFlowExpander,
    SemanticFlowSlicePackage,
} from "../../core/semanticflow/SemanticFlowTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function makeAnchor(index: number): SemanticFlowAnchor {
    return {
        id: `anchor-${index}`,
        surface: `Owner.method${index}`,
        methodSignature: `Owner.method${index}(): void`,
    };
}

function makeSlice(anchorId: string): SemanticFlowSlicePackage {
    return {
        anchorId,
        round: 0,
        template: "owner-slot",
        observations: [`observation for ${anchorId}`],
        snippets: [],
    };
}

async function main(): Promise<void> {
    let calls = 0;
    const decider: SemanticFlowDecider = {
        async decide() {
            calls++;
            if (calls <= 3) {
                throw new Error("fetch failed");
            }
            throw new Error("semanticflow LLM circuit open after 3 consecutive failures");
        },
    };
    const expander: SemanticFlowExpander = {
        async expand() {
            throw new Error("unexpected expansion after provider failure");
        },
    };

    const items = Array.from({ length: 6 }, (_, i) => {
        const anchor = makeAnchor(i);
        return {
            anchor,
            initialSlice: makeSlice(anchor.id),
        };
    });

    const result = await runSemanticFlowPipeline(items, decider, expander, {
        concurrency: 1,
        maxRounds: 1,
    });

    assert(result.items.length === 6, `expected 6 item results, got ${result.items.length}`);
    assert(calls === 4, `expected decider to stop after circuit-open item, got ${calls} calls`);
    assert(result.items.slice(0, 3).every(item => item.error === "fetch failed"), "first three items should retain fetch failed errors");
    assert(/semanticflow LLM circuit open/i.test(result.items[3].error || ""), "fourth item should record circuit-open error");
    for (const item of result.items.slice(4)) {
        assert(item.resolution === "need-human-check", `skipped item should remain bounded need-human-check, got ${item.resolution}`);
        assert(/provider unavailable after circuit open/.test(item.error || ""), `missing provider-unavailable diagnostic: ${item.error}`);
        assert(item.history.length === 1, "skipped item should have one diagnostic history record");
    }

    console.log("PASS test_semanticflow_provider_circuit");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_provider_circuit");
    console.error(error);
    process.exit(1);
});
