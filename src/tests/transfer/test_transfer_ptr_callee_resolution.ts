import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, TransferRule } from "../../core/rules/RuleSchema";
import { validateRuleSet } from "../../core/rules/RuleValidator";
import {
    exactSinkRule,
    exactTransferRule,
    type ExactRuleRuntime,
} from "../rules/ExactRuleTestUtils";
import {
    assertCanonicalExactRules,
    exactTransferRuntimeFromFixtures,
} from "./ExactTransferTestUtils";
import * as path from "path";

interface CaseSpec {
    name: string;
    expected: boolean;
}

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
    sinkRules: SinkRule[],
    transferRules: TransferRule[],
    runtime: ExactRuleRuntime,
): Promise<boolean> {
    const caseMethod = scene.getMethods().find(m => m.getName() === caseName);
    assert(caseMethod, `case method not found: ${caseName}`);
    const engine = new TaintPropagationEngine(scene, 1, { ...runtime, transferRules, includeBuiltinModules: false });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [caseMethod],
    });
    engine.setActiveReachableMethodSignatures(undefined, { mergeExplicitEntryScope: false });
    const seedNodes = findSeedNodes(engine, scene, caseName, "taint_src");
    assert(seedNodes.length > 0, `${caseName}: expected taint_src seed nodes`);
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules);
    const scopedFlows = flows.filter(flow => flowSinkInCaseMethod(scene, flow.sink, caseName));
    return scopedFlows.length > 0;
}

function findMethod(scene: Scene, methodName: string, fileHint?: string) {
    const method = scene.getMethods().find(m => {
        if (m.getName() !== methodName) return false;
        const sig = m.getSignature?.().toString?.() || "";
        return !fileHint || sig.includes(fileHint);
    });
    assert(method, `method not found: ${methodName}${fileHint ? ` in ${fileHint}` : ""}`);
    return method;
}

function findSeedNodes(engine: TaintPropagationEngine, scene: Scene, methodName: string, localName: string): PagNode[] {
    const method = findMethod(scene, methodName);
    const local = method.getBody?.()?.getLocals?.()?.get(localName);
    if (local) {
        const nodeIds = engine.pag.getNodesByValue(local);
        if (nodeIds) return [...nodeIds.values()].map(id => engine.pag.getNode(id) as PagNode);
    }
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

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_transfer_ptr");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const bridgePtrMethod = findMethod(scene, "BridgePtr", "/taint_mock.ts");
    const cases: CaseSpec[] = [
        { name: "transfer_ptr_signature_001_T", expected: true },
        { name: "transfer_ptr_signature_002_F", expected: false },
    ];

    const sinkEffect = exactSinkRule({
        id: "sink.ptr.arg0",
        method: findMethod(scene, "Sink"),
        target: { endpoint: "arg0" },
    });
    const transferEffect = exactTransferRule({
        id: "transfer.ptr.canonical.bridge",
        method: bridgePtrMethod,
        from: "arg0",
        to: "result",
    });
    const exactRuntime = exactTransferRuntimeFromFixtures([
        sinkEffect,
        transferEffect,
    ]);
    const sinkRules: SinkRule[] = [sinkEffect.rule];
    const transferRules: TransferRule[] = [transferEffect.rule];
    assertCanonicalExactRules([...sinkRules, ...transferRules]);

    const validation = validateRuleSet({
        sources: [],
        sinks: sinkRules,
        transfers: transferRules,
    });
    assert(validation.valid, `ptr transfer rules invalid: ${validation.errors.join("; ")}`);

    let passCount = 0;
    for (const c of cases) {
        const detectedWithRules = await runCase(scene, c.name, sinkRules, transferRules, exactRuntime);
        const detectedWithoutRules = await runCase(scene, c.name, sinkRules, [], exactRuntime);
        const pass = c.expected
            ? (detectedWithRules && !detectedWithoutRules)
            : !detectedWithRules;
        if (pass) passCount++;

        console.log(
            `${pass ? "PASS" : "FAIL"} ${c.name} expected=${c.expected ? "T" : "F"} `
            + `withRules=${detectedWithRules} withoutRules=${detectedWithoutRules}`
        );
    }

    console.log("====== Transfer Ptr Callee Resolution Test ======");
    console.log(`total_cases=${cases.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${cases.length - passCount}`);

    if (passCount !== cases.length) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});


