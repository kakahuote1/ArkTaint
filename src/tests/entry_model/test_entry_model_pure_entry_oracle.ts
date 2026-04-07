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
            sourceDir: "tests/demo/harmony_lifecycle",
            category: "ability_lifecycle",
            caseName: "lifecycle_want_direct_001_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["AbilityWantDirect001.onCreate"],
        },
        {
            sourceDir: "tests/demo/harmony_lifecycle",
            category: "ability_lifecycle",
            caseName: "lifecycle_extension_addform_011_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["DemoFormExtension011.onAddForm"],
        },
        {
            sourceDir: "tests/demo/harmony_lifecycle",
            category: "ability_lifecycle",
            caseName: "param_type_mismatch_007_F",
            entryExpectation: false,
            expectedClassification: "negative",
            expectedValidTargets: [],
        },
        {
            sourceDir: "tests/demo/harmony_framework_entry_probe",
            category: "ability_lifecycle",
            caseName: "uiextension_onnewwant_015_T",
            entryExpectation: true,
            expectedClassification: "positive",
            expectedValidTargets: ["ProbeUiExtension.onNewWant"],
        },
    ];

    for (const probe of probes) {
        assertOracle(probe, outputRoot);
    }

    console.log("PASS test_entry_model_pure_entry_oracle");
}

main();


