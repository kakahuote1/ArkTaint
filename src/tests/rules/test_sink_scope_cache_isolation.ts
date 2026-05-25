import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { SinkRule } from "../../core/rules/RuleSchema";
import * as path from "path";

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

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_sink");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const methodName = "sink_official_rdb_scope_016_F";
    const entryMethod = scene.getMethods().find(m => m.getName() === methodName);
    assert(entryMethod, `entry method not found: ${methodName}`);

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });

    const seedNodes = findSeedNodes(engine, scene, methodName, "taint_src");
    assert(seedNodes.length > 0, "expected taint_src PAG seed nodes");
    engine.propagateWithSeeds(seedNodes);

    const updateSignature = "@rule_precision_sink/taint_mock.ts: taint.RdbStoreUtil.[static]update(any, any, any)";
    const sinkRules: SinkRule[] = [
        {
            id: "sink.test.rdb_util.wrong_scope.arg0",
            family: "sink.test.rdb_util.update",
            tier: "B",
            match: {
                kind: "signature_equals",
                value: updateSignature,
                invokeKind: "static",
                argCount: 3,
            },
            scope: {
                className: { mode: "equals", value: "DefinitelyNotRdbStoreUtil" },
            },
            target: { endpoint: "arg0" },
        },
        {
            id: "sink.test.rdb_util.correct_scope.arg0",
            family: "sink.test.rdb_util.update",
            tier: "C",
            match: {
                kind: "signature_equals",
                value: updateSignature,
                invokeKind: "static",
                argCount: 3,
            },
            scope: {
                className: { mode: "contains", value: "RdbStoreUtil" },
            },
            target: { endpoint: "arg0" },
        },
    ];

    const flows = engine.detectSinksByRules(sinkRules)
        .filter(flow => flowSinkInMethod(scene, flow.sink, methodName));

    console.log("====== Sink Scope Cache Isolation Test ======");
    console.log(`flow_count=${flows.length}`);
    console.log(`sink_rules=${flows.map(flow => flow.sinkRuleId || "<none>").join(",")}`);

    assert(flows.length > 0, "expected second scoped rule to detect the sink despite first scoped rule miss");
    assert(flows.every(flow => flow.sinkRuleId === "sink.test.rdb_util.correct_scope.arg0"),
        "expected only the correctly scoped sink rule to produce flows");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
