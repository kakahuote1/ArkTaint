import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { SinkRule } from "../../core/rules/RuleSchema";
import { createAssetIdentityIndex, type AssetDocumentBase, type AssetIdentityIndex } from "../../core/assets/schema";
import { createCanonicalApiRegistry } from "../../core/api/identity";
import type { CanonicalApiRegistry } from "../../core/api/identity";
import * as path from "path";
import { exactSinkRule } from "./ExactRuleTestUtils";

type ExactSinkFixture = ReturnType<typeof exactSinkRule>;

interface ExactRuleRuntime {
    apiAssets: AssetDocumentBase[];
    canonicalApiRegistry: CanonicalApiRegistry;
    assetIdentityIndex: AssetIdentityIndex;
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

function findClassMethod(scene: Scene, className: string, methodName: string): any {
    const method = scene.getMethods().find(m =>
        m.getName?.() === methodName
        && m.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `method not found: ${className}.${methodName}`);
    return method;
}

function buildExactRuleRuntime(fixtures: ExactSinkFixture[]): ExactRuleRuntime {
    const descriptorsById = new Map<string, ExactSinkFixture["exact"]["canonicalApiDescriptor"]>();
    for (const fixture of fixtures) {
        descriptorsById.set(fixture.exact.canonicalApiDescriptor.canonicalApiId, fixture.exact.canonicalApiDescriptor);
    }
    const canonicalApiRegistry = createCanonicalApiRegistry([...descriptorsById.values()]);
    const assetIdentityIndex = createAssetIdentityIndex({ canonicalApiRegistry });
    const apiAssets = fixtures.map(fixture => fixture.asset);
    for (const asset of apiAssets) {
        assetIdentityIndex.addAsset(asset);
    }
    return { apiAssets, canonicalApiRegistry, assetIdentityIndex };
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

    const wrongIdentityEffect = exactSinkRule({
        id: "sink.test.rdb_store.wrong_identity.arg0",
        family: "sink.test.rdb_util.update",
        method: findClassMethod(scene, "RdbStore", "update"),
        target: "arg0",
    });
    const correctIdentityEffect = exactSinkRule({
        id: "sink.test.rdb_util.correct_identity.arg0",
        family: "sink.test.rdb_util.update",
        method: findClassMethod(scene, "RdbStoreUtil", "update"),
        target: "arg0",
    });
    const sinkRules: SinkRule[] = [wrongIdentityEffect.rule, correctIdentityEffect.rule];
    const exactRuntime = buildExactRuleRuntime([wrongIdentityEffect, correctIdentityEffect]);

    const engine = new TaintPropagationEngine(scene, 1, exactRuntime);
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });

    const seedNodes = findSeedNodes(engine, scene, methodName, "taint_src");
    assert(seedNodes.length > 0, "expected taint_src PAG seed nodes");
    engine.propagateWithSeeds(seedNodes);

    const flows = engine.detectSinksByRules(sinkRules)
        .filter(flow => flowSinkInMethod(scene, flow.sink, methodName));

    console.log("====== Sink Canonical Identity Cache Isolation Test ======");
    console.log(`flow_count=${flows.length}`);
    console.log(`sink_rules=${flows.map(flow => flow.sinkRuleId || "<none>").join(",")}`);

    assert(flows.length > 0, "expected second canonical-id rule to detect the sink despite first canonical-id miss");
    assert(flows.every(flow => flow.sinkRuleId === "sink.test.rdb_util.correct_identity.arg0"),
        "expected only the correctly identified sink rule to produce flows");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
