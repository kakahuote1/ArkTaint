import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SanitizerRule, SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";
import * as path from "path";
import {
    exactSanitizerRule,
    exactRuleRuntimeFromFixtures,
    exactSinkRule,
    exactSourceRule,
    exactTransferRule,
} from "./ExactRuleTestUtils";

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

function findMethodByName(scene: Scene, methodName: string): any {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    assert(method, `method not found: ${methodName}`);
    return method;
}

function findMethod(scene: Scene, methodName: string, signatureHint: string): any {
    const method = scene.getMethods().find(m =>
        m.getName() === methodName
        && m.getSignature().toString().includes(signatureHint),
    );
    assert(method, `method not found: ${methodName} (${signatureHint})`);
    return method;
}

function findAnyMethodSignature(scene: Scene, methodName: string): string {
    return findMethodByName(scene, methodName).getSignature().toString();
}

function findClassMethodSignature(scene: Scene, className: string, methodName: string): string {
    const method = scene.getMethods().find(m =>
        m.getName?.() === methodName
        && m.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `method not found: ${className}.${methodName}`);
    return method.getSignature().toString();
}

function findClassMethod(scene: Scene, className: string, methodName: string): any {
    const method = scene.getMethods().find(m =>
        m.getName?.() === methodName
        && m.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `method not found: ${className}.${methodName}`);
    return method;
}

function findSeedNodes(engine: TaintPropagationEngine, scene: Scene, methodName: string, localName: string): PagNode[] {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    assert(method, `method not found: ${methodName}`);
    const cfg = method.getCfg();
    assert(cfg, `cfg not found: ${methodName}`);
    for (const stmt of cfg.getStmts()) {
        const left = (stmt as any).getLeftOp?.();
        if (!left || left.getName?.() !== localName) continue;
        const nodeIds = engine.pag.getNodesByValue(left);
        return nodeIds ? [...nodeIds.values()].map(id => engine.pag.getNode(id) as PagNode) : [];
    }
    return [];
}

async function buildEngineWithExplicitEntries(
    scene: Scene,
    entryMethodNames: string[],
    options: ConstructorParameters<typeof TaintPropagationEngine>[2] = {},
): Promise<TaintPropagationEngine> {
    const engine = new TaintPropagationEngine(scene, 1, options);
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: entryMethodNames.map(name => findMethodByName(scene, name)),
    });
    return engine;
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
    const sourceEffect = exactSourceRule({
        id: "source.runtime.strong",
        sourceKind: "call_return",
        target: "result",
        method: findMethod(scene, "SourceReturn", "taint_mock"),
    });
    const sinkEffect = exactSinkRule({
        id: "sink.runtime.arg0",
        target: "arg0",
        method: findMethodByName(scene, "Sink"),
    });

    const sourceRules: SourceRule[] = [sourceEffect.rule];
    const sinkRules: SinkRule[] = [sinkEffect.rule];

    const engine = await buildEngineWithExplicitEntries(scene, ["source_call_return_001_T"], {
        ...exactRuleRuntimeFromFixtures([sourceEffect, sinkEffect]),
    });
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const detected = flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "source_call_return_001_T"));
    assert(detected, "runtime source ingress should still detect the positive case");
    assert(seedInfo.sourceRuleHits["source.runtime.strong"] > 0, "identity-complete source rule should hit after runtime family normalization");
}

async function runTransferGovernanceProbe(): Promise<void> {
    const scene = buildScene(path.resolve("tests/demo/transfer_priority"));

    const sinkEffect = exactSinkRule({
        id: "sink.runtime.transfer.arg0",
        target: "arg0",
        method: findMethodByName(scene, "Sink"),
    });
    const transferEffect = exactTransferRule({
        id: "transfer.runtime.strong",
        method: findClassMethod(scene, "PriorityHostConstrained", "Bridge"),
        from: "arg0",
        to: "result",
    });
    const sinkRules: SinkRule[] = [sinkEffect.rule];
    const strongTransfer: TransferRule = transferEffect.rule;

    const engine = await buildEngineWithExplicitEntries(scene, ["transfer_priority_002_T"], {
        transferRules: [strongTransfer],
        ...exactRuleRuntimeFromFixtures([sinkEffect, transferEffect]),
    });
    const seedNodes = findSeedNodes(engine, scene, "transfer_priority_002_T", "taint_src");
    assert(seedNodes.length > 0, "expected taint_src PAG seed nodes");
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules);
    const detected = flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "transfer_priority_002_T"));
    const transferHits = Object.entries(engine.getRuleHitCounters().transfer)
        .filter(([, hit]) => hit > 0)
        .map(([id]) => id)
        .sort();

    assert(detected, "runtime transfer ingress should still detect the constrained positive case");
    assert(transferHits.includes("transfer.runtime.strong"), "identity-complete transfer rule should hit after runtime family normalization");
}

