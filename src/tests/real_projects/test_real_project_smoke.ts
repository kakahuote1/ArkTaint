import {
    AnalyzeReport,
    EntryAnalyzeResult,
    emptyAnalyzeErrorDiagnostics,
    emptyRuleHitCounters,
    emptyTransferProfile,
    emptyDetectProfile,
    emptyExecutionHandoffAudit,
    emptyEnginePluginAuditSnapshot,
    emptyEntryStageProfile,
} from "../../cli/analyzeTypes";
import { emptyModuleAuditSnapshot } from "../../core/kernel/contracts/ModuleContract";
import { emptyPagNodeResolutionAuditSnapshot } from "../../core/kernel/contracts/PagNodeResolution";
import { CliOptions as AnalyzeCliOptions } from "../../cli/analyzeCliOptions";
import { runAnalyze } from "../../cli/analyzeRunner";
import { runAnalyzeCliCommand } from "../../cli/analyze";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import {
    CliOptions,
    EntrySmokeResult,
    ProjectSmokeResult,
    SmokeManifest,
    SmokeProjectConfig,
} from "../helpers/SmokeTypes";
import {
    aggregateReport,
    createSourceSummary,
    printConsoleSummary,
    projectFatalReasons,
    projectHasFatalAnalysis,
    renderMarkdownReport,
} from "../helpers/SmokeReportUtils";
import * as fs from "fs";
import * as path from "path";
import {
    createTestProgressReporter,
    printTestConsoleSummary,
    resolveTestOutputLayout,
    TestFailureSummary,
    TestOutputMetadata,
    writeTestSummary,
} from "../helpers/TestOutputContract";

function sumCounts(counts: Record<string, number>): number {
    return Object.values(counts || {}).reduce((sum, value) => sum + value, 0);
}

const DEFAULT_SMOKE_WORKLIST_BUDGET_MS = 45000;
const DEFAULT_SMOKE_MODULE_SETUP_BUDGET_MS = 30000;
const DEFAULT_SMOKE_EXECUTION_HANDOFF_BUDGET_MS = 30000;
const DEFAULT_SMOKE_PAG_INDEX_BUDGET_MS = 30000;
const DEFAULT_SMOKE_LAZY_MATERIALIZER_BUDGET_MS = 30000;
const DEFAULT_SMOKE_REACHABLE_BUDGET_MS = 30000;

function buildSinkEndpointHits(flowRuleTraces: EntryAnalyzeResult["flowRuleTraces"]): Record<string, number> {
    const hits: Record<string, number> = {};
    for (const trace of flowRuleTraces || []) {
        const endpoint = String(trace.sinkEndpoint || "").trim();
        if (!endpoint) continue;
        hits[endpoint] = (hits[endpoint] || 0) + 1;
    }
    return hits;
}

function buildSinkFamilyHits(
    flowRuleTraces: EntryAnalyzeResult["flowRuleTraces"],
    sinkFamilyById: Map<string, string>,
): Record<string, number> {
    const hits: Record<string, number> = {};
    for (const trace of flowRuleTraces || []) {
        const sinkRuleId = String(trace.sinkRuleId || "").trim();
        if (!sinkRuleId) continue;
        const family = String(sinkFamilyById.get(sinkRuleId) || "").trim();
        if (!family) continue;
        hits[family] = (hits[family] || 0) + 1;
    }
    return hits;
}

