import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule } from "../../core/rules/RuleSchema";
import * as path from "path";

interface CaseSpec {
    methodName: string;
    expected: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
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

function flowSinkInMethod(scene: Scene, sinkStmt: any, methodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    const cfg = method?.getCfg();
    return !!cfg && cfg.getStmts().includes(sinkStmt);
}

async function runCase(scene: Scene, methodName: string, sinkRules: SinkRule[]): Promise<boolean> {
    const entryMethod = scene.getMethods().find(m => m.getName() === methodName);
    assert(entryMethod, `entry method not found: ${methodName}`);

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    const seedNodes = findSeedNodes(engine, scene, methodName, "taint_src");
    assert(seedNodes.length > 0, `${methodName}: expected taint_src seed nodes`);
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules)
        .filter(flow => flowSinkInMethod(scene, flow.sink, methodName));
    return flows.length > 0;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/sink_sdk_namespace_receiver");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const sinkRules: SinkRule[] = [
        {
            id: "sink.test.webview.runJavaScript.arg0",
            match: {
                kind: "method_name_equals",
                value: "runJavaScript",
                invokeKind: "instance",
            },
            scope: {
                className: { mode: "regex", value: "^(WebController|WebviewController)$" },
            },
            target: { endpoint: "arg0" },
        },
        {
            id: "sink.test.fs.writeSync.arg1",
            match: {
                kind: "method_name_equals",
                value: "writeSync",
                invokeKind: "instance",
            },
            scope: {
                className: { mode: "contains", value: "fs" },
            },
            target: { endpoint: "arg1" },
        },
    ];

    const cases: CaseSpec[] = [
        { methodName: "sink_sdk_namespace_receiver_001_T", expected: true },
        { methodName: "sink_sdk_namespace_receiver_002_F", expected: false },
        { methodName: "sink_sdk_namespace_receiver_003_T", expected: true },
        { methodName: "sink_sdk_namespace_receiver_004_F", expected: false },
    ];

    let passCount = 0;
    for (const item of cases) {
        const detected = await runCase(scene, item.methodName, sinkRules);
        const pass = detected === item.expected;
        if (pass) passCount++;
        console.log(`${pass ? "PASS" : "FAIL"} ${item.methodName} expected=${item.expected} detected=${detected}`);
    }

    console.log("====== Sink SDK Namespace Receiver Scope Test ======");
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
