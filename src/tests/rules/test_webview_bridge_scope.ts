import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { SinkRule } from "../../core/rules/RuleSchema";
import * as path from "path";

interface CaseSpec {
    methodName: string;
    expected: boolean;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function findSeedNodes(engine: TaintPropagationEngine, scene: any, methodName: string, localName: string): PagNode[] {
    const method = scene.getMethods().find((m: any) => m.getName() === methodName);
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

async function runCase(scene: any, methodName: string, sinkRules: SinkRule[]): Promise<boolean> {
    const entryMethod = scene.getMethods().find((m: any) => m.getName() === methodName);
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
    const flows = engine.detectSinksByRules(sinkRules);
    return flows.length > 0;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/webview_bridge_scope");
    const scene = buildTestScene(sourceDir);

    const sinkRules: SinkRule[] = [
        {
            id: "sink.test.webview.runJavaScript.arg0",
            match: {
                kind: "method_name_equals",
                value: "runJavaScript",
                invokeKind: "instance",
            },
            scope: {
                className: { mode: "regex", value: "^(WebController|WebviewController|AtomicServiceWebController)$" },
            },
            target: { endpoint: "arg0" },
        },
    ];

    const cases: CaseSpec[] = [
        { methodName: "webview_bridge_scope_001_T", expected: true },
        { methodName: "webview_bridge_scope_002_F", expected: false },
        { methodName: "webview_bridge_scope_003_T", expected: true },
        { methodName: "webview_bridge_scope_004_T", expected: true },
    ];

    let passCount = 0;
    for (const item of cases) {
        const detected = await runCase(scene, item.methodName, sinkRules);
        const pass = detected === item.expected;
        if (pass) passCount++;
        console.log(`${pass ? "PASS" : "FAIL"} ${item.methodName} expected=${item.expected} detected=${detected}`);
    }

    console.log("====== WebView Bridge Scope Test ======");
    console.log(`total_cases=${cases.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${cases.length - passCount}`);

    if (passCount !== cases.length) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error("FAIL test_webview_bridge_scope");
    console.error(error);
    process.exitCode = 1;
});
