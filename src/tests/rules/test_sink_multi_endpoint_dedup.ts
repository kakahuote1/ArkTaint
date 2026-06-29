import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { SinkRule } from "../../core/rules/RuleSchema";
import { detectFlows } from "../../cli/analyzeUtils";
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

function flowSinkInMethod(scene: Scene, sinkStmt: any, methodName: string): boolean {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    const cfg = method?.getCfg();
    return !!cfg && cfg.getStmts().includes(sinkStmt);
}

function findMethod(scene: Scene, methodName: string, signatureHint: string): any {
    const method = scene.getMethods().find(m =>
        m.getName?.() === methodName
        && m.getSignature?.().toString?.().includes(signatureHint)
    );
    assert(method, `method not found: ${methodName} (${signatureHint})`);
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
    const entryMethod = scene.getMethods().find(m => m.getName() === "sink_multi_endpoint_013_T");
    assert(entryMethod, "expected sink_multi_endpoint_013_T entry method");

    const sinkMethod = findMethod(scene, "SinkMulti", "taint_mock");
    const sinkArg0Effect = exactSinkRule({
        id: "sink.precision.multi.arg0",
        family: "sink.precision.multi",
        method: sinkMethod,
        target: "arg0",
    });
    const sinkArg1Effect = exactSinkRule({
        id: "sink.precision.multi.arg1",
        family: "sink.precision.multi",
        method: sinkMethod,
        target: "arg1",
    });
    const sinkRules: SinkRule[] = [sinkArg0Effect.rule, sinkArg1Effect.rule];
    const exactRuntime = buildExactRuleRuntime([sinkArg0Effect, sinkArg1Effect]);

    const engine = new TaintPropagationEngine(scene, 1, exactRuntime);
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    const seedNodes = findSeedNodes(engine, scene, "sink_multi_endpoint_013_T", "taint_src");
    assert(seedNodes.length > 0, "expected taint_src PAG seed nodes");
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules)
        .filter(flow => flowSinkInMethod(scene, flow.sink, "sink_multi_endpoint_013_T"));
    const endpoints = new Set(flows.map(flow => flow.sinkEndpoint));
    const summary = detectFlows(engine, {
        ruleSet: {
            sources: [],
            sinks: sinkRules,
            transfers: [],
        },
        assets: exactRuntime.apiAssets,
        assetIdentityIndex: exactRuntime.assetIdentityIndex,
        canonicalApiRegistry: exactRuntime.canonicalApiRegistry,
        ruleCatalogPath: "",
        enabledRulePacks: [],
        discoveredRulePacks: [],
        extraRulePaths: [],
        appliedRuleSources: [],
        ruleSourceStatus: [],
        warnings: [],
    });
    const summaryEndpoints = new Set(
        summary.flowRuleTraces
            .filter(trace => trace.sink.includes("SinkMulti"))
            .map(trace => trace.sinkEndpoint)
    );

    console.log("====== Sink Multi Endpoint Dedup Test ======");
    console.log(`seed_count=${seedNodes.length}`);
    console.log(`flow_count=${flows.length}`);
    console.log(`endpoints=${[...endpoints].sort().join(",")}`);
    console.log(`summary_endpoints=${[...summaryEndpoints].sort().join(",")}`);

    assert(endpoints.has("arg0"), "expected arg0 flow to be retained");
    assert(endpoints.has("arg1"), "expected arg1 flow to be retained");
    assert(summary.totalFlowCount >= 2, "expected analyze summary to retain endpoint-distinct flows");
    assert(summaryEndpoints.has("arg0"), "expected analyze summary arg0 flow");
    assert(summaryEndpoints.has("arg1"), "expected analyze summary arg1 flow");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
