import { createSemanticFlowLlmDecider } from "../../core/semanticflow/SemanticFlowLlm";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const calls: string[] = [];
    const decider = createSemanticFlowLlmDecider({
        model: "mock-semanticflow-repair",
        async modelInvoker(input) {
            calls.push(input.system);
            if (calls.length === 1) {
                return JSON.stringify({
                    status: "done",
                    classification: "rule",
                    resolution: "resolved",
                    summary: {
                        inputs: [],
                        outputs: ["ret"],
                        transfers: ["router.state -> ret"],
                        confidence: "medium",
                        ruleKind: "source",
                        sourceKind: "call_return",
                        relations: {
                            companions: ["push", "replace"],
                        },
                    },
                });
            }
            return JSON.stringify({
                status: "done",
                classification: "rule",
                resolution: "resolved",
                summary: {
                    inputs: [],
                    outputs: ["ret"],
                    transfers: [],
                    confidence: "medium",
                    ruleKind: "source",
                    sourceKind: "call_return",
                },
            });
        },
    });

    const decision = await decider.decide({
        anchor: {
            id: "router.getParams",
            owner: "Router",
            surface: "getParams",
        },
        draftId: "draft.router.getParams",
        slice: {
            anchorId: "router.getParams",
            round: 0,
            template: "multi-surface",
            observations: ["methodSnippet=available", "ownerMethodSnippets=2"],
            companions: ["push", "replace"],
            snippets: [
                {
                    label: "method",
                    code: "public static getParams(): Object { return router.getParams() }",
                },
            ],
        },
        draft: undefined,
        lastMarker: undefined,
        lastDelta: undefined,
        round: 0,
        history: [],
    });

    assert(calls.length === 2, `expected one repair retry, got ${calls.length} invocations`);
    assert(calls[1].includes("repairing a previously invalid JSON response"), "second invocation should be a repair prompt");
    assert(decision.status === "done", `unexpected status: ${(decision as any).status}`);
    assert(decision.classification === "rule", `unexpected classification: ${(decision as any).classification}`);
    assert(decision.summary.ruleKind === "source", `unexpected rule kind: ${decision.summary.ruleKind}`);
    assert(decision.summary.outputs.length === 1 && decision.summary.outputs[0].slot === "result", "repaired decision should keep ret output");
    assert(decision.summary.transfers.length === 0, "repaired decision should drop the invalid pseudo-slot transfer");
    assert(!decision.summary.relations?.companions?.length, "repaired rule decision must not keep companion relations");

    const aliasCalls: string[] = [];
    const aliasDecider = createSemanticFlowLlmDecider({
        model: "mock-semanticflow-slot-alias",
        async modelInvoker(input) {
            aliasCalls.push(`${input.system}\n${input.user}`);
            return JSON.stringify({
                status: "done",
                classification: "arkmain",
                resolution: "resolved",
                summary: {
                    inputs: ["formId", "message"],
                    outputs: [],
                    transfers: [],
                    confidence: "high",
                    relations: {
                        entryPattern: {
                            phase: "interaction",
                            kind: "callback",
                            ownerKind: "ability_owner",
                        },
                    },
                },
            });
        },
    });
    const aliasDecision = await aliasDecider.decide({
        anchor: {
            id: "formability.onevent",
            owner: "FormAbility",
            surface: "onEvent",
        },
        draftId: "draft.formability.onevent",
        slice: {
            anchorId: "formability.onevent",
            round: 0,
            template: "owner-slot",
            observations: ["class=FormAbility", "superClass=FormExtensionAbility"],
            snippets: [
                {
                    label: "method",
                    code: "onEvent(formId, message): void {\n  Log.info(`${formId}:${message}`);\n}",
                },
            ],
        },
        draft: undefined,
        lastMarker: undefined,
        lastDelta: undefined,
        round: 0,
        history: [],
    });

    assert(aliasCalls.length === 1, `slot alias decision should parse without repair, got ${aliasCalls.length} invocations`);
    assert(aliasCalls[0].includes("formId => arg0"), "prompt should expose formId slot alias");
    assert(aliasCalls[0].includes("message => arg1"), "prompt should expose message slot alias");
    assert(aliasDecision.status === "done", `unexpected alias decision status: ${(aliasDecision as any).status}`);
    assert(aliasDecision.classification === "arkmain", `unexpected alias decision class: ${(aliasDecision as any).classification}`);
    assert(aliasDecision.summary.inputs[0].slot === "arg" && aliasDecision.summary.inputs[0].index === 0, "formId should normalize to arg0");
    assert(aliasDecision.summary.inputs[1].slot === "arg" && aliasDecision.summary.inputs[1].index === 1, "message should normalize to arg1");

    console.log("PASS test_semanticflow_llm_repair");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_llm_repair");
    console.error(error);
    process.exit(1);
});
