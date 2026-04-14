import { classifySemanticFlowSummary } from "../../core/semanticflow/SemanticFlowArtifacts";
import { SemanticFlowAnchor, SemanticFlowSummary } from "../../core/semanticflow/SemanticFlowTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function main(): void {
    const anchor: SemanticFlowAnchor = {
        id: "router.getParams",
        owner: "@router/Router.ets: Router",
        surface: "getParams",
        methodSignature: "@router/Router.ets: Router.[static]getParams()",
        filePath: "router/Router.ets",
        metaTags: ["rule", "candidate", "static"],
    };
    const sourceRuleWithCompanions: SemanticFlowSummary = {
        inputs: [],
        outputs: [{ slot: "result" }],
        transfers: [],
        confidence: "high",
        ruleKind: "source",
        sourceKind: "call_return",
        relations: {
            companions: ["push", "replace"],
        },
    };

    const classification = classifySemanticFlowSummary(anchor, sourceRuleWithCompanions, "rule");
    assert(classification === "rule", `expected rule classification, got ${classification}`);

    const moduleSummary: SemanticFlowSummary = {
        inputs: [{ slot: "arg", index: 0 }],
        outputs: [{ slot: "callback_param", callbackArgIndex: 0, paramIndex: 0 }],
        transfers: [{
            from: { slot: "arg", index: 0 },
            to: { slot: "callback_param", callbackArgIndex: 0, paramIndex: 0 },
        }],
        confidence: "high",
        relations: {
            trigger: {
                preset: "callback_event",
            },
        },
    };
    const moduleClassification = classifySemanticFlowSummary(anchor, moduleSummary, "module");
    assert(moduleClassification === "module", `expected module classification, got ${moduleClassification}`);

    const bogusArkMainSummary: SemanticFlowSummary = {
        inputs: [],
        outputs: [],
        transfers: [],
        confidence: "high",
        relations: {
            entryPattern: {
                phase: "bootstrap",
                kind: "ability_lifecycle",
                ownerKind: "ability_owner",
                reason: "framework entry",
            },
        },
    };
    const bogusArkMainClassification = classifySemanticFlowSummary(anchor, bogusArkMainSummary, "arkmain");
    assert(
        bogusArkMainClassification === undefined,
        `non-arkmain anchor must not classify as arkmain, got ${bogusArkMainClassification}`,
    );

    console.log("PASS test_semanticflow_classification");
}

try {
    main();
} catch (error) {
    console.error("FAIL test_semanticflow_classification");
    console.error(error);
    process.exit(1);
}
