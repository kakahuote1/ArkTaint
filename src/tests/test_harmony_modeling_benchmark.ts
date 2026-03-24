import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../core/rules/RuleLoader";
import { SinkRule, SourceRule } from "../core/rules/RuleSchema";
import { findCaseMethod, resolveCaseMethod } from "./helpers/SyntheticCaseHarness";
import { registerMockSdkFiles } from "./helpers/TestSceneBuilder";

type ModelingCapability = "state" | "storage" | "router" | "handoff";
type BenchmarkVariant = "baseline" | "modeling";

interface SuiteSpec {
    id: string;
    category: string;
    sourceDir: string;
    defaultRulePath: string;
    frameworkRulePath?: string;
    projectRulePath: string;
    caseIncludePatterns?: string[];
    caseExcludePatterns?: string[];
    modelingCapabilities: ModelingCapability[];
}

interface BenchmarkManifest {
    name: string;
    version: string;
    description: string;
    suites: SuiteSpec[];
}

interface ExpectationManifest {
    name: string;
    version: string;
    description: string;
    cases: Record<string, boolean>;
}

interface VariantCaseResult {
    detected: boolean;
    seedCount: number;
    flowCount: number;
    pass: boolean;
    error?: string;
}

interface VariantSummary {
    totalCases: number;
    positiveCases: number;
    negativeCases: number;
    passCases: number;
    failCases: number;
    truePositives: number;
    falseNegatives: number;
    falsePositives: number;
    trueNegatives: number;
    runtimeErrors: number;
}

interface CaseReport {
    caseName: string;
    expected: boolean;
    results: Record<BenchmarkVariant, VariantCaseResult>;
    modelingSolvedVsBaseline: boolean;
    modelingPreventedFalsePositiveVsBaseline: boolean;
}

interface SuiteReport {
    suite: string;
    category: string;
    sourceDir: string;
    modelingCapabilities: ModelingCapability[];
    caseCount: number;
    summaries: Record<BenchmarkVariant, VariantSummary>;
    modelingSolvedCases: string[];
    modelingPreventedFalsePositiveCases: string[];
    remainingFailures: string[];
    baselineOnlyPassCases: string[];
    cases: CaseReport[];
}

interface BenchmarkReport {
    benchmarkKind: "harmony_modeling";
    manifestPath: string;
    suiteCount: number;
    totalCases: number;
    summaries: Record<BenchmarkVariant, VariantSummary>;
    modelingSolvedCases: string[];
    modelingPreventedFalsePositiveCases: string[];
    suites: SuiteReport[];
}

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
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

function loadManifest(): BenchmarkManifest {
    return readJsonFile<BenchmarkManifest>(path.resolve("tests/manifests/harmony_modeling_benchmark.json"));
}

function loadExpectations(): ExpectationManifest {
    return readJsonFile<ExpectationManifest>(path.resolve("tests/manifests/harmony_modeling_expectations.json"));
}

