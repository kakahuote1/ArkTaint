import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";
import {
    createFormalTestSuite,
    TestFailureSummary,
    TestOutputMetadata,
} from "../helpers/TestOutputContract";

type ModelingCapability = "state" | "storage" | "router" | "handoff" | "emitter" | "worker_taskpool";
type BenchmarkVariant = "baseline" | "modeling";

interface SuiteSpec {
    id: string;
    category: string;
    sourceDir: string;
    kernelRulePath: string;
    ruleCatalogPath?: string;
    projectRulePath: string;
    caseIncludePatterns?: string[];
    caseExcludePatterns?: string[];
    modelingCapabilities: ModelingCapability[];
    disabledAutoSourceRuleIdPrefixes?: string[];
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

function renderMarkdownReport(report: BenchmarkReport): string {
    const lines: string[] = [];
    lines.push("# Harmony Modeling Benchmark");
    lines.push("");
    lines.push(`- manifestPath: ${report.manifestPath}`);
    lines.push(`- suiteCount: ${report.suiteCount}`);
    lines.push(`- totalCases: ${report.totalCases}`);
    lines.push(`- baselinePass: ${report.summaries.baseline.passCases}/${report.summaries.baseline.totalCases}`);
    lines.push(`- modelingPass: ${report.summaries.modeling.passCases}/${report.summaries.modeling.totalCases}`);
    lines.push(`- modelingSolvedVsBaseline: ${report.modelingSolvedCases.length}`);
    lines.push(`- modelingPreventedFalsePositiveVsBaseline: ${report.modelingPreventedFalsePositiveCases.length}`);
    lines.push("");
    lines.push("| Suite | Category | Cases | Baseline Pass | Modeling Pass | Remaining Failures |");
    lines.push("| --- | --- | ---: | ---: | ---: | ---: |");
    for (const suite of report.suites) {
        lines.push(`| ${suite.suite} | ${suite.category} | ${suite.caseCount} | ${suite.summaries.baseline.passCases}/${suite.summaries.baseline.totalCases} | ${suite.summaries.modeling.passCases}/${suite.summaries.modeling.totalCases} | ${suite.remainingFailures.length} |`);
    }
    if (report.modelingSolvedCases.length > 0) {
        lines.push("");
        lines.push("## Modeling Gains");
        lines.push("");
        for (const item of report.modelingSolvedCases) {
            lines.push(`- ${item}`);
        }
    }
    const remainingFailures = report.suites.flatMap(suite => suite.remainingFailures.map(item => `${suite.suite}/${item}`));
    if (remainingFailures.length > 0) {
        lines.push("");
        lines.push("## Remaining Failures");
        lines.push("");
        for (const item of remainingFailures) {
            lines.push(`- ${item}`);
        }
    }
    lines.push("");
    return lines.join("\n");
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
    return readJsonFile<BenchmarkManifest>(path.resolve("tests/manifests/benchmarks/harmony_modeling_benchmark.json"));
}

function loadExpectations(): ExpectationManifest {
    return readJsonFile<ExpectationManifest>(path.resolve("tests/manifests/benchmarks/harmony_modeling_expectations.json"));
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
        kernelRulePath: path.resolve(spec.kernelRulePath),
        ruleCatalogPath: spec.ruleCatalogPath ? path.resolve(spec.ruleCatalogPath) : undefined,
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
    disabledAutoSourceRuleIdPrefixes: string[],
    sourceRules: SourceRule[],
    sinkRules: SinkRule[],
    expected: boolean,
): Promise<VariantCaseResult> {
    const scene = buildScene(projectDir);
    const resolved = resolveCaseMethod(scene, `${caseName}.ets`, caseName);
    const caseMethod = findCaseMethod(scene, resolved);
    const disabledModuleIds: string[] = [];
    if (disabledCapabilities.has("state")) disabledModuleIds.push("harmony.state");
    if (disabledCapabilities.has("storage")) disabledModuleIds.push("harmony.appstorage");
    if (disabledCapabilities.has("router")) disabledModuleIds.push("harmony.router");
    if (disabledCapabilities.has("handoff")) disabledModuleIds.push("harmony.ability_handoff");
    if (disabledCapabilities.has("emitter")) disabledModuleIds.push("harmony.emitter");
    if (disabledCapabilities.has("worker_taskpool")) disabledModuleIds.push("harmony.worker_taskpool");
    const engine = new TaintPropagationEngine(scene, 1, {
        disabledModuleIds,
        disabledAutoSourceRuleIdPrefixes,
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
    const manifestPath = path.resolve("tests/manifests/benchmarks/harmony_modeling_benchmark.json");
    const expectationPath = path.resolve("tests/manifests/benchmarks/harmony_modeling_expectations.json");
    const manifest = loadManifest();
    const expectations = loadExpectations();
    const outputRoot = path.resolve("tmp/test_runs/modeling/harmony_modeling_benchmark/latest");
    const caseViewRoot = path.join(outputRoot, "cases");
    const metadata: TestOutputMetadata = {
        suite: "harmony_modeling",
        domain: "benchmark",
        title: "Harmony Modeling Benchmark",
        purpose: "Measure whether built-in Harmony modules recover expected propagation semantics beyond the baseline engine behavior.",
    };
    const suite = createFormalTestSuite(outputRoot, metadata);
    ensureDir(caseViewRoot);
    const totalCases = Object.keys(expectations.cases).length;
    const progressReporter = suite.createProgress(totalCases, {
        logEveryCount: 1,
        logEveryPercent: 5,
    });

    const suiteReports: SuiteReport[] = [];
    const overallSummary: Record<BenchmarkVariant, VariantSummary> = {
        baseline: createEmptySummary(),
        modeling: createEmptySummary(),
    };
    const overallModelingSolvedCases: string[] = [];
    const overallModelingPreventedFalsePositiveCases: string[] = [];

    let enumeratedCases = 0;

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
            enumeratedCases++;
            progressReporter.update(enumeratedCases - 1, `${suite.id}/${caseName}`, `suite=${suite.id}`);
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
                suite.disabledAutoSourceRuleIdPrefixes || [],
                sourceRules,
                sinkRules,
                expected,
            );
            const modeling = await runCaseVariant(
                projectDir,
                caseName,
                new Set<ModelingCapability>(),
                suite.disabledAutoSourceRuleIdPrefixes || [],
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
            progressReporter.update(enumeratedCases, `${suite.id}/${caseName}`, `suite=${suite.id}`);
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
    if (expectedCaseCount !== enumeratedCases) {
        throw new Error(`Expectation coverage mismatch: expected ${expectedCaseCount} cases, benchmark enumerated ${enumeratedCases}`);
    }

    const report: BenchmarkReport = {
        benchmarkKind: "harmony_modeling",
        manifestPath,
        suiteCount: suiteReports.length,
        totalCases: enumeratedCases,
        summaries: overallSummary,
        modelingSolvedCases: overallModelingSolvedCases.sort(),
        modelingPreventedFalsePositiveCases: overallModelingPreventedFalsePositiveCases.sort(),
        suites: suiteReports,
    };

    const reportPath = path.join(outputRoot, "harmony_modeling_benchmark_report.json");
    suite.writeReport(report, renderMarkdownReport(report), {
        aliases: [{ jsonPath: reportPath }],
    });
    progressReporter.finish("DONE", "benchmark=harmony_modeling");

    const remainingFailures = report.suites.flatMap(suite => suite.remainingFailures.map(item => `${suite.suite}/${item}`));
    const failureItems: TestFailureSummary[] = remainingFailures.map(item => ({
        name: item,
        reason: "Modeled benchmark case still does not match expected result.",
        severity: "high",
    }));
    suite.finish({
        status: failureItems.length > 0 ? "fail" : "pass",
        verdict: failureItems.length > 0
            ? "Harmony modeling benchmark completed with remaining modeled-case failures."
            : "Harmony modeling benchmark completed with all modeled cases passing.",
        totals: {
            manifest: path.relative(process.cwd(), manifestPath),
            expectations: path.relative(process.cwd(), expectationPath),
            suiteCount: report.suiteCount,
            totalCases: report.totalCases,
            baselinePass: `${report.summaries.baseline.passCases}/${report.summaries.baseline.totalCases}`,
            modelingPass: `${report.summaries.modeling.passCases}/${report.summaries.modeling.totalCases}`,
            modelingSolvedVsBaseline: report.modelingSolvedCases.length,
            modelingPreventedFalsePositiveVsBaseline: report.modelingPreventedFalsePositiveCases.length,
        },
        highlights: [
            `baseline_pass=${report.summaries.baseline.passCases}/${report.summaries.baseline.totalCases}`,
            `modeling_pass=${report.summaries.modeling.passCases}/${report.summaries.modeling.totalCases}`,
        ],
        failures: failureItems,
    });
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});



