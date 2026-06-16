import * as path from "path";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import type { AssetDocumentBase } from "../../core/assets/schema";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import type { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { validateRuleSet } from "../../core/rules/RuleValidator";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function promiseResultSourceAsset(): AssetDocumentBase {
    return {
        id: "asset.promise_api.fetch.source",
        plane: "rule",
        status: "official",
        surfaces: [
            {
                surfaceId: "surface.PromiseApi.fetch",
                kind: "invoke",
                modulePath: "promise_result_source.ets",
                ownerName: "PromiseApi",
                methodName: "fetch",
                invokeKind: "instance",
                argCount: 0,
                confidence: "certain",
                provenance: {
                    source: "manual",
                    location: {
                        file: "promise_result_source.ets",
                        line: 4,
                    },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.PromiseApi.fetch.promiseResult.source",
                surfaceId: "surface.PromiseApi.fetch",
                assetId: "asset.promise_api.fetch.source",
                plane: "rule",
                role: "source",
                endpoint: { base: { kind: "promiseResult" } },
                effectTemplateRefs: ["template.PromiseApi.fetch.promiseResult.source"],
                semanticsFamily: "promise-result-source",
                completeness: "complete",
                confidence: "certain",
            },
        ],
        effectTemplates: [
            {
                id: "template.PromiseApi.fetch.promiseResult.source",
                kind: "rule.source",
                sourceKind: "call_return",
                value: { base: { kind: "promiseResult" } },
                confidence: "certain",
            },
        ],
        provenance: {
            source: "manual",
            evidenceLocations: [
                {
                    file: "promise_result_source.ets",
                    line: 4,
                },
            ],
        },
    };
}

const SINK_RULES: SinkRule[] = [
    {
        id: "sink.promise_result_source.taint_sink",
        match: { kind: "method_name_equals", value: "Sink" },
        target: "arg0",
    },
];

async function detectCase(scene: Scene, methodName: string, sourceRules: SourceRule[]): Promise<boolean> {
    const method = scene.getMethods().find(item => item.getName() === methodName);
    assert(method, `case method not found: ${methodName}`);
    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "explicit", syntheticEntryMethods: [method] });
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(SINK_RULES);
    return flows.length > 0;
}

async function collectSeedInfo(scene: Scene, methodName: string, sourceRules: SourceRule[]) {
    const method = scene.getMethods().find(item => item.getName() === methodName);
    assert(method, `case method not found: ${methodName}`);
    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "explicit", syntheticEntryMethods: [method] });
    return engine.propagateWithSourceRules(sourceRules);
}

async function main(): Promise<void> {
    const lowered = lowerRuleAssetsToRuleSet([promiseResultSourceAsset()]);
    assert(lowered.diagnostics.length === 0, `unexpected diagnostics: ${lowered.diagnostics.join("; ")}`);
    assert(lowered.ruleSet.sources.length === 1, "promiseResult source asset should lower");
    const loweredSource = lowered.ruleSet.sources[0];
    assert(typeof loweredSource.target === "object", "promiseResult source target should retain endpoint metadata");
    assert((loweredSource.target as any).semanticEndpointKind === "promiseResult", "promiseResult endpoint kind must be preserved");

    const validation = validateRuleSet({
        sources: lowered.ruleSet.sources,
        sinks: SINK_RULES,
        transfers: [],
    });
    assert(validation.valid, `rules invalid: ${validation.errors.join("; ")}`);

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(path.resolve("tests/demo/promise_result_source"));
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const positive = await detectCase(scene, "promise_result_source_then_001_T", lowered.ruleSet.sources);
    const negative = await detectCase(scene, "promise_result_source_safe_002_F", lowered.ruleSet.sources);
    const unrelatedSeedInfo = await collectSeedInfo(
        scene,
        "promise_result_source_unrelated_entry_003_F",
        lowered.ruleSet.sources,
    );

    assert(positive, "promiseResult source should propagate to then callback payload");
    assert(!negative, "promiseResult source must not taint unrelated constants inside then callback");
    assert(unrelatedSeedInfo.seedCount === 0, "unrelated entry should not seed promiseResult source");
    const zeroHitAudit = unrelatedSeedInfo.sourceRuleZeroHitAudit.find(entry =>
        entry.ruleId === "PromiseApi.fetch.promiseResult.source"
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
