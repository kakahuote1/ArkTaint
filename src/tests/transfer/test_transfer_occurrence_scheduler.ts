import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, TransferRule } from "../../core/rules/RuleSchema";
import {
    exactRuleRuntimeFromFixtures,
    exactSinkRule,
    exactTransferRule,
    type ExactRuleRuntime,
} from "../rules/ExactRuleTestUtils";
import { findLocalSeedNodes } from "./ExactTransferTestUtils";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function findMethodForClass(scene: Scene, className: string, methodName: string) {
    const method = scene.getMethods().find(candidate =>
        candidate.getName?.() === methodName
        && candidate.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `method not found: ${className}.${methodName}`);
    return method;
}

function findMethod(scene: Scene, methodName: string) {
    const method = scene.getMethods().find(candidate => candidate.getName?.() === methodName);
    assert(method, `method not found: ${methodName}`);
    return method;
}

function flowSinkInCaseMethod(scene: Scene, sinkStmt: any, caseMethodName: string): boolean {
    const method = scene.getMethods().find(candidate => candidate.getName?.() === caseMethodName);
    if (!method) return false;
    const cfg = method.getCfg();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

async function runEngineCase(input: {
    scene: Scene;
    caseName: string;
    sinkRules: SinkRule[];
    transferRules: TransferRule[];
    runtime: ExactRuleRuntime;
}): Promise<{
    detected: boolean;
    seedNodes: PagNode[];
    transferProfile: NonNullable<ReturnType<TaintPropagationEngine["getWorklistProfile"]>>["transfer"];
}> {
    const entryMethod = findMethod(input.scene, input.caseName);
    const engine = new TaintPropagationEngine(input.scene, 1, {
        ...input.runtime,
        transferRules: input.transferRules,
        includeBuiltinModules: false,
        debug: { enableWorklistProfile: true },
    });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    engine.setActiveReachableMethodSignatures(undefined, { mergeExplicitEntryScope: false });
    const seedNodes = findLocalSeedNodes(engine, input.scene, input.caseName, "taint_src");
    assert(seedNodes.length > 0, `${input.caseName}: expected taint_src seed nodes`);
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(input.sinkRules);
    const scopedFlows = flows.filter(flow => flowSinkInCaseMethod(input.scene, flow.sink, input.caseName));
    const profile = engine.getWorklistProfile();
    assert(profile, "worklist profile should be enabled for transfer scheduler test");
    return {
        detected: scopedFlows.length > 0,
        seedNodes,
        transferProfile: profile.transfer,
    };
}

function findConsumption(profile: { siteConsumptions: any[] }, ruleId: string, blockedReason?: string): any {
    return (profile.siteConsumptions || []).find(item =>
        item.ruleId === ruleId
        && (blockedReason === undefined || item.blockedReason === blockedReason)
    );
}

function findProjectedConsumption(profile: { siteConsumptions: any[] }, ruleId: string): any {
    return (profile.siteConsumptions || []).find(item =>
        item.ruleId === ruleId
        && item.scheduled === true
        && item.fromMatched === true
        && item.toProjected === true
    );
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_transfer");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const caseName = "transfer_invoke_kind_003_T";
    const bridgeMethod = findMethodForClass(scene, "InvokeKindHost", "BridgeInvokeKind");
    const sinkMethod = findMethod(scene, "Sink");
    const sink = exactSinkRule({
        id: "sink.p7.transfer.scheduler.arg0",
        method: sinkMethod,
        target: "arg0",
    });
    const acceptedTransfer = exactTransferRule({
        id: "transfer.p7.scheduler.accepted.arg0_to_result",
        method: bridgeMethod,
        from: "arg0",
        to: "result",
    });
    const unresolvedToTransfer = exactTransferRule({
        id: "transfer.p7.scheduler.accepted.arg0_to_missing_arg1",
        method: bridgeMethod,
        from: "arg0",
        to: "arg1",
    });

    const acceptedRun = await runEngineCase({
        scene,
        caseName,
        sinkRules: [sink.rule],
        transferRules: [acceptedTransfer.rule],
        runtime: exactRuleRuntimeFromFixtures([sink, acceptedTransfer]),
    });
    assert(acceptedRun.detected, "accepted transfer site should produce a sink flow");
    const acceptedConsumption = findProjectedConsumption(acceptedRun.transferProfile, acceptedTransfer.rule.id);
    assert(acceptedConsumption, "accepted engine run should write transfer site consumption");
    assert(acceptedConsumption.scheduled === true, "accepted engine transfer should be scheduled");
    assert(acceptedConsumption.fromMatched === true, "accepted engine transfer should match from endpoint");
    assert(acceptedConsumption.toProjected === true, "accepted engine transfer should project to endpoint");
    assert(acceptedConsumption.resultCount > 0, "accepted engine transfer should emit target fact");
    assert(!acceptedConsumption.blockedReason, "accepted engine transfer should not be blocked");

    const unresolvedToRun = await runEngineCase({
        scene,
        caseName,
        sinkRules: [sink.rule],
        transferRules: [unresolvedToTransfer.rule],
        runtime: exactRuleRuntimeFromFixtures([sink, unresolvedToTransfer]),
    });
    assert(!unresolvedToRun.detected, "unresolved to endpoint must not produce a sink flow");
    const unresolvedToConsumption = findConsumption(
        unresolvedToRun.transferProfile,
        unresolvedToTransfer.rule.id,
        "to_endpoint_unresolved",
    );
    assert(unresolvedToConsumption, "unresolved to endpoint should write blocked site consumption");
    assert(unresolvedToConsumption.scheduled === true, "unresolved to endpoint should still be an accepted scheduled site");
    assert(unresolvedToConsumption.fromMatched === true, "unresolved to endpoint should keep fromMatched=true");
    assert(unresolvedToConsumption.toProjected === false, "unresolved to endpoint must not project target");
    assert(unresolvedToConsumption.toEndpoint.status !== "resolved", "unresolved to endpoint status must not be resolved");

    const noAcceptedRun = await runEngineCase({
        scene,
        caseName,
        sinkRules: [sink.rule],
        transferRules: [acceptedTransfer.rule],
        runtime: exactRuleRuntimeFromFixtures([sink]),
    });
    assert(!noAcceptedRun.detected, "missing accepted transfer site must not produce a sink flow");
    const noAcceptedConsumption = findConsumption(
        noAcceptedRun.transferProfile,
        acceptedTransfer.rule.id,
        "no_transfer_effect_site",
    );
    assert(noAcceptedConsumption, "missing accepted transfer site should write no_transfer_effect_site reason");
    assert(noAcceptedConsumption.scheduled === false, "missing accepted transfer site must not be scheduled");
    assert(noAcceptedConsumption.fromMatched === false, "missing accepted transfer site must not match from endpoint");
    assert(noAcceptedConsumption.toProjected === false, "missing accepted transfer site must not project target");

    console.log("PASS test_transfer_occurrence_scheduler");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
