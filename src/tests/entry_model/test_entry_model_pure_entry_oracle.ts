import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildPureEntryExpectationLookup, loadPureEntryExpectationSuites } from "../helpers/PureEntryExpectations";
import { buildPureEntryOracle, PureEntrySuiteCategory } from "../helpers/PureEntryOracle";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

interface OracleProbeSpec {
    sourceDir: string;
    category: PureEntrySuiteCategory;
    caseName: string;
    entryExpectation: boolean;
    expectedClassification: "positive" | "negative";
    expectedValidTargets: string[];
}

interface PureEntryTaxonomyManifest {
    suites: Array<{
        id: string;
        category: string;
        sourceDir: string;
        caseIncludePatterns?: string[];
    }>;
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function isSemanticCaseFile(fileName: string): boolean {
    return /\.(ets|ts)$/.test(fileName) && /_(T|F)\./.test(fileName);
}

function createCaseView(sourceDir: string, caseName: string, outputRoot: string): string {
    const caseDir = path.join(outputRoot, caseName);
    fs.rmSync(caseDir, { recursive: true, force: true });
    ensureDir(caseDir);

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const fileName = entry.name;
        const isCaseFile = fileName === `${caseName}.ets` || fileName === `${caseName}.ts`;
        if (!isCaseFile && isSemanticCaseFile(fileName)) {
            continue;
        }
        fs.copyFileSync(path.join(sourceDir, fileName), path.join(caseDir, fileName));
    }

    return caseDir;
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function assertManifestPureScope(): void {
    const manifestPath = path.resolve("tests/manifests/entry_model/main_model_pure_entry_taxonomy.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PureEntryTaxonomyManifest;
    const expectationSuites = loadPureEntryExpectationSuites();
    const forbiddenCategories = new Set([
        "service_bridge",
        "storage_channel",
        "implicit_control",
        "end_to_end",
    ]);
    const offendingSuites = manifest.suites.filter(suite =>
        forbiddenCategories.has(suite.category)
        || suite.sourceDir.includes("harmony_http"),
    );
    if (offendingSuites.length > 0) {
        throw new Error(
            `pure-entry manifest contains non-entry suites: ${offendingSuites.map(suite => `${suite.id}:${suite.category}`).join(", ")}`,
        );
    }

    for (const suite of manifest.suites) {
        const sourceDir = path.resolve(suite.sourceDir);
        if (!fs.existsSync(sourceDir)) continue;
        const patterns = (suite.caseIncludePatterns || []).map(pattern => new RegExp(pattern));
        const caseNames = fs.readdirSync(sourceDir)
            .filter(name => /\.(ets|ts)$/.test(name) && /_(T|F)\./.test(name))
            .map(name => path.basename(name, path.extname(name)))
            .filter(caseName => patterns.length === 0 || patterns.some(pattern => pattern.test(caseName)))
            .sort((left, right) => left.localeCompare(right));
        buildPureEntryExpectationLookup(suite.id, caseNames, expectationSuites);
    }
}

function assertOracle(spec: OracleProbeSpec, outputRoot: string): void {
    const caseProjectDir = createCaseView(path.resolve(spec.sourceDir), spec.caseName, outputRoot);
    const scene = buildScene(caseProjectDir);
    const oracle = buildPureEntryOracle(scene, spec.category, spec.entryExpectation);

    if (oracle.classification !== spec.expectedClassification) {
        throw new Error(
            `${spec.caseName} classification mismatch: expected ${spec.expectedClassification}, got ${oracle.classification}`,
        );
    }

    for (const target of spec.expectedValidTargets) {
        if (!oracle.validTargets.includes(target)) {
            throw new Error(
                `${spec.caseName} missing expected valid target ${target}; got ${oracle.validTargets.join(", ")}`,
            );
        }
    }
}

function main(): void {
    const outputRoot = path.resolve("tmp/test_runs/entry_model/pure_entry_oracle_case_views/latest");
    ensureDir(outputRoot);
    assertManifestPureScope();

    const probes: OracleProbeSpec[] = [
        {
            sourceDir: "tests/demo/harmony_handoff_multihop",
            category: "cross_component_handoff",
            caseName: "handoff_startability_onnewwant_001_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["Target001.onNewWant"],
        },
        {
            sourceDir: "tests/demo/harmony_handoff_multihop",
            category: "cross_component_handoff",
            caseName: "handoff_startability_for_result_002_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["Target002.onCreate"],
        },
        {
            sourceDir: "tests/demo/harmony_handoff_multihop",
            category: "cross_component_handoff",
            caseName: "handoff_safe_sink_004_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["Target004.onNewWant"],
        },
        {
            sourceDir: "tests/demo/harmony_handoff_multihop",
            category: "cross_component_handoff",
            caseName: "handoff_unrelated_method_005_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/harmony_multi_ability_chain",
            category: "cross_component_handoff",
            caseName: "multiability_create_foreground_001_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["TargetAbility001.onCreate", "TargetAbility001.onForeground"],
        },
        {
            sourceDir: "tests/demo/harmony_multi_ability_chain",
            category: "cross_component_handoff",
            caseName: "multiability_newwant_build_002_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["TargetAbility002.onNewWant", "TargetAbility002.build"],
        },
        {
            sourceDir: "tests/demo/harmony_system_callback_variants",
            category: "event_async",
            caseName: "system_fake_webview_008_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/harmony_system_callback_variants",
            category: "event_async",
            caseName: "system_fake_window_007_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/harmony_event_activation",
            category: "ui_event_callback",
            caseName: "event_onchange_outside_build_005_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/harmony_event_activation",
            category: "ui_event_callback",
            caseName: "event_onclick_build_004_F",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["%dflt.cbOnClick"],
        },
        {
            sourceDir: "tests/demo/harmony_callback_registration",
            category: "ui_event_callback",
            caseName: "callback_constant_sink_006_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/harmony_route_stack_variants",
            category: "route_handoff",
            caseName: "route_stack_fake_005_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/harmony_framework_entry_probe",
            category: "route_handoff",
            caseName: "navpathstack_fake_013_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/harmony_reactive_deep_tree",
            category: "reactive_composition",
            caseName: "reactive_link_constant_006_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/harmony_timer_scheduler",
            category: "event_async",
            caseName: "timer_outside_build_006_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/pure_entry_watch",
            category: "reactive_watch",
            caseName: "watch_build_trigger_001_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["WatchPage001.onTokenChanged"],
        },
        {
            sourceDir: "tests/demo/pure_entry_watch",
            category: "reactive_watch",
            caseName: "watch_no_trigger_003_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/pure_entry_worker",
            category: "event_async",
            caseName: "worker_onmessage_build_001_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["WorkerPage001.%AM0$build"],
        },
        {
            sourceDir: "tests/demo/pure_entry_worker",
            category: "event_async",
            caseName: "worker_fake_owner_003_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/pure_entry_worker",
            category: "event_async",
            caseName: "worker_taskpool_build_002_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["%dflt.taskJob"],
        },
        {
            sourceDir: "tests/demo/pure_entry_emitter",
            category: "event_async",
            caseName: "emitter_on_build_001_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["EmitterPage001.%AM0$build"],
        },
        {
            sourceDir: "tests/demo/pure_entry_emitter",
            category: "event_async",
            caseName: "emitter_fake_owner_003_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
    ];

    for (const probe of probes) {
        assertOracle(probe, outputRoot);
    }

    console.log("PASS test_entry_model_pure_entry_oracle");
}

main();


