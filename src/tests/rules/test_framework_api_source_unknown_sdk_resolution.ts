import * as path from "path";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildTestScene } from "../helpers/TestSceneBuilder";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

interface ProbeSpec {
    family: string;
    ruleId: string;
    positiveCase: string;
    negativeCase: string;
}

const SOURCE_DIR = path.resolve("tests/demo/framework_api_source_unknown_sdk");

const SINK_RULES: SinkRule[] = [
    {
        id: "sink.framework.api.unknown_sdk.arg0",
        match: { kind: "method_name_equals", value: "Sink" },
        target: { endpoint: "arg0" },
    },
];

const PROBES: ProbeSpec[] = [
    {
        family: "source.harmony.location",
        ruleId: "source.harmony.geo.getLastLocation",
        positiveCase: "unknown_sdk_geo_getLastLocation_001_T",
        negativeCase: "unknown_sdk_geo_getLastLocation_002_F",
    },
    {
        family: "source.harmony.preferences",
        ruleId: "source.harmony.preferences.getSync.result",
        positiveCase: "unknown_sdk_preferences_getSync_003_T",
        negativeCase: "unknown_sdk_preferences_getSync_004_F",
    },
    {
        family: "source.harmony.network.http",
        ruleId: "source.harmony.network.http.request.result",
        positiveCase: "unknown_sdk_http_request_005_T",
        negativeCase: "unknown_sdk_http_request_006_F",
    },
];

function findMethod(scene: ReturnType<typeof buildTestScene>, methodName: string): any {
    return scene.getMethods().find(method => method.getName() === methodName);
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
): Promise<{ detected: boolean; seedInfo: ReturnType<TaintPropagationEngine["propagateWithSourceRules"]> }> {
    const entryMethod = findMethod(scene, caseName);
    assert(entryMethod, `entry method not found for ${caseName}`);

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    engine.setActiveReachableMethodSignatures(new Set([entryMethod.getSignature().toString()]));
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(SINK_RULES);
    return {
        detected: flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, caseName)),
        seedInfo,
    };
}

async function main(): Promise<void> {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
    });
    const scene = buildTestScene(SOURCE_DIR);
    const rules = (loaded.ruleSet.sources || []).filter(
        rule => rule.sourceKind === "call_return" || rule.sourceKind === "field_read"
    );

    const results: string[] = [];
    for (const probe of PROBES) {
        const familyRules = rules.filter(rule => rule.family === probe.family);
        assert(familyRules.length > 0, `missing family rules for ${probe.family}`);

        const positive = await runCase(scene, probe.positiveCase, familyRules);
        assert(positive.detected, `${probe.positiveCase}: expected flow with ${probe.family}`);
        assert(
            (positive.seedInfo.sourceRuleHits[probe.ruleId] || 0) > 0,
            `${probe.positiveCase}: expected source hit for ${probe.ruleId}`,
        );

        const negative = await runCase(scene, probe.negativeCase, familyRules);
        assert(!negative.detected, `${probe.negativeCase}: local helper should not trigger ${probe.family}`);
        assert(
            (negative.seedInfo.sourceRuleHits[probe.ruleId] || 0) === 0,
            `${probe.negativeCase}: local helper should not count as source hit for ${probe.ruleId}`,
        );

        results.push(`PASS family=${probe.family} positive=${probe.positiveCase} negative=${probe.negativeCase}`);
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

