import { parseSemanticFlowDecision } from "../../core/semanticflow/SemanticFlowLlm";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const decision = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: ["ret"],
            transfers: ["arg0 -> ret"],
            confidence: "high",
            ruleKind: "transfer",
        },
    }));

    assert(decision.status === "done", `unexpected status: ${(decision as any).status}`);
    assert(decision.classification === "rule", `unexpected classification: ${decision.classification}`);
    assert(decision.summary.inputs.length === 1, "expected one input");
    assert(decision.summary.inputs[0].slot === "arg" && decision.summary.inputs[0].index === 0, "expected arg0 input");
    assert(decision.summary.outputs.length === 1, "expected one output");
    assert(decision.summary.outputs[0].slot === "result", "expected ret output");
    assert(decision.summary.transfers.length === 1, "expected one transfer");
    assert(decision.summary.transfers[0].relation === undefined, "direct shorthand should not force relation");
    assert(decision.summary.transfers[0].from.slot === "arg" && decision.summary.transfers[0].from.index === 0, "expected arg0 source");
    assert(decision.summary.transfers[0].to.slot === "result", "expected ret target");
    const proseWrapped = parseSemanticFlowDecision(`模型判断如下：
{"status":"done","classification":"rule","resolution":"resolved","summary":{"inputs":["arg0"],"outputs":["ret"],"transfers":["arg0 -> ret"],"confidence":"high","ruleKind":"transfer"},"rationale":["valid json embedded in prose"]}
以上为结果。`);
    assert(proseWrapped.status === "done", "expected prose-wrapped JSON to parse");
    assert(proseWrapped.summary.transfers.length === 1, "expected prose-wrapped transfer");

    const invalidPayloads = [
        {
            status: "done",
            classification: "transfer",
            resolution: "resolved",
            summary: {
                inputs: [],
                outputs: ["ret"],
                transfers: [],
                confidence: "high",
            },
        },
        {
            status: "done",
            classificationHint: "rule",
            resolution: "resolved",
            summary: {
                inputs: [],
                outputs: ["ret"],
                transfers: [],
                confidence: "high",
            },
        },
        {
            status: "done",
            class: "rule",
            resolution: "resolved",
            summary: {
                inputs: [],
                outputs: ["ret"],
                transfers: [],
                confidence: "high",
            },
        },
        {
            status: "done",
            classification: "arkmain",
            resolution: "resolved",
            summary: {
                inputs: ["arg0"],
                outputs: [],
                transfers: [],
                confidence: "high",
                relations: {
                    entryPattern: "bootstrap ability_lifecycle",
                },
            },
        },
        {
            status: "done",
            classification: "rule",
            resolution: "resolved",
            summary: {
                inputs: ["arg0"],
                outputs: ["ret"],
                transfers: ["companion:set.arg1 -> ret"],
                confidence: "high",
                ruleKind: "transfer",
            },
        },
        {
            status: "done",
            classification: "rule",
            resolution: "resolved",
            summary: {
                inputs: [],
                outputs: ["ret"],
                transfers: [".arg0 -> ret"],
                confidence: "high",
                ruleKind: "transfer",
            },
        },
    ];
    for (const payload of invalidPayloads) {
        let failed = false;
        try {
            parseSemanticFlowDecision(JSON.stringify(payload));
        } catch {
            failed = true;
        }
        assert(failed, `expected payload to be rejected: ${JSON.stringify(payload)}`);
    }

    console.log("PASS test_semanticflow_llm_shorthand");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_llm_shorthand");
    console.error(error);
    process.exit(1);
});
