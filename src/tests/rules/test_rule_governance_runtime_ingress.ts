import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SanitizerRule, SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function buildScene(projectDir: string): Scene {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();
    return scene;
}

function findMethodSignature(scene: Scene, methodName: string, signatureHint: string): string {
    const method = scene.getMethods().find(m =>
        m.getName() === methodName
        && m.getSignature().toString().includes(signatureHint),
    );
    assert(method, `method not found: ${methodName} (${signatureHint})`);
    return method.getSignature().toString();
}

function flowSinkInCaseMethod(scene: Scene, sinkStmt: any, caseMethodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === caseMethodName);
    if (!method) return false;
    const cfg = method.getCfg();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

async function runSourceGovernanceProbe(): Promise<void> {
    const scene = buildScene(path.resolve("tests/demo/rule_precision_source"));
    const sourceReturnSig = findMethodSignature(scene, "SourceReturn", "taint_mock");

    const sourceRules: SourceRule[] = [
        {
            id: "source.runtime.weak",
            sourceKind: "call_return",
            target: "result",
            match: { kind: "method_name_equals", value: "SourceReturn" },
        },
        {
            id: "source.runtime.strong",
            sourceKind: "call_return",
            target: "result",
            match: { kind: "signature_equals", value: sourceReturnSig },
        },
    ];
    const sinkRules: SinkRule[] = [
        {
            id: "sink.runtime.arg0",
            target: { endpoint: "arg0" },
            match: { kind: "method_name_equals", value: "Sink" },
        },
    ];

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG();
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const detected = flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "source_call_return_001_T"));
    assert(detected, "runtime source ingress should still detect the positive case");
    assert(seedInfo.sourceRuleHits["source.runtime.strong"] > 0, "strong source rule should hit after runtime governance normalization");
    assert(!seedInfo.sourceRuleHits["source.runtime.weak"], "weak source rule should be suppressed by family+tier governance");
}

async function runTransferGovernanceProbe(): Promise<void> {
    const scene = buildScene(path.resolve("tests/demo/transfer_priority"));

    const sourceRules: SourceRule[] = [
        {
            id: "source.runtime.transfer.entry",
            sourceKind: "entry_param",
            target: "arg0",
            match: { kind: "local_name_regex", value: "^taint_src$" },
        },
    ];
    const sinkRules: SinkRule[] = [
        {
            id: "sink.runtime.transfer.arg0",
            target: { endpoint: "arg0" },
            match: { kind: "method_name_equals", value: "Sink" },
        },
    ];
    const weakTransfer: TransferRule = {
        id: "transfer.runtime.weak",
        match: { kind: "method_name_equals", value: "Bridge" },
        from: "arg0",
        to: "result",
    };
    const strongTransfer: TransferRule = {
        id: "transfer.runtime.strong",
        match: { kind: "method_name_equals", value: "Bridge", invokeKind: "instance", argCount: 1 },
        scope: {
            className: { mode: "contains", value: "PriorityHostConstrained" },
        },
        from: "arg0",
        to: "result",
    };

    const engine = new TaintPropagationEngine(scene, 1, {
        transferRules: [weakTransfer, strongTransfer],
    });
    engine.verbose = false;
    await engine.buildPAG();
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const detected = flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "transfer_priority_002_T"));
    const transferHits = Object.entries(engine.getRuleHitCounters().transfer)
        .filter(([, hit]) => hit > 0)
        .map(([id]) => id)
        .sort();

    assert(detected, "runtime transfer ingress should still detect the constrained positive case");
    assert(transferHits.includes("transfer.runtime.strong"), "strong transfer rule should hit after runtime governance normalization");
    assert(!transferHits.includes("transfer.runtime.weak"), "weak transfer rule should be suppressed by runtime governance normalization");
}

async function runSinkGovernanceProbe(): Promise<void> {
    const scene = buildScene(path.resolve("tests/demo/rule_precision_sink"));
    const sinkArg0Sig = findMethodSignature(scene, "SinkArg0", "taint_mock");

    const sourceRules: SourceRule[] = [
        {
            id: "source.runtime.sink.entry",
            sourceKind: "entry_param",
            target: "arg0",
            match: { kind: "local_name_regex", value: "^taint_src$" },
        },
    ];
    const sinkRules: SinkRule[] = [
        {
            id: "sink.runtime.weak",
            match: { kind: "method_name_equals", value: "SinkArg0" },
        },
        {
            id: "sink.runtime.strong",
            target: { endpoint: "arg0" },
            match: { kind: "signature_equals", value: sinkArg0Sig },
        },
    ];

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG();
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const detected = flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "sink_target_arg0_001_T"));
    const sinkHits = Object.entries(engine.getRuleHitCounters().sink)
        .filter(([, hit]) => hit > 0)
        .map(([id]) => id)
        .sort();

    assert(detected, "runtime sink ingress should still detect the positive case");
    assert(sinkHits.includes("sink.runtime.strong"), "strong sink rule should hit after runtime governance normalization");
    assert(!sinkHits.includes("sink.runtime.weak"), "weak sink rule should be suppressed by family+tier normalization");
}

async function runSanitizerGovernanceProbe(): Promise<void> {
    const scene = buildScene(path.resolve("tests/demo/rule_precision_sanitizer"));
    const escapeSig = findMethodSignature(scene, "Escape", "taint_mock");

    const sourceRules: SourceRule[] = [
        {
            id: "source.runtime.sanitizer.entry",
            sourceKind: "entry_param",
            target: "arg0",
            match: { kind: "local_name_regex", value: "^taint_src$" },
        },
    ];
    const sinkRules: SinkRule[] = [
        {
            id: "sink.runtime.sanitizer.arg0",
            target: { endpoint: "arg0" },
            match: { kind: "method_name_equals", value: "Sink" },
        },
    ];
    const sanitizerRules: SanitizerRule[] = [
        {
            id: "sanitizer.runtime.weak",
            target: { endpoint: "arg0" },
            match: { kind: "method_name_equals", value: "Escape" },
        },
        {
            id: "sanitizer.runtime.strong",
            target: { endpoint: "result" },
            match: { kind: "signature_equals", value: escapeSig },
        },
    ];

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG();
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules, { sanitizerRules });
    const sanitizedNegative = flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "sanitize_result_001_F"));
    const positiveStillDetected = flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "sanitize_result_002_T"));

    assert(!sanitizedNegative, "strong result sanitizer should sanitize the negative result case");
    assert(positiveStillDetected, "weak same-family arg0 sanitizer must not suppress the positive case");
}

async function main(): Promise<void> {
    await runSourceGovernanceProbe();
    await runTransferGovernanceProbe();
    await runSinkGovernanceProbe();
    await runSanitizerGovernanceProbe();

    console.log("====== Rule Governance Runtime Ingress ======");
    console.log("source_runtime_governance=PASS");
    console.log("sink_runtime_governance=PASS");
    console.log("sanitizer_runtime_governance=PASS");
    console.log("transfer_runtime_governance=PASS");
}

main().catch(err => {
    console.error("FAIL test_rule_governance_runtime_ingress");
    console.error(err);
    process.exitCode = 1;
});