async function runSinkGovernanceProbe(): Promise<void> {
    const scene = buildScene(path.resolve("tests/demo/rule_precision_sink"));
    const sinkEffect = exactSinkRule({
        id: "sink.runtime.strong",
        target: "arg0",
        method: findMethod(scene, "SinkArg0", "taint_mock"),
    });

    const sinkRules: SinkRule[] = [sinkEffect.rule];

    const engine = await buildEngineWithExplicitEntries(scene, ["sink_target_arg0_001_T"], {
        ...exactRuleRuntimeFromFixtures([sinkEffect]),
    });
    const seedNodes = findSeedNodes(engine, scene, "sink_target_arg0_001_T", "taint_src");
    assert(seedNodes.length > 0, "expected taint_src PAG seed nodes");
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules);
    const detected = flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "sink_target_arg0_001_T"));
    const sinkHits = Object.entries(engine.getRuleHitCounters().sink)
        .filter(([, hit]) => hit > 0)
        .map(([id]) => id)
        .sort();

    assert(detected, "runtime sink ingress should still detect the positive case");
    assert(sinkHits.includes("sink.runtime.strong"), "identity-complete sink rule should hit after runtime family normalization");
}

async function runSanitizerGovernanceProbe(): Promise<void> {
    const scene = buildScene(path.resolve("tests/demo/rule_precision_sanitizer"));
    const sinkEffect = exactSinkRule({
        id: "sink.runtime.sanitizer.arg0",
        target: "arg0",
        method: findMethodByName(scene, "Sink"),
    });
    const sanitizerEffect = exactSanitizerRule({
        id: "sanitizer.runtime.strong",
        target: "result",
        method: findMethod(scene, "Escape", "taint_mock"),
    });

    const sinkRules: SinkRule[] = [sinkEffect.rule];
    const sanitizerRules: SanitizerRule[] = [sanitizerEffect.rule];

    const engine = await buildEngineWithExplicitEntries(scene, [
        "sanitize_result_001_F",
        "sanitize_result_002_T",
    ], {
        ...exactRuleRuntimeFromFixtures([sinkEffect, sanitizerEffect]),
    });
    const negativeSeeds = findSeedNodes(engine, scene, "sanitize_result_001_F", "taint_src");
    const positiveSeeds = findSeedNodes(engine, scene, "sanitize_result_002_T", "taint_src");
    assert(negativeSeeds.length > 0 && positiveSeeds.length > 0, "expected sanitizer case seed nodes");
    engine.propagateWithSeeds([...negativeSeeds, ...positiveSeeds]);
    const flows = engine.detectSinksByRules(sinkRules, { sanitizerRules });
    const sanitizedNegative = flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "sanitize_result_001_F"));
    const positiveStillDetected = flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, "sanitize_result_002_T"));

    assert(!sanitizedNegative, "strong result sanitizer should sanitize the negative result case");
    assert(positiveStillDetected, "result sanitizer must not suppress the original dirty argument");
}

async function main(): Promise<void> {
    await runSourceGovernanceProbe();
    await runTransferGovernanceProbe();
    await runSinkGovernanceProbe();
    await runSanitizerGovernanceProbe();

    console.log("====== Rule Family Runtime Ingress ======");
    console.log("source_runtime_family=PASS");
    console.log("sink_runtime_family=PASS");
    console.log("sanitizer_runtime_family=PASS");
    console.log("transfer_runtime_family=PASS");
}

main().catch(err => {
    console.error("FAIL test_rule_governance_runtime_ingress");
    console.error(err);
    process.exitCode = 1;
});
