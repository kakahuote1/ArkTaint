import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";
import { LoadedRuleSet, loadRuleSet } from "../core/rules/RuleLoader";
import { TaintFlow } from "../core/kernel/model/TaintFlow";
import { registerMockSdkFiles } from "./helpers/TestSceneBuilder";
import * as fs from "fs";
import * as path from "path";

interface CliOptions {
    benchmarkRoot: string;
    defaultRulePath: string;
    frameworkRulePath: string;
    overridePath: string;
    outputDir: string;
    k: number;
}

interface PaperClaims {
    precision?: number;
    recall?: number;
    source?: string;
}

interface OracleOverride {
    expectedFlow: boolean;
    reason: string;
}

interface OverrideManifest {
    name: string;
    version: string;
    description?: string;
    paperClaims?: PaperClaims;
    overrides: Record<string, OracleOverride>;
}

type LabelStrategy =
    | "comment_positive"
    | "comment_negative"
    | "comment_mixed_positive"
    | "manual_override";

interface SinkLabel {
    file: string;
    line: number;
    kind: "leak" | "no_leak";
    text: string;
}

interface CaseOracle {
    caseKey: string;
    expectedFlow: boolean;
    strategy: LabelStrategy;
    leakLabels: SinkLabel[];
    safeLabels: SinkLabel[];
    overrideReason?: string;
}

interface HapBenchCase {
    category: string;
    name: string;
    caseKey: string;
    caseRoot: string;
    files: string[];
    oracle: CaseOracle;
}

interface CaseResult {
    category: string;
    caseName: string;
    caseKey: string;
    expectedFlow: boolean;
    strategy: LabelStrategy;
    overrideReason?: string;
    seedCount: number;
    flowCount: number;
    detectedFlow: boolean;
    classification: "TP" | "TN" | "FP" | "FN";
    pass: boolean;
    elapsedMs: number;
    leakLabelCount: number;
    safeLabelCount: number;
    sinkSamples: string[];
    error?: string;
}

interface CategorySummary {
    category: string;
    cases: number;
    positiveCases: number;
    negativeCases: number;
    tp: number;
    tn: number;
    fp: number;
    fn: number;
    recall: number | null;
    precision: number | null;
}

interface BenchmarkReport {
    benchmarkKind: "hapbench";
    generatedAt: string;
    benchmarkRoot: string;
    overridePath: string;
    k: number;
    categoryCount: number;
    caseCount: number;
    positiveCases: number;
    negativeCases: number;
    tp: number;
    tn: number;
    fp: number;
    fn: number;
    recall: number | null;
    precision: number | null;
    paperClaims?: PaperClaims;
    categories: CategorySummary[];
    overrideCases: Array<{
        caseKey: string;
        expectedFlow: boolean;
        reason: string;
    }>;
    mixedCases: string[];
    failures: CaseResult[];
    cases: CaseResult[];
}

