import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import * as fs from "fs";
import * as path from "path";
import {
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";
import { injectArkUiSdk } from "../../core/orchestration/ArkUiSdkConfig";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { LoadedRuleSet, loadRuleSet } from "../../core/rules/RuleLoader";
import { summarizeSinkInventoryFlows } from "../helpers/SinkInventoryScoring";
import {
    createTestProgressReporter,
    printTestConsoleSummary,
    resolveTestOutputLayout,
    TestFailureSummary,
    TestOutputMetadata,
    writeTestSummary,
} from "../helpers/TestOutputContract";

interface SeniorFullManifest {
    targetDir: string;
    selectionMode?: "all" | "representative_pair_per_leaf_dir";
    includeTopLevelCategories: string[];
    boundaryTopLevelCategories?: string[];
    boundaryLeafDirs?: string[];
    explicitEntries?: Record<string, string | { name: string; pathHint?: string }>;
}

interface HapBenchManifest {
    benchmarkRoot: string;
    kernelRulePath: string;
    ruleCatalogPath: string;
    selectedCases?: string[];
}

interface ArkTaintBenchManifest {
    name: string;
    version: string;
    description?: string;
    seniorFull: SeniorFullManifest;
    hapBench: HapBenchManifest;
}

interface SeniorFullCaseResult {
    caseKey: string;
    category: string;
    expectedFlow: boolean;
    detectedFlow: boolean;
    pass: boolean;
    boundary: boolean;
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

interface SinkLabel {
    file: string;
    line: number;
    kind: "leak" | "no_leak";
    text: string;
}

type LabelStrategy =
    | "comment_positive"
    | "comment_negative"
    | "comment_mixed_positive"
    | "manual_override";

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

interface HapBenchCaseResult {
    caseKey: string;
    category: string;
    expectedFlow: boolean;
    detectedFlow: boolean;
    pass: boolean;
    flowCount: number;
    inventoryFlowCount: number;
    sinkRuleHits: Record<string, number>;
}

interface BenchSectionSummary {
    name: string;
    total: number;
    positives: number;
    negatives: number;
    tp: number;
    tn: number;
    fp: number;
    fn: number;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function parseArgs(argv: string[]): { manifestPath: string; outputDir: string } {
    let manifestPath = "tests/manifests/benchmarks/arktaint_bench.json";
    let outputDir = "tmp/test_runs/benchmark/arktaint_bench/latest";

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--manifest" && i + 1 < argv.length) {
            manifestPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--manifest=")) {
            manifestPath = arg.slice("--manifest=".length);
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
    }

    return {
        manifestPath: path.resolve(manifestPath),
        outputDir: path.resolve(outputDir),
    };
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function collectSeniorFullCases(root: string, includeTopLevelCategories: string[]): string[] {
    const selectedTopLevels = new Set(includeTopLevelCategories);
    const results: string[] = [];

    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }
            if (!entry.name.endsWith(".ets")) continue;
            const relative = path.relative(root, fullPath).replace(/\\/g, "/");
            const topLevel = relative.split("/")[0];
            if (!selectedTopLevels.has(topLevel)) continue;
            results.push(path.resolve(fullPath));
        }
    };

    walk(root);
    return results.sort((a, b) => a.localeCompare(b));
}

function selectRepresentativeSeniorFullCases(root: string, files: string[]): string[] {
    const grouped = new Map<string, string[]>();
    for (const file of files) {
        const relative = path.relative(root, file).replace(/\\/g, "/");
        const groupKey = path.dirname(relative);
        const bucket = grouped.get(groupKey) || [];
        bucket.push(file);
        grouped.set(groupKey, bucket);
    }

    const selected: string[] = [];
    for (const [, bucket] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const sorted = bucket.slice().sort((a, b) => a.localeCompare(b));
        const positive = sorted.find(file => {
            const name = path.basename(file, ".ets");
            return name.endsWith("_T") || name.includes("_T_");
        });
        const negative = sorted.find(file => {
            const name = path.basename(file, ".ets");
            return name.endsWith("_F") || name.includes("_F_");
        });
        if (positive) selected.push(positive);
        if (negative && negative !== positive) selected.push(negative);
        if (!positive && !negative && sorted[0]) selected.push(sorted[0]);
    }

    return selected;
}

