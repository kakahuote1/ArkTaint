import * as path from "path";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import type { AssetDocumentBase } from "../../core/assets/schema";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import type { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { validateRuleSet } from "../../core/rules/RuleValidator";
import { projectApiEffectAssetFromMethod } from "../helpers/ApiEffectTestAssets";
import { exactRuleRuntimeFromAssets, type ExactRuleRuntime } from "./ExactRuleTestUtils";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function promiseResultSourceAsset(scene: Scene): AssetDocumentBase {
    return projectApiEffectAssetFromMethod({
        id: "PromiseApi.fetch.promiseResult.source",
        role: "source",
        method: findMethod(scene, "fetch"),
        endpoint: { base: { kind: "promiseResult" } },
        sourceKind: "call_return",
    }).asset;
}

function findMethod(scene: Scene, methodName: string) {
    const method = scene.getMethods().find(item => item.getName?.() === methodName);
    assert(method, `method not found: ${methodName}`);
    return method;
}

function buildSinkRules(scene: Scene): { rules: SinkRule[]; assets: AssetDocumentBase[] } {
    const sinkEffect = projectApiEffectAssetFromMethod({
        id: "sink.promise_result_source.taint_sink",
        role: "sink",
        method: findMethod(scene, "Sink"),
        endpoint: { base: { kind: "arg", index: 0 } },
        sinkKind: "test",
    });
    return {
        assets: [sinkEffect.asset],
        rules: [{
            id: "sink.promise_result_source.taint_sink",
            match: { kind: "canonical_api_id_equals", value: sinkEffect.canonicalApiDescriptor.canonicalApiId },
            apiEffect: sinkEffect.apiEffect,
            target: "arg0",
        }],
    };
}

async function detectCase(scene: Scene, methodName: string, sourceRules: SourceRule[], sinkRules: SinkRule[], exactRuntime: ExactRuleRuntime): Promise<boolean> {
    const method = scene.getMethods().find(item => item.getName() === methodName);
    assert(method, `case method not found: ${methodName}`);
    const engine = new TaintPropagationEngine(scene, 1, { ...exactRuntime });
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "explicit", syntheticEntryMethods: [method] });
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    return flows.length > 0;
}

async function collectSeedInfo(scene: Scene, methodName: string, sourceRules: SourceRule[], exactRuntime: ExactRuleRuntime) {
    const method = scene.getMethods().find(item => item.getName() === methodName);
    assert(method, `case method not found: ${methodName}`);
    const engine = new TaintPropagationEngine(scene, 1, { ...exactRuntime });
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "explicit", syntheticEntryMethods: [method] });
    return engine.propagateWithSourceRules(sourceRules);
}

async function main(): Promise<void> {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(path.resolve("tests/demo/promise_result_source"));
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();
    const sourceAsset = promiseResultSourceAsset(scene);
    const lowered = lowerRuleAssetsToRuleSet([sourceAsset]);
    assert(lowered.diagnostics.length === 0, `unexpected diagnostics: ${lowered.diagnostics.join("; ")}`);
    assert(lowered.ruleSet.sources.length === 1, "promiseResult source asset should lower");
    const loweredSource = lowered.ruleSet.sources[0];
    assert(typeof loweredSource.target === "object", "promiseResult source target should retain endpoint metadata");
    assert((loweredSource.target as any).semanticEndpointKind === "promiseResult", "promiseResult endpoint kind must be preserved");

    const sinkRules = buildSinkRules(scene);
    const apiAssets = [sourceAsset, ...sinkRules.assets];
    const exactRuntime = exactRuleRuntimeFromAssets(apiAssets);

    const validation = validateRuleSet({
        sources: lowered.ruleSet.sources,
        sinks: sinkRules.rules,
        transfers: [],
    });
    assert(validation.valid, `rules invalid: ${validation.errors.join("; ")}`);

    const positive = await detectCase(scene, "promise_result_source_then_001_T", lowered.ruleSet.sources, sinkRules.rules, exactRuntime);
    const negative = await detectCase(scene, "promise_result_source_safe_002_F", lowered.ruleSet.sources, sinkRules.rules, exactRuntime);
    const unrelatedSeedInfo = await collectSeedInfo(
        scene,
        "promise_result_source_unrelated_entry_003_F",
        lowered.ruleSet.sources,
        exactRuntime,
    );

    assert(positive, "promiseResult source should propagate to then callback payload");
    assert(!negative, "promiseResult source must not taint unrelated constants inside then callback");
    assert(unrelatedSeedInfo.seedCount === 0, "unrelated entry should not seed promiseResult source");
    const zeroHitAudit = unrelatedSeedInfo.sourceRuleZeroHitAudit.find(entry =>
        entry.ruleId.includes("PromiseApi.fetch.promiseResult.source")
    );
    assert(zeroHitAudit, "zero-hit audit should include the promiseResult source rule");
    assert(
        zeroHitAudit.reason === "source_rule_callsite_outside_allowed_methods",
        `zero-hit audit should identify allowed-method exclusion, got ${zeroHitAudit.reason}`,
    );
    assert(zeroHitAudit.matchedCallsiteCount >= 1, "zero-hit audit should count matching scene callsites");
    assert(zeroHitAudit.matchedAllowedCallsiteCount === 0, "zero-hit audit should show no matching allowed callsites");
    console.log("PASS test_rule_asset_promise_result_source");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
