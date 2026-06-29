import * as path from "path";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { projectApiEffectAssetFromMethod } from "../helpers/ApiEffectTestAssets";
import type { AssetDocumentBase } from "../../core/assets/schema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

interface ProbeSpec {
    methodName: string;
    moduleContains: string;
    positiveCase: string;
    negativeCase: string;
}

const SOURCE_DIR = path.resolve("tests/demo/framework_api_source_unknown_sdk");

const PROBES: ProbeSpec[] = [
    {
        methodName: "getLastLocation",
        moduleContains: "@ohos.geoLocationManager",
        positiveCase: "unknown_sdk_geo_getLastLocation_001_T",
        negativeCase: "unknown_sdk_geo_getLastLocation_002_F",
    }
];

function findMethod(scene: ReturnType<typeof buildTestScene>, methodName: string): any {
    return scene.getMethods().find(method => method.getName() === methodName);
}

function buildSinkRules(scene: ReturnType<typeof buildTestScene>): {
    rules: SinkRule[];
    assets: AssetDocumentBase[];
} {
    const sinkMethod = findMethod(scene, "Sink");
    assert(sinkMethod, "sink method not found: Sink");
    const sinkEffect = projectApiEffectAssetFromMethod({
        id: "sink.framework.api.unknown_sdk.arg0",
        role: "sink",
        method: sinkMethod,
        endpoint: { base: { kind: "arg", index: 0 } },
        sinkKind: "test",
    });
    return {
        assets: [sinkEffect.asset],
        rules: [{
        id: "sink.framework.api.unknown_sdk.arg0",
        match: { kind: "canonical_api_id_equals", value: sinkEffect.canonicalApiDescriptor.canonicalApiId },
        apiEffect: sinkEffect.apiEffect,
        target: { endpoint: "arg0" },
        }],
    };
}

function decodedCanonicalId(rule: SourceRule): string {
    return decodeURIComponent(rule.match.value || "");
}

function matchesProbeRule(rule: SourceRule, probe: ProbeSpec): boolean {
    if (rule.match.kind !== "canonical_api_id_equals") return false;
    const id = decodedCanonicalId(rule);
    return id.includes(`module=${probe.moduleContains}`)
        && id.includes(`:${probe.methodName}:`);
}

function flowSinkInCaseMethod(scene: ReturnType<typeof buildTestScene>, sinkStmt: any, caseMethodName: string): boolean {
    const method = findMethod(scene, caseMethodName);
    if (!method) return false;
    const cfg = method.getCfg();
    if (!cfg) return false;
    return cfg.getStmts().includes(sinkStmt);
}

async function runCase(
    scene: ReturnType<typeof buildTestScene>,
    caseName: string,
    sourceRules: SourceRule[],
    apiAssets: AssetDocumentBase[],
): Promise<{ detected: boolean; seedInfo: ReturnType<TaintPropagationEngine["propagateWithSourceRules"]> }> {
    const entryMethod = findMethod(scene, caseName);
    assert(entryMethod, `entry method not found for ${caseName}`);

    const sinkRules = buildSinkRules(scene);
    const engine = new TaintPropagationEngine(scene, 1, {
        apiAssets: [...apiAssets, ...sinkRules.assets],
    });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    engine.setActiveReachableMethodSignatures(new Set([entryMethod.getSignature().toString()]));
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules.rules);
    return {
        detected: flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, caseName)),
        seedInfo,
    };
}

async function main(): Promise<void> {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
    });
    const scene = buildTestScene(SOURCE_DIR);
    const rules = (loaded.ruleSet.sources || []).filter(
        rule => rule.sourceKind === "call_return" || rule.sourceKind === "field_read"
    );

    const results: string[] = [];
    for (const probe of PROBES) {
        const probeRules = rules.filter(rule => matchesProbeRule(rule, probe));
        assert(probeRules.length > 0, `missing official source rule for ${probe.moduleContains}.${probe.methodName}`);
        const probeRuleIds = new Set(probeRules.map(rule => rule.id));

        const positive = await runCase(scene, probe.positiveCase, probeRules, loaded.assets);
        assert(positive.detected, `${probe.positiveCase}: expected flow with ${probe.moduleContains}.${probe.methodName}`);
        assert(
            Object.entries(positive.seedInfo.sourceRuleHits || {})
                .some(([ruleId, hits]) => probeRuleIds.has(ruleId) && hits > 0),
            `${probe.positiveCase}: expected source hit for ${probe.moduleContains}.${probe.methodName}`,
        );

        const negative = await runCase(scene, probe.negativeCase, probeRules, loaded.assets);
        assert(!negative.detected, `${probe.negativeCase}: local helper should not trigger ${probe.moduleContains}.${probe.methodName}`);
        assert(
            Object.entries(negative.seedInfo.sourceRuleHits || {})
                .every(([ruleId, hits]) => !probeRuleIds.has(ruleId) || hits === 0),
            `${probe.negativeCase}: local helper should not count as source hit for ${probe.moduleContains}.${probe.methodName}`,
        );

        results.push(`PASS source=${probe.moduleContains}.${probe.methodName} positive=${probe.positiveCase} negative=${probe.negativeCase}`);
    }

    console.log("====== Framework API Source Unknown SDK Resolution ======");
    console.log(`probes=${results.length}`);
    for (const line of results) {
        console.log(line);
    }
}

main().catch(error => {
    console.error("FAIL test_framework_api_source_unknown_sdk_resolution");
    console.error(error);
    process.exit(1);
});

