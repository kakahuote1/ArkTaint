import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { SinkRule } from "../../core/rules/RuleSchema";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function flowSinkInMethod(scene: Scene, sinkStmt: any, methodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    const cfg = method?.getCfg();
    return !!cfg && cfg.getStmts().includes(sinkStmt);
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

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_sink");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();
    const entryMethod = scene.getMethods().find(m => m.getName() === "sink_object_field_payload_014_T");
    assert(entryMethod, "expected sink_object_field_payload_014_T entry method");

    const sinkRules: SinkRule[] = [
        {
            id: "sink.precision.object.payload",
            match: { kind: "method_name_equals", value: "SinkField" },
            target: { endpoint: "arg0" },
        },
    ];

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    const seedNodes = findSeedNodes(engine, scene, "sink_object_field_payload_014_T", "taint_src");
    assert(seedNodes.length > 0, "expected taint_src PAG seed nodes");
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules)
        .filter(flow => flowSinkInMethod(scene, flow.sink, "sink_object_field_payload_014_T"));

    console.log("====== Sink Object Field Payload Test ======");
    console.log(`seed_count=${seedNodes.length}`);
    console.log(`flow_count=${flows.length}`);
    console.log(`field_paths=${flows.map(flow => flow.sinkFieldPath?.join(".") || "<whole>").join(",")}`);

    assert(flows.length >= 1, "expected whole-object sink to observe tainted object field");
    assert(flows.some(flow => flow.sinkEndpoint === "arg0" && flow.sinkFieldPath?.join(".") === "name"),
        "expected arg0 flow to retain the concrete field path name");
    assert(flows.some(flow => flow.sinkEndpoint === "arg0" && flow.sinkFieldPath?.join(".") === "phone"),
        "expected arg0 flow to retain the concrete field path phone");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
