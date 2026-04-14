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

interface ApiFamilyProbeSpec {
    family: string;
    caseName: string;
}

interface ApiFamilyProbeResult {
    family: string;
    caseName: string;
    withFamily: boolean;
    withoutFamily: boolean;
    sourceRuleCount: number;
}

const API_SOURCE_DIR = path.resolve("tests/demo/framework_api_source_contract");

const SINK_RULES: SinkRule[] = [
    {
        id: "sink.framework.api.family.arg0",
        match: { kind: "method_name_equals", value: "Sink" },
        target: { endpoint: "arg0" },
    },
];

const API_FAMILY_PROBE_SPECS: ApiFamilyProbeSpec[] = [
    { family: "source.harmony.network.http", caseName: "api_http_request_001_T" },
    { family: "source.harmony.preferences", caseName: "api_preferences_get_003_T" },
    { family: "source.harmony.rdb", caseName: "api_rdb_query_005_T" },
    { family: "source.harmony.globalcontext", caseName: "api_globalcontext_getobject_007_T" },
    { family: "source.harmony.file", caseName: "api_fs_read_008_T" },
    { family: "source.harmony.request", caseName: "api_request_download_010_T" },
    { family: "source.harmony.distributedkv", caseName: "api_distributedkv_get_012_T" },
    { family: "source.harmony.device_id", caseName: "api_deviceinfo_udid_014_T" },
];

function sortStrings(values: string[]): string[] {
    return [...values].sort((a, b) => a.localeCompare(b));
}

function filterApiSourceRules(rules: SourceRule[]): SourceRule[] {
    return rules.filter(rule => rule.sourceKind === "call_return" || rule.sourceKind === "field_read");
}

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

async function runApiFamilyProbe(
    scene: ReturnType<typeof buildTestScene>,
    spec: ApiFamilyProbeSpec,
    sourceRules: SourceRule[],
): Promise<ApiFamilyProbeResult> {
    const entryMethod = findMethod(scene, spec.caseName);
    assert(entryMethod, `entry method not found for ${spec.caseName}`);

    const detect = async (rules: SourceRule[]): Promise<boolean> => {
        const engine = new TaintPropagationEngine(scene, 1);
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "explicit",
            syntheticEntryMethods: [entryMethod],
        });
        engine.setActiveReachableMethodSignatures(new Set([entryMethod.getSignature().toString()]));
        const seedInfo = engine.propagateWithSourceRules(rules);
        const flows = engine.detectSinksByRules(SINK_RULES);
        if (rules.length > 0) {
            assert(seedInfo.seedCount > 0, `${spec.caseName}: expected source seeds for family ${spec.family}`);
        }
        return flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, spec.caseName));
    };

    const withFamily = await detect(sourceRules);
    const withoutFamily = await detect([]);
    return {
        family: spec.family,
        caseName: spec.caseName,
        withFamily,
        withoutFamily,
        sourceRuleCount: sourceRules.length,
    };
}

async function main(): Promise<void> {
    const generatedRules = buildFrameworkApiSourceRules();
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
    });
    const loadedApiRules = filterApiSourceRules(loaded.ruleSet.sources || []);

    const generatedIds = sortStrings(generatedRules.map(rule => rule.id));
    const loadedIds = sortStrings(loadedApiRules.map(rule => rule.id));
    assert(
        JSON.stringify(generatedIds) === JSON.stringify(loadedIds),
        "loaded framework API source inventory should exactly match generated API source catalog",
    );

    const expectedFamilies = sortStrings(
        [...new Set(generatedRules.map(rule => String(rule.family || "")))]
    );
    const loadedFamilies = sortStrings(
        [...new Set(loadedApiRules.map(rule => String(rule.family || "")))]
    );
    assert(
        JSON.stringify(expectedFamilies) === JSON.stringify(loadedFamilies),
        "loaded API source families should exactly match generated family contracts",
    );

    for (const rule of loadedApiRules) {
        assert(rule.family && rule.family.trim().length > 0, `API source rule missing family: ${rule.id}`);
        assert(rule.tier === "A" || rule.tier === "B" || rule.tier === "C", `API source rule missing tier: ${rule.id}`);
        if (rule.match.kind === "method_name_equals") {
            const methodName = rule.match.value;
            const highRisk = new Set(["get", "getSync", "query", "querySql", "read", "readSync", "request", "download", "upload"]);
            if (highRisk.has(methodName)) {
                assert(
                    !!rule.calleeScope?.className || !!rule.calleeScope?.methodName,
                    `high-risk API source should carry calleeScope exactness anchor: ${rule.id}`,
                );
            }
        }
    }

    const scene = buildTestScene(API_SOURCE_DIR);
    const results: ApiFamilyProbeResult[] = [];
    for (const spec of API_FAMILY_PROBE_SPECS) {
        const familyRules = loadedApiRules.filter(rule => rule.family === spec.family);
        assert(familyRules.length > 0, `family has no loaded API source rules: ${spec.family}`);
        const result = await runApiFamilyProbe(scene, spec, familyRules);
        assert(result.withFamily, `${spec.caseName}: expected sink flow with family ${spec.family}`);
        assert(!result.withoutFamily, `${spec.caseName}: expected no sink flow without family ${spec.family}`);
        results.push(result);
    }

    console.log("====== Framework API Source Family Contract ======");
    console.log(`api_source_rules=${loadedApiRules.length}`);
    console.log(`families=${loadedFamilies.length}`);
    console.log(`representative_cases=${results.length}`);
    for (const result of results) {
        console.log(
            `PASS family=${result.family} case=${result.caseName} `
            + `withFamily=${result.withFamily} withoutFamily=${result.withoutFamily} `
            + `rules=${result.sourceRuleCount}`,
        );
    }
}

main().catch(error => {
    console.error("FAIL test_framework_api_source_family_contract");
    console.error(error);
    process.exit(1);
});