function listCases(sourceDir: string, spec: SuiteSpec): string[] {
    const includePatterns = (spec.caseIncludePatterns || []).map(pattern => new RegExp(pattern));
    const excludePatterns = (spec.caseExcludePatterns || []).map(pattern => new RegExp(pattern));

    return fs.readdirSync(sourceDir)
        .filter(file => file.endsWith(".ets"))
        .map(file => path.basename(file, ".ets"))
        .filter(name => /_(T|F)$/.test(name))
        .filter(name => includePatterns.length === 0 || includePatterns.some(pattern => pattern.test(name)))
        .filter(name => !excludePatterns.some(pattern => pattern.test(name)))
        .sort();
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

function loadRules(spec: SuiteSpec): { sourceRules: SourceRule[]; sinkRules: SinkRule[] } {
    const loaded = loadRuleSet({
        defaultRulePath: path.resolve(spec.defaultRulePath),
        frameworkRulePath: spec.frameworkRulePath ? path.resolve(spec.frameworkRulePath) : undefined,
        projectRulePath: path.resolve(spec.projectRulePath),
        allowMissingProject: false,
        autoDiscoverLayers: false,
    });

    return {
        sourceRules: loaded.ruleSet.sources || [],
        sinkRules: loaded.ruleSet.sinks || [],
    };
}

function createEmptySummary(): VariantSummary {
    return {
        totalCases: 0,
        positiveCases: 0,
        negativeCases: 0,
        passCases: 0,
        failCases: 0,
        truePositives: 0,
        falseNegatives: 0,
        falsePositives: 0,
        trueNegatives: 0,
        runtimeErrors: 0,
    };
}

function mergeSummary(target: VariantSummary, source: VariantSummary): void {
    target.totalCases += source.totalCases;
    target.positiveCases += source.positiveCases;
    target.negativeCases += source.negativeCases;
    target.passCases += source.passCases;
    target.failCases += source.failCases;
    target.truePositives += source.truePositives;
    target.falseNegatives += source.falseNegatives;
    target.falsePositives += source.falsePositives;
    target.trueNegatives += source.trueNegatives;
    target.runtimeErrors += source.runtimeErrors;
}

function summarizeCases(cases: CaseReport[]): Record<BenchmarkVariant, VariantSummary> {
    const summaries: Record<BenchmarkVariant, VariantSummary> = {
        baseline: createEmptySummary(),
        modeling: createEmptySummary(),
    };

    for (const report of cases) {
        for (const variant of ["baseline", "modeling"] as BenchmarkVariant[]) {
            const summary = summaries[variant];
            const result = report.results[variant];
            summary.totalCases++;
            if (result.error) {
                summary.runtimeErrors++;
                summary.failCases++;
                continue;
            }
            if (report.expected) {
                summary.positiveCases++;
                if (result.detected) {
                    summary.truePositives++;
                    summary.passCases++;
                } else {
                    summary.falseNegatives++;
                    summary.failCases++;
                }
            } else {
                summary.negativeCases++;
                if (result.detected) {
                    summary.falsePositives++;
                    summary.failCases++;
                } else {
                    summary.trueNegatives++;
                    summary.passCases++;
                }
            }
        }
    }

    return summaries;
}

async function runCaseVariant(
    projectDir: string,
    caseName: string,
    disabledCapabilities: Set<ModelingCapability>,
    sourceRules: SourceRule[],
    sinkRules: SinkRule[],
    expected: boolean,
): Promise<VariantCaseResult> {
    const scene = buildScene(projectDir);
    const resolved = resolveCaseMethod(scene, `${caseName}.ets`, caseName);
    const caseMethod = findCaseMethod(scene, resolved);
    const engine = new TaintPropagationEngine(scene, 1, {
        enableHarmonyStateModeling: !disabledCapabilities.has("state"),
        enableHarmonyAppStorageModeling: !disabledCapabilities.has("storage"),
        enableHarmonyRouterModeling: !disabledCapabilities.has("router"),
        enableHarmonyAbilityHandoffModeling: !disabledCapabilities.has("handoff"),
    });
    engine.verbose = false;

    try {
        await engine.buildPAG({
            entryModel: "arkMain",
            syntheticEntryMethods: caseMethod ? [caseMethod] : undefined,
        });
        try {
            const reachable = engine.computeReachableMethodSignatures();
            engine.setActiveReachableMethodSignatures(reachable);
        } catch {
            engine.setActiveReachableMethodSignatures(undefined);
        }

        const seedInfo = engine.propagateWithSourceRules(sourceRules);
        const flows = engine.detectSinksByRules(sinkRules);
        const detected = flows.length > 0;

        return {
            detected,
            seedCount: seedInfo.seedCount,
            flowCount: flows.length,
            pass: detected === expected,
        };
    } catch (error) {
        return {
            detected: false,
            seedCount: 0,
            flowCount: 0,
            pass: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function main(): Promise<void> {
    const manifestPath = path.resolve("tests/manifests/harmony_modeling_benchmark.json");
    const expectationPath = path.resolve("tests/manifests/harmony_modeling_expectations.json");
    const manifest = loadManifest();
    const expectations = loadExpectations();
    const outputRoot = path.resolve("tmp/phase717/harmony_modeling_benchmark");
    const caseViewRoot = path.join(outputRoot, "cases");
    ensureDir(caseViewRoot);

    const suiteReports: SuiteReport[] = [];
    const overallSummary: Record<BenchmarkVariant, VariantSummary> = {
        baseline: createEmptySummary(),
        modeling: createEmptySummary(),
    };
    const overallModelingSolvedCases: string[] = [];
    const overallModelingPreventedFalsePositiveCases: string[] = [];

    let totalCases = 0;

    for (const suite of manifest.suites) {
        const sourceDir = path.resolve(suite.sourceDir);
        const cases = listCases(sourceDir, suite);
        const { sourceRules, sinkRules } = loadRules(suite);
        const caseReports: CaseReport[] = [];
        const modelingSolvedCases: string[] = [];
        const modelingPreventedFalsePositiveCases: string[] = [];
        const remainingFailures: string[] = [];
        const baselineOnlyPassCases: string[] = [];

        for (const caseName of cases) {
            totalCases++;
            const projectDir = createCaseView(sourceDir, caseName, path.join(caseViewRoot, suite.id));
            const expectationKey = `${suite.id}/${caseName}`;
            const expected = expectations.cases[expectationKey];
            if (typeof expected !== "boolean") {
                throw new Error(`Missing expectation for modeling benchmark case: ${expectationKey}`);
            }
            const baseline = await runCaseVariant(
                projectDir,
                caseName,
                new Set<ModelingCapability>(suite.modelingCapabilities),
                sourceRules,
                sinkRules,
                expected,
            );
            const modeling = await runCaseVariant(
                projectDir,
                caseName,
                new Set<ModelingCapability>(),
                sourceRules,
                sinkRules,
                expected,
            );

            const modelingSolvedVsBaseline = expected && modeling.detected && !baseline.detected;
            const modelingPreventedFalsePositiveVsBaseline = !expected && !modeling.detected && baseline.detected;

            if (modelingSolvedVsBaseline) {
                modelingSolvedCases.push(caseName);
                overallModelingSolvedCases.push(`${suite.id}/${caseName}`);
            }
            if (modelingPreventedFalsePositiveVsBaseline) {
                modelingPreventedFalsePositiveCases.push(caseName);
                overallModelingPreventedFalsePositiveCases.push(`${suite.id}/${caseName}`);
            }
            if (!modeling.pass) {
                remainingFailures.push(caseName);
            }
            if (!baseline.pass && modeling.pass) {
                // baseline miss solved by modeling or baseline FP corrected by modeling
            } else if (baseline.pass && !modeling.pass) {
                baselineOnlyPassCases.push(caseName);
            }

            caseReports.push({
                caseName,
                expected,
                results: {
                    baseline,
                    modeling,
                },
                modelingSolvedVsBaseline,
                modelingPreventedFalsePositiveVsBaseline,
            });
        }

        const summaries = summarizeCases(caseReports);
        mergeSummary(overallSummary.baseline, summaries.baseline);
        mergeSummary(overallSummary.modeling, summaries.modeling);

        suiteReports.push({
            suite: suite.id,
            category: suite.category,
            sourceDir: suite.sourceDir,
            modelingCapabilities: suite.modelingCapabilities,
            caseCount: caseReports.length,
            summaries,
            modelingSolvedCases,
            modelingPreventedFalsePositiveCases,
            remainingFailures,
            baselineOnlyPassCases,
            cases: caseReports,
        });
    }

    const expectedCaseCount = Object.keys(expectations.cases).length;
    if (expectedCaseCount !== totalCases) {
        throw new Error(`Expectation coverage mismatch: expected ${expectedCaseCount} cases, benchmark enumerated ${totalCases}`);
    }

    const report: BenchmarkReport = {
        benchmarkKind: "harmony_modeling",
        manifestPath,
        suiteCount: suiteReports.length,
        totalCases,
        summaries: overallSummary,
        modelingSolvedCases: overallModelingSolvedCases.sort(),
        modelingPreventedFalsePositiveCases: overallModelingPreventedFalsePositiveCases.sort(),
        suites: suiteReports,
    };

    ensureDir(outputRoot);
    const reportPath = path.join(outputRoot, "harmony_modeling_benchmark_report.json");
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    console.log("====== Harmony Modeling Benchmark ======");
    console.log(`manifest=${path.relative(process.cwd(), manifestPath)}`);
    console.log(`expectations=${path.relative(process.cwd(), expectationPath)}`);
    console.log(`suite_count=${report.suiteCount}`);
    console.log(`total_cases=${report.totalCases}`);
    console.log(`baseline_pass=${report.summaries.baseline.passCases}/${report.summaries.baseline.totalCases}`);
    console.log(`modeling_pass=${report.summaries.modeling.passCases}/${report.summaries.modeling.totalCases}`);
    console.log(`modeling_solved_vs_baseline=${report.modelingSolvedCases.length}`);
    console.log(`modeling_prevented_false_positives_vs_baseline=${report.modelingPreventedFalsePositiveCases.length}`);
    console.log(`report=${path.relative(process.cwd(), reportPath)}`);

    if (report.summaries.modeling.failCases > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

