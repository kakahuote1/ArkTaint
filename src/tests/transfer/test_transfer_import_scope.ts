import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule, TransferRule } from "../../core/rules/RuleSchema";
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

async function runCase(
    scene: Scene,
    methodName: string,
    sourceRules: SourceRule[],
    sinkRules: SinkRule[],
    transferRules: TransferRule[]
): Promise<boolean> {
    const entryMethod = scene.getMethods().find(m => m.getName() === methodName);
    assert(entryMethod, `entry method not found: ${methodName}`);

    const engine = new TaintPropagationEngine(scene, 1, { transferRules });
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
    const sourceDir = path.resolve("tests/demo/transfer_import_scope");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const sourceRules: SourceRule[] = [{
        id: "source.test.entry_param.taint_src",
        match: { kind: "local_name_regex", value: "^taint_src$" },
        sourceKind: "entry_param",
        target: { endpoint: "arg0" },
    }];
    const sinkRules: SinkRule[] = [{
        id: "sink.test.arg0",
        match: { kind: "method_name_equals", value: "Sink" },
        target: { endpoint: "arg0" },
    }];
    const transferRules: TransferRule[] = [{
        id: "transfer.test.ohos_axios_get.arg0_to_result",
        match: {
            kind: "method_name_equals",
            value: "get",
            invokeKind: "instance",
            argCount: 1,
            typeHint: "axios",
        },
        scope: {
            module: { mode: "contains", value: "@ohos/axios" },
        },
        from: "arg0",
        to: "result",
    }];

    const cases: CaseSpec[] = [
        { methodName: "transfer_import_scope_001_T", expected: true },
        { methodName: "transfer_import_scope_002_F", expected: false },
    ];

    let passCount = 0;
    for (const item of cases) {
        const detected = await runCase(scene, item.methodName, sourceRules, sinkRules, transferRules);
        const pass = detected === item.expected;
        if (pass) passCount++;
        console.log(`${pass ? "PASS" : "FAIL"} ${item.methodName} expected=${item.expected} detected=${detected}`);
    }

    console.log("====== Transfer Import Scope Test ======");
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