function selectSeniorFullFiles(section: SeniorFullManifest): string[] {
    const targetDir = path.resolve(section.targetDir);
    const allFiles = collectSeniorFullCases(targetDir, section.includeTopLevelCategories);
    return section.selectionMode === "all"
        ? allFiles
        : selectRepresentativeSeniorFullCases(targetDir, allFiles);
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    injectArkUiSdk(config);
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function resolveSeniorFullExplicitEntry(
    section: SeniorFullManifest,
    normalizedRelative: string,
): { name: string; pathHint?: string } | undefined {
    const raw = section.explicitEntries?.[normalizedRelative];
    if (!raw) return undefined;
    if (typeof raw === "string") {
        return { name: raw };
    }
    if (typeof raw.name === "string" && raw.name.trim().length > 0) {
        return {
            name: raw.name.trim(),
            pathHint: raw.pathHint,
        };
    }
    return undefined;
}

async function runSeniorFullSection(
    section: SeniorFullManifest,
    progress: {
        reporter: ReturnType<typeof createTestProgressReporter>;
        baseCompletedCases: number;
    },
): Promise<SeniorFullCaseResult[]> {
    const targetDir = path.resolve(section.targetDir);
    const files = selectSeniorFullFiles(section);
    const results: SeniorFullCaseResult[] = [];
    const boundaryTopLevels = new Set(section.boundaryTopLevelCategories || []);
    const boundaryLeafDirs = new Set((section.boundaryLeafDirs || []).map(item => item.replace(/\\/g, "/")));
    const grouped = new Map<string, string[]>();
    for (const file of files) {
        const normalizedRelative = path.relative(targetDir, file).replace(/\\/g, "/");
        const leafDir = path.dirname(normalizedRelative);
        const bucket = grouped.get(leafDir) || [];
        bucket.push(file);
        grouped.set(leafDir, bucket);
    }

    console.log(`senior_full_selected_cases=${files.length}`);
    console.log(`senior_full_leaf_groups=${grouped.size}`);
    let globalIndex = 0;
    for (const [leafDir, bucket] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const projectDir = path.join(targetDir, leafDir);
        const scene = buildScene(projectDir);
        const preparedCases = bucket.map(file => {
            const relativePath = path.relative(projectDir, file).replace(/\\/g, "/");
            const normalizedRelative = path.relative(targetDir, file).replace(/\\/g, "/");
            const category = normalizedRelative.split("/")[0];
            const testName = path.basename(file, ".ets");
            const explicitEntry = resolveSeniorFullExplicitEntry(section, normalizedRelative);
            const entry = resolveCaseMethod(scene, relativePath, testName, { explicitEntry });
            const entryMethod = findCaseMethod(scene, entry);
            return {
                normalizedRelative,
                category,
                leafDir,
                testName,
                entryMethod,
                expectedFlow: testName.endsWith("_T") || testName.includes("_T_"),
                boundary: boundaryTopLevels.has(category) || boundaryLeafDirs.has(leafDir),
            };
        });
        const allEntryMethods = preparedCases
            .map(item => item.entryMethod)
            .filter((method): method is NonNullable<typeof method> => !!method && !!method.getBody?.());
        const engine = new TaintPropagationEngine(scene, 1);
        engine.verbose = false;
        await engine.buildPAG({
            syntheticEntryMethods: allEntryMethods,
            entryModel: "explicit",
        });

        for (let localIndex = 0; localIndex < preparedCases.length; localIndex++) {
            const index = globalIndex++;
            const item = preparedCases[localIndex];
            if (index % 10 === 0 || index === files.length - 1) {
                console.log(`senior_full_progress=${index + 1}/${files.length}`);
            }
            progress.reporter.update(
                progress.baseCompletedCases + index,
                item.normalizedRelative,
                "section=senior_full",
            );
            let detectedFlow = false;
            if (item.entryMethod?.getBody()) {
                engine.resetPropagationState();
                const seeds = collectCaseSeedNodes(engine, item.entryMethod);
                if (seeds.length > 0) {
                    engine.propagateWithSeeds(seeds);
                    detectedFlow = engine.detectSinks("Sink").length > 0;
                }
            }

            results.push({
                caseKey: item.normalizedRelative,
                category: item.category,
                expectedFlow: item.expectedFlow,
                detectedFlow,
                pass: detectedFlow === item.expectedFlow,
                boundary: item.boundary,
            });

            progress.reporter.update(
                progress.baseCompletedCases + index + 1,
                item.normalizedRelative,
                "section=senior_full",
            );
        }
    }

    return results;
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
        throw new Error(`No sink labels or override found for ArkTaint-bench HapBench case: ${caseKey}`);
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

function scanSelectedHapBenchCases(
    benchmarkRoot: string,
    selectedCases: string[] | undefined,
    overrides: Record<string, OracleOverride>,
): HapBenchCase[] {
    const wanted = selectedCases && selectedCases.length > 0 ? new Set(selectedCases) : undefined;
    const cases: HapBenchCase[] = [];
    for (const category of listDirectories(benchmarkRoot)) {
        const categoryRoot = path.join(benchmarkRoot, category);
        for (const caseName of listDirectories(categoryRoot)) {
            const caseKey = `${category}/${caseName}`;
            if (wanted && !wanted.has(caseKey)) continue;
            const caseRoot = path.join(categoryRoot, caseName);
            const files = collectCaseFiles(caseRoot);
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

    if (wanted) {
        const discovered = new Set(cases.map(item => item.caseKey));
        for (const caseKey of selectedCases || []) {
            assert(discovered.has(caseKey), `selected HapBench case not found: ${caseKey}`);
        }
    }

    return cases.sort((a, b) => a.caseKey.localeCompare(b.caseKey));
}

async function runSelectedHapBenchSectionWithProgress(
    section: HapBenchManifest,
    progress: {
        reporter: ReturnType<typeof createTestProgressReporter>;
        baseCompletedCases: number;
    },
): Promise<HapBenchCaseResult[]> {
    const benchmarkRoot = path.resolve(section.benchmarkRoot);
    const overrideManifest = readJsonFile<OverrideManifest>(path.resolve("tests/benchmark/HapBench/oracle_overrides.json"));
    const cases = scanSelectedHapBenchCases(benchmarkRoot, section.selectedCases, overrideManifest.overrides || {});
    const rules: LoadedRuleSet = loadRuleSet({
        kernelRulePath: path.resolve(section.kernelRulePath),
        ruleCatalogPath: path.resolve(section.ruleCatalogPath),
        allowMissingProject: true,
        autoDiscoverLayers: false,
    });

    const results: HapBenchCaseResult[] = [];
    console.log(`hapbench_selected_cases=${cases.length}`);
    for (let index = 0; index < cases.length; index++) {
        const caseInfo = cases[index];
        console.log(`hapbench_progress=${index + 1}/${cases.length} case=${caseInfo.caseKey}`);
        progress.reporter.update(
            progress.baseCompletedCases + index,
            caseInfo.caseKey,
            "section=hapbench",
        );
        const scene = buildScene(caseInfo.caseRoot);
        const engine = new TaintPropagationEngine(scene, 1, {
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
        assert(seedInfo.seedCount > 0, `expected HapBench seeds for ${caseInfo.caseKey}`);
        const flows = engine.detectSinksByRules(rules.ruleSet.sinks || [], {
            sanitizerRules: rules.ruleSet.sanitizers || [],
        });
        const sinkSummary = summarizeSinkInventoryFlows(flows, rules.ruleSet.sinks || []);
        const detectedFlow = sinkSummary.detectedInventory;
        results.push({
            caseKey: caseInfo.caseKey,
            category: caseInfo.category,
            expectedFlow: caseInfo.oracle.expectedFlow,
            detectedFlow,
            pass: detectedFlow === caseInfo.oracle.expectedFlow,
            flowCount: flows.length,
            inventoryFlowCount: sinkSummary.inventoryFlowCount,
            sinkRuleHits: sinkSummary.sinkRuleHits,
        });

        progress.reporter.update(
            progress.baseCompletedCases + index + 1,
            caseInfo.caseKey,
            "section=hapbench",
        );
    }

    return results;
}

function summarizeSection(name: string, results: Array<{ expectedFlow: boolean; detectedFlow: boolean }>): BenchSectionSummary {
    const tp = results.filter(item => item.expectedFlow && item.detectedFlow).length;
    const tn = results.filter(item => !item.expectedFlow && !item.detectedFlow).length;
    const fp = results.filter(item => !item.expectedFlow && item.detectedFlow).length;
    const fn = results.filter(item => item.expectedFlow && !item.detectedFlow).length;
    const positives = results.filter(item => item.expectedFlow).length;
    const negatives = results.length - positives;
    return {
        name,
        total: results.length,
        positives,
        negatives,
        tp,
        tn,
        fp,
        fn,
    };
}

function renderMarkdown(
    manifest: ArkTaintBenchManifest,
    seniorSummary: BenchSectionSummary,
    seniorBoundarySummary: BenchSectionSummary,
    hapSummary: BenchSectionSummary,
    seniorFailures: SeniorFullCaseResult[],
    seniorBoundaryFailures: SeniorFullCaseResult[],
    hapFailures: HapBenchCaseResult[],
): string {
    const total = seniorSummary.total + seniorBoundarySummary.total + hapSummary.total;
    const tp = seniorSummary.tp + seniorBoundarySummary.tp + hapSummary.tp;
    const tn = seniorSummary.tn + seniorBoundarySummary.tn + hapSummary.tn;
    const fp = seniorSummary.fp + seniorBoundarySummary.fp + hapSummary.fp;
    const fn = seniorSummary.fn + seniorBoundarySummary.fn + hapSummary.fn;
    const positives = seniorSummary.positives + seniorBoundarySummary.positives + hapSummary.positives;
    const negatives = seniorSummary.negatives + seniorBoundarySummary.negatives + hapSummary.negatives;

    const lines: string[] = [];
    lines.push("# ArkTaint Bench");
    lines.push("");
    lines.push(`- name: ${manifest.name}`);
    lines.push(`- version: ${manifest.version}`);
    lines.push(`- total_cases: ${total}`);
    lines.push(`- positives: ${positives}`);
    lines.push(`- negatives: ${negatives}`);
    lines.push(`- tp: ${tp}`);
    lines.push(`- tn: ${tn}`);
    lines.push(`- fp: ${fp}`);
    lines.push(`- fn: ${fn}`);
    lines.push("");
    lines.push("| Section | Total | Pos | Neg | TP | TN | FP | FN |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const summary of [seniorSummary, hapSummary]) {
        lines.push(`| ${summary.name} | ${summary.total} | ${summary.positives} | ${summary.negatives} | ${summary.tp} | ${summary.tn} | ${summary.fp} | ${summary.fn} |`);
    }
    lines.push("");
    lines.push("## Boundary Lane");
    lines.push("");
    lines.push(`- senior_full_boundary_cases: ${seniorBoundarySummary.total}`);
    lines.push(`- senior_full_boundary_tp: ${seniorBoundarySummary.tp}`);
    lines.push(`- senior_full_boundary_tn: ${seniorBoundarySummary.tn}`);
    lines.push(`- senior_full_boundary_fp: ${seniorBoundarySummary.fp}`);
    lines.push(`- senior_full_boundary_fn: ${seniorBoundarySummary.fn}`);
    lines.push("");

    if (seniorFailures.length > 0 || hapFailures.length > 0 || seniorBoundaryFailures.length > 0) {
        lines.push("## Failures");
        lines.push("");
        for (const item of seniorFailures) {
            lines.push(`- senior_full_core :: ${item.caseKey} expected=${item.expectedFlow ? "T" : "F"} detected=${item.detectedFlow ? "T" : "F"}`);
        }
        for (const item of seniorBoundaryFailures) {
            lines.push(`- senior_full_boundary :: ${item.caseKey} expected=${item.expectedFlow ? "T" : "F"} detected=${item.detectedFlow ? "T" : "F"}`);
        }
        for (const item of hapFailures) {
            lines.push(`- hapbench :: ${item.caseKey} expected=${item.expectedFlow ? "T" : "F"} detected=${item.detectedFlow ? "T" : "F"} inventoryFlows=${item.inventoryFlowCount}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const manifest = readJsonFile<ArkTaintBenchManifest>(options.manifestPath);
    const outputLayout = resolveTestOutputLayout(options.outputDir);
    ensureDir(outputLayout.rootDir);
    const metadata: TestOutputMetadata = {
        suite: "arktaint_bench",
        domain: "benchmark",
        title: "ArkTaint Bench",
        purpose: "Measure overall ArkTaint benchmark performance across the merged senior_full and HapBench suites, including current capability boundaries.",
    };

    const seniorPlannedCases = selectSeniorFullFiles(manifest.seniorFull).length;
    const hapOverrideManifest = readJsonFile<OverrideManifest>(path.resolve("tests/benchmark/HapBench/oracle_overrides.json"));
    const hapPlannedCases = scanSelectedHapBenchCases(
        path.resolve(manifest.hapBench.benchmarkRoot),
        manifest.hapBench.selectedCases,
        hapOverrideManifest.overrides || {},
    ).length;
    const totalPlannedCases = seniorPlannedCases + hapPlannedCases;
    const startedAt = Date.now();
    const progressReporter = createTestProgressReporter(outputLayout, metadata, totalPlannedCases, {
        logEveryCount: 1,
        logEveryPercent: 5,
    });

    const seniorResults = await runSeniorFullSection(manifest.seniorFull, {
        reporter: progressReporter,
        baseCompletedCases: 0,
    });
    const hapResults = await runSelectedHapBenchSectionWithProgress(manifest.hapBench, {
        reporter: progressReporter,
        baseCompletedCases: seniorPlannedCases,
    });

    const seniorCoreResults = seniorResults.filter(item => !item.boundary);
    const seniorBoundaryResults = seniorResults.filter(item => item.boundary);
    const seniorSummary = summarizeSection("senior_full_core", seniorCoreResults);
    const seniorBoundarySummary = summarizeSection("senior_full_boundary", seniorBoundaryResults);
    const hapSummary = summarizeSection("hapbench_harmony", hapResults);
    const seniorFailures = seniorCoreResults.filter(item => !item.pass);
    const seniorBoundaryFailures = seniorBoundaryResults.filter(item => !item.pass);
    const hapFailures = hapResults.filter(item => !item.pass);

    const report = {
        name: manifest.name,
        version: manifest.version,
        generatedAt: new Date().toISOString(),
        seniorFull: {
            total: seniorSummary.total,
            positives: seniorSummary.positives,
            negatives: seniorSummary.negatives,
            tp: seniorSummary.tp,
            tn: seniorSummary.tn,
            fp: seniorSummary.fp,
            fn: seniorSummary.fn,
            failures: seniorFailures,
        },
        seniorFullBoundary: {
            total: seniorBoundarySummary.total,
            positives: seniorBoundarySummary.positives,
            negatives: seniorBoundarySummary.negatives,
            tp: seniorBoundarySummary.tp,
            tn: seniorBoundarySummary.tn,
            fp: seniorBoundarySummary.fp,
            fn: seniorBoundarySummary.fn,
            failures: seniorBoundaryFailures,
        },
        hapBench: {
            total: hapSummary.total,
            positives: hapSummary.positives,
            negatives: hapSummary.negatives,
            tp: hapSummary.tp,
            tn: hapSummary.tn,
            fp: hapSummary.fp,
            fn: hapSummary.fn,
            selectedCases: manifest.hapBench.selectedCases || "all",
            failures: hapFailures,
        },
        total: {
            cases: seniorSummary.total + seniorBoundarySummary.total + hapSummary.total,
            positives: seniorSummary.positives + seniorBoundarySummary.positives + hapSummary.positives,
            negatives: seniorSummary.negatives + seniorBoundarySummary.negatives + hapSummary.negatives,
            tp: seniorSummary.tp + seniorBoundarySummary.tp + hapSummary.tp,
            tn: seniorSummary.tn + seniorBoundarySummary.tn + hapSummary.tn,
            fp: seniorSummary.fp + seniorBoundarySummary.fp + hapSummary.fp,
            fn: seniorSummary.fn + seniorBoundarySummary.fn + hapSummary.fn,
        },
    };

    fs.writeFileSync(outputLayout.reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(
        outputLayout.reportMarkdownPath,
        `${renderMarkdown(manifest, seniorSummary, seniorBoundarySummary, hapSummary, seniorFailures, seniorBoundaryFailures, hapFailures)}\n`,
        "utf8",
    );
    progressReporter.finish("DONE", "section=all");

    const failures: TestFailureSummary[] = [
        ...seniorFailures.map(item => ({
            name: `senior_full_core:${item.caseKey}`,
            expected: item.expectedFlow ? "flow" : "no_flow",
            actual: item.detectedFlow ? "flow" : "no_flow",
            reason: "Core benchmark case did not match expected flow result.",
            severity: "high" as const,
        })),
        ...seniorBoundaryFailures.map(item => ({
            name: `senior_full_boundary:${item.caseKey}`,
            expected: item.expectedFlow ? "flow" : "no_flow",
            actual: item.detectedFlow ? "flow" : "no_flow",
            reason: "Boundary benchmark case exposed a current precision or recall limitation.",
            severity: "medium" as const,
        })),
        ...hapFailures.map(item => ({
            name: `hapbench:${item.caseKey}`,
            expected: item.expectedFlow ? "flow" : "no_flow",
            actual: item.detectedFlow ? "flow" : "no_flow",
            reason: `HapBench case mismatch; inventoryFlows=${item.inventoryFlowCount}.`,
            severity: "high" as const,
        })),
    ];
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAt;
    writeTestSummary(outputLayout, metadata, {
        status: failures.length > 0 ? "fail" : "pass",
        verdict: failures.length > 0
            ? "ArkTaint Bench completed with benchmark mismatches; see failures and report breakdown."
            : "ArkTaint Bench completed with all merged benchmark cases matching current expectations.",
        startedAt: new Date(startedAt).toISOString(),
        finishedAt,
        durationMs,
        totals: {
            manifest: options.manifestPath,
            totalCases: report.total.cases,
            positives: report.total.positives,
            negatives: report.total.negatives,
            tp: report.total.tp,
            tn: report.total.tn,
            fp: report.total.fp,
            fn: report.total.fn,
            seniorFullCoreCases: seniorSummary.total,
            seniorFullBoundaryCases: seniorBoundarySummary.total,
            hapBenchCases: hapSummary.total,
        },
        highlights: [
            `senior_full_core=${seniorSummary.tp + seniorSummary.tn}/${seniorSummary.total}`,
            `senior_full_boundary=${seniorBoundarySummary.tp + seniorBoundarySummary.tn}/${seniorBoundarySummary.total}`,
            `hapbench=${hapSummary.tp + hapSummary.tn}/${hapSummary.total}`,
        ],
        failures,
        notes: [
            "Boundary lane cases are included in total scoring and intentionally keep current capability limits visible.",
        ],
    });
    printTestConsoleSummary(metadata, outputLayout, {
        status: failures.length > 0 ? "fail" : "pass",
        verdict: failures.length > 0
            ? "ArkTaint Bench completed with benchmark mismatches; see summary/report artifacts."
            : "ArkTaint Bench completed with all merged benchmark expectations satisfied.",
        startedAt: new Date(startedAt).toISOString(),
        finishedAt,
        durationMs,
        totals: {
            manifest: options.manifestPath,
            senior_full_core_cases: seniorSummary.total,
            senior_full_core_failures: seniorSummary.fp + seniorSummary.fn,
            senior_full_boundary_cases: seniorBoundarySummary.total,
            senior_full_boundary_failures: seniorBoundarySummary.fp + seniorBoundarySummary.fn,
            hapbench_cases: hapSummary.total,
            hapbench_failures: hapSummary.fp + hapSummary.fn,
            total_cases: report.total.cases,
            tp: report.total.tp,
            tn: report.total.tn,
            fp: report.total.fp,
            fn: report.total.fn,
        },
        highlights: [],
        failures,
    });

    if (seniorFailures.length > 0 || seniorBoundaryFailures.length > 0 || hapFailures.length > 0) {
        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error("FAIL test_arktaint_bench");
    console.error(error);
    process.exit(1);
});