function parseArgs(argv: string[]): CliOptions {
    let manifestPath = "tests/manifests/real_projects/smoke_projects.json";
    let k = 1;
    let maxEntries = 12;
    let outputDir = "tmp/test_runs/real_projects/smoke/latest";
    let projectFilter: string | undefined;
    let autoModel = false;
    const autoModelProjects: string[] = [];
    let llmProfile: string | undefined;
    let llmModel: string | undefined;
    let llmSessionCacheDir: string | undefined;
    let llmSessionCacheMode: string | undefined;
    let llmTimeoutMs: number | undefined;
    let llmConnectTimeoutMs: number | undefined;
    let llmMaxAttempts: number | undefined;
    let llmMaxFailures: number | undefined;
    let llmRepairAttempts: number | undefined;
    let maxLlmItems: number | undefined;
    let worklistBudgetMs: number | undefined;
    let worklistMaxDequeues: number | undefined;
    let worklistMaxVisited: number | undefined;
    let moduleSetupBudgetMs: number | undefined;
    let executionHandoffBudgetMs: number | undefined;
    let pagIndexBudgetMs: number | undefined;
    let lazyMaterializerBudgetMs: number | undefined;
    let reachableBudgetMs: number | undefined;

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
        if (arg === "--k" && i + 1 < argv.length) {
            k = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--k=")) {
            k = Number(arg.slice("--k=".length));
            continue;
        }
        if (arg === "--maxEntries" && i + 1 < argv.length) {
            maxEntries = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--maxEntries=")) {
            maxEntries = Number(arg.slice("--maxEntries=".length));
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
        if (arg === "--project" && i + 1 < argv.length) {
            projectFilter = argv[++i];
            continue;
        }
        if (arg.startsWith("--project=")) {
            projectFilter = arg.slice("--project=".length);
            continue;
        }
        if (arg === "--autoModel") {
            autoModel = true;
            continue;
        }
        if (arg === "--autoModelProject" && i + 1 < argv.length) {
            autoModelProjects.push(...splitCsv(argv[++i]));
            continue;
        }
        if (arg.startsWith("--autoModelProject=")) {
            autoModelProjects.push(...splitCsv(arg.slice("--autoModelProject=".length)));
            continue;
        }
        if (arg === "--autoModelProjects" && i + 1 < argv.length) {
            autoModelProjects.push(...splitCsv(argv[++i]));
            continue;
        }
        if (arg.startsWith("--autoModelProjects=")) {
            autoModelProjects.push(...splitCsv(arg.slice("--autoModelProjects=".length)));
            continue;
        }
        if (arg === "--llmProfile" && i + 1 < argv.length) {
            llmProfile = argv[++i];
            continue;
        }
        if (arg.startsWith("--llmProfile=")) {
            llmProfile = arg.slice("--llmProfile=".length);
            continue;
        }
        if ((arg === "--llmModel" || arg === "--model") && i + 1 < argv.length) {
            llmModel = argv[++i];
            continue;
        }
        if (arg.startsWith("--llmModel=")) {
            llmModel = arg.slice("--llmModel=".length);
            continue;
        }
        if (arg.startsWith("--model=")) {
            llmModel = arg.slice("--model=".length);
            continue;
        }
        if (arg === "--llmSessionCacheDir" && i + 1 < argv.length) {
            llmSessionCacheDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--llmSessionCacheDir=")) {
            llmSessionCacheDir = arg.slice("--llmSessionCacheDir=".length);
            continue;
        }
        if (arg === "--llmSessionCacheMode" && i + 1 < argv.length) {
            llmSessionCacheMode = argv[++i];
            continue;
        }
        if (arg.startsWith("--llmSessionCacheMode=")) {
            llmSessionCacheMode = arg.slice("--llmSessionCacheMode=".length);
            continue;
        }
        const llmTimeoutArg = readNumberArg(arg, argv, i, "--llmTimeoutMs");
        if (llmTimeoutArg !== undefined) {
            llmTimeoutMs = llmTimeoutArg.value;
            if (llmTimeoutArg.consumedNext) i++;
            continue;
        }
        const llmConnectTimeoutArg = readNumberArg(arg, argv, i, "--llmConnectTimeoutMs");
        if (llmConnectTimeoutArg !== undefined) {
            llmConnectTimeoutMs = llmConnectTimeoutArg.value;
            if (llmConnectTimeoutArg.consumedNext) i++;
            continue;
        }
        const llmMaxAttemptsArg = readNumberArg(arg, argv, i, "--llmMaxAttempts");
        if (llmMaxAttemptsArg !== undefined) {
            llmMaxAttempts = llmMaxAttemptsArg.value;
            if (llmMaxAttemptsArg.consumedNext) i++;
            continue;
        }
        const llmMaxFailuresArg = readNumberArg(arg, argv, i, "--llmMaxFailures");
        if (llmMaxFailuresArg !== undefined) {
            llmMaxFailures = llmMaxFailuresArg.value;
            if (llmMaxFailuresArg.consumedNext) i++;
            continue;
        }
        const llmRepairAttemptsArg = readNumberArg(arg, argv, i, "--llmRepairAttempts");
        if (llmRepairAttemptsArg !== undefined) {
            llmRepairAttempts = llmRepairAttemptsArg.value;
            if (llmRepairAttemptsArg.consumedNext) i++;
            continue;
        }
        const maxLlmItemsArg = readNumberArg(arg, argv, i, "--maxLlmItems");
        if (maxLlmItemsArg !== undefined) {
            maxLlmItems = maxLlmItemsArg.value;
            if (maxLlmItemsArg.consumedNext) i++;
            continue;
        }
        const worklistBudgetArg = readNumberArg(arg, argv, i, "--worklistBudgetMs");
        if (worklistBudgetArg !== undefined) {
            worklistBudgetMs = worklistBudgetArg.value;
            if (worklistBudgetArg.consumedNext) i++;
            continue;
        }
        const worklistBudgetKebabArg = readNumberArg(arg, argv, i, "--worklist-budget-ms");
        if (worklistBudgetKebabArg !== undefined) {
            worklistBudgetMs = worklistBudgetKebabArg.value;
            if (worklistBudgetKebabArg.consumedNext) i++;
            continue;
        }
        const worklistDequeuesArg = readNumberArg(arg, argv, i, "--worklistMaxDequeues");
        if (worklistDequeuesArg !== undefined) {
            worklistMaxDequeues = worklistDequeuesArg.value;
            if (worklistDequeuesArg.consumedNext) i++;
            continue;
        }
        const worklistVisitedArg = readNumberArg(arg, argv, i, "--worklistMaxVisited");
        if (worklistVisitedArg !== undefined) {
            worklistMaxVisited = worklistVisitedArg.value;
            if (worklistVisitedArg.consumedNext) i++;
            continue;
        }
        const moduleSetupBudgetArg = readNumberArg(arg, argv, i, "--moduleSetupBudgetMs");
        if (moduleSetupBudgetArg !== undefined) {
            moduleSetupBudgetMs = moduleSetupBudgetArg.value;
            if (moduleSetupBudgetArg.consumedNext) i++;
            continue;
        }
        const moduleSetupBudgetKebabArg = readNumberArg(arg, argv, i, "--module-setup-budget-ms");
        if (moduleSetupBudgetKebabArg !== undefined) {
            moduleSetupBudgetMs = moduleSetupBudgetKebabArg.value;
            if (moduleSetupBudgetKebabArg.consumedNext) i++;
            continue;
        }
        const executionHandoffBudgetArg = readNumberArg(arg, argv, i, "--executionHandoffBudgetMs");
        if (executionHandoffBudgetArg !== undefined) {
            executionHandoffBudgetMs = executionHandoffBudgetArg.value;
            if (executionHandoffBudgetArg.consumedNext) i++;
            continue;
        }
        const executionHandoffBudgetKebabArg = readNumberArg(arg, argv, i, "--execution-handoff-budget-ms");
        if (executionHandoffBudgetKebabArg !== undefined) {
            executionHandoffBudgetMs = executionHandoffBudgetKebabArg.value;
            if (executionHandoffBudgetKebabArg.consumedNext) i++;
            continue;
        }
        const pagIndexBudgetArg = readNumberArg(arg, argv, i, "--pagIndexBudgetMs");
        if (pagIndexBudgetArg !== undefined) {
            pagIndexBudgetMs = pagIndexBudgetArg.value;
            if (pagIndexBudgetArg.consumedNext) i++;
            continue;
        }
        const pagIndexBudgetKebabArg = readNumberArg(arg, argv, i, "--pag-index-budget-ms");
        if (pagIndexBudgetKebabArg !== undefined) {
            pagIndexBudgetMs = pagIndexBudgetKebabArg.value;
            if (pagIndexBudgetKebabArg.consumedNext) i++;
            continue;
        }
        const lazyMaterializerBudgetArg = readNumberArg(arg, argv, i, "--lazyMaterializerBudgetMs");
        if (lazyMaterializerBudgetArg !== undefined) {
            lazyMaterializerBudgetMs = lazyMaterializerBudgetArg.value;
            if (lazyMaterializerBudgetArg.consumedNext) i++;
            continue;
        }
        const lazyMaterializerBudgetKebabArg = readNumberArg(arg, argv, i, "--lazy-materializer-budget-ms");
        if (lazyMaterializerBudgetKebabArg !== undefined) {
            lazyMaterializerBudgetMs = lazyMaterializerBudgetKebabArg.value;
            if (lazyMaterializerBudgetKebabArg.consumedNext) i++;
            continue;
        }
        const reachableBudgetArg = readNumberArg(arg, argv, i, "--reachableBudgetMs");
        if (reachableBudgetArg !== undefined) {
            reachableBudgetMs = reachableBudgetArg.value;
            if (reachableBudgetArg.consumedNext) i++;
            continue;
        }
        const reachableBudgetKebabArg = readNumberArg(arg, argv, i, "--reachable-budget-ms");
        if (reachableBudgetKebabArg !== undefined) {
            reachableBudgetMs = reachableBudgetKebabArg.value;
            if (reachableBudgetKebabArg.consumedNext) i++;
            continue;
        }
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}. Expected 0 or 1.`);
    }
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
        throw new Error(`Invalid --maxEntries value: ${maxEntries}. Expected positive integer.`);
    }
    if (llmTimeoutMs !== undefined && (!Number.isFinite(llmTimeoutMs) || llmTimeoutMs <= 0)) {
        throw new Error(`Invalid --llmTimeoutMs value: ${llmTimeoutMs}. Expected positive integer.`);
    }
    if (llmConnectTimeoutMs !== undefined && (!Number.isFinite(llmConnectTimeoutMs) || llmConnectTimeoutMs <= 0)) {
        throw new Error(`Invalid --llmConnectTimeoutMs value: ${llmConnectTimeoutMs}. Expected positive integer.`);
    }

    return {
        manifestPath,
        k,
        maxEntries: Math.floor(maxEntries),
        outputDir,
        projectFilter,
        autoModel,
        autoModelProjects: [...new Set(autoModelProjects)],
        llmProfile,
        llmModel,
        llmSessionCacheDir,
        llmSessionCacheMode,
        llmTimeoutMs,
        llmConnectTimeoutMs,
        llmMaxAttempts,
        llmMaxFailures,
        llmRepairAttempts,
        maxLlmItems,
        worklistBudgetMs,
        worklistMaxDequeues,
        worklistMaxVisited,
        moduleSetupBudgetMs,
        executionHandoffBudgetMs,
        pagIndexBudgetMs,
        lazyMaterializerBudgetMs,
        reachableBudgetMs,
    };
}

function splitCsv(raw: string): string[] {
    return String(raw || "").split(",").map(item => item.trim()).filter(Boolean);
}

function readNumberArg(
    arg: string,
    argv: string[],
    index: number,
    flag: string,
): { value: number; consumedNext: boolean } | undefined {
    let raw: string | undefined;
    let consumedNext = false;
    if (arg === flag && index + 1 < argv.length) {
        raw = argv[index + 1];
        consumedNext = true;
    } else if (arg.startsWith(`${flag}=`)) {
        raw = arg.slice(flag.length + 1);
    }
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid ${flag} value: ${raw}. Expected non-negative integer.`);
    }
    return { value: Math.floor(value), consumedNext };
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function isInsideDirectory(parentDir: string, candidateDir: string): boolean {
    const parentAbs = path.resolve(parentDir);
    const candidateAbs = path.resolve(candidateDir);
    const relative = path.relative(parentAbs, candidateAbs);
    return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function prepareSmokeOutputDirectory(rootDir: string): void {
    const rootAbs = path.resolve(rootDir);
    const managedSmokeRoot = path.resolve("tmp", "test_runs", "real_projects");
    if (isInsideDirectory(managedSmokeRoot, rootAbs)) {
        fs.rmSync(rootAbs, { recursive: true, force: true });
        ensureDir(rootAbs);
        return;
    }

    ensureDir(rootAbs);
    for (const artifactName of [
        "progress.json",
        "report.json",
        "report.md",
        "run.json",
        "smoke_report.json",
        "smoke_report.md",
        "summary.json",
        "summary.md",
    ]) {
        fs.rmSync(path.resolve(rootAbs, artifactName), { force: true });
    }
}

function readManifest(manifestPath: string): SmokeManifest {
    const abs = path.isAbsolute(manifestPath) ? manifestPath : path.resolve(manifestPath);
    if (!fs.existsSync(abs)) {
        throw new Error(`Manifest file not found: ${abs}`);
    }
    const parsed = JSON.parse(fs.readFileSync(abs, "utf-8")) as SmokeManifest;
    if (!parsed.projects || !Array.isArray(parsed.projects)) {
        throw new Error(`Invalid manifest format: missing projects[] in ${abs}`);
    }
    return parsed;
}

function sanitizeProjectId(raw: string): string {
    const normalized = String(raw || "")
        .replace(/[^A-Za-z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized.length > 0 ? normalized : "project";
}

function shouldAutoModelProject(project: SmokeProjectConfig, options: CliOptions): boolean {
    return options.autoModel
        || project.autoModel === true
        || (options.autoModelProjects || []).includes(project.id);
}

function readAnalyzeReportFromSummary(outputDir: string): AnalyzeReport {
    const summaryPath = path.resolve(outputDir, "summary", "summary.json");
    if (!fs.existsSync(summaryPath)) {
        throw new Error(`auto_model_summary_missing: ${summaryPath}`);
    }
    return JSON.parse(fs.readFileSync(summaryPath, "utf-8")) as AnalyzeReport;
}

function createAutoModelOptions(
    base: AnalyzeCliOptions,
    project: SmokeProjectConfig,
    options: CliOptions,
): AnalyzeCliOptions {
    const llmSessionCacheDir = project.llmSessionCacheDir || options.llmSessionCacheDir;
    return {
        ...base,
        autoModel: true,
        llmProfile: project.llmProfile || options.llmProfile,
        llmModel: project.llmModel || options.llmModel,
        llmSessionCacheDir: llmSessionCacheDir
            ? (path.isAbsolute(llmSessionCacheDir) ? llmSessionCacheDir : path.resolve(llmSessionCacheDir))
            : undefined,
        llmSessionCacheMode: project.llmSessionCacheMode || options.llmSessionCacheMode,
        llmTimeoutMs: project.llmTimeoutMs ?? options.llmTimeoutMs,
        llmConnectTimeoutMs: project.llmConnectTimeoutMs ?? options.llmConnectTimeoutMs,
        llmMaxAttempts: project.llmMaxAttempts ?? options.llmMaxAttempts,
        llmMaxFailures: project.llmMaxFailures ?? options.llmMaxFailures,
        llmRepairAttempts: project.llmRepairAttempts ?? options.llmRepairAttempts,
        maxLlmItems: project.maxLlmItems ?? options.maxLlmItems,
    };
}

function resolveSmokeWorklistBudgetMs(project: SmokeProjectConfig, options: CliOptions): number {
    return project.worklistBudgetMs ?? options.worklistBudgetMs ?? DEFAULT_SMOKE_WORKLIST_BUDGET_MS;
}

function resolveSmokeLlmTimeoutMs(project: SmokeProjectConfig, options: CliOptions): number | undefined {
    return project.llmTimeoutMs ?? options.llmTimeoutMs;
}

function resolveSmokeLlmConnectTimeoutMs(project: SmokeProjectConfig, options: CliOptions): number | undefined {
    return project.llmConnectTimeoutMs ?? options.llmConnectTimeoutMs;
}

function resolveSmokeModuleSetupBudgetMs(project: SmokeProjectConfig, options: CliOptions): number {
    return project.moduleSetupBudgetMs ?? options.moduleSetupBudgetMs ?? DEFAULT_SMOKE_MODULE_SETUP_BUDGET_MS;
}

function resolveSmokeExecutionHandoffBudgetMs(project: SmokeProjectConfig, options: CliOptions): number {
    return project.executionHandoffBudgetMs ?? options.executionHandoffBudgetMs ?? DEFAULT_SMOKE_EXECUTION_HANDOFF_BUDGET_MS;
}

function resolveSmokePagIndexBudgetMs(project: SmokeProjectConfig, options: CliOptions): number {
    return project.pagIndexBudgetMs ?? options.pagIndexBudgetMs ?? DEFAULT_SMOKE_PAG_INDEX_BUDGET_MS;
}

function resolveSmokeLazyMaterializerBudgetMs(project: SmokeProjectConfig, options: CliOptions): number {
    return project.lazyMaterializerBudgetMs ?? options.lazyMaterializerBudgetMs ?? DEFAULT_SMOKE_LAZY_MATERIALIZER_BUDGET_MS;
}

function resolveSmokeReachableBudgetMs(project: SmokeProjectConfig, options: CliOptions): number {
    return project.reachableBudgetMs ?? options.reachableBudgetMs ?? DEFAULT_SMOKE_REACHABLE_BUDGET_MS;
}

function applySmokeWorklistBudget(
    analyzeOptions: AnalyzeCliOptions,
    project: SmokeProjectConfig,
    options: CliOptions,
): AnalyzeCliOptions {
    return {
        ...analyzeOptions,
        worklistBudgetMs: resolveSmokeWorklistBudgetMs(project, options),
        worklistMaxDequeues: project.worklistMaxDequeues ?? options.worklistMaxDequeues,
        worklistMaxVisited: project.worklistMaxVisited ?? options.worklistMaxVisited,
        moduleSetupBudgetMs: resolveSmokeModuleSetupBudgetMs(project, options),
        executionHandoffBudgetMs: resolveSmokeExecutionHandoffBudgetMs(project, options),
        pagIndexBudgetMs: resolveSmokePagIndexBudgetMs(project, options),
        lazyMaterializerBudgetMs: resolveSmokeLazyMaterializerBudgetMs(project, options),
        reachableBudgetMs: resolveSmokeReachableBudgetMs(project, options),
    };
}

function createSyntheticEntryResult(
    sourceDir: string,
    status: EntrySmokeResult["status"],
    error?: string
): EntrySmokeResult {
    return {
        sourceDir,
        entryName: "@arkMain",
        entryPathHint: sourceDir,
        signature: "@arkMain",
        score: 100,
        status,
        seedLocalNames: [],
        seedStrategies: [],
        seedCount: 0,
        flowCount: 0,
        flowRuleTraces: [],
        sinkRuleHits: {},
        sinkFamilyHits: {},
        sinkEndpointHits: {},
        sinkFlowByKeyword: {},
        sinkFlowBySignature: {},
        sinkSamples: [],
        error,
        elapsedMs: 0,
    };
}

function mapAnalyzeEntryToSmokeEntry(
    entry: EntryAnalyzeResult,
    sinkFamilyById: Map<string, string>,
): EntrySmokeResult {
    const flowRuleTraces = entry.flowRuleTraces || [];
    const sinkRuleHits = { ...(entry.ruleHits?.sink || {}) };
    const sinkEndpointHits = buildSinkEndpointHits(flowRuleTraces);
    const sinkFamilyHits = buildSinkFamilyHits(flowRuleTraces, sinkFamilyById);

    return {
        sourceDir: entry.sourceDir,
        entryName: entry.entryName,
        entryPathHint: entry.entryPathHint,
        signature: entry.entryName,
        score: entry.score,
        status: entry.status,
        seedLocalNames: entry.seedLocalNames || [],
        seedStrategies: entry.seedStrategies || [],
        seedCount: entry.seedCount || 0,
        flowCount: entry.flowCount || 0,
        flowRuleTraces,
        sinkRuleHits,
        sinkFamilyHits,
        sinkEndpointHits,
        sinkFlowByKeyword: {},
        sinkFlowBySignature: {},
        sinkSamples: entry.sinkSamples || [],
        error: entry.error,
        elapsedMs: entry.elapsedMs || 0,
    };
}

function createAnalyzeOptions(
    repoAbs: string,
    validSourceDirs: string[],
    outputDir: string,
    projectId: string,
    k: number,
    maxEntries: number
): AnalyzeCliOptions {
    return {
        repo: repoAbs,
        sourceDirs: validSourceDirs,
        profile: "default",
        k,
        maxEntries,
        reportMode: "full",
        outputDir,
        concurrency: Math.max(1, Math.min(2, validSourceDirs.length)),
        incremental: false,
        incrementalCachePath: undefined,
        stopOnFirstFlow: false,
        maxFlowsPerEntry: undefined,
        enabledModels: [projectId],
        ruleOptions: {
            autoDiscoverLayers: true,
        },
    };
}

function buildSourceDirEntries(
    sourceDirs: string[],
    mappedEntries: EntrySmokeResult[],
    fatalErrors: string[]
): EntrySmokeResult[] {
    const bySourceDir = new Map<string, EntrySmokeResult>();
    for (const entry of mappedEntries) {
        bySourceDir.set(entry.sourceDir, entry);
    }

    const out: EntrySmokeResult[] = [];
    for (const sourceDir of sourceDirs) {
        const hit = bySourceDir.get(sourceDir);
        if (hit) {
            out.push(hit);
            continue;
        }
        const missing = fatalErrors.find(err => err.includes(sourceDir));
        out.push(createSyntheticEntryResult(sourceDir, "exception", missing || "source_dir_not_analyzed"));
    }
    return out;
}

function createFailureAnalyzeReport(repoAbs: string, sourceDirs: string[]): AnalyzeReport {
    const entries = sourceDirs.map(sourceDir => ({
        sourceDir,
        entryName: "@arkMain",
        entryPathHint: sourceDir,
        score: 100,
        status: "exception" as const,
        seedCount: 0,
        seedLocalNames: [],
        seedStrategies: [],
        sourceSeedAudit: [],
        sourceRuleZeroHitAudit: [],
        flowCount: 0,
        sinkSamples: [],
        sinkDetectionAudit: { entries: [], overflowCount: 0 },
        flowRuleTraces: [],
        ruleHits: emptyRuleHitCounters(),
        ruleHitEndpoints: emptyRuleHitCounters(),
        transferProfile: emptyTransferProfile(),
        detectProfile: emptyDetectProfile(),
        stageProfile: emptyEntryStageProfile(),
        transferNoHitReasons: ["analyze_exception"],
        pagNodeResolutionAudit: emptyPagNodeResolutionAuditSnapshot(),
        executionHandoffAudit: emptyExecutionHandoffAudit(),
        moduleAudit: emptyModuleAuditSnapshot(),
        enginePluginAudit: emptyEnginePluginAuditSnapshot(),
        elapsedMs: 0,
        error: "analyze_failed",
    }));

    return {
        generatedAt: new Date().toISOString(),
        repo: repoAbs,
        sourceDirs,
        profile: "default",
        reportMode: "full",
        k: 1,
        maxEntries: sourceDirs.length,
        ruleLayers: [],
        ruleLayerStatus: [],
        summary: {
            totalEntries: entries.length,
            okEntries: 0,
            withSeeds: 0,
            withFlows: 0,
            totalFlows: 0,
            statusCount: { exception: entries.length },
            ruleHits: emptyRuleHitCounters(),
            ruleHitEndpoints: emptyRuleHitCounters(),
            transferProfile: {
                ...emptyTransferProfile(),
                elapsedShareAvg: 0,
            },
            detectProfile: emptyDetectProfile(),
            memoryProfile: {
                sampleIntervalMs: 0,
                sampleCount: 0,
                rssMiB: 0,
                heapUsedMiB: 0,
                heapTotalMiB: 0,
                externalMiB: 0,
                arrayBuffersMiB: 0,
                peakRssMiB: 0,
                peakHeapUsedMiB: 0,
                peakHeapTotalMiB: 0,
                peakExternalMiB: 0,
                peakArrayBuffersMiB: 0,
            },
            pagNodeResolutionAudit: emptyPagNodeResolutionAuditSnapshot(),
            executionHandoffAudit: emptyExecutionHandoffAudit(),
            diagnostics: emptyAnalyzeErrorDiagnostics(),
            diagnosticItems: [],
            moduleAudit: {
                loadedModuleIds: [],
                failedModuleIds: [],
                discoveredModuleProjects: [],
                enabledModuleProjects: [],
                modules: {},
            },
            pluginAudit: {
                loadedPluginNames: [],
                failedPluginNames: [],
                plugins: {},
            },
            stageProfile: {
                ruleLoadMs: 0,
                sceneBuildMs: 0,
                entrySelectMs: 0,
                entryAnalyzeMs: 0,
                reportWriteMs: 0,
                sceneCacheHitCount: 0,
                sceneCacheMissCount: 0,
                transferSceneRuleCacheHitCount: 0,
                transferSceneRuleCacheMissCount: 0,
                transferSceneRuleCacheDisabledCount: 0,
                incrementalCacheHitCount: 0,
                incrementalCacheMissCount: 0,
                incrementalCacheWriteCount: 0,
                entryConcurrency: 0,
                entryParallelTaskCount: 0,
                totalMs: 0,
            },
            transferNoHitReasons: {},
            ruleFeedback: {
                zeroHitRules: emptyRuleHitCounters(),
                sourceZeroHitAudit: [],
                ruleHitRanking: {
                    source: [],
                    sink: [],
                    transfer: [],
                },
                uncoveredHighFrequencyInvokes: [],
                noCandidateCallsites: [],
            },
        },
        entries,
    };
}

type ProjectProgressUpdate = (detail: string) => void;

async function runProject(
    project: SmokeProjectConfig,
    options: CliOptions,
    updateProgress?: ProjectProgressUpdate,
): Promise<ProjectSmokeResult> {
    const stage = (name: string): void => updateProgress?.(`stage=${name}`);
    const repoAbs = path.isAbsolute(project.repoPath) ? project.repoPath : path.resolve(project.repoPath);
    const sourceDirs = project.sourceDirs || [];
    let effectiveMaxEntries = options.maxEntries;
    if (typeof project.maxEntriesCap === "number" && Number.isFinite(project.maxEntriesCap) && project.maxEntriesCap > 0) {
        effectiveMaxEntries = Math.min(options.maxEntries, Math.floor(project.maxEntriesCap));
    }
    const result: ProjectSmokeResult = {
        id: project.id,
        repoPath: repoAbs,
        repoUrl: project.repoUrl,
        license: project.license,
        sourceMode: project.sourceMode,
        priority: project.priority,
        commit: project.commit,
        tags: project.tags || [],
        sourceDirs,
        autoModel: shouldAutoModelProject(project, options),
        sourceSummaries: [],
        entries: [],
        sinkSignatures: project.sinkSignatures || [],
        effectiveMaxEntries,
        effectiveLlmTimeoutMs: resolveSmokeLlmTimeoutMs(project, options),
        effectiveLlmConnectTimeoutMs: resolveSmokeLlmConnectTimeoutMs(project, options),
        analyzed: 0,
        withSeeds: 0,
        withFlows: 0,
        totalFlows: 0,
        sinkRuleHits: {},
        sinkFamilyHits: {},
        sinkEndpointHits: {},
        sinkFlowByKeyword: {},
        sinkFlowBySignature: {},
        fatalErrors: [],
        effectiveWorklistBudgetMs: resolveSmokeWorklistBudgetMs(project, options),
        effectiveWorklistMaxDequeues: project.worklistMaxDequeues ?? options.worklistMaxDequeues,
        effectiveWorklistMaxVisited: project.worklistMaxVisited ?? options.worklistMaxVisited,
        effectiveModuleSetupBudgetMs: resolveSmokeModuleSetupBudgetMs(project, options),
        effectiveExecutionHandoffBudgetMs: resolveSmokeExecutionHandoffBudgetMs(project, options),
        effectivePagIndexBudgetMs: resolveSmokePagIndexBudgetMs(project, options),
        effectiveLazyMaterializerBudgetMs: resolveSmokeLazyMaterializerBudgetMs(project, options),
        effectiveReachableBudgetMs: resolveSmokeReachableBudgetMs(project, options),
    };

    stage("check_project_paths");
    if (!fs.existsSync(repoAbs)) {
        result.fatalErrors.push(`repo_path_missing: ${repoAbs}`);
        stage("project_path_missing");
        return result;
    }

    const validSourceDirs: string[] = [];
    for (const sourceDir of sourceDirs) {
        const sourceAbs = path.resolve(repoAbs, sourceDir);
        if (!fs.existsSync(sourceAbs)) {
            result.fatalErrors.push(`source_dir_missing: ${sourceAbs}`);
            continue;
        }
        validSourceDirs.push(sourceDir);
    }
    if (validSourceDirs.length === 0) {
        stage("source_dirs_missing");
        return result;
    }

    if (effectiveMaxEntries !== options.maxEntries) {
        console.log(`[smoke][project_cap] ${project.id}: cli_maxEntries=${options.maxEntries}, cap=${effectiveMaxEntries}`);
    }

    stage("prepare_analyze_options");
    const projectOutputDir = path.resolve(options.outputDir, sanitizeProjectId(project.id));
    ensureDir(projectOutputDir);
    const analyzeOptions = applySmokeWorklistBudget(createAnalyzeOptions(
        repoAbs,
        validSourceDirs,
        projectOutputDir,
        project.id,
        options.k,
        effectiveMaxEntries
    ), project, options);
    stage("load_active_rules");
    const activeRules = loadRuleSet({
        ...analyzeOptions.ruleOptions,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const sinkFamilyById = new Map<string, string>(
        (activeRules.ruleSet.sinks || []).map(rule => [String(rule.id || ""), String(rule.family || "")]),
    );
    let analyzeReport: AnalyzeReport;
    try {
        stage(result.autoModel ? "run_analyze_automodel_start" : "run_analyze_start");
        if (result.autoModel) {
            await runAnalyzeCliCommand(createAutoModelOptions(analyzeOptions, project, options));
            analyzeReport = readAnalyzeReportFromSummary(projectOutputDir);
        } else {
            analyzeReport = (await runAnalyze(analyzeOptions)).report;
        }
        stage("run_analyze_done");
    } catch (err: any) {
        result.fatalErrors.push(`analyze_failed: ${String(err?.message || err)}`);
        analyzeReport = createFailureAnalyzeReport(repoAbs, validSourceDirs);
        stage("run_analyze_failed");
    }

    stage("map_entries");
    const mappedEntries = (analyzeReport.entries || []).map(entry => mapAnalyzeEntryToSmokeEntry(entry, sinkFamilyById));
    result.entries = buildSourceDirEntries(validSourceDirs, mappedEntries, result.fatalErrors);

    for (const sourceDir of validSourceDirs) {
        const sourceEntries = result.entries.filter(entry => entry.sourceDir === sourceDir);
        const hasAnalysis = sourceEntries.length > 0;
        const summary = createSourceSummary(sourceDir, sourceEntries, {
            selected: sourceEntries.map(entry => ({
                name: entry.entryName,
                pathHint: entry.entryPathHint,
                signature: entry.signature,
                score: entry.score,
                sourceDir: entry.sourceDir,
                sourceFile: entry.entryPathHint,
            })),
            poolTotal: 1,
            filteredTotal: 1,
            poolFileCount: 1,
            filteredFileCount: 1,
            selectedFileCount: hasAnalysis ? 1 : 0,
        });
        result.sourceSummaries.push(summary);
    }

    stage("aggregate_entry_results");
    for (const entry of result.entries) {
        result.analyzed++;
        if (entry.seedCount > 0) result.withSeeds++;
        const inventoryFlowCount = (entry.flowRuleTraces?.length || 0) > 0
            ? entry.flowRuleTraces.length
            : Math.max(entry.flowCount, sumCounts(entry.sinkRuleHits));
        if (inventoryFlowCount > 0) result.withFlows++;
        result.totalFlows += inventoryFlowCount;
        for (const [sinkRuleId, count] of Object.entries(entry.sinkRuleHits)) {
            result.sinkRuleHits[sinkRuleId] = (result.sinkRuleHits[sinkRuleId] || 0) + count;
        }
        for (const [family, count] of Object.entries(entry.sinkFamilyHits)) {
            result.sinkFamilyHits[family] = (result.sinkFamilyHits[family] || 0) + count;
        }
        for (const [endpoint, count] of Object.entries(entry.sinkEndpointHits)) {
            result.sinkEndpointHits[endpoint] = (result.sinkEndpointHits[endpoint] || 0) + count;
        }
    }

    stage("project_result_ready");
    return result;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const manifest = readManifest(options.manifestPath);
    let projects = manifest.projects.filter(p => p.enabled !== false);
    if (options.projectFilter) {
        projects = projects.filter(p => p.id === options.projectFilter);
    }
    if (projects.length === 0) {
        throw new Error("No projects selected. Check manifest or --project filter.");
    }
    const outputLayout = resolveTestOutputLayout(options.outputDir);
    prepareSmokeOutputDirectory(outputLayout.rootDir);
    const metadata: TestOutputMetadata = {
        suite: "real_project_smoke",
        domain: "real_projects",
        title: "Real Project Smoke",
        purpose: "Run bounded real-project analysis smoke checks and summarize entry coverage, seed recovery, flow recovery, and fatal project failures.",
    };
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const progressReporter = createTestProgressReporter(outputLayout, metadata, projects.length, {
        logEveryCount: 1,
        logEveryPercent: 10,
    });

    const projectResults: ProjectSmokeResult[] = [];
    for (let index = 0; index < projects.length; index++) {
        const project = projects[index];
        progressReporter.update(index, project.id, "stage=project_start");
        console.log(`\n>>> Smoke project: ${project.id}`);
        const result = await runProject(project, options, detail => {
            progressReporter.update(index, project.id, detail);
        });
        projectResults.push(result);
        progressReporter.update(index + 1, project.id, "stage=project_done");
    }

    const report = aggregateReport(options, projectResults);
    const reportJsonPath = path.resolve(options.outputDir, "smoke_report.json");
    const reportMdPath = path.resolve(options.outputDir, "smoke_report.md");
    fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(reportMdPath, renderMarkdownReport(report), "utf-8");
    fs.writeFileSync(outputLayout.reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(outputLayout.reportMarkdownPath, renderMarkdownReport(report), "utf-8");
    progressReporter.finish("DONE", "stage=all_projects");

    printConsoleSummary(report);
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;
    const failureItems: TestFailureSummary[] = report.projects
        .filter(projectHasFatalAnalysis)
        .map(project => {
            const fatalReasons = projectFatalReasons(project);
            return {
                name: project.id,
                expected: "no_fatal_errors",
                actual: `fatal_reasons=${fatalReasons.length}`,
                reason: fatalReasons.join("; "),
                severity: "high",
                nextHint: "Inspect the project section in smoke_report.md for source-dir and analyze failure details.",
            };
        });
    writeTestSummary(outputLayout, metadata, {
        status: report.fatalProjectCount > 0 ? "fail" : "pass",
        verdict: report.fatalProjectCount > 0
            ? "Real-project smoke completed with fatal project failures; inspect affected project sections."
            : "Real-project smoke completed without fatal project failures.",
        startedAt,
        finishedAt,
        durationMs,
        totals: {
            manifest: options.manifestPath,
            projects: report.totalProjects,
            analyzedEntries: report.totalAnalyzedEntries,
            entriesWithSeeds: report.totalEntriesWithSeeds,
            entriesWithFlows: report.totalEntriesWithFlows,
            totalFlows: report.totalFlows,
            fatalProjects: report.fatalProjectCount,
        },
        highlights: report.projects.slice(0, 5).map(project =>
            `${project.id}: analyzed=${project.analyzed}, withSeeds=${project.withSeeds}, withFlows=${project.withFlows}, fatal=${projectFatalReasons(project).length}`),
        failures: failureItems,
    });
    printTestConsoleSummary(metadata, outputLayout, {
        status: report.fatalProjectCount > 0 ? "fail" : "pass",
        verdict: report.fatalProjectCount > 0
            ? "Real-project smoke completed with fatal project failures; inspect summary/report artifacts."
            : "Real-project smoke completed without fatal project failures.",
        startedAt,
        finishedAt,
        durationMs,
        totals: {
            manifest: options.manifestPath,
            projects: report.totalProjects,
            analyzed_entries: report.totalAnalyzedEntries,
            entries_with_seeds: report.totalEntriesWithSeeds,
            entries_with_flows: report.totalEntriesWithFlows,
            total_flows: report.totalFlows,
            fatal_projects: report.fatalProjectCount,
        },
        highlights: [],
        failures: failureItems,
    });

    if (report.fatalProjectCount > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});


