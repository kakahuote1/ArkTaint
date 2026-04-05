import * as fs from "fs";
import * as path from "path";
import { buildFrameworkSinkRules, FRAMEWORK_SINK_FAMILY_CONTRACTS, isFrameworkSinkCatalogRule } from "../../core/rules/FrameworkSinkCatalog";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, SourceRule, TaintRuleSet } from "../../core/rules/RuleSchema";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { createIsolatedCaseView, ensureDir } from "../helpers/ExecutionHandoffContractSupport";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

interface SinkFamilyProbeSpec {
    family: string;
    sourceDir: string;
    caseName: string;
    sourceLocalPattern: string;
}

interface SinkFamilyProbeResult {
    family: string;
    caseName: string;
    withFamily: boolean;
    withoutFamily: boolean;
    sinkRuleCount: number;
}

const PROBE_SPECS: SinkFamilyProbeSpec[] = [
    {
        family: "sink.harmony.rdb",
        sourceDir: "tests/demo/sdk_signature_probe",
        caseName: "sdk_signature_probe_001_T",
        sourceLocalPattern: "^userInput$",
    },
    {
        family: "sink.harmony.preferences",
        sourceDir: "tests/demo/sdk_signature_probe",
        caseName: "sdk_signature_probe_001_T",
        sourceLocalPattern: "^userInput$",
    },
    {
        family: "sink.harmony.network.axios",
        sourceDir: "tests/demo/sdk_signature_probe",
        caseName: "sdk_signature_probe_001_T",
        sourceLocalPattern: "^userInput$",
    },
    {
        family: "sink.harmony.file",
        sourceDir: "tests/demo/sdk_signature_probe",
        caseName: "sdk_signature_probe_001_T",
        sourceLocalPattern: "^userInput$",
    },
    {
        family: "sink.harmony.network.socket",
        sourceDir: "tests/demo/sdk_signature_probe",
        caseName: "sdk_signature_probe_001_T",
        sourceLocalPattern: "^userInput$",
    },
    {
        family: "sink.harmony.logging.console",
        sourceDir: "tests/demo/sdk_signature_probe",
        caseName: "sdk_signature_probe_001_T",
        sourceLocalPattern: "^userInput$",
    },
    {
        family: "sink.harmony.logging.hilog_info",
        sourceDir: "tests/demo/sdk_signature_probe",
        caseName: "sdk_signature_probe_001_T",
        sourceLocalPattern: "^userInput$",
    },
];

function sortStrings(values: string[]): string[] {
    return [...values].sort((a, b) => a.localeCompare(b));
}

function readKernelRuleSets(kind: "sinks"): TaintRuleSet[] {
    const dir = path.resolve("src/rules", kind, "kernel");
    const files = fs.readdirSync(dir)
        .filter(fileName => fileName.endsWith(".rules.json"))
        .sort((a, b) => a.localeCompare(b));
    return files.map(fileName => JSON.parse(fs.readFileSync(path.join(dir, fileName), "utf-8")) as TaintRuleSet);
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

async function runProbe(spec: SinkFamilyProbeSpec, sinkRules: SinkRule[]): Promise<SinkFamilyProbeResult> {
    const caseViewRoot = path.resolve("tmp/test_runs/research/framework_sink_family_contract/latest/case_views");
    ensureDir(caseViewRoot);
    const projectDir = createIsolatedCaseView(path.resolve(spec.sourceDir), spec.caseName, caseViewRoot);
    const scene = buildTestScene(projectDir);
    const entryMethod = findMethod(scene, spec.caseName);
    assert(entryMethod, `entry method not found: ${spec.caseName}`);

    const sourceRules: SourceRule[] = [
        {
            id: `source.framework.sink.contract.${spec.caseName}`,
            match: { kind: "local_name_regex", value: spec.sourceLocalPattern },
            sourceKind: "entry_param",
            target: "arg0",
        },
    ];

    const detect = async (activeSinkRules: SinkRule[]): Promise<boolean> => {
        const engine = new TaintPropagationEngine(scene, 1);
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "explicit",
            syntheticEntryMethods: [entryMethod],
        });
        const seedInfo = engine.propagateWithSourceRules(sourceRules);
        assert(seedInfo.seedCount > 0, `${spec.caseName}: expected source seeds`);
        const flows = engine.detectSinksByRules(activeSinkRules);
        return flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, spec.caseName));
    };

    const withFamily = await detect(sinkRules);
    const withoutFamily = await detect([]);
    return {
        family: spec.family,
        caseName: spec.caseName,
        withFamily,
        withoutFamily,
        sinkRuleCount: sinkRules.length,
    };
}

async function main(): Promise<void> {
    const rawKernelSinks = readKernelRuleSets("sinks")
        .flatMap(ruleSet => ruleSet.sinks || [])
        .filter(rule => rule.enabled !== false);
    const generatedSinkRules = buildFrameworkSinkRules(rawKernelSinks);
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/rules"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const loadedSinkRules = (loaded.ruleSet.sinks || []).filter(rule => isFrameworkSinkCatalogRule(rule));

    const generatedIds = sortStrings(generatedSinkRules.map(rule => rule.id));
    const loadedIds = sortStrings(loadedSinkRules.map(rule => rule.id));
    assert(
        JSON.stringify(generatedIds) === JSON.stringify(loadedIds),
        "loaded framework sink inventory should exactly match generated sink catalog",
    );

    const generatedFamilies = sortStrings([...new Set(generatedSinkRules.map(rule => String(rule.family || "")))]);
    const loadedFamilies = sortStrings([...new Set(loadedSinkRules.map(rule => String(rule.family || "")))]);
    assert(
        JSON.stringify(generatedFamilies) === JSON.stringify(loadedFamilies),
        "loaded sink families should exactly match sink catalog contracts",
    );

    for (const rule of loadedSinkRules) {
        assert(rule.family && rule.family.trim().length > 0, `sink rule missing family: ${rule.id}`);
        assert(rule.tier === "A" || rule.tier === "B" || rule.tier === "C", `sink rule missing tier: ${rule.id}`);
    }

    const results: SinkFamilyProbeResult[] = [];
    for (const spec of PROBE_SPECS) {
        const familyRules = loadedSinkRules.filter(rule => rule.family === spec.family);
        assert(familyRules.length > 0, `family has no loaded sink rules: ${spec.family}`);
        const result = await runProbe(spec, familyRules);
        assert(result.withFamily, `${spec.caseName}: expected sink flow with family ${spec.family}`);
        assert(!result.withoutFamily, `${spec.caseName}: expected no sink flow without family ${spec.family}`);
        results.push(result);
    }

    console.log("====== Framework Sink Family Contract ======");
    console.log(`sink_rules=${loadedSinkRules.length}`);
    console.log(`families=${loadedFamilies.length}`);
    console.log(`contract_families=${FRAMEWORK_SINK_FAMILY_CONTRACTS.length}`);
    console.log(`representative_cases=${results.length}`);
    for (const result of results) {
        console.log(
            `PASS family=${result.family} case=${result.caseName} `
            + `withFamily=${result.withFamily} withoutFamily=${result.withoutFamily} `
            + `rules=${result.sinkRuleCount}`,
        );
    }
}

main().catch(error => {
    console.error("FAIL test_framework_sink_family_contract");
    console.error(error);
    process.exit(1);
});
