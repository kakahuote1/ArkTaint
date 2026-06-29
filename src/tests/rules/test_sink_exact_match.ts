import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule } from "../../core/rules/RuleSchema";
import { createAssetIdentityIndex, type AssetDocumentBase, type AssetIdentityIndex } from "../../core/assets/schema";
import { createCanonicalApiRegistry, type CanonicalApiRegistry } from "../../core/api/identity";
import { validateRuleSet } from "../../core/rules/RuleValidator";
import { projectApiEffectAssetFromMethod, type TestApiEffectAsset } from "../helpers/ApiEffectTestAssets";
import * as path from "path";

interface CaseSpec {
    name: string;
    expected: boolean;
}

interface ExactRuleRuntime {
    apiAssets: AssetDocumentBase[];
    canonicalApiRegistry: CanonicalApiRegistry;
    assetIdentityIndex: AssetIdentityIndex;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function canonicalApiIdMatch(exact: TestApiEffectAsset): { kind: "canonical_api_id_equals"; value: string } {
    return { kind: "canonical_api_id_equals", value: exact.apiEffect.canonicalApiId };
}

function assertCanonicalExactRules(rules: SinkRule[]): void {
    for (const rule of rules) {
        assert(rule.match.kind === "canonical_api_id_equals", `${rule.id} must use canonical API identity`);
        assert(
            rule.match.value === rule.apiEffect.canonicalApiId,
            `${rule.id} match value must equal apiEffect.canonicalApiId`
        );
    }
}

function buildExactRuleRuntime(effects: TestApiEffectAsset[]): ExactRuleRuntime {
    const descriptorsById = new Map<string, TestApiEffectAsset["canonicalApiDescriptor"]>();
    for (const effect of effects) {
        descriptorsById.set(effect.canonicalApiDescriptor.canonicalApiId, effect.canonicalApiDescriptor);
    }
    const canonicalApiRegistry = createCanonicalApiRegistry([...descriptorsById.values()]);
    const assetIdentityIndex = createAssetIdentityIndex({ canonicalApiRegistry });
    const apiAssets = effects.map(effect => effect.asset);
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
    runtime: ExactRuleRuntime,
): Promise<boolean> {
    const caseMethod = scene.getMethods().find(m => m.getName() === caseName);
    assert(caseMethod, `case method not found: ${caseName}`);
    const engine = new TaintPropagationEngine(scene, 1, runtime);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "explicit", syntheticEntryMethods: [caseMethod] });
    const seedNodes = findSeedNodes(engine, scene, caseName, "taint_src");
    assert(seedNodes.length > 0, `${caseName}: expected taint_src seed nodes`);
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules);
    const scopedFlows = flows.filter(flow => flowSinkInCaseMethod(scene, flow.sink, caseName));
    return scopedFlows.length > 0;
}

function findMethod(scene: Scene, methodName: string, signatureHint: string) {
    const method = scene.getMethods().find(m =>
        m.getName() === methodName
        && m.getSignature().toString().includes(signatureHint)
    );
    assert(method, `method not found: ${methodName} (${signatureHint})`);
    return method;
}

function findMethodForClass(scene: Scene, className: string, methodName: string) {
    const method = scene.getMethods().find(m =>
        m.getName() === methodName
        && m.getDeclaringArkClass?.()?.getName?.() === className
    );
    assert(method, `method not found: ${className}.${methodName}`);
    return method;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_sink");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const sinkArg0Method = findMethod(scene, "SinkArg0", "taint_mock");
    const sinkArg1Method = findMethod(scene, "SinkArg1", "taint_mock");
    const sinkInvokeKindMethod = findMethodForClass(scene, "InvokeKindHost", "SinkInvokeKind");
    const sinkArg0Effect = projectApiEffectAssetFromMethod({
        id: "sink.arg0",
        role: "sink",
        method: sinkArg0Method,
        endpoint: { base: { kind: "arg", index: 0 } },
        sinkKind: "test",
    });
    const sinkArg1Effect = projectApiEffectAssetFromMethod({
        id: "sink.arg1",
        role: "sink",
        method: sinkArg1Method,
        endpoint: { base: { kind: "arg", index: 1 } },
        sinkKind: "test",
    });
    const sinkInvokeKindEffect = projectApiEffectAssetFromMethod({
        id: "sink.invokeKind",
        role: "sink",
        method: sinkInvokeKindMethod,
        endpoint: { base: { kind: "arg", index: 0 } },
        sinkKind: "test",
    });
    const cases: CaseSpec[] = [
        { name: "sink_target_arg0_001_T", expected: true },
        { name: "sink_target_arg0_002_F", expected: false },
        { name: "sink_target_arg1_003_T", expected: true },
        { name: "sink_target_arg1_004_F", expected: false },
        { name: "sink_invoke_kind_007_T", expected: true },
        { name: "sink_invoke_kind_008_F", expected: false },
    ];

    const exactRuntime = buildExactRuleRuntime([
        sinkArg0Effect,
        sinkArg1Effect,
        sinkInvokeKindEffect,
    ]);

    const sinkRules: SinkRule[] = [
        {
            id: "sink.exact.canonical_api_id.arg0",
            target: { endpoint: "arg0" },
            match: canonicalApiIdMatch(sinkArg0Effect),
            apiEffect: sinkArg0Effect.apiEffect,
        },
        {
            id: "sink.exact.canonical_api_id.arg1",
            target: { endpoint: "arg1" },
            match: canonicalApiIdMatch(sinkArg1Effect),
            apiEffect: sinkArg1Effect.apiEffect,
        },
        {
            id: "sink.exact.canonical_api_id.invoke_kind_host",
            target: { endpoint: "arg0" },
            match: canonicalApiIdMatch(sinkInvokeKindEffect),
            apiEffect: sinkInvokeKindEffect.apiEffect,
        },
    ];
    assertCanonicalExactRules(sinkRules);

    const validation = validateRuleSet({
        sources: [],
        sinks: sinkRules,
        transfers: [],
    });
    assert(validation.valid, `sink canonical identity exactness rules invalid: ${validation.errors.join("; ")}`);

    let passCount = 0;
    for (const c of cases) {
        const detectedWithRules = await runCase(scene, c.name, sinkRules, exactRuntime);
        const detectedWithoutRules = await runCase(scene, c.name, [], exactRuntime);
        const pass = c.expected
            ? (detectedWithRules && !detectedWithoutRules)
            : !detectedWithRules;
        if (pass) passCount++;

        console.log(
            `${pass ? "PASS" : "FAIL"} ${c.name} expected=${c.expected ? "T" : "F"} `
            + `withRules=${detectedWithRules} withoutRules=${detectedWithoutRules}`
        );
    }

    console.log("====== Sink Canonical Identity Exactness Test ======");
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


