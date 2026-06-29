import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
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

function assertCanonicalExactRules(rules: Array<SourceRule | SinkRule>): void {
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
    sourceRules: SourceRule[],
    sinkRules: SinkRule[],
    runtime: ExactRuleRuntime,
): Promise<boolean> {
    const caseMethod = scene.getMethods().find(m => m.getName() === caseName);
    assert(caseMethod, `case method not found: ${caseName}`);
    const engine = new TaintPropagationEngine(scene, 1, runtime);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "explicit", syntheticEntryMethods: [caseMethod] });
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const scopedFlows = flows.filter(flow => flowSinkInCaseMethod(scene, flow.sink, caseName));
    return scopedFlows.length > 0;
}

async function collectSourceHits(
    scene: Scene,
    caseName: string,
    sourceRules: SourceRule[],
    runtime: ExactRuleRuntime,
): Promise<Record<string, number>> {
    const caseMethod = scene.getMethods().find(m => m.getName() === caseName);
    assert(caseMethod, `case method not found: ${caseName}`);
    const engine = new TaintPropagationEngine(scene, 1, runtime);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "explicit", syntheticEntryMethods: [caseMethod] });
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    return seedInfo.sourceRuleHits;
}

function findMethod(scene: Scene, methodName: string, signatureHint: string) {
    const method = scene.getMethods().find(m =>
        m.getName() === methodName
        && m.getSignature().toString().includes(signatureHint)
    );
    assert(method, `method not found: ${methodName} (${signatureHint})`);
    return method;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/rule_precision_source");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const sourceReturnMethod = findMethod(scene, "SourceReturn", "taint_mock");
    const sourceArgMethod = findMethod(scene, "SourceArg", "taint_mock");
    const sinkMethod = findMethod(scene, "Sink", "taint_mock");
    const sourceReturnEffect = projectApiEffectAssetFromMethod({
        id: "source.return",
        role: "source",
        method: sourceReturnMethod,
        endpoint: { base: { kind: "return" } },
        sourceKind: "call_return",
    });
    const sourceArgEffect = projectApiEffectAssetFromMethod({
        id: "source.arg",
        role: "source",
        method: sourceArgMethod,
        endpoint: { base: { kind: "arg", index: 1 } },
        sourceKind: "call_arg",
    });
    const sinkEffect = projectApiEffectAssetFromMethod({
        id: "sink.arg0",
        role: "sink",
        method: sinkMethod,
        endpoint: { base: { kind: "arg", index: 0 } },
        sinkKind: "test",
    });
    const exactRuntime = buildExactRuleRuntime([sourceReturnEffect, sourceArgEffect, sinkEffect]);

    const sourceRules: SourceRule[] = [
        {
            id: "source.exact.canonical_api_id.call_return",
            sourceKind: "call_return",
            target: "result",
            match: canonicalApiIdMatch(sourceReturnEffect),
            apiEffect: sourceReturnEffect.apiEffect,
        },
        {
            id: "source.exact.canonical_api_id.call_arg",
            sourceKind: "call_arg",
            target: "arg1",
            match: canonicalApiIdMatch(sourceArgEffect),
            apiEffect: sourceArgEffect.apiEffect,
        },
    ];

    const sinkRules: SinkRule[] = [
        {
            id: "sink.exact.arg0",
            target: { endpoint: "arg0" },
            match: canonicalApiIdMatch(sinkEffect),
            apiEffect: sinkEffect.apiEffect,
        },
    ];
    assertCanonicalExactRules([...sourceRules, ...sinkRules]);

    const validation = validateRuleSet({
        sources: sourceRules,
        sinks: sinkRules,
        transfers: [],
    });
    assert(validation.valid, `source canonical identity exactness rules invalid: ${validation.errors.join("; ")}`);

    const cases: CaseSpec[] = [
        { name: "source_call_return_001_T", expected: true },
        { name: "source_call_return_002_F", expected: false },
        { name: "source_call_arg_003_T", expected: true },
        { name: "source_call_arg_004_F", expected: false },
    ];

    let passCount = 0;
    for (const c of cases) {
        const detectedWithRules = await runCase(scene, c.name, sourceRules, sinkRules, exactRuntime);
        const detectedWithoutRules = await runCase(scene, c.name, [], sinkRules, exactRuntime);
        const pass = c.expected
            ? (detectedWithRules && !detectedWithoutRules)
            : !detectedWithRules;
        if (pass) passCount++;

        console.log(
            `${pass ? "PASS" : "FAIL"} ${c.name} expected=${c.expected ? "T" : "F"} `
            + `withRules=${detectedWithRules} withoutRules=${detectedWithoutRules}`
        );
    }

    const multiAEffect = projectApiEffectAssetFromMethod({
        id: "source.multi.a",
        role: "source",
        method: sourceArgMethod,
        endpoint: { base: { kind: "arg", index: 1 } },
        sourceKind: "call_arg",
    });
    const multiBEffect = projectApiEffectAssetFromMethod({
        id: "source.multi.b",
        role: "source",
        method: sourceArgMethod,
        endpoint: { base: { kind: "arg", index: 1 } },
        sourceKind: "call_arg",
    });
    const multiLabelRules: SourceRule[] = [
        {
            id: "source.multi_label.a",
            sourceKind: "call_arg",
            target: "arg1",
            match: canonicalApiIdMatch(multiAEffect),
            apiEffect: multiAEffect.apiEffect,
        },
        {
            id: "source.multi_label.b",
            sourceKind: "call_arg",
            target: "arg1",
            match: canonicalApiIdMatch(multiBEffect),
            apiEffect: multiBEffect.apiEffect,
        },
    ];
    assertCanonicalExactRules(multiLabelRules);
    const multiRuntime = buildExactRuleRuntime([multiAEffect, multiBEffect]);
    const multiLabelHits = await collectSourceHits(scene, "source_call_arg_003_T", multiLabelRules, multiRuntime);
    assert(
        multiLabelHits["source.multi_label.a"] === 1 && multiLabelHits["source.multi_label.b"] === 1,
        `same seed location should preserve distinct source labels, hits=${JSON.stringify(multiLabelHits)}`
    );

    const duplicateSameSourceHits = await collectSourceHits(
        scene,
        "source_call_arg_003_T",
        [multiLabelRules[0], multiLabelRules[0]],
        buildExactRuleRuntime([multiAEffect]),
    );
    assert(
        duplicateSameSourceHits["source.multi_label.a"] === 1,
        `same source label should still be deduplicated, hits=${JSON.stringify(duplicateSameSourceHits)}`
    );

    console.log("====== Source Canonical Identity Exactness Test ======");
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


