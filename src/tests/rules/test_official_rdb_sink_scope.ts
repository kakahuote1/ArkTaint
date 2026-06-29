import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { SinkRule } from "../../core/rules/RuleSchema";
import { loadRuleSet } from "../../core/rules/RuleLoader";
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

function loadRdbValuesSinkRules(): SinkRule[] {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    return (loaded.ruleSet.sinks || [])
        .filter(rule => rule.id === "sink.harmony.rdb.update.values.arg0.for.sink.harmony.rdb.update.values.arg0.0.exact.update.class.RdbStore");
}

async function detectCase(scene: Scene, methodName: string, sinkRules: SinkRule[]): Promise<boolean> {
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
    const sourceDir = path.resolve("tests/demo/rule_precision_sink");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const sinkRules = loadRdbValuesSinkRules();
    assert(sinkRules.length === 1, "expected RDB values sink rule");

    const officialDetected = await detectCase(scene, "sink_official_rdb_scope_015_T", sinkRules);
    const wrapperDetected = await detectCase(scene, "sink_official_rdb_scope_016_F", sinkRules);

    console.log("====== Official RDB Sink Scope Test ======");
    console.log(`official_detected=${officialDetected}`);
    console.log(`wrapper_detected=${wrapperDetected}`);

    assert(officialDetected, "expected official RdbStore.update to be detected");
    assert(!wrapperDetected, "expected project RdbStoreUtil.update wrapper not to match official RDB sink");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
