import { parseSemanticFlowDecision } from "../../core/semanticflow/SemanticFlowLlm";
import {
    buildSemanticFlowPrompt,
    SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION,
} from "../../core/semanticflow/SemanticFlowPrompt";
import { loadSemanticFlowRuntimeSkills } from "../../core/semanticflow/SemanticFlowRuntimeSkills";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function expectThrows(fn: () => unknown, contains: string): void {
    let thrown = false;
    try {
        fn();
    } catch (error) {
        thrown = true;
        const text = String((error as any)?.message || error);
        if (!text.includes(contains)) {
            throw new Error(`expected error containing "${contains}", got "${text}"`);
        }
    }
    if (!thrown) {
        throw new Error(`expected error containing "${contains}"`);
    }
}

async function main(): Promise<void> {
    const prompt = buildSemanticFlowPrompt({
        anchor: {
            id: "prompt_guard",
            surface: "ApiClient.request",
            methodSignature: "ApiClient.request(string)",
        },
        draftId: "draft.prompt.guard",
        round: 0,
        history: [],
        slice: {
            anchorId: "prompt_guard",
            round: 0,
            template: "call-return",
            observations: ["third-party wrapper candidate"],
            snippets: [{ label: "body", code: "request(url) { return http.request(url); }" }],
        },
    });
    const runtimeSkills = loadSemanticFlowRuntimeSkills();
    assert(runtimeSkills.length === 3, "expected three runtime LLM skills");
    assert(runtimeSkills.some(skill => skill.id === "semanticflow/asset-plane-selection"), "expected asset-plane runtime skill");
    assert(runtimeSkills.some(skill => skill.id === "semanticflow/project-api-modeling"), "expected project API runtime skill");
    assert(runtimeSkills.some(skill => skill.id === "semanticflow/evidence-and-safety"), "expected evidence runtime skill");
    assert(SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION >= 8, "prompt schema should reflect runtime skill harness update");
    assert(prompt.system.includes("runtime LLM modeling harness"), "prompt should identify ArkTaint runtime modeling harness");
    assert(prompt.system.includes("Loaded runtime LLM skills from src/core/semanticflow/llm_skills"), "prompt should include runtime LLM skills");
    assert(prompt.system.includes("semanticflow/asset-plane-selection"), "prompt should include asset-plane skill");
    assert(prompt.system.includes("semanticflow/project-api-modeling"), "prompt should include project API modeling skill");
    assert(prompt.system.includes("semanticflow/evidence-and-safety"), "prompt should include evidence and safety skill");
    assert(prompt.system.includes("classification=rule produces the rules plane"), "prompt should define rules plane");
    assert(prompt.system.includes("classification=module produces the modules plane"), "prompt should define modules plane");
    assert(prompt.system.includes("classification=arkmain produces the arkmain plane"), "prompt should define arkmain plane");
    assert(prompt.system.includes("RdbPredicates"), "prompt should tell the runtime LLM not to treat RDB predicates as payload sinks");
    assert(prompt.system.includes("values bucket"), "prompt should identify database values buckets as payload sinks");
    assert(prompt.system.includes("keyed_storage moduleSpec requires storageClasses"), "prompt should require current keyed_storage ModuleSpec schema fields");
    assert(prompt.system.includes("semanticFocus=returned_value_surface"), "prompt should define focused returned-value modeling");
    assert(prompt.system.includes("not as a preselected artifact"), "prompt should keep returned-value focus from preselecting source/rule output");
    assert(prompt.system.includes("ordinary wrapper candidate without semanticFocus=returned_value_surface"), "prompt should keep ordinary dual-role wrappers on the request/input side");
    assert(prompt.system.includes("companionFinalSinkUsage"), "prompt should explain companion final sink usage evidence");
    assert(!prompt.system.includes("Example keyed_storage moduleSpec shorthand"), "prompt should not show invalid keyed_storage examples without storageClasses");
    assert(!prompt.system.includes("local transfer summary candidate"), "prompt should not use old local-transfer-only framing");

    const decision = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        resolution: "resolved",
        classification: "module",
        summary: {
            inputs: [{ surface: "emit", slot: "arg", index: 1 }],
            outputs: [{ surface: "on", slot: "callback_param" }],
            transfers: [
                {
                    from: { surface: "emit", slot: "arg", index: 1 },
                    to: { surface: "on", slot: "callback_param" },
                    relation: "deferred",
                },
            ],
            confidence: "high",
            moduleKind: "deferred",
            relations: {
                trigger: {
                    preset: "callback_event",
                    via: { surface: "on", slot: "callback_param" },
                },
                constraints: [
                    { kind: "same_receiver" },
                    {
                        kind: "same_address",
                        left: { kind: "literal", value: "topic" },
                        right: {
                            kind: "endpoint",
                            endpoint: { surface: "emit", slot: "arg", index: 0 },
                        },
                    },
                ],
            },
        },
    }));

    assert(decision.status === "done", `unexpected status: ${(decision as any).status}`);
    assert(decision.summary.outputs[0].callbackArgIndex === 0, "callbackArgIndex should default to 0");
    assert(decision.summary.outputs[0].paramIndex === 0, "paramIndex should default to 0");

    const requestDecision = parseSemanticFlowDecision(JSON.stringify({
        status: "need-more-evidence",
        draft: {
            inputs: ["arg0"],
            outputs: ["ret"],
            transfers: [],
            confidence: "medium",
            ruleKind: "transfer",
        },
        request: {
            kind: "q_comp",
            focus: {
                from: "arg0",
                to: "Cache.get.ret",
                companion: "Cache.get",
                carrierHint: "slots",
            },
            scope: {
                owner: "Cache",
                locality: "owner",
                sharedSymbols: ["token"],
                surface: "set",
            },
            budgetClass: "owner_local",
            why: ["need writer/reader companion evidence"],
            ask: "show Cache.get and shared key-addressed carrier evidence",
        },
    }));
    assert(requestDecision.status === "need-more-evidence", "expected structured request decision");
    assert(requestDecision.request.focus.companion === "Cache.get", "expected structured companion focus");
    assert(requestDecision.request.scope.locality === "owner", "expected structured scope locality");
    assert(requestDecision.request.budgetClass === "owner_local", "expected structured budget class");

    const nonArtifactNeedMoreEvidenceDecision = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        resolution: "need-more-evidence",
        summary: {
            inputs: ["arg0"],
            outputs: [],
            transfers: [],
            confidence: "low",
        },
        rationale: ["The slice lacks the matching bridge registration surface."],
    }));
    assert(nonArtifactNeedMoreEvidenceDecision.status === "done", "expected non-artifact done decision");
    assert(nonArtifactNeedMoreEvidenceDecision.resolution === "need-human-check",
        "done+need-more-evidence should normalize to the non-artifact need-human-check resolution");

    const inferredDirectTransfer = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: ["ret"],
            transfers: [],
            confidence: "high",
            ruleKind: "transfer",
        },
        rationale: ["DTO mapper copies input fields into a returned object."],
    }));
    assert(inferredDirectTransfer.status === "done", "expected inferred direct transfer decision");
    assert(inferredDirectTransfer.summary.transfers.length === 1, "ruleKind=transfer with one input/output should infer direct transfer");
    assert(inferredDirectTransfer.summary.transfers[0].from.slot === "arg", "expected inferred transfer from arg0");
    assert(inferredDirectTransfer.summary.transfers[0].to.slot === "result", "expected inferred transfer to result");

    const shorthandModuleDecision = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "module",
        resolution: "resolved",
        summary: {
            inputs: ["arg1"],
            outputs: [],
            transfers: [],
            confidence: "high",
            moduleSpec: {
                kind: "keyed_storage",
                storageClasses: ["Vault"],
                writeMethods: [{ methodName: "put", valueIndex: 1 }],
                readMethods: ["get"],
            },
            relations: {
                constraints: [
                    { description: "arg0 is the shared key" },
                ],
            },
        },
    }));
    assert(shorthandModuleDecision.status === "done", "expected shorthand module decision");
    assert(shorthandModuleDecision.summary.moduleSpec?.semantics[0]?.kind === "keyed_storage", "expected keyed_storage shorthand to normalize");

    const arkmainDecision = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "arkmain",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: [],
            transfers: [],
            confidence: "high",
            relations: {
                entryPattern: {
                    phase: "bootstrap",
                    kind: "page_lifecycle",
                    ownerKind: "component_owner",
                },
            },
        },
    }));
    assert(arkmainDecision.status === "done", "expected arkmain decision");
    assert(arkmainDecision.summary.relations?.entryPattern?.phase === "bootstrap", "expected phase bootstrap");
    assert(arkmainDecision.summary.relations?.entryPattern?.kind === "page_lifecycle", "expected kind page_lifecycle");
    assert(arkmainDecision.summary.relations?.entryPattern?.ownerKind === "component_owner", "expected ownerKind component_owner");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: ["ret"],
            transfers: ["arg0 -> ret"],
            confidence: "high",
            ruleKind: "transfer",
        },
    })), "decision.classification is required when decision.resolution=resolved");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "need-more-evidence",
        draft: {
            inputs: ["arg0"],
            outputs: [],
            transfers: [],
            confidence: "low",
        },
        request: {
            kind: "q_cb",
            focus: {},
            why: ["missing callback evidence"],
            ask: "show callback dispatch",
        },
    })), "decision.request.focus must describe at least one target relation");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        resolution: "resolved",
        summary: {
            inputs: [{ slot: "argument", index: 0 }],
            outputs: ["ret"],
            transfers: ["arg0 -> ret"],
            confidence: "high",
        },
    })), "decision.summary.inputs[0].slot invalid");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: ["ret"],
            transfers: [{ from: "arg0", to: "ret", relation: "magic" }],
            confidence: "high",
        },
    })), "decision.summary.transfers[0].relation invalid");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: ["ret"],
            transfers: ["arg0 -> ret"],
            confidence: "high",
            relations: {
                trigger: {
                    preset: "async_callback",
                },
            },
        },
    })), "decision.summary.relations.trigger.preset invalid");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: [],
            transfers: [],
            confidence: "high",
            relations: {
                entryPattern: "callback",
            },
        },
    })), "decision.summary.relations.entryPattern must be an object");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: ["ret"],
            transfers: ["arg0 -> ret"],
            confidence: "high",
            ruleKind: "transfer",
            relations: {
                trigger: {
                    preset: "callback_event",
                },
            },
        },
    })), "classification=rule must not encode companion/carrier/trigger/constraint relations");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "module",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: ["ret"],
            transfers: ["arg0 -> ret"],
            confidence: "high",
        },
    })), "classification=module requires moduleSpec or module-only evidence");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "module",
        resolution: "resolved",
        summary: {
            inputs: ["arg1"],
            outputs: [],
            transfers: [],
            confidence: "high",
            moduleKind: "state",
            relations: {
                carrier: {
                    kind: "keyed_state",
                    label: "vault",
                },
            },
        },
    })), "classification=module with moduleKind=state requires explicit moduleSpec");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "module",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: [],
            transfers: [],
            confidence: "high",
            relations: {
                companions: ["emit"],
            },
        },
    })), "classification=module without moduleSpec requires at least one transfer");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: ["ret"],
            transfers: ["arg0 -> ret"],
            confidence: "high",
            relations: {
                constraints: [
                    {
                        kind: "same_address",
                        left: { kind: "broken", value: "x" },
                        right: { kind: "literal", value: "x" },
                    },
                ],
            },
        },
    })), "decision.summary.relations.constraints[0].left.kind invalid");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "module",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: ["ret"],
            transfers: [],
            confidence: "high",
            moduleSpec: {
                id: "bad.bridge",
                semantics: [
                    {
                        kind: "bridge",
                        from: { surface: "cloneValue", slot: "arg", index: 0 },
                        to: { surface: "cloneValue", slot: "result" },
                    },
                ],
            },
        },
    })), "classification=module must not use moduleSpec for one-surface direct bridge semantics that rules can already express");

    expectThrows(() => parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        resolution: "resolved",
        summary: {
            inputs: ["arg2", "arg3"],
            outputs: [],
            transfers: [],
            confidence: "high",
            ruleKind: "sink",
        },
    }), {
        forbiddenSinkInputs: [
            { index: 3, reason: "arg3 maps to unused realLog.arg4 in companionFinalSinkUsage" },
        ],
    }), "ruleKind=sink input arg3 contradicts slice evidence");

    console.log("PASS test_semanticflow_llm_validation");
}

main().catch(error => {
    console.error("FAIL test_semanticflow_llm_validation");
    console.error(error);
    process.exit(1);
});
