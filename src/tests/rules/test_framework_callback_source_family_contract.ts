import * as path from "path";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { buildFrameworkCallbackSourceRules } from "../../core/rules/FrameworkCallbackSourceCatalog";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { createIsolatedCaseView, ensureDir } from "../helpers/ExecutionHandoffContractSupport";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

interface FamilyFlowSpec {
    family: string;
    sourceDir: string;
    caseName: string;
    relativePath: string;
    entryMethodName: string;
}

interface FamilyFlowResult {
    family: string;
    caseName: string;
    withFamily: boolean;
    withoutFamily: boolean;
    sourceRuleCount: number;
}

const SINK_RULES: SinkRule[] = [
    {
        id: "sink.framework.callback.family.arg0",
        match: { kind: "method_name_equals", value: "Sink" },
        target: { endpoint: "arg0" },
    },
];

const FAMILY_FLOW_SPECS: FamilyFlowSpec[] = [
    {
        family: "source.harmony.callback.input",
        sourceDir: "tests/demo/harmony_event_activation",
        caseName: "event_oninput_build_002_T",
        relativePath: "event_oninput_build_002_T.ets",
        entryMethodName: "event_oninput_build_002_T",
    },
    {
        family: "source.harmony.callback.network.http_completion",
        sourceDir: "tests/demo/harmony_http",
        caseName: "http_async_callback_003_T",
        relativePath: "http_async_callback_003_T.ets",
        entryMethodName: "http_async_callback_003_T",
    },
    {
        family: "source.harmony.callback.window.stage",
        sourceDir: "tests/demo/sdk_signature_probe",
        caseName: "sdk_signature_probe_001_T",
        relativePath: "sdk_signature_probe_001_T.ets",
        entryMethodName: "sdk_signature_probe_001_T",
    },
    {
        family: "source.harmony.callback.system.message",
        sourceDir: "tests/demo/harmony_worker",
        caseName: "worker_callback_payload_003_T",
        relativePath: "worker_callback_payload_003_T.ets",
        entryMethodName: "worker_callback_payload_003_T",
    },
    {
        family: "source.harmony.callback.subscription.observer",
        sourceDir: "tests/demo/pure_entry_realworld",
        caseName: "notification_localstorage_032_T",
        relativePath: "notification_localstorage_032_T.ets",
        entryMethodName: "aboutToAppear",
    },
    {
        family: "source.harmony.callback.device.sensor",
        sourceDir: "tests/demo/pure_entry_realworld",
        caseName: "geolocation_sensor_029_T",
        relativePath: "geolocation_sensor_029_T.ets",
        entryMethodName: "aboutToAppear",
    },
    {
        family: "source.harmony.callback.device.telephony",
        sourceDir: "tests/demo/framework_callback_source_sim",
        caseName: "telephony_sim_account_001_T",
        relativePath: "telephony_sim_account_001_T.ets",
        entryMethodName: "telephony_sim_account_001_T",
    },
];

function sortStrings(values: string[]): string[] {
    return [...values].sort((a, b) => a.localeCompare(b));
}

function filterCallbackSourceRules(rules: SourceRule[]): SourceRule[] {
    return rules.filter(rule => rule.sourceKind === "callback_param");
}

function findEntryMethod(scene: ReturnType<typeof buildTestScene>, spec: FamilyFlowSpec): any {
    const resolved = resolveCaseMethod(scene, spec.relativePath, spec.caseName);
    const exact = scene.getMethods().find(method =>
        method.getName() === spec.entryMethodName
        && method.getSignature().toString().includes(resolved.pathHint || spec.relativePath),
    );
    if (exact) {
        return exact;
    }
    const fallback = findCaseMethod(scene, resolved);
    if (fallback?.getName?.() === spec.entryMethodName) {
        return fallback;
    }
    const sameName = scene.getMethods().find(method =>
        method.getName() === spec.entryMethodName
        && method.getSignature().toString().includes(spec.relativePath),
    );
    return sameName;
}

async function runFamilyFlowProbe(spec: FamilyFlowSpec, sourceRules: SourceRule[]): Promise<FamilyFlowResult> {
    const caseViewRoot = path.resolve("tmp/test_runs/research/framework_callback_source_family_contract/latest/case_views");
    ensureDir(caseViewRoot);
    const projectDir = createIsolatedCaseView(path.resolve(spec.sourceDir), spec.caseName, caseViewRoot);
    const scene = buildTestScene(projectDir);
    const entryMethod = findEntryMethod(scene, spec);
    assert(entryMethod, `entry method not found for ${spec.caseName}:${spec.entryMethodName}`);

    const detect = async (rules: SourceRule[]): Promise<boolean> => {
        const engine = new TaintPropagationEngine(scene, 1);
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "explicit",
            syntheticEntryMethods: [entryMethod],
        });
        const seedInfo = engine.propagateWithSourceRules(rules);
        const flows = engine.detectSinksByRules(SINK_RULES);
        if (rules.length > 0) {
            assert(seedInfo.seedCount > 0, `${spec.caseName}: expected source seeds for family ${spec.family}`);
        }
        return flows.length > 0;
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
    const generatedRules = buildFrameworkCallbackSourceRules();
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/rules"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
    });
    const loadedCallbackRules = filterCallbackSourceRules(loaded.ruleSet.sources || []);

    const generatedIds = sortStrings(generatedRules.map(rule => rule.id));
    const loadedIds = sortStrings(loadedCallbackRules.map(rule => rule.id));
    assert(
        JSON.stringify(generatedIds) === JSON.stringify(loadedIds),
        "loaded framework callback source inventory should exactly match generated callback source catalog",
    );

    for (const rule of loadedCallbackRules) {
        assert(rule.family && rule.family.trim().length > 0, `callback source rule missing family: ${rule.id}`);
        assert(rule.tier === "A" || rule.tier === "B" || rule.tier === "C", `callback source rule missing tier: ${rule.id}`);
    }

    const requiredIds = [
        "source.harmony.network.http.requestAsync.callback.arg1",
        "source.harmony.worker.onMessage.callback.arg0",
        "source.harmony.notification.subscribe.callback.arg1",
        "source.harmony.geolocation.on",
        "source.harmony.telephony.getSimAccountInfo.callback.arg1",
    ];
    for (const id of requiredIds) {
        assert(loadedIds.includes(id), `expected generated callback source rule missing: ${id}`);
    }

    const results: FamilyFlowResult[] = [];
    for (const spec of FAMILY_FLOW_SPECS) {
        const familyRules = loadedCallbackRules.filter(rule => rule.family === spec.family);
        assert(familyRules.length > 0, `family has no loaded callback source rules: ${spec.family}`);
        const result = await runFamilyFlowProbe(spec, familyRules);
        assert(result.withFamily, `${spec.caseName}: expected sink flow with family ${spec.family}`);
        assert(!result.withoutFamily, `${spec.caseName}: expected no sink flow without family ${spec.family}`);
        results.push(result);
    }

    console.log("====== Framework Callback Source Family Contract ======");
    console.log(`callback_rules=${loadedCallbackRules.length}`);
    console.log(`families=${sortStrings([...new Set(loadedCallbackRules.map(rule => String(rule.family || "")))]).length}`);
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
    console.error("FAIL test_framework_callback_source_family_contract");
    console.error(error);
    process.exit(1);
});
