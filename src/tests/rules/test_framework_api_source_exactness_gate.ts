import * as path from "path";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { buildFrameworkApiSourceRules } from "../../core/rules/FrameworkApiSourceCatalog";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildTestScene } from "../helpers/TestSceneBuilder";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

interface ExactnessProbeSpec {
    family: string;
    positiveCase: string;
    negativeCase: string;
    weakFallback?: SourceRule;
}

const API_SOURCE_DIR = path.resolve("tests/demo/framework_api_source_contract");

const SINK_RULES: SinkRule[] = [
    {
        id: "sink.framework.api.exactness.arg0",
        match: { kind: "method_name_equals", value: "Sink" },
        target: { endpoint: "arg0" },
    },
];

const EXACTNESS_PROBES: ExactnessProbeSpec[] = [
    {
        family: "source.harmony.network.http",
        positiveCase: "api_http_request_001_T",
        negativeCase: "api_httpclient_request_002_F",
        weakFallback: {
            id: "source.framework.api.http.weak_request",
            family: "source.harmony.network.http",
            tier: "C",
            sourceKind: "call_return",
            match: { kind: "method_name_equals", value: "request" },
            target: "result",
        },
    },
    {
        family: "source.harmony.preferences",
        positiveCase: "api_preferences_get_003_T",
        negativeCase: "api_cachepreferences_get_004_F",
        weakFallback: {
            id: "source.framework.api.preferences.weak_get",
            family: "source.harmony.preferences",
            tier: "C",
            sourceKind: "call_return",
            match: { kind: "method_name_equals", value: "get" },
            target: "result",
        },
    },
    {
        family: "source.harmony.rdb",
        positiveCase: "api_rdb_query_005_T",
        negativeCase: "api_myrdb_query_006_F",
    },
    {
        family: "source.harmony.file",
        positiveCase: "api_fs_read_008_T",
        negativeCase: "api_fileoperatorwrapper_read_009_F",
        weakFallback: {
            id: "source.framework.api.file.weak_read",
            family: "source.harmony.file",
            tier: "C",
            sourceKind: "call_return",
            match: { kind: "method_name_equals", value: "read" },
            target: "result",
        },
    },
    {
        family: "source.harmony.request",
        positiveCase: "api_request_download_010_T",
        negativeCase: "api_requestagentwrapper_download_011_F",
    },
    {
        family: "source.harmony.distributedkv",
        positiveCase: "api_distributedkv_get_012_T",
        negativeCase: "api_mydistributedkv_get_013_F",
    },
    {
        family: "source.harmony.device_id",
        positiveCase: "api_deviceinfo_udid_014_T",
        negativeCase: "api_deviceinfoproxy_udid_015_F",
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
    const loadedApiRules = (loaded.ruleSet.sources || []).filter(
        rule => rule.sourceKind === "call_return" || rule.sourceKind === "field_read"
    );
    const scene = buildTestScene(API_SOURCE_DIR);

    const results: string[] = [];
    for (const probe of EXACTNESS_PROBES) {
        const familyRules = loadedApiRules.filter(rule => rule.family === probe.family);
        assert(familyRules.length > 0, `family has no API rules: ${probe.family}`);

        const positive = await runCase(scene, probe.positiveCase, familyRules);
        assert(positive.detected, `${probe.positiveCase}: expected positive flow for ${probe.family}`);

        const negative = await runCase(scene, probe.negativeCase, familyRules);
        assert(!negative.detected, `${probe.negativeCase}: expected exactness gate to block ${probe.family}`);

        if (probe.weakFallback) {
            const combined = await runCase(scene, probe.positiveCase, [...familyRules, probe.weakFallback]);
            assert(combined.detected, `${probe.positiveCase}: expected combined family rules to keep positive flow`);
            assert(
                (combined.seedInfo.sourceRuleHits[probe.weakFallback.id] || 0) === 0,
                `${probe.positiveCase}: weak fallback should be suppressed by stronger family rule for ${probe.family}`,
            );
        }

        results.push(`PASS family=${probe.family} positive=${probe.positiveCase} negative=${probe.negativeCase}`);
    }

    const generated = buildFrameworkApiSourceRules();
    const familyCount = [...new Set(generated.map(rule => String(rule.family || "")))].length;
    console.log("====== Framework API Source Exactness Gate ======");
    console.log(`families=${familyCount}`);
    console.log(`probes=${results.length}`);
    for (const line of results) {
        console.log(line);
    }
}

main().catch(error => {
    console.error("FAIL test_framework_api_source_exactness_gate");
    console.error(error);
    process.exit(1);
});