function parseArgs(argv: string[]): CliOptions {
    let benchmarkRoot = "tests/benchmark/HapBench";
    let defaultRulePath = "src/rules/default.rules.json";
    let frameworkRulePath = "src/rules/framework.rules.json";
    let overridePath = "tests/benchmark/HapBench/oracle_overrides.json";
    let outputDir = "tmp/test_runs/benchmark/hapbench/latest";
    let k = 1;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--benchmarkRoot" && i + 1 < argv.length) {
            benchmarkRoot = argv[++i];
            continue;
        }
        if (arg.startsWith("--benchmarkRoot=")) {
            benchmarkRoot = arg.slice("--benchmarkRoot=".length);
            continue;
        }
        if (arg === "--default" && i + 1 < argv.length) {
            defaultRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--default=")) {
            defaultRulePath = arg.slice("--default=".length);
            continue;
        }
        if (arg === "--framework" && i + 1 < argv.length) {
            frameworkRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--framework=")) {
            frameworkRulePath = arg.slice("--framework=".length);
            continue;
        }
        if (arg === "--override" && i + 1 < argv.length) {
            overridePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--override=")) {
            overridePath = arg.slice("--override=".length);
            continue;
        }
        if (arg === "--outputDir" && i + 1 < argv.length) {
            outputDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--outputDir=")) {
            outputDir = arg.slice("--outputDir=".length);
            continue;
        }
        if (arg === "--k" && i + 1 < argv.length) {
            k = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--k=")) {
            k = Number(arg.slice("--k=".length));
            continue;
        }
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}. Expected 0 or 1.`);
    }

    return {
        benchmarkRoot: path.resolve(benchmarkRoot),
        defaultRulePath: path.resolve(defaultRulePath),
        frameworkRulePath: path.resolve(frameworkRulePath),
        overridePath: path.resolve(overridePath),
        outputDir: path.resolve(outputDir),
        k,
    };
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function listDirectories(root: string): string[] {
    return fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b));
}

function collectCaseFiles(caseRoot: string): string[] {
    const out: string[] = [];
    const stack = [caseRoot];
    while (stack.length > 0) {
        const current = stack.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (/\.(ets|ts)$/i.test(entry.name)) {
                out.push(fullPath);
            }
        }
    }
    return out.sort((a, b) => a.localeCompare(b));
}

function collectSinkLabels(root: string, filePath: string): SinkLabel[] {
    const rel = path.relative(root, filePath).replace(/\\/g, "/");
    const labels: SinkLabel[] = [];
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const leak = /\/\/\s*sink,\s*leak\b/i.test(line);
        const noLeak = /\/\/\s*sink,\s*no leak\b/i.test(line);
        if (!leak && !noLeak) continue;
        labels.push({
            file: rel,
            line: i + 1,
            kind: leak ? "leak" : "no_leak",
            text: line.trim(),
        });
    }
    return labels;
}

function buildOracle(
    benchmarkRoot: string,
    caseKey: string,
    files: string[],
    overrides: Record<string, OracleOverride>,
): CaseOracle {
    const allLabels = files.flatMap(filePath => collectSinkLabels(benchmarkRoot, filePath));
    const leakLabels = allLabels.filter(label => label.kind === "leak");
    const safeLabels = allLabels.filter(label => label.kind === "no_leak");

    if (leakLabels.length > 0 && safeLabels.length === 0) {
        return {
            caseKey,
            expectedFlow: true,
            strategy: "comment_positive",
            leakLabels,
            safeLabels,
        };
    }
    if (leakLabels.length === 0 && safeLabels.length > 0) {
        return {
            caseKey,
            expectedFlow: false,
            strategy: "comment_negative",
            leakLabels,
            safeLabels,
        };
    }
    if (leakLabels.length > 0 && safeLabels.length > 0) {
        return {
            caseKey,
            expectedFlow: true,
            strategy: "comment_mixed_positive",
            leakLabels,
            safeLabels,
        };
    }

    const override = overrides[caseKey];
    if (!override) {
        throw new Error(`No sink labels or override found for HapBench case: ${caseKey}`);
    }

    return {
        caseKey,
        expectedFlow: override.expectedFlow,
        strategy: "manual_override",
        leakLabels,
        safeLabels,
        overrideReason: override.reason,
    };
}

function scanCases(
    benchmarkRoot: string,
    overrides: Record<string, OracleOverride>,
): HapBenchCase[] {
    const cases: HapBenchCase[] = [];
    for (const category of listDirectories(benchmarkRoot)) {
        const categoryRoot = path.join(benchmarkRoot, category);
        for (const caseName of listDirectories(categoryRoot)) {
            const caseRoot = path.join(categoryRoot, caseName);
            const files = collectCaseFiles(caseRoot);
            if (files.length === 0) {
                throw new Error(`HapBench case has no ArkTS files: ${caseRoot}`);
            }
            const caseKey = `${category}/${caseName}`;
            cases.push({
                category,
                name: caseName,
                caseKey,
                caseRoot,
                files,
                oracle: buildOracle(benchmarkRoot, caseKey, files, overrides),
            });
        }
    }
    return cases.sort((a, b) => a.caseKey.localeCompare(b.caseKey));
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

function calcRecall(tp: number, fn: number): number | null {
    const denom = tp + fn;
    return denom === 0 ? null : tp / denom;
}

function calcPrecision(tp: number, fp: number): number | null {
    const denom = tp + fp;
    return denom === 0 ? null : tp / denom;
}

function fmtPercent(value: number | null): string {
    return value === null ? "N/A" : `${(value * 100).toFixed(2)}%`;
}

function classify(expectedFlow: boolean, detectedFlow: boolean): "TP" | "TN" | "FP" | "FN" {
    if (expectedFlow) {
        return detectedFlow ? "TP" : "FN";
    }
    return detectedFlow ? "FP" : "TN";
}

function sinkSamples(flows: TaintFlow[]): string[] {
    return flows.slice(0, 3).map(flow => flow.sink.toString());
}

async function runCase(
    caseInfo: HapBenchCase,
    rules: LoadedRuleSet,
    k: number,
): Promise<CaseResult> {
    const start = Date.now();
    try {
        const scene = buildScene(caseInfo.caseRoot);
        const engine = new TaintPropagationEngine(scene, k, {
            transferRules: rules.ruleSet.transfers || [],
        });
        engine.verbose = false;
        await engine.buildPAG({ entryModel: "arkMain" });
        try {
            const reachable = engine.computeReachableMethodSignatures();
            engine.setActiveReachableMethodSignatures(reachable);
        } catch {
            engine.setActiveReachableMethodSignatures(undefined);
        }

        const seedInfo = engine.propagateWithSourceRules(rules.ruleSet.sources || []);
        const flows = engine.detectSinksByRules(rules.ruleSet.sinks || [], {
            sanitizerRules: rules.ruleSet.sanitizers || [],
        });
        const detectedFlow = flows.length > 0;
        const classification = classify(caseInfo.oracle.expectedFlow, detectedFlow);

        return {
            category: caseInfo.category,
            caseName: caseInfo.name,
            caseKey: caseInfo.caseKey,
            expectedFlow: caseInfo.oracle.expectedFlow,
            strategy: caseInfo.oracle.strategy,
            overrideReason: caseInfo.oracle.overrideReason,
            seedCount: seedInfo.seedCount,
            flowCount: flows.length,
            detectedFlow,
            classification,
            pass: (detectedFlow === caseInfo.oracle.expectedFlow),
            elapsedMs: Date.now() - start,
            leakLabelCount: caseInfo.oracle.leakLabels.length,
            safeLabelCount: caseInfo.oracle.safeLabels.length,
            sinkSamples: sinkSamples(flows),
        };
    } catch (error) {
        return {
            category: caseInfo.category,
            caseName: caseInfo.name,
            caseKey: caseInfo.caseKey,
            expectedFlow: caseInfo.oracle.expectedFlow,
            strategy: caseInfo.oracle.strategy,
            overrideReason: caseInfo.oracle.overrideReason,
            seedCount: 0,
            flowCount: 0,
            detectedFlow: false,
            classification: caseInfo.oracle.expectedFlow ? "FN" : "TN",
            pass: false,
            elapsedMs: Date.now() - start,
            leakLabelCount: caseInfo.oracle.leakLabels.length,
            safeLabelCount: caseInfo.oracle.safeLabels.length,
            sinkSamples: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function summarizeByCategory(results: CaseResult[]): CategorySummary[] {
    const grouped = new Map<string, CaseResult[]>();
    for (const result of results) {
        const bucket = grouped.get(result.category) || [];
        bucket.push(result);
        grouped.set(result.category, bucket);
    }
    return [...grouped.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([category, items]) => {
            const tp = items.filter(item => item.classification === "TP").length;
            const tn = items.filter(item => item.classification === "TN").length;
            const fp = items.filter(item => item.classification === "FP").length;
            const fn = items.filter(item => item.classification === "FN").length;
            const positiveCases = items.filter(item => item.expectedFlow).length;
            const negativeCases = items.length - positiveCases;
            return {
                category,
                cases: items.length,
                positiveCases,
                negativeCases,
                tp,
                tn,
                fp,
                fn,
                recall: calcRecall(tp, fn),
                precision: calcPrecision(tp, fp),
            };
        });
}

function renderMarkdown(report: BenchmarkReport): string {
    const lines: string[] = [];
    lines.push("# HapBench Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- benchmarkRoot: ${report.benchmarkRoot}`);
    lines.push(`- k: ${report.k}`);
    lines.push(`- categories: ${report.categoryCount}`);
    lines.push(`- cases: ${report.caseCount}`);
    lines.push(`- positives: ${report.positiveCases}`);
    lines.push(`- negatives: ${report.negativeCases}`);
    lines.push(`- tp: ${report.tp}`);
    lines.push(`- fp: ${report.fp}`);
    lines.push(`- tn: ${report.tn}`);
    lines.push(`- fn: ${report.fn}`);
    lines.push(`- recall: ${fmtPercent(report.recall)}`);
    lines.push(`- precision: ${fmtPercent(report.precision)}`);
    if (report.paperClaims) {
        lines.push(`- paper_precision: ${fmtPercent(report.paperClaims.precision ?? null)}`);
        lines.push(`- paper_recall: ${fmtPercent(report.paperClaims.recall ?? null)}`);
        if (report.paperClaims.source) {
            lines.push(`- paper_source: ${report.paperClaims.source}`);
        }
    }
    lines.push("");
    lines.push("| Category | Cases | Pos | Neg | TP | FP | TN | FN | Recall | Precision |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const summary of report.categories) {
        lines.push(`| ${summary.category} | ${summary.cases} | ${summary.positiveCases} | ${summary.negativeCases} | ${summary.tp} | ${summary.fp} | ${summary.tn} | ${summary.fn} | ${fmtPercent(summary.recall)} | ${fmtPercent(summary.precision)} |`);
    }
    lines.push("");

    if (report.overrideCases.length > 0) {
        lines.push("## Manual Oracle Overrides");
        lines.push("");
        for (const item of report.overrideCases) {
            lines.push(`- ${item.caseKey}: expectedFlow=${item.expectedFlow} (${item.reason})`);
        }
        lines.push("");
    }

    if (report.mixedCases.length > 0) {
        lines.push("## Mixed Comment Cases");
        lines.push("");
        lines.push("These cases contain both `sink, leak` and `sink, no leak` labels in the original benchmark. Case-level scoring treats them as positive if at least one leak sink exists.");
        lines.push("");
        for (const caseKey of report.mixedCases) {
            lines.push(`- ${caseKey}`);
        }
        lines.push("");
    }

    if (report.failures.length > 0) {
        lines.push("## Failures");
        lines.push("");
        for (const item of report.failures) {
            const err = item.error ? ` error=${item.error}` : "";
            lines.push(`- [${item.category}] ${item.caseName} expected=${item.expectedFlow ? "T" : "F"} detected=${item.detectedFlow ? "T" : "F"} flowCount=${item.flowCount} strategy=${item.strategy}${err}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.benchmarkRoot)) {
        throw new Error(`HapBench root not found: ${options.benchmarkRoot}`);
    }
    const overrideManifest = readJsonFile<OverrideManifest>(options.overridePath);
    const cases = scanCases(options.benchmarkRoot, overrideManifest.overrides || {});
    const rules = loadRuleSet({
        defaultRulePath: options.defaultRulePath,
        frameworkRulePath: options.frameworkRulePath,
        allowMissingProject: true,
        autoDiscoverLayers: false,
    });

    const results: CaseResult[] = [];
    for (const caseInfo of cases) {
        results.push(await runCase(caseInfo, rules, options.k));
    }

    const tp = results.filter(item => item.classification === "TP").length;
    const tn = results.filter(item => item.classification === "TN").length;
    const fp = results.filter(item => item.classification === "FP").length;
    const fn = results.filter(item => item.classification === "FN").length;
    const positiveCases = results.filter(item => item.expectedFlow).length;
    const negativeCases = results.length - positiveCases;
    const failures = results.filter(item => !item.pass);
    const categories = summarizeByCategory(results);
    const overrideCases = cases
        .filter(item => item.oracle.strategy === "manual_override")
        .map(item => ({
            caseKey: item.caseKey,
            expectedFlow: item.oracle.expectedFlow,
            reason: item.oracle.overrideReason || "",
        }));
    const mixedCases = cases
        .filter(item => item.oracle.strategy === "comment_mixed_positive")
        .map(item => item.caseKey)
        .sort();

    const report: BenchmarkReport = {
        benchmarkKind: "hapbench",
        generatedAt: new Date().toISOString(),
        benchmarkRoot: options.benchmarkRoot,
        overridePath: options.overridePath,
        k: options.k,
        categoryCount: categories.length,
        caseCount: results.length,
        positiveCases,
        negativeCases,
        tp,
        tn,
        fp,
        fn,
        recall: calcRecall(tp, fn),
        precision: calcPrecision(tp, fp),
        paperClaims: overrideManifest.paperClaims,
        categories,
        overrideCases,
        mixedCases,
        failures,
        cases: results,
    };

    ensureDir(options.outputDir);
    const reportJson = path.join(options.outputDir, "report.json");
    const reportMd = path.join(options.outputDir, "report.md");
    fs.writeFileSync(reportJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(reportMd, `${renderMarkdown(report)}\n`, "utf8");

    console.log("====== HapBench Summary ======");
    console.log(`benchmark_root=${options.benchmarkRoot}`);
    console.log(`k=${options.k}`);
    console.log(`categories=${report.categoryCount}`);
    console.log(`cases=${report.caseCount}`);
    console.log(`positives=${report.positiveCases}`);
    console.log(`negatives=${report.negativeCases}`);
    console.log(`tp=${report.tp}`);
    console.log(`fp=${report.fp}`);
    console.log(`tn=${report.tn}`);
    console.log(`fn=${report.fn}`);
    console.log(`recall=${fmtPercent(report.recall)}`);
    console.log(`precision=${fmtPercent(report.precision)}`);
    if (report.paperClaims) {
        console.log(`paper_precision=${fmtPercent(report.paperClaims.precision ?? null)}`);
        console.log(`paper_recall=${fmtPercent(report.paperClaims.recall ?? null)}`);
    }
    console.log(`manual_overrides=${report.overrideCases.length}`);
    console.log(`mixed_cases=${report.mixedCases.length}`);
    console.log(`report_json=${reportJson}`);
    console.log(`report_md=${reportMd}`);

    if (failures.length > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
