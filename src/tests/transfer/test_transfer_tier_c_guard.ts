import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function flowSinkInCaseMethod(scene: Scene, sinkStmt: any, caseMethodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === caseMethodName);
    if (!method) return false;
    const cfg = method.getCfg();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

async function runCase(
    scene: Scene,
    caseName: string,
    sourceRules: SourceRule[],
    sinkRules: SinkRule[],
    transferRules: TransferRule[]
): Promise<{ detected: boolean; transferRuleHits: string[] }> {
    const engine = new TaintPropagationEngine(scene, 1, { transferRules });
    engine.verbose = false;
    await engine.buildPAG();
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const scopedFlows = flows.filter(flow => flowSinkInCaseMethod(scene, flow.sink, caseName));
    const transferRuleHits = Object.entries(engine.getRuleHitCounters().transfer)
        .filter(([, hit]) => hit > 0)
        .map(([id]) => id)
        .sort();

    return {
        detected: scopedFlows.length > 0,
        transferRuleHits,
    };
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/transfer_priority");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const sourceRules: SourceRule[] = [
        {
            id: "source.tierc.entry_param",
            sourceKind: "entry_param",
            target: "arg0",
            match: { kind: "local_name_regex", value: "^taint_src$" },
        },
    ];
    const sinkRules: SinkRule[] = [
        {
            id: "sink.tierc.arg0",
            target: { endpoint: "arg0" },
            match: { kind: "method_name_equals", value: "Sink" },
        },
    ];

    const bareTierC: TransferRule = {
        id: "transfer.tierc.bare",
        family: "transfer.tierc.bridge",
        tier: "C",
        match: { kind: "method_name_equals", value: "Bridge" },
        from: "arg0",
        to: "result",
    };
    const anchoredTierC: TransferRule = {
        id: "transfer.tierc.anchored",
        family: "transfer.tierc.bridge",
        tier: "C",
        match: { kind: "method_name_equals", value: "Bridge", invokeKind: "instance", argCount: 1 },
        scope: {
            className: { mode: "contains", value: "PriorityHostConstrained" },
        },
        from: "arg0",
        to: "result",
    };

    const caseName = "transfer_priority_002_T";
    const noTransfer = await runCase(scene, caseName, sourceRules, sinkRules, []);
    const withBareTierC = await runCase(scene, caseName, sourceRules, sinkRules, [bareTierC]);
    const withAnchoredTierC = await runCase(scene, caseName, sourceRules, sinkRules, [anchoredTierC]);
    const withBoth = await runCase(scene, caseName, sourceRules, sinkRules, [bareTierC, anchoredTierC]);

    assert(!noTransfer.detected, "baseline without transfer should not detect");
    assert(!withBareTierC.detected, "bare tier C fallback must be blocked by gate");
    assert(withAnchoredTierC.detected, "anchored tier C fallback should detect");
    assert(withBoth.detected, "anchored tier C should still work when bare tier C co-exists");
    assert(!withBoth.transferRuleHits.includes("transfer.tierc.bare"), "bare tier C should not hit");
    assert(withBoth.transferRuleHits.includes("transfer.tierc.anchored"), "anchored tier C should hit");

    console.log("====== Transfer Tier C Guard Test ======");
    console.log(`baseline_detected=${noTransfer.detected}`);
    console.log(`with_bare_tier_c_detected=${withBareTierC.detected}`);
    console.log(`with_anchored_tier_c_detected=${withAnchoredTierC.detected}`);
    console.log(`with_both_detected=${withBoth.detected}`);
    console.log(`with_both_hits=${withBoth.transferRuleHits.join(",") || "N/A"}`);
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});


