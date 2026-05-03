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

    const explanatoryRelations = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        resolution: "resolved",
        summary: {
            inputs: ["arg1"],
            outputs: ["ret"],
            transfers: ["arg1 -> ret"],
            confidence: "high",
            ruleKind: "transfer",
            relations: {
                companions: ["setParam"],
                carrier: { kind: "wrapper_note", label: "explanatory owner context" },
                constraints: [{ description: "same helper family, not required for the local transfer artifact" }],
            },
        },
    }));
    assert(explanatoryRelations.status === "done", "expected explanatory rule relations to parse");
    assert(explanatoryRelations.classification === "rule", "expected explanatory relation normalization to preserve rule class");
    assert(explanatoryRelations.summary.transfers.length === 1, "expected direct rule transfer to survive relation normalization");
    assert(!explanatoryRelations.summary.relations, "explanatory relations on direct anchor-local rule transfers should be dropped");

    const sourceRuleWithCarrier = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        resolution: "resolved",
        summary: {
            inputs: [],
            outputs: ["ret"],
            transfers: [],
            confidence: "high",
            ruleKind: "source",
            sourceKind: "call_return",
            relations: {
                carrier: { kind: "keyed_storage", label: "LocalStorage" },
                constraints: [{ description: "storage key is explanatory for a local source rule" }],
            },
        },
    }));
    assert(sourceRuleWithCarrier.status === "done", "expected source rule with explanatory carrier to parse");
    assert(sourceRuleWithCarrier.classification === "rule", "source carrier drift should remain a rule");
    assert(sourceRuleWithCarrier.summary.ruleKind === "source", "expected source rule kind");
    assert(sourceRuleWithCarrier.summary.outputs[0].slot === "result", "expected ret output");
    assert(!sourceRuleWithCarrier.summary.relations, "source rule explanatory carrier should be dropped");

    const sourceLikeModuleSpecDrift = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "module",
        resolution: "resolved",
        moduleSpec: {
            id: "drift.getFromStorage",
            semantics: [
                {
                    kind: "source",
                    sourceKind: "call_return",
                    ret: "StartModeOptions",
                    relations: {
                        carrier: { kind: "keyed_storage", label: "LocalStorage", key: "startModeOptions" },
                    },
                },
            ],
        },
        summary: {
            inputs: [],
            outputs: ["ret"],
            confidence: "high",
        },
    }));
    assert(sourceLikeModuleSpecDrift.status === "done", "expected source-like moduleSpec drift to parse");
    assert(sourceLikeModuleSpecDrift.classification === "rule", "source-like moduleSpec drift should normalize to rule");
    assert(sourceLikeModuleSpecDrift.summary.ruleKind === "source", "source-like moduleSpec drift should become source rule");
    assert(sourceLikeModuleSpecDrift.summary.sourceKind === "call_return", "expected sourceKind to be preserved");
    assert(sourceLikeModuleSpecDrift.summary.outputs[0].slot === "result", "expected source-like moduleSpec drift ret output");
    assert(!sourceLikeModuleSpecDrift.summary.moduleSpec, "source-like moduleSpec drift must not keep moduleSpec");
    assert(!sourceLikeModuleSpecDrift.summary.relations, "source-like moduleSpec drift carrier should remain explanatory only");

    const sourceLikeModuleOutputDrift = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "module",
        resolution: "resolved",
        summary: {
            inputs: [],
            outputs: ["ret"],
            transfers: [],
            confidence: "high",
            moduleKind: "bridge",
            entryPattern: {
                phase: "runtime",
                kind: "instance_method",
            },
        },
    }));
    assert(sourceLikeModuleOutputDrift.status === "done", "expected source-like module output drift to parse");
    assert(sourceLikeModuleOutputDrift.classification === "rule", "source-like module output drift should normalize to rule");
    assert(sourceLikeModuleOutputDrift.summary.ruleKind === "source", "source-like module output drift should become source rule");
    assert(sourceLikeModuleOutputDrift.summary.outputs[0].slot === "result", "source-like module output drift should keep ret output");
    assert(!sourceLikeModuleOutputDrift.summary.moduleKind, "source-like module output drift should drop moduleKind");

    const repairedSourceLikeSummaryModuleSpec = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "module",
        resolution: "resolved",
        summary: {
            moduleSpec: {
                id: "drift.summarySource",
                semantics: [
                    {
                        kind: "source",
                        outputs: ["ret"],
                        storage: { key: "startModeOptions", type: "LocalStorage" },
                    },
                ],
            },
        },
    }));
    assert(repairedSourceLikeSummaryModuleSpec.status === "done", "expected summary.moduleSpec source drift to parse");
    assert(repairedSourceLikeSummaryModuleSpec.classification === "rule", "summary.moduleSpec source drift should normalize to rule");
    assert(repairedSourceLikeSummaryModuleSpec.summary.ruleKind === "source", "summary.moduleSpec source drift should become source rule");
    assert(repairedSourceLikeSummaryModuleSpec.summary.confidence === "medium", "missing drift confidence should default to medium");
    assert(repairedSourceLikeSummaryModuleSpec.summary.outputs[0].slot === "result", "summary.moduleSpec source drift should keep ret output");

    const topLevelRuleKindDrift = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        ruleKind: "sink",
        summary: {
            inputs: ["arg0", "arg1"],
            outputs: [],
            transfers: [],
            confidence: "high",
        },
    }));
    assert(topLevelRuleKindDrift.status === "done", "expected top-level ruleKind drift to parse");
    assert(topLevelRuleKindDrift.classification === "rule", "top-level ruleKind drift should stay rule");
    assert(topLevelRuleKindDrift.resolution === "resolved", "missing resolution should infer resolved when classification is valid");
    assert(topLevelRuleKindDrift.summary.ruleKind === "sink", "top-level ruleKind should move into summary");
    assert(topLevelRuleKindDrift.summary.inputs.length === 2, "top-level ruleKind drift should preserve inputs");

    const ruleWithInformalConstraints = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        resolution: "sink",
        summary: {
            inputs: ["arg0", "arg1"],
            outputs: [],
            transfers: [],
            confidence: "high",
            ruleKind: "sink",
            relations: {
                constraints: [
                    { condition: "arg0 == 'notification.event.message'", effect: "sendMessage()" },
                    "arg1.phoneNumber != null",
                ],
            },
        },
    }));
    assert(ruleWithInformalConstraints.status === "done", "expected rule with informal constraints to parse");
    assert(ruleWithInformalConstraints.classification === "rule", "informal constraint hints should stay in rule class");
    assert(ruleWithInformalConstraints.summary.ruleKind === "sink", "expected sink rule with informal constraints");
    assert(ruleWithInformalConstraints.summary.inputs.length === 2, "informal constraints should not remove sink inputs");
    assert(!ruleWithInformalConstraints.summary.relations, "informal rule constraints should be dropped");

    const arkMainWithStringRationale = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "arkmain",
        resolution: "resolved",
        summary: {
            inputs: ["arg0", "arg1"],
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
        rationale: "framework callback entry point",
    }));
    assert(arkMainWithStringRationale.status === "done", "expected string rationale to parse");
    assert(arkMainWithStringRationale.rationale.length === 1, "string rationale should normalize to one rationale item");
    assert(arkMainWithStringRationale.classification === "arkmain", "string rationale should not alter classification");

    const pseudoTransferModuleSpec = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "module",
        resolution: "resolved",
        summary: {
            inputs: ["arg0", "arg1"],
            outputs: ["ret"],
            confidence: "high",
            moduleSpec: {
                id: "drift.callbackTransfer",
                semantics: [
                    {
                        kind: "transfer",
                        inputs: ["arg0", "arg1"],
                        outputs: ["ret"],
                        effect: "arg1 is invoked with dialogId derived from arg0.jobId; method returns void",
                    },
                ],
            },
        },
    }));
    assert(pseudoTransferModuleSpec.status === "done", "expected pseudo transfer moduleSpec drift to parse");
    assert(pseudoTransferModuleSpec.classification === "module", "callback transfer drift should remain module");
    assert(pseudoTransferModuleSpec.summary.moduleKind === "bridge", "callback transfer drift should become bridge module summary");
    assert(!pseudoTransferModuleSpec.summary.moduleSpec, "pseudo transfer moduleSpec should be removed");
    assert(pseudoTransferModuleSpec.summary.transfers.length === 1, "callback transfer drift should produce one transfer");
    assert(pseudoTransferModuleSpec.summary.transfers[0].from.slot === "arg", "callback transfer source should be arg slot");
    assert(pseudoTransferModuleSpec.summary.transfers[0].from.index === 0, "callback transfer source should be arg0");
    assert(pseudoTransferModuleSpec.summary.transfers[0].from.fieldPath?.[0] === "jobId", "callback transfer should preserve source field path");
    assert(pseudoTransferModuleSpec.summary.transfers[0].to.slot === "callback_param", "callback transfer target should be callback parameter");
    assert(pseudoTransferModuleSpec.summary.transfers[0].to.callbackArgIndex === 1, "callback transfer target should use callback arg index");

    const callbackParamRuleDrift = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        resolution: "resolved",
        summary: {
            inputs: ["arg0", "arg1"],
            outputs: ["ret"],
            transfers: ["arg1 -> callback0.param0"],
            confidence: "high",
            ruleKind: "transfer",
        },
        rationale: ["callback receives the argument value"],
    }));
    assert(callbackParamRuleDrift.status === "done", "expected callback_param rule drift to parse");
    assert(callbackParamRuleDrift.classification === "module", "callback_param transfer should be lifted to module");
    assert(callbackParamRuleDrift.summary.moduleKind === "bridge", "callback_param transfer should become bridge module");
    assert(callbackParamRuleDrift.summary.ruleKind === undefined, "lifted callback_param transfer should drop ruleKind");
    assert(callbackParamRuleDrift.summary.transfers[0].to.slot === "callback_param", "lifted transfer should preserve callback_param target");

    const sinkWithModuleOnlyTransferDrift = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        resolution: "resolved",
        summary: {
            inputs: ["arg0"],
            outputs: [],
            transfers: ["arg0.parameters.token -> decorated_field_value"],
            confidence: "high",
            ruleKind: "sink",
            sourceKind: "call_arg",
            relations: {
                carrier: { kind: "state", label: "this.storage" },
            },
        },
        rationale: ["local state write was mislabeled as sink"],
    }));
    assert(sinkWithModuleOnlyTransferDrift.status === "done", "expected sink-with-transfer drift to parse");
    assert(sinkWithModuleOnlyTransferDrift.classification === "module", "module-only transfer drift should lift to module");
    assert(sinkWithModuleOnlyTransferDrift.summary.moduleKind === "bridge", "module-only sink transfer drift should become bridge module");
    assert(sinkWithModuleOnlyTransferDrift.summary.ruleKind === undefined, "lifted sink transfer drift should drop ruleKind");
    assert(sinkWithModuleOnlyTransferDrift.summary.transfers[0].to.slot === "base", "bare decorated field target should become base state field");
    const stateFieldPath = sinkWithModuleOnlyTransferDrift.summary.transfers[0].to.fieldPath;
    assert(Array.isArray(stateFieldPath) && stateFieldPath.join(".") === "storage.token", "state field target should use carrier label plus source tail");

    const wrapperOnlyResidualTransfer = parseSemanticFlowDecision(JSON.stringify({
        status: "done",
        classification: "rule",
        resolution: "wrapper-only",
        summary: {
            inputs: ["arg0"],
            outputs: [],
            transfers: [],
            confidence: "high",
            ruleKind: "transfer",
        },
        rationale: [
            "argument is forwarded to an internal dispatch mechanism",
            "no visible ret/field/callback output is exposed by this surface",
        ],
    }));
    assert(wrapperOnlyResidualTransfer.status === "done", "expected wrapper-only residual transfer to parse");
    assert(wrapperOnlyResidualTransfer.resolution === "wrapper-only", "wrapper-only resolution should be preserved");
    assert(wrapperOnlyResidualTransfer.classification === undefined, "non-artifact wrapper-only decision should drop classification");
    assert(wrapperOnlyResidualTransfer.summary.ruleKind === undefined, "non-artifact wrapper-only decision should drop residual ruleKind");
    assert(wrapperOnlyResidualTransfer.summary.transfers.length === 0, "wrapper-only decision should keep an empty transfer list");

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
