import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { LoadedRuleSet, loadRuleSet } from "../../core/rules/RuleLoader";
import { TaintFlow } from "../../core/kernel/model/TaintFlow";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";
import * as fs from "fs";
import * as path from "path";
import { summarizeSinkInventoryFlows } from "../helpers/SinkInventoryScoring";
import {
    createTestProgressReporter,
    printTestConsoleSummary,
    resolveTestOutputLayout,
    TestFailureSummary,
    TestOutputMetadata,
    writeTestSummary,
} from "../helpers/TestOutputContract";

interface CliOptions {
    benchmarkRoot: string;
    kernelRulePath: string;
    ruleCatalogPath: string;
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

type ExclusionKind =
    | "semantic_conflict"
    | "unsupported_precision_boundary"
    | "benchmark_issue";

interface OracleExclusion {
    kind: ExclusionKind;
    reason: string;
}

interface OracleSinkExclusion {
    reason: string;
    sinkRuleId?: string;
    sinkEndpoint?: string;
    sinkTextContains?: string;
    sinkMethodSignatureContains?: string;
}

interface OverrideManifest {
    name: string;
    version: string;
    description?: string;
    paperClaims?: PaperClaims;
    overrides: Record<string, OracleOverride>;
    exclusions?: Record<string, OracleExclusion>;
    sinkExclusions?: Record<string, OracleSinkExclusion[]>;
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
    excluded?: boolean;
    exclusionKind?: ExclusionKind;
    exclusionReason?: string;
    sinkExclusions?: OracleSinkExclusion[];
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
    rawFlowCount: number;
    ignoredFlowCount: number;
    flowCount: number;
    inventoryFlowCount: number;
    detectedFlow: boolean;
    classification: "TP" | "TN" | "FP" | "FN";
    pass: boolean;
    elapsedMs: number;
    leakLabelCount: number;
    safeLabelCount: number;
    sinkSamples: string[];
    sinkRuleHits: Record<string, number>;
    sinkFamilyHits: Record<string, number>;
    sinkEndpointHits: Record<string, number>;
    excluded?: boolean;
    exclusionKind?: ExclusionKind;
    exclusionReason?: string;
    ignoredSinkSamples?: string[];
    error?: string;
}

interface CategorySummary {
    category: string;
    cases: number;
    scoredCases: number;
    excludedCases: number;
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
    scoredCaseCount: number;
    excludedCaseCount: number;
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
    excludedCases: Array<{
        caseKey: string;
        kind: ExclusionKind;
        reason: string;
    }>;
    mixedCases: string[];
    failures: CaseResult[];
    cases: CaseResult[];
}

function parseArgs(argv: string[]): CliOptions {
    let benchmarkRoot = "tests/benchmark/HapBench";
    let kernelRulePath = "tests/rules/minimal.rules.json";
    let ruleCatalogPath = "src/rules";
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
        if (arg === "--kernelRule" && i + 1 < argv.length) {
            kernelRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--kernelRule=")) {
            kernelRulePath = arg.slice("--kernelRule=".length);
            continue;
        }
        if (arg === "--ruleCatalog" && i + 1 < argv.length) {
            ruleCatalogPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--ruleCatalog=")) {
            ruleCatalogPath = arg.slice("--ruleCatalog=".length);
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
        kernelRulePath: path.resolve(kernelRulePath),
        ruleCatalogPath: path.resolve(ruleCatalogPath),
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
    exclusions: Record<string, OracleExclusion>,
    sinkExclusionsByCase: Record<string, OracleSinkExclusion[]>,
): CaseOracle {
    const exclusion = exclusions[caseKey];
    const sinkExclusions = sinkExclusionsByCase[caseKey] || [];
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
            excluded: !!exclusion,
            exclusionKind: exclusion?.kind,
            exclusionReason: exclusion?.reason,
            sinkExclusions,
        };
    }
    if (leakLabels.length === 0 && safeLabels.length > 0) {
        return {
            caseKey,
            expectedFlow: false,
            strategy: "comment_negative",
            leakLabels,
            safeLabels,
            excluded: !!exclusion,
            exclusionKind: exclusion?.kind,
            exclusionReason: exclusion?.reason,
            sinkExclusions,
        };
    }
    if (leakLabels.length > 0 && safeLabels.length > 0) {
        return {
            caseKey,
            expectedFlow: true,
            strategy: "comment_mixed_positive",
            leakLabels,
            safeLabels,
            excluded: !!exclusion,
            exclusionKind: exclusion?.kind,
            exclusionReason: exclusion?.reason,
            sinkExclusions,
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
        excluded: !!exclusion,
        exclusionKind: exclusion?.kind,
        exclusionReason: exclusion?.reason,
        sinkExclusions,
    };
}

function scanCases(
    benchmarkRoot: string,
    overrides: Record<string, OracleOverride>,
    exclusions: Record<string, OracleExclusion>,
    sinkExclusionsByCase: Record<string, OracleSinkExclusion[]>,
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
                oracle: buildOracle(benchmarkRoot, caseKey, files, overrides, exclusions, sinkExclusionsByCase),
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

function resolveFlowSinkMethodSignature(flow: TaintFlow): string {
    return flow.sink?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
}

function matchesSinkExclusion(flow: TaintFlow, exclusion: OracleSinkExclusion): boolean {
    const sinkRuleId = String(flow.sinkRuleId || "").trim();
    const sinkEndpoint = String(flow.sinkEndpoint || "").trim();
    const sinkText = String(flow.sink?.toString?.() || "").trim();
    const sinkMethodSignature = resolveFlowSinkMethodSignature(flow);

    if (exclusion.sinkRuleId && exclusion.sinkRuleId !== sinkRuleId) return false;
    if (exclusion.sinkEndpoint && exclusion.sinkEndpoint !== sinkEndpoint) return false;
    if (exclusion.sinkTextContains && !sinkText.includes(exclusion.sinkTextContains)) return false;
    if (exclusion.sinkMethodSignatureContains && !sinkMethodSignature.includes(exclusion.sinkMethodSignatureContains)) return false;

    return !!(
        exclusion.sinkRuleId
        || exclusion.sinkEndpoint
        || exclusion.sinkTextContains
        || exclusion.sinkMethodSignatureContains
    );
}

function applySinkExclusions(
    flows: TaintFlow[],
    exclusions: OracleSinkExclusion[] | undefined,
): { keptFlows: TaintFlow[]; ignoredFlows: TaintFlow[] } {
    if (!exclusions || exclusions.length === 0) {
        return {
            keptFlows: [...flows],
            ignoredFlows: [],
        };
    }

    const keptFlows: TaintFlow[] = [];
    const ignoredFlows: TaintFlow[] = [];
    for (const flow of flows) {
        if (exclusions.some(exclusion => matchesSinkExclusion(flow, exclusion))) {
            ignoredFlows.push(flow);
            continue;
        }
        keptFlows.push(flow);
    }
    return { keptFlows, ignoredFlows };
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
        const rawFlows = engine.detectSinksByRules(rules.ruleSet.sinks || [], {
            sanitizerRules: rules.ruleSet.sanitizers || [],
        });
        const { keptFlows: flows, ignoredFlows } = applySinkExclusions(rawFlows, caseInfo.oracle.sinkExclusions);
        const sinkSummary = summarizeSinkInventoryFlows(flows, rules.ruleSet.sinks || []);
        const detectedFlow = sinkSummary.detectedInventory;
        const classification = classify(caseInfo.oracle.expectedFlow, detectedFlow);

        return {
            category: caseInfo.category,
            caseName: caseInfo.name,
            caseKey: caseInfo.caseKey,
            expectedFlow: caseInfo.oracle.expectedFlow,
            strategy: caseInfo.oracle.strategy,
            overrideReason: caseInfo.oracle.overrideReason,
            seedCount: seedInfo.seedCount,
            rawFlowCount: rawFlows.length,
            ignoredFlowCount: ignoredFlows.length,
            flowCount: flows.length,
            inventoryFlowCount: sinkSummary.inventoryFlowCount,
            detectedFlow,
            classification,
            pass: (detectedFlow === caseInfo.oracle.expectedFlow),
            elapsedMs: Date.now() - start,
            leakLabelCount: caseInfo.oracle.leakLabels.length,
            safeLabelCount: caseInfo.oracle.safeLabels.length,
            sinkSamples: sinkSamples(flows),
            sinkRuleHits: sinkSummary.sinkRuleHits,
            sinkFamilyHits: sinkSummary.sinkFamilyHits,
            sinkEndpointHits: sinkSummary.sinkEndpointHits,
            ignoredSinkSamples: sinkSamples(ignoredFlows),
            excluded: caseInfo.oracle.excluded,
            exclusionKind: caseInfo.oracle.exclusionKind,
            exclusionReason: caseInfo.oracle.exclusionReason,
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
            rawFlowCount: 0,
            ignoredFlowCount: 0,
            flowCount: 0,
            inventoryFlowCount: 0,
            detectedFlow: false,
            classification: caseInfo.oracle.expectedFlow ? "FN" : "TN",
            pass: false,
            elapsedMs: Date.now() - start,
            leakLabelCount: caseInfo.oracle.leakLabels.length,
            safeLabelCount: caseInfo.oracle.safeLabels.length,
            sinkSamples: [],
            sinkRuleHits: {},
            sinkFamilyHits: {},
            sinkEndpointHits: {},
            ignoredSinkSamples: [],
            excluded: caseInfo.oracle.excluded,
            exclusionKind: caseInfo.oracle.exclusionKind,
            exclusionReason: caseInfo.oracle.exclusionReason,
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
            const scoredItems = items.filter(item => !item.excluded);
            const tp = scoredItems.filter(item => item.classification === "TP").length;
            const tn = scoredItems.filter(item => item.classification === "TN").length;
            const fp = scoredItems.filter(item => item.classification === "FP").length;
            const fn = scoredItems.filter(item => item.classification === "FN").length;
            const positiveCases = scoredItems.filter(item => item.expectedFlow).length;
            const negativeCases = scoredItems.length - positiveCases;
            return {
                category,
                cases: items.length,
                scoredCases: scoredItems.length,
                excludedCases: items.length - scoredItems.length,
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
    lines.push(`- scored_cases: ${report.scoredCaseCount}`);
    lines.push(`- excluded_cases: ${report.excludedCaseCount}`);
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
    lines.push("| Category | Cases | Scored | Excluded | Pos | Neg | TP | FP | TN | FN | Recall | Precision |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const summary of report.categories) {
        lines.push(`| ${summary.category} | ${summary.cases} | ${summary.scoredCases} | ${summary.excludedCases} | ${summary.positiveCases} | ${summary.negativeCases} | ${summary.tp} | ${summary.fp} | ${summary.tn} | ${summary.fn} | ${fmtPercent(summary.recall)} | ${fmtPercent(summary.precision)} |`);
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

    if (report.excludedCases.length > 0) {
        lines.push("## Excluded Benchmark-Issue Cases");
        lines.push("");
        lines.push("These cases are kept in the imported corpus, executed for observation, but excluded from main scoring because their labels or triggering assumptions conflict with ArkTS/Harmony semantics or exceed the supported precision boundary.");
        lines.push("");
        for (const item of report.excludedCases) {
            lines.push(`- ${item.caseKey}: kind=${item.kind} (${item.reason})`);
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
            const exclusion = item.excluded ? ` excluded=${item.exclusionKind}` : "";
            const ignored = item.ignoredFlowCount > 0 ? ` ignored=${item.ignoredFlowCount}` : "";
            const sinkRuleIds = Object.keys(item.sinkRuleHits || {}).sort();
            const hitText = sinkRuleIds.length > 0
                ? ` sinkRuleHits=${sinkRuleIds.map(id => `${id}:${item.sinkRuleHits[id]}`).join(",")}`
                : "";
            lines.push(`- [${item.category}] ${item.caseName} expected=${item.expectedFlow ? "T" : "F"} detected=${item.detectedFlow ? "T" : "F"} flowCount=${item.flowCount} inventoryFlows=${item.inventoryFlowCount} strategy=${item.strategy}${exclusion}${ignored}${hitText}${err}`);
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
    const cases = scanCases(
        options.benchmarkRoot,
        overrideManifest.overrides || {},
        overrideManifest.exclusions || {},
        overrideManifest.sinkExclusions || {},
    );
    const rules = loadRuleSet({
        kernelRulePath: options.kernelRulePath,
        ruleCatalogPath: options.ruleCatalogPath,
        allowMissingProject: true,
        autoDiscoverLayers: false,
    });
    const outputLayout = resolveTestOutputLayout(options.outputDir);
    ensureDir(outputLayout.rootDir);
    const metadata: TestOutputMetadata = {
        suite: "hapbench",
        domain: "benchmark",
        title: "HapBench",
        purpose: "Evaluate ArkTaint against the imported HapBench benchmark and report precision/recall oriented sink-inventory scoring results.",
    };
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const progressReporter = createTestProgressReporter(outputLayout, metadata, cases.length, {
        logEveryCount: 1,
        logEveryPercent: 5,
    });

    const results: CaseResult[] = [];
    for (let index = 0; index < cases.length; index++) {
        const caseInfo = cases[index];
        progressReporter.update(index, caseInfo.caseKey, `category=${caseInfo.category}`);
        results.push(await runCase(caseInfo, rules, options.k));
        progressReporter.update(index + 1, caseInfo.caseKey, `category=${caseInfo.category}`);
    }

    const scoredResults = results.filter(item => !item.excluded);
    const tp = scoredResults.filter(item => item.classification === "TP").length;
    const tn = scoredResults.filter(item => item.classification === "TN").length;
    const fp = scoredResults.filter(item => item.classification === "FP").length;
    const fn = scoredResults.filter(item => item.classification === "FN").length;
    const positiveCases = scoredResults.filter(item => item.expectedFlow).length;
    const negativeCases = scoredResults.length - positiveCases;
    const failures = scoredResults.filter(item => !item.pass);
    const categories = summarizeByCategory(results);
    const overrideCases = cases
        .filter(item => item.oracle.strategy === "manual_override")
        .map(item => ({
            caseKey: item.caseKey,
            expectedFlow: item.oracle.expectedFlow,
            reason: item.oracle.overrideReason || "",
        }));
    const excludedCases = cases
        .filter(item => item.oracle.excluded)
        .map(item => ({
            caseKey: item.caseKey,
            kind: item.oracle.exclusionKind!,
            reason: item.oracle.exclusionReason || "",
        }))
        .sort((a, b) => a.caseKey.localeCompare(b.caseKey));
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
        scoredCaseCount: scoredResults.length,
        excludedCaseCount: results.length - scoredResults.length,
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
        excludedCases,
        mixedCases,
        failures,
        cases: results,
    };

    fs.writeFileSync(outputLayout.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(outputLayout.reportMarkdownPath, `${renderMarkdown(report)}\n`, "utf8");
    progressReporter.finish("DONE", "benchmark=hapbench");

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;
    const failureItems: TestFailureSummary[] = failures.map(item => ({
        name: item.caseKey,
        expected: item.expectedFlow ? "flow" : "no_flow",
        actual: item.detectedFlow ? "flow" : "no_flow",
        reason: item.error
            ? `Case execution failed: ${item.error}`
            : `Case result mismatched expected inventory scoring; classification=${item.classification}.`,
        severity: "high",
    }));
    writeTestSummary(outputLayout, metadata, {
        status: failureItems.length > 0 ? "fail" : "pass",
        verdict: failureItems.length > 0
            ? "HapBench completed with mismatches; see failures and category breakdown."
            : "HapBench completed with all scored cases matching expected inventory scoring.",
        startedAt,
        finishedAt,
        durationMs,
        totals: {
            benchmarkRoot: options.benchmarkRoot,
            k: options.k,
            categories: report.categoryCount,
            cases: report.caseCount,
            scoredCases: report.scoredCaseCount,
            excludedCases: report.excludedCaseCount,
            positives: report.positiveCases,
            negatives: report.negativeCases,
            tp: report.tp,
            tn: report.tn,
            fp: report.fp,
            fn: report.fn,
            recall: fmtPercent(report.recall),
            precision: fmtPercent(report.precision),
        },
        highlights: [
            `manual_overrides=${report.overrideCases.length}`,
            `excluded_benchmark_issues=${report.excludedCases.length}`,
            `mixed_cases=${report.mixedCases.length}`,
        ],
        failures: failureItems,
        notes: report.paperClaims
            ? [
                `paper_precision=${fmtPercent(report.paperClaims.precision ?? null)}`,
                `paper_recall=${fmtPercent(report.paperClaims.recall ?? null)}`,
                report.paperClaims.source ? `paper_source=${report.paperClaims.source}` : "",
            ].filter(Boolean)
            : [],
    });
    printTestConsoleSummary(metadata, outputLayout, {
        status: failureItems.length > 0 ? "fail" : "pass",
        verdict: failureItems.length > 0
            ? "HapBench completed with mismatches; see summary/report artifacts."
            : "HapBench completed with all scored cases matching expected inventory scoring.",
        startedAt,
        finishedAt,
        durationMs,
        totals: {
            benchmark_root: options.benchmarkRoot,
            k: options.k,
            categories: report.categoryCount,
            cases: report.caseCount,
            scored_cases: report.scoredCaseCount,
            excluded_cases: report.excludedCaseCount,
            positives: report.positiveCases,
            negatives: report.negativeCases,
            tp: report.tp,
            fp: report.fp,
            tn: report.tn,
            fn: report.fn,
            recall: fmtPercent(report.recall),
            precision: fmtPercent(report.precision),
        },
        highlights: [
            `manual_overrides=${report.overrideCases.length}`,
            `excluded_benchmark_issues=${report.excludedCases.length}`,
            `mixed_cases=${report.mixedCases.length}`,
        ],
        failures: failureItems,
    });

    if (failures.length > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
