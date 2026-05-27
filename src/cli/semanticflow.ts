import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { enrichNoCandidateItemsWithCallsiteSlices } from "../core/model/callsite/callsiteContextSlices";
import type { NormalizedCallsiteItem } from "../core/model/callsite/callsiteContextSlices";
import { mergeSemanticFlowAnalysisAugments } from "../core/semanticflow/SemanticFlowArtifacts";
import { buildSemanticFlowEngineAugment } from "../core/semanticflow/SemanticFlowArtifacts";
import { runSemanticFlowProject } from "../core/semanticflow/SemanticFlowProject";
import {
    serializeSemanticFlowAssets,
    serializeSemanticFlowSession,
} from "../core/semanticflow/SemanticFlowSerialize";
import { publishSemanticFlowProjectAssets } from "../core/semanticflow/SemanticFlowProjectAssets";
import { createSemanticFlowModelInvokerFromConfig } from "./semanticflowLlmClient";
import { resolveLlmProfile } from "./llmConfig";
import { runAnalyze } from "./analyzeRunner";
import type { AnalyzeEntryModel, AnalyzeProfile, CliOptions, ReportMode } from "./analyzeCliOptions";
import type { SemanticFlowProgressEvent } from "../core/semanticflow/SemanticFlowPipeline";
import { filterKnownSemanticFlowRuleCandidates } from "./semanticflowKnownRuleCandidates";
import { normalizeSemanticFlowSessionCacheMode, SemanticFlowSessionCache } from "../core/semanticflow/SemanticFlowSessionCache";
import { discoverArkTsSourceDirs, normalizeSourceDirsForCli } from "./sourceDiscovery";

declare const require: any;
declare const module: any;
declare const process: any;

export interface SemanticFlowCliOptions {
    repo: string;
    sourceDirs: string[];
    llmConfigPath?: string;
    llmProfile?: string;
    publishModel?: string;
    modelRoots?: string[];
    enabledModels?: string[];
    disabledModels?: string[];
    ruleInput?: string;
    outputDir: string;
    model?: string;
    arkMainMaxCandidates?: number;
    maxRounds: number;
    concurrency: number;
    contextRadius: number;
    cfgNeighborRadius: number;
    maxSliceItems: number;
    examplesPerItem: number;
    analyze: boolean;
    incremental?: boolean;
    incrementalCachePath?: string;
    profile: AnalyzeProfile;
    entryModel?: AnalyzeEntryModel;
    reportMode: ReportMode;
    maxEntries: number;
    k: number;
    stopOnFirstFlow: boolean;
    maxFlowsPerEntry?: number;
    worklistBudgetMs?: number;
    worklistMaxDequeues?: number;
    worklistMaxVisited?: number;
    llmSessionCacheDir?: string;
    llmSessionCacheMode?: string;
    llmTimeoutMs?: number;
    llmConnectTimeoutMs?: number;
    llmMaxAttempts?: number;
    llmMaxFailures?: number;
    llmRepairAttempts?: number;
    maxLlmItems?: number;
}

interface SemanticFlowSessionBundle {
    sourceDir: string;
    skippedKnownRuleCandidates: number;
    result: Awaited<ReturnType<typeof runSemanticFlowProject>>;
}

interface SemanticFlowSourceRunRecord {
    sourceDir: string;
    absPath: string;
    status: "ok" | "missing" | "exception";
    methods?: number;
    itemCount?: number;
    arkMainCandidateCount?: number;
    arkMainIneligibleCount?: number;
    elapsedMs: number;
    error?: string;
}

interface BootstrapAnalyzeResult {
    ruleInputPath: string;
    run?: Awaited<ReturnType<typeof runAnalyze>>;
}

async function withAnalyzeHeartbeat<T>(
    phase: "bootstrap_analyze" | "final_analyze",
    work: () => Promise<T>,
): Promise<T> {
    const startedAt = Date.now();
    const timer = setInterval(() => {
        const elapsedMs = Date.now() - startedAt;
        console.log(`semanticflow_phase=${phase} heartbeat elapsed_ms=${elapsedMs}`);
    }, 15000);
    try {
        return await work();
    } finally {
        clearInterval(timer);
    }
}

function resolveArkMainCandidateLimit(options: SemanticFlowCliOptions): number {
    if (options.arkMainMaxCandidates !== undefined) {
        return options.arkMainMaxCandidates;
    }
    return Math.max(4, Math.min(options.maxEntries, 8));
}

function emitSemanticFlowProgress(event: SemanticFlowProgressEvent): void {
    if (event.type === "session-start") {
        console.log(`semanticflow_progress=session_start items=${event.totalItems} concurrency=${event.concurrency} max_rounds=${event.maxRounds}`);
        return;
    }
    if (event.type === "session-complete") {
        console.log(`semanticflow_progress=session_complete items=${event.totalItems}`);
        return;
    }
    if (event.type === "item-start") {
        console.log(`semanticflow_progress=item_start index=${event.index}/${event.totalItems} anchor=${event.anchorId} surface=${event.surface}`);
        return;
    }
    if (event.type === "round-start") {
        console.log(`semanticflow_progress=round_start index=${event.index}/${event.totalItems} anchor=${event.anchorId} round=${event.round}`);
        return;
    }
    if (event.type === "round-decision") {
        console.log(`semanticflow_progress=round_decision index=${event.index}/${event.totalItems} anchor=${event.anchorId} round=${event.round} status=${event.status}`);
        return;
    }
    if (event.type === "round-expand") {
        console.log(`semanticflow_progress=round_expand index=${event.index}/${event.totalItems} anchor=${event.anchorId} round=${event.round} kind=${event.kind}`);
        return;
    }
    console.log(`semanticflow_progress=item_done index=${event.index}/${event.totalItems} anchor=${event.anchorId} resolution=${event.resolution} plane=${event.plane || ""}`);
}

function splitCsv(value?: string): string[] {
    if (!value) return [];
    return value.split(",").map(v => v.trim()).filter(Boolean);
}

function readValue(argv: string[], i: number, prefix: string): string | undefined {
    const arg = argv[i];
    const next = i + 1 < argv.length ? argv[i + 1] : undefined;
    if (arg === prefix) return next;
    if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1);
    return undefined;
}

function normalizePositiveInt(raw: string | undefined, flag: string, fallback: number): number {
    if (raw === undefined) {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`invalid ${flag}: ${raw}`);
    }
    return Math.floor(value);
}

function normalizeNonNegativeInt(raw: string | undefined, flag: string, fallback: number): number {
    if (raw === undefined) {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`invalid ${flag}: ${raw}`);
    }
    return Math.floor(value);
}

function parseProfile(raw: string | undefined): AnalyzeProfile {
    if (!raw) return "default";
    if (raw === "default" || raw === "strict" || raw === "fast") {
        return raw;
    }
    throw new Error(`invalid --profile: ${raw}`);
}

function parseReportMode(raw: string | undefined): ReportMode {
    if (!raw) return "light";
    if (raw === "light" || raw === "full") {
        return raw;
    }
    throw new Error(`invalid --reportMode: ${raw}`);
}

function parseArgs(argv: string[]): SemanticFlowCliOptions {
    let repo = "";
    let sourceDirs: string[] = [];
    let llmConfigPath: string | undefined;
    let llmProfile: string | undefined;
    let publishModel: string | undefined;
    let modelRoots: string[] = [];
    let enabledModels: string[] = [];
    let disabledModels: string[] = [];
    let ruleInput: string | undefined;
    let outputDir = path.resolve("tmp/test_runs/runtime/semanticflow_cli/latest");
    let model: string | undefined;
    let arkMainMaxCandidates: number | undefined;
    let maxRounds = 2;
    let concurrency = 4;
    let contextRadius = 4;
    let cfgNeighborRadius = 2;
    let maxSliceItems = 48;
    let examplesPerItem = 2;
    let analyze = true;
    let incremental = true;
    let incrementalCachePath: string | undefined;
    let profile: AnalyzeProfile = "default";
    let entryModel: AnalyzeEntryModel = "arkMain";
    let reportMode: ReportMode = "light";
    let maxEntries = 12;
    let k = 1;
    let stopOnFirstFlow = false;
    let maxFlowsPerEntry: number | undefined;
    let worklistBudgetMs: number | undefined;
    let worklistMaxDequeues: number | undefined;
    let worklistMaxVisited: number | undefined;
    let llmSessionCacheDir: string | undefined;
    let llmSessionCacheMode: string | undefined;
    let llmTimeoutMs: number | undefined;
    let llmConnectTimeoutMs: number | undefined;
    let llmMaxAttempts = 1;
    let llmMaxFailures = 3;
    let llmRepairAttempts = 0;
    let maxLlmItems = 12;

    for (let i = 0; i < argv.length; i++) {
        const repoArg = readValue(argv, i, "--repo");
        if (repoArg !== undefined) {
            repo = path.resolve(repoArg);
            if (argv[i] === "--repo") i++;
            continue;
        }
        const sourceDirArg = readValue(argv, i, "--sourceDir");
        if (sourceDirArg !== undefined) {
            sourceDirs.push(...splitCsv(sourceDirArg));
            if (argv[i] === "--sourceDir") i++;
            continue;
        }
        const llmConfigArg = readValue(argv, i, "--llmConfig");
        if (llmConfigArg !== undefined) {
            llmConfigPath = path.resolve(llmConfigArg);
            if (argv[i] === "--llmConfig") i++;
            continue;
        }
        const llmProfileArg = readValue(argv, i, "--llmProfile");
        if (llmProfileArg !== undefined) {
            llmProfile = llmProfileArg.trim();
            if (argv[i] === "--llmProfile") i++;
            continue;
        }
        const publishModelArg = readValue(argv, i, "--publish-model");
        if (publishModelArg !== undefined) {
            publishModel = publishModelArg.trim();
            if (argv[i] === "--publish-model") i++;
            continue;
        }
        const modelRootArg = readValue(argv, i, "--model-root");
        if (modelRootArg !== undefined) {
            modelRoots.push(...splitCsv(modelRootArg).map(item => path.resolve(item)));
            if (argv[i] === "--model-root") i++;
            continue;
        }
        const enableModelArg = readValue(argv, i, "--enable-model");
        if (enableModelArg !== undefined) {
            enabledModels.push(...splitCsv(enableModelArg));
            if (argv[i] === "--enable-model") i++;
            continue;
        }
        const disableModelArg = readValue(argv, i, "--disable-model");
        if (disableModelArg !== undefined) {
            disabledModels.push(...splitCsv(disableModelArg));
            if (argv[i] === "--disable-model") i++;
            continue;
        }
        const ruleInputArg = readValue(argv, i, "--ruleInput");
        if (ruleInputArg !== undefined) {
            ruleInput = path.resolve(ruleInputArg);
            if (argv[i] === "--ruleInput") i++;
            continue;
        }
        const outputArg = readValue(argv, i, "--outputDir");
        if (outputArg !== undefined) {
            outputDir = path.resolve(outputArg);
            if (argv[i] === "--outputDir") i++;
            continue;
        }
        const modelArg = readValue(argv, i, "--model");
        if (modelArg !== undefined) {
            model = modelArg.trim();
            if (argv[i] === "--model") i++;
            continue;
        }
        const arkArg = readValue(argv, i, "--arkMainMaxCandidates");
        if (arkArg !== undefined) {
            arkMainMaxCandidates = normalizePositiveInt(arkArg, "--arkMainMaxCandidates", 1);
            if (argv[i] === "--arkMainMaxCandidates") i++;
            continue;
        }
        const roundsArg = readValue(argv, i, "--maxRounds");
        if (roundsArg !== undefined) {
            maxRounds = normalizePositiveInt(roundsArg, "--maxRounds", 2);
            if (argv[i] === "--maxRounds") i++;
            continue;
        }
        const concurrencyArg = readValue(argv, i, "--concurrency");
        if (concurrencyArg !== undefined) {
            concurrency = normalizePositiveInt(concurrencyArg, "--concurrency", 4);
            if (argv[i] === "--concurrency") i++;
            continue;
        }
        const contextArg = readValue(argv, i, "--contextRadius");
        if (contextArg !== undefined) {
            contextRadius = normalizePositiveInt(contextArg, "--contextRadius", 4);
            if (argv[i] === "--contextRadius") i++;
            continue;
        }
        const cfgArg = readValue(argv, i, "--cfgNeighborRadius");
        if (cfgArg !== undefined) {
            cfgNeighborRadius = normalizePositiveInt(cfgArg, "--cfgNeighborRadius", 2);
            if (argv[i] === "--cfgNeighborRadius") i++;
            continue;
        }
        const maxSliceArg = readValue(argv, i, "--maxSliceItems");
        if (maxSliceArg !== undefined) {
            maxSliceItems = normalizePositiveInt(maxSliceArg, "--maxSliceItems", 48);
            if (argv[i] === "--maxSliceItems") i++;
            continue;
        }
        const examplesArg = readValue(argv, i, "--examplesPerItem");
        if (examplesArg !== undefined) {
            examplesPerItem = normalizePositiveInt(examplesArg, "--examplesPerItem", 2);
            if (argv[i] === "--examplesPerItem") i++;
            continue;
        }
        if (argv[i] === "--analyze") {
            analyze = true;
            continue;
        }
        if (argv[i] === "--no-analyze") {
            analyze = false;
            continue;
        }
        if (argv[i] === "--incremental") {
            incremental = true;
            continue;
        }
        if (argv[i] === "--no-incremental") {
            incremental = false;
            continue;
        }
        const incrementalCacheArg = readValue(argv, i, "--incrementalCache");
        if (incrementalCacheArg !== undefined) {
            incrementalCachePath = path.resolve(incrementalCacheArg);
            if (argv[i] === "--incrementalCache") i++;
            continue;
        }
        const profileArg = readValue(argv, i, "--profile");
        if (profileArg !== undefined) {
            profile = parseProfile(profileArg);
            if (argv[i] === "--profile") i++;
            continue;
        }
        const entryModelArg = readValue(argv, i, "--entryModel");
        if (entryModelArg !== undefined) {
            if (entryModelArg !== "arkMain" && entryModelArg !== "explicit") {
                throw new Error(`invalid --entryModel: ${entryModelArg}`);
            }
            entryModel = entryModelArg;
            if (argv[i] === "--entryModel") i++;
            continue;
        }
        const reportModeArg = readValue(argv, i, "--reportMode");
        if (reportModeArg !== undefined) {
            reportMode = parseReportMode(reportModeArg);
            if (argv[i] === "--reportMode") i++;
            continue;
        }
        const maxEntriesArg = readValue(argv, i, "--maxEntries");
        if (maxEntriesArg !== undefined) {
            maxEntries = normalizePositiveInt(maxEntriesArg, "--maxEntries", 12);
            if (argv[i] === "--maxEntries") i++;
            continue;
        }
        const kArg = readValue(argv, i, "--k");
        if (kArg !== undefined) {
            const parsed = Number(kArg);
            if (parsed !== 0 && parsed !== 1) {
                throw new Error(`invalid --k: ${kArg}`);
            }
            k = parsed;
            if (argv[i] === "--k") i++;
            continue;
        }
        if (argv[i] === "--stopOnFirstFlow") {
            stopOnFirstFlow = true;
            continue;
        }
        const maxFlowsArg = readValue(argv, i, "--maxFlowsPerEntry");
        if (maxFlowsArg !== undefined) {
            maxFlowsPerEntry = normalizePositiveInt(maxFlowsArg, "--maxFlowsPerEntry", 1);
            if (argv[i] === "--maxFlowsPerEntry") i++;
            continue;
        }
        const worklistBudgetArg = readValue(argv, i, "--worklistBudgetMs") ?? readValue(argv, i, "--worklist-budget-ms");
        if (worklistBudgetArg !== undefined) {
            worklistBudgetMs = normalizeNonNegativeInt(worklistBudgetArg, "--worklistBudgetMs", 0);
            if (argv[i] === "--worklistBudgetMs" || argv[i] === "--worklist-budget-ms") i++;
            continue;
        }
        const worklistMaxDequeuesArg = readValue(argv, i, "--worklistMaxDequeues") ?? readValue(argv, i, "--worklist-max-dequeues");
        if (worklistMaxDequeuesArg !== undefined) {
            worklistMaxDequeues = normalizeNonNegativeInt(worklistMaxDequeuesArg, "--worklistMaxDequeues", 0);
            if (argv[i] === "--worklistMaxDequeues" || argv[i] === "--worklist-max-dequeues") i++;
            continue;
        }
        const worklistMaxVisitedArg = readValue(argv, i, "--worklistMaxVisited") ?? readValue(argv, i, "--worklist-max-visited");
        if (worklistMaxVisitedArg !== undefined) {
            worklistMaxVisited = normalizeNonNegativeInt(worklistMaxVisitedArg, "--worklistMaxVisited", 0);
            if (argv[i] === "--worklistMaxVisited" || argv[i] === "--worklist-max-visited") i++;
            continue;
        }
        const llmSessionCacheDirArg = readValue(argv, i, "--llmSessionCacheDir");
        if (llmSessionCacheDirArg !== undefined) {
            llmSessionCacheDir = path.resolve(llmSessionCacheDirArg);
            if (argv[i] === "--llmSessionCacheDir") i++;
            continue;
        }
        const llmSessionCacheModeArg = readValue(argv, i, "--llmSessionCacheMode");
        if (llmSessionCacheModeArg !== undefined) {
            llmSessionCacheMode = llmSessionCacheModeArg.trim();
            if (argv[i] === "--llmSessionCacheMode") i++;
            continue;
        }
        const llmTimeoutArg = readValue(argv, i, "--llmTimeoutMs");
        if (llmTimeoutArg !== undefined) {
            llmTimeoutMs = normalizePositiveInt(llmTimeoutArg, "--llmTimeoutMs", 1);
            if (argv[i] === "--llmTimeoutMs") i++;
            continue;
        }
        const llmConnectTimeoutArg = readValue(argv, i, "--llmConnectTimeoutMs");
        if (llmConnectTimeoutArg !== undefined) {
            llmConnectTimeoutMs = normalizePositiveInt(llmConnectTimeoutArg, "--llmConnectTimeoutMs", 1);
            if (argv[i] === "--llmConnectTimeoutMs") i++;
            continue;
        }
        const llmMaxAttemptsArg = readValue(argv, i, "--llmMaxAttempts");
        if (llmMaxAttemptsArg !== undefined) {
            llmMaxAttempts = normalizePositiveInt(llmMaxAttemptsArg, "--llmMaxAttempts", 1);
            if (argv[i] === "--llmMaxAttempts") i++;
            continue;
        }
        const llmMaxFailuresArg = readValue(argv, i, "--llmMaxFailures");
        if (llmMaxFailuresArg !== undefined) {
            llmMaxFailures = normalizePositiveInt(llmMaxFailuresArg, "--llmMaxFailures", 1);
            if (argv[i] === "--llmMaxFailures") i++;
            continue;
        }
        const llmRepairAttemptsArg = readValue(argv, i, "--llmRepairAttempts");
        if (llmRepairAttemptsArg !== undefined) {
            llmRepairAttempts = normalizeNonNegativeInt(llmRepairAttemptsArg, "--llmRepairAttempts", 0);
            if (argv[i] === "--llmRepairAttempts") i++;
            continue;
        }
        const maxLlmItemsArg = readValue(argv, i, "--maxLlmItems");
        if (maxLlmItemsArg !== undefined) {
            maxLlmItems = normalizePositiveInt(maxLlmItemsArg, "--maxLlmItems", 1);
            if (argv[i] === "--maxLlmItems") i++;
            continue;
        }
        if (argv[i].startsWith("--")) {
            throw new Error(`unknown option: ${argv[i]}`);
        }
    }

    if (!repo) {
        throw new Error("missing --repo");
    }
    if (sourceDirs.length === 0) {
        sourceDirs = discoverArkTsSourceDirs(repo);
    }
    if (sourceDirs.length === 0) {
        throw new Error("no sourceDir found; pass --sourceDir");
    }
    sourceDirs = normalizeSourceDirsForCli(sourceDirs);

    return {
        repo,
        sourceDirs,
        llmConfigPath,
        llmProfile,
        publishModel,
        modelRoots: [...new Set(modelRoots)],
        enabledModels: [...new Set(enabledModels.map(item => item.trim()).filter(Boolean))],
        disabledModels: [...new Set(disabledModels.map(item => item.trim()).filter(Boolean))],
        ruleInput,
        outputDir,
        model,
        arkMainMaxCandidates,
        maxRounds,
        concurrency,
        contextRadius,
        cfgNeighborRadius,
        maxSliceItems,
        examplesPerItem,
        analyze,
        incremental,
        incrementalCachePath,
        profile,
        entryModel,
        reportMode,
        maxEntries,
        k,
        stopOnFirstFlow,
        maxFlowsPerEntry,
        worklistBudgetMs,
        worklistMaxDequeues,
        worklistMaxVisited,
        llmSessionCacheDir,
        llmSessionCacheMode,
        llmTimeoutMs,
        llmConnectTimeoutMs,
        llmMaxAttempts,
        llmMaxFailures,
        llmRepairAttempts,
        maxLlmItems,
    };
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function createLoggedModelInvoker(
    invoker: NonNullable<ReturnType<typeof createSemanticFlowModelInvokerFromConfig>>,
    options: { maxFailures?: number } = {},
): NonNullable<ReturnType<typeof createSemanticFlowModelInvokerFromConfig>> {
    let requestSeq = 0;
    let consecutiveFailures = 0;
    const maxFailures = Math.max(1, options.maxFailures ?? 3);
    return async input => {
        if (consecutiveFailures >= maxFailures) {
            console.log(`semanticflow_llm=circuit_open failures=${consecutiveFailures} max_failures=${maxFailures}`);
            throw new Error(`semanticflow LLM circuit open after ${consecutiveFailures} consecutive failures`);
        }
        const requestId = ++requestSeq;
        const startedAt = Date.now();
        console.log(`semanticflow_llm=request_start id=${requestId} model=${input.model || "-"}`);
        try {
            const raw = await invoker(input);
            const elapsedMs = Date.now() - startedAt;
            consecutiveFailures = 0;
            console.log(`semanticflow_llm=request_done id=${requestId} elapsed_ms=${elapsedMs} chars=${String(raw || "").length}`);
            return raw;
        } catch (error) {
            const elapsedMs = Date.now() - startedAt;
            const detail = String((error as any)?.message || error).replace(/\s+/g, " ").trim();
            consecutiveFailures++;
            console.log(`semanticflow_llm=request_fail id=${requestId} elapsed_ms=${elapsedMs} error=${detail}`);
            throw error;
        }
    };
}

function safeSourceDirName(sourceDir: string): string {
    const normalized = sourceDir.replace(/[\\/]+/g, "__").replace(/[^A-Za-z0-9_.-]+/g, "_");
    return normalized === "." ? "root" : normalized || "root";
}

function loadRuleCandidates(
    options: SemanticFlowCliOptions,
    ruleInputPath: string | undefined,
): {
    items: NormalizedCallsiteItem[];
    skippedKnown: number;
} {
    if (!ruleInputPath || !fs.existsSync(ruleInputPath)) {
        return { items: [], skippedKnown: 0 };
    }
    const parsed = JSON.parse(fs.readFileSync(ruleInputPath, "utf-8"));
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
    if (!Array.isArray(items)) {
        return { items: [], skippedKnown: 0 };
    }
    const filterOptions = {
        modelRoots: options.modelRoots,
        enabledModels: options.enabledModels,
        disabledModels: options.disabledModels,
    };
    const filtered = filterKnownSemanticFlowRuleCandidates(items as NormalizedCallsiteItem[], filterOptions);
    const rankedForContext = rankSemanticFlowRuleCandidatesForModeling(filtered.candidates);
    const enriched = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: options.repo,
        sourceDirs: options.sourceDirs,
        items: rankedForContext,
        maxItems: options.maxSliceItems,
        maxExamplesPerItem: options.examplesPerItem,
        contextRadius: options.contextRadius,
        cfgNeighborRadius: options.cfgNeighborRadius,
    });
    const contextFiltered = filterKnownSemanticFlowRuleCandidates(enriched, filterOptions);
    return {
        items: contextFiltered.candidates,
        skippedKnown: filtered.skippedKnown.length + contextFiltered.skippedKnown.length,
    };
}

function collectAggregateSummary(bundles: SemanticFlowSessionBundle[]) {
    const items = bundles.flatMap(bundle => bundle.result.session.run.items);
    const resolutions: Record<string, number> = {};
    const planes: Record<string, number> = {};
    for (const item of items) {
        resolutions[item.resolution] = (resolutions[item.resolution] || 0) + 1;
        const plane = item.plane || item.asset?.plane;
        if (plane) {
            planes[plane] = (planes[plane] || 0) + 1;
        }
    }
    const augment = mergeSemanticFlowAnalysisAugments(bundles.map(bundle => bundle.result.session.augment));
    const trustedAnalysisAssets = augment.assets.filter(asset =>
        asset.status === "official" || asset.status === "reviewed" || asset.status === "replayed",
    );
    const assetsByPlane = augment.assets.reduce((acc, asset) => {
        acc[asset.plane] = (acc[asset.plane] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    return {
        items,
        augment,
        engineAugment: buildSemanticFlowEngineAugment(augment),
        summary: {
            itemCount: items.length,
            resolutions,
            planes,
            ruleCandidateCount: bundles.reduce((sum, bundle) => sum + bundle.result.ruleCandidateCount, 0),
            ruleKnownCoveredCount: bundles.reduce((sum, bundle) => sum + bundle.skippedKnownRuleCandidates, 0),
            arkMainCandidateCount: bundles.reduce((sum, bundle) => sum + bundle.result.arkMainCandidates.length, 0),
            arkMainKernelCoveredCount: bundles.reduce((sum, bundle) => sum + bundle.result.skippedArkMainCandidates.length, 0),
            arkMainIneligibleCount: bundles.reduce((sum, bundle) => sum + bundle.result.ineligibleArkMainCandidates.length, 0),
            assetCount: augment.assets.length,
            trustedAnalysisAssetCount: trustedAnalysisAssets.length,
            assetCountByPlane: assetsByPlane,
            moduleCount: augment.assets.filter(asset => asset.plane === "module").length,
            trustedAnalysisModuleCount: trustedAnalysisAssets.filter(asset => asset.plane === "module").length,
            sourceRuleCount: (augment.ruleSet.sources || []).length,
            sinkRuleCount: (augment.ruleSet.sinks || []).length,
            sanitizerRuleCount: (augment.ruleSet.sanitizers || []).length,
            transferRuleCount: (augment.ruleSet.transfers || []).length,
        },
    };
}

export function semanticFlowCandidateBelongsToSourceDir(sourceDir: string, sourceAbs: string, item: NormalizedCallsiteItem): boolean {
    if (sourceDir === ".") {
        return true;
    }
    const sourceFile = String(item.sourceFile || "").replace(/\\/g, "/").replace(/^\/+/g, "");
    if (!sourceFile || sourceFile.includes("%unk") || sourceFile.includes("arkui-builtin")) {
        return true;
    }
    const normalizedSourceDir = sourceDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (normalizedSourceDir && (sourceFile === normalizedSourceDir || sourceFile.startsWith(`${normalizedSourceDir}/`))) {
        return true;
    }
    if (normalizedSourceDir && (
        sourceFile.includes(`/${normalizedSourceDir}/`)
        || sourceFile.endsWith(`/${normalizedSourceDir}`)
    )) {
        return true;
    }
    const etsRelativePrefix = semanticFlowEtsRelativeSourceDirPrefix(normalizedSourceDir);
    if (etsRelativePrefix && (sourceFile === etsRelativePrefix || sourceFile.startsWith(`${etsRelativePrefix}/`))) {
        return true;
    }
    const variants = [
        sourceFile,
        sourceFile.replace(/^ets\//, ""),
        sourceFile.replace(/^src\/main\/ets\//, ""),
        normalizedSourceDir && sourceFile.startsWith(`${normalizedSourceDir}/`)
            ? sourceFile.slice(normalizedSourceDir.length + 1)
            : sourceFile,
    ];
    return variants.some(rel => fs.existsSync(path.resolve(sourceAbs, rel)));
}

function semanticFlowEtsRelativeSourceDirPrefix(normalizedSourceDir: string): string | undefined {
    const marker = "/src/main/ets/";
    const markerIndex = normalizedSourceDir.indexOf(marker);
    if (markerIndex >= 0) {
        const suffix = normalizedSourceDir.slice(markerIndex + marker.length).replace(/^\/+|\/+$/g, "");
        return suffix || undefined;
    }
    if (normalizedSourceDir.startsWith("src/main/ets/")) {
        const suffix = normalizedSourceDir.slice("src/main/ets/".length).replace(/^\/+|\/+$/g, "");
        return suffix || undefined;
    }
    return undefined;
}

function capRuleCandidatesForSourceDir(
    sourceDir: string,
    sourceAbs: string,
    candidates: NormalizedCallsiteItem[],
    maxItems: number | undefined,
): NormalizedCallsiteItem[] {
    const scoped = scopeRuleCandidatesForSourceDir(sourceDir, sourceAbs, candidates);
    return selectSemanticFlowRuleCandidatesForModeling(scoped, maxItems);
}

function scopeRuleCandidatesForSourceDir(
    sourceDir: string,
    sourceAbs: string,
    candidates: NormalizedCallsiteItem[],
): NormalizedCallsiteItem[] {
    return candidates.filter(item => semanticFlowCandidateBelongsToSourceDir(sourceDir, sourceAbs, item));
}

export function rankSemanticFlowRuleCandidatesForModeling(candidates: NormalizedCallsiteItem[]): NormalizedCallsiteItem[] {
    return [...candidates].sort((a, b) => scoreSemanticFlowRuleCandidateForModeling(b) - scoreSemanticFlowRuleCandidateForModeling(a)
        || (Number(b.count) || 0) - (Number(a.count) || 0)
        || String(a.callee_signature || "").localeCompare(String(b.callee_signature || "")));
}

export function selectSemanticFlowRuleCandidatesForModeling(
    candidates: NormalizedCallsiteItem[],
    maxItems?: number,
): NormalizedCallsiteItem[] {
    const ranked = rankSemanticFlowRuleCandidatesForModeling(candidates);
    const limit = Math.max(1, maxItems ?? ranked.length);
    const byGroup = new Map<string, NormalizedCallsiteItem[]>();
    for (const item of ranked) {
        const key = semanticFlowModelingPairKey(item);
        byGroup.set(key, [...(byGroup.get(key) || []), item]);
    }

    const selected: NormalizedCallsiteItem[] = [];
    const selectedKeys = new Set<string>();
    const groupCounts = new Map<string, number>();
    const diversityCounts = new Map<string, number>();
    const returnedValueFocusLimit = Math.max(1, Math.ceil(limit / 2));
    const maxPerDiversityGroup = limit <= 2 ? 2 : Math.min(2, limit);
    let forcedFirstPair = false;

    const add = (item: NormalizedCallsiteItem, diversePass: boolean): boolean => {
        if (selected.length >= limit) {
            return false;
        }
        const itemKey = semanticFlowModelingItemKey(item);
        if (selectedKeys.has(itemKey)) {
            return false;
        }
        const groupKey = semanticFlowModelingPairKey(item);
        const groupCount = groupCounts.get(groupKey) || 0;
        if (groupCount >= 2) {
            return false;
        }
        if (diversePass && !canAddUnderSemanticFlowDiversityBudget(
            item,
            diversityCounts,
            selected,
            maxPerDiversityGroup,
            returnedValueFocusLimit,
        )) {
            return false;
        }
        selected.push(item);
        selectedKeys.add(itemKey);
        groupCounts.set(groupKey, groupCount + 1);
        const diversityKey = semanticFlowModelingDiversityKey(item);
        diversityCounts.set(diversityKey, (diversityCounts.get(diversityKey) || 0) + 1);
        return true;
    };

    for (const diversePass of [true, false]) {
        for (let index = 0; index < ranked.length; index++) {
            const item = ranked[index];
            if (selected.length >= limit) {
                break;
            }
            if (!add(item, diversePass)) {
                continue;
            }
            const sibling = pairedSemanticFlowModelingCandidate(item, byGroup, selectedKeys);
            if (sibling && shouldAddPairedSemanticFlowCandidate(sibling, ranked, index + 1, selectedKeys, forcedFirstPair)) {
                if (add(sibling, diversePass)) {
                    forcedFirstPair = true;
                }
            }
        }
    }
    return selected;
}

function canAddUnderSemanticFlowDiversityBudget(
    item: NormalizedCallsiteItem,
    diversityCounts: Map<string, number>,
    selected: NormalizedCallsiteItem[],
    maxPerDiversityGroup: number,
    returnedValueFocusLimit: number,
): boolean {
    const diversityKey = semanticFlowModelingDiversityKey(item);
    if ((diversityCounts.get(diversityKey) || 0) >= maxPerDiversityGroup) {
        return false;
    }
    if (isReturnedValueSemanticFocus(String((item as any).semanticFocus || "").trim())) {
        const selectedReturned = selected.filter(existing => isReturnedValueSemanticFocus(
            String((existing as any).semanticFocus || "").trim(),
        )).length;
        if (selectedReturned >= returnedValueFocusLimit) {
            return false;
        }
    }
    return true;
}

function shouldAddPairedSemanticFlowCandidate(
    sibling: NormalizedCallsiteItem,
    ranked: NormalizedCallsiteItem[],
    nextIndex: number,
    selectedKeys: Set<string>,
    forcedFirstPair: boolean,
): boolean {
    if (!forcedFirstPair) {
        return true;
    }
    const siblingScore = scoreSemanticFlowRuleCandidateForModeling(sibling);
    for (let i = nextIndex; i < ranked.length; i++) {
        const candidate = ranked[i];
        if (selectedKeys.has(semanticFlowModelingItemKey(candidate))) {
            continue;
        }
        if (scoreSemanticFlowRuleCandidateForModeling(candidate) > siblingScore) {
            return false;
        }
        return true;
    }
    return true;
}

export function scoreSemanticFlowRuleCandidateForModeling(item: NormalizedCallsiteItem): number {
    const method = String(item.method || "").toLowerCase();
    const sig = String(item.callee_signature || "").toLowerCase();
    const origin = String((item as any).candidateOrigin || "").trim();
    const semanticFocus = String((item as any).semanticFocus || "").trim();
    const methodSnippet = String((item as any).methodSnippet || "").toLowerCase();
    const hasExternalEffectEvidence = /\b(axios|http|request|fetch|post|get|put|delete|websocket|socket|hilog|console|logger|fileio|writesync|relationalstore|rdb|rdbstore|executesql|preferences|appstorage|persistent|localstorage)\b/.test(methodSnippet);
    const hasDelegatedWrapperEvidence = /\b(datasource|networkdatasource|repository|repo|store|client|service|api|dao|orm|preferences|appstorage|persistent|localstorage)\b/.test(methodSnippet);
    let score = Number(item.count) || 0;
    if (origin !== "recall_callback_surface") score += 30;
    if (origin === "recall_api_surface") score += 45;
    if (origin === "recall_returned_value_surface") score += 55;
    if (isReturnedValueSemanticFocus(semanticFocus)) score += 32;
    if (item.argCount > 0) score += 20;
    if (isProjectSerializationWrapperCandidate(method, sig, item.argCount)) score += 28;
    if (/(process|parse|decode|encode|transform|convert|collect|save|insert|update|request|response)/.test(method)) score += 12;
    if (/viewmodel|service|manager|repository|store|cache|client/.test(sig)) score += 8;
    if (/(api|apis|service|services|network|net|request|requests|client|clients|repository|repositories|configure|axios|http|logger|cache)/.test(sig)) score += 16;
    if (/(token|credential|auth|profile|login|register|password|phone|email|cookie|session)/.test(sig)) score += 10;
    if ((origin === "recall_api_surface" || origin === "recall_returned_value_surface") && hasExternalEffectEvidence) score += 24;
    if (origin === "recall_returned_value_surface" && hasDelegatedWrapperEvidence) score += 18;
    if ((origin === "recall_api_surface" || origin === "recall_returned_value_surface") && !hasExternalEffectEvidence && !hasDelegatedWrapperEvidence) score -= 35;
    if ((origin === "recall_api_surface" || origin === "recall_returned_value_surface") && /(\/context\.ets|\/stage\.ets|\/device\.ets|context|window|avoidarea|windowsize)/.test(sig)) score -= 35;
    if ((origin === "recall_api_surface" || origin === "recall_returned_value_surface") && /(credential|profile|token|auth)/.test(method) && hasExternalEffectEvidence) score += 24;
    if (origin === "recall_returned_value_surface" && /(credential|profile|token|auth|password|cookie|session|account|phone|email)/.test(method) && hasDelegatedWrapperEvidence) score += 26;
    if (isLikelyContextOrUiSetupCandidate(method, sig)) score -= 70;
    if (isNoPayloadMaintenanceCandidate(method, sig, item.argCount)) score -= 55;
    if (isInternalNavigationControlCandidate(method, sig)) score -= 45;
    if (/pages\/|components\//.test(sig)) score -= 8;
    if (/^(check|validate|back|scroll|build|render|is|has|getui)/.test(method)) score -= 18;
    if (/^get|^is|^has/.test(method) && item.argCount === 0) score -= 10;
    return score;
}

function pairedSemanticFlowModelingCandidate(
    item: NormalizedCallsiteItem,
    byGroup: Map<string, NormalizedCallsiteItem[]>,
    selectedKeys: Set<string>,
): NormalizedCallsiteItem | undefined {
    const siblings = byGroup.get(semanticFlowModelingPairKey(item)) || [];
    const hasFocus = isReturnedValueSemanticFocus(String((item as any).semanticFocus || "").trim());
    const wanted = siblings.find(candidate => {
        if (selectedKeys.has(semanticFlowModelingItemKey(candidate))) {
            return false;
        }
        const candidateFocus = isReturnedValueSemanticFocus(String((candidate as any).semanticFocus || "").trim());
        return hasFocus ? !candidateFocus : candidateFocus;
    });
    return wanted;
}

function isReturnedValueSemanticFocus(semanticFocus: string): boolean {
    return semanticFocus === "returned_value_surface"
        || semanticFocus === "external_response_source";
}

function semanticFlowModelingPairKey(item: NormalizedCallsiteItem): string {
    return [
        item.callee_signature || "",
        item.method || "",
        item.invokeKind || "",
        String(item.argCount ?? ""),
        item.sourceFile || "",
    ].join("|");
}

function semanticFlowModelingItemKey(item: NormalizedCallsiteItem): string {
    return `${semanticFlowModelingPairKey(item)}|${String((item as any).semanticFocus || "")}`;
}

function semanticFlowModelingDiversityKey(item: NormalizedCallsiteItem): string {
    const sourceFile = String(item.sourceFile || "").replace(/\\/g, "/").toLowerCase();
    const owner = extractSemanticFlowOwnerFromSignature(String(item.callee_signature || ""))
        || sourceFile;
    return `${sourceFile}|${owner.toLowerCase()}`;
}

function extractSemanticFlowOwnerFromSignature(signature: string): string | undefined {
    const afterColon = signature.split(":").slice(1).join(":").trim();
    const ownerMatch = afterColon.match(/\b([A-Za-z_$][\w$]*)\s*\.\s*(?:\[static\]\s*)?[A-Za-z_$][\w$]*\s*\(/);
    return ownerMatch?.[1];
}

function isLikelyContextOrUiSetupCandidate(methodLower: string, signatureLower: string): boolean {
    if (/(configure\/(context|stage|device)|contextmanager|ctxmanager|stagemanager|appdevice)/.test(signatureLower)) {
        if (/^(register|update|set|init)/.test(methodLower)) return true;
    }
    return /(abilitystagecontext|uiabilitycontext|stagewindowclass|avoidarea|windowsize|systembar|orientation)/.test(methodLower);
}

function isNoPayloadMaintenanceCandidate(
    methodLower: string,
    signatureLower: string,
    argCount: number | undefined,
): boolean {
    if ((argCount ?? 0) > 0) {
        return false;
    }
    if (!/^(delete|clear|close|drop|destroy|release|init|connect|disconnect|start|stop)/.test(methodLower)) {
        return false;
    }
    return /(database|db|cache|cacher|socket|configure|service|manager)/.test(signatureLower);
}

function isInternalNavigationControlCandidate(methodLower: string, signatureLower: string): boolean {
    if (!/(router|route|navigation|nav)/.test(signatureLower)) {
        return false;
    }
    return /^(push|pop|back|replace|forward|go|navigate|route|scroll|build)/.test(methodLower);
}

function isProjectSerializationWrapperCandidate(methodLower: string, signatureLower: string, argCount: number | undefined): boolean {
    if ((argCount ?? 0) !== 0) return false;
    if (methodLower === "tostring" || methodLower === "valueof") return false;
    if (!/^to[a-z0-9_]*(object|json|map|record|bucket|params|param|request|payload|dto|data|value|values)$/.test(methodLower)) {
        return false;
    }
    return /(model|entity|dto|data|record|database|request|response|store|bucket)/.test(signatureLower);
}

function countSourceRunStatuses(records: SemanticFlowSourceRunRecord[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const record of records) {
        out[record.status] = (out[record.status] || 0) + 1;
    }
    return out;
}

function writeSemanticFlowArtifacts(
    rootDir: string,
    bundles: SemanticFlowSessionBundle[],
): {
    aggregateSessionPath: string;
    aggregateAssetsPath: string;
    generatedModelRoot: string;
    generatedModelProjectId: string;
    aggregateSummaryPath: string;
} {
    const aggregate = collectAggregateSummary(bundles);
    fs.mkdirSync(rootDir, { recursive: true });
    const modelingDir = path.join(rootDir, "modeling");
    fs.mkdirSync(modelingDir, { recursive: true });

    for (const bundle of bundles) {
        const base = path.join(modelingDir, safeSourceDirName(bundle.sourceDir));
        fs.mkdirSync(base, { recursive: true });
        fs.writeFileSync(path.join(base, "session.json"), JSON.stringify(serializeSemanticFlowSession(bundle.result.session), null, 2), "utf-8");
        fs.writeFileSync(path.join(base, "assets.json"), JSON.stringify(serializeSemanticFlowAssets(bundle.result.session.augment), null, 2), "utf-8");
        fs.writeFileSync(path.join(base, "summary.json"), JSON.stringify({
            itemCount: bundle.result.session.run.items.length,
            resolutions: bundle.result.session.run.items.reduce((acc, item) => {
                const key = item.resolution;
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
            planes: bundle.result.session.run.items.reduce((acc, item) => {
                const key = item.plane || item.asset?.plane;
                if (key) {
                    acc[key] = (acc[key] || 0) + 1;
                }
                return acc;
            }, {} as Record<string, number>),
            assetCount: bundle.result.session.augment.assets.length,
            ruleCandidateCount: bundle.result.ruleCandidateCount,
            ruleKnownCoveredCount: bundle.skippedKnownRuleCandidates,
            arkMainCandidateCount: bundle.result.arkMainCandidates.length,
            arkMainIneligibleCount: bundle.result.ineligibleArkMainCandidates.length,
            moduleCount: bundle.result.session.augment.assets.filter(asset => asset.plane === "module").length,
            sourceRuleCount: (bundle.result.session.augment.ruleSet.sources || []).length,
            sinkRuleCount: (bundle.result.session.augment.ruleSet.sinks || []).length,
            sanitizerRuleCount: (bundle.result.session.augment.ruleSet.sanitizers || []).length,
            transferRuleCount: (bundle.result.session.augment.ruleSet.transfers || []).length,
        }, null, 2), "utf-8");
    }

    const aggregateSessionPath = path.join(rootDir, "session.json");
    const aggregateAssetsPath = path.join(rootDir, "assets.json");
    const aggregateSummaryPath = path.join(rootDir, "summary.json");

    fs.writeFileSync(aggregateSessionPath, JSON.stringify(serializeSemanticFlowSession({
        run: { items: aggregate.items },
        augment: aggregate.augment,
        engineAugment: aggregate.engineAugment,
    }), null, 2), "utf-8");
    fs.writeFileSync(aggregateAssetsPath, JSON.stringify(serializeSemanticFlowAssets(aggregate.augment), null, 2), "utf-8");
    fs.writeFileSync(aggregateSummaryPath, JSON.stringify(aggregate.summary, null, 2), "utf-8");
    const generatedModelRoot = path.join(rootDir, "generated_model_assets");
    const generatedModelProjectId = "semanticflow";
    publishSemanticFlowProjectAssets({
        projectId: generatedModelProjectId,
        modelRoot: generatedModelRoot,
        assets: aggregate.augment.assets,
    });

    return {
        aggregateSessionPath,
        aggregateAssetsPath,
        generatedModelRoot,
        generatedModelProjectId,
        aggregateSummaryPath,
    };
}

function buildAnalyzeOptions(
    options: SemanticFlowCliOptions,
    outputDir: string,
    overrides: Partial<CliOptions>,
): CliOptions {
    return {
        repo: options.repo,
        sourceDirs: options.sourceDirs,
        llmConfigPath: options.llmConfigPath,
        llmProfile: options.llmProfile,
        publishModel: options.publishModel,
        profile: overrides.profile || options.profile,
        entryModel: overrides.entryModel || options.entryModel || "arkMain",
        reportMode: overrides.reportMode || options.reportMode,
        k: overrides.k ?? options.k,
        maxEntries: overrides.maxEntries ?? options.maxEntries,
        outputDir,
        concurrency: overrides.concurrency ?? options.concurrency,
        incremental: overrides.incremental ?? options.incremental ?? true,
        incrementalCachePath: overrides.incrementalCachePath ?? options.incrementalCachePath,
        showLoadWarnings: false,
        stopOnFirstFlow: overrides.stopOnFirstFlow ?? options.stopOnFirstFlow,
        maxFlowsPerEntry: overrides.maxFlowsPerEntry ?? options.maxFlowsPerEntry,
        worklistBudgetMs: overrides.worklistBudgetMs ?? options.worklistBudgetMs,
        worklistMaxDequeues: overrides.worklistMaxDequeues ?? options.worklistMaxDequeues,
        worklistMaxVisited: overrides.worklistMaxVisited ?? options.worklistMaxVisited,
        enableSecondarySinkSweep: overrides.enableSecondarySinkSweep ?? ((overrides.profile || options.profile) === "fast"),
        llmModel: overrides.llmModel,
        arkMainMaxCandidates: overrides.arkMainMaxCandidates,
        listModules: false,
        listModels: false,
        explainModuleId: undefined,
        traceModuleId: undefined,
        listPlugins: false,
        explainPluginName: undefined,
        tracePluginName: undefined,
        modelRoots: overrides.modelRoots || options.modelRoots || [],
        enabledModels: overrides.enabledModels || options.enabledModels || [],
        disabledModels: overrides.disabledModels || options.disabledModels || [],
        disabledModuleIds: overrides.disabledModuleIds || [],
        pluginPaths: overrides.pluginPaths || [],
        disabledPluginNames: overrides.disabledPluginNames || [],
        pluginIsolate: overrides.pluginIsolate || [],
        pluginDryRun: overrides.pluginDryRun || false,
        pluginAudit: overrides.pluginAudit || false,
        ruleOptions: {
            autoDiscoverLayers: true,
            ...(overrides.ruleOptions || {}),
        },
    };
}

async function runBootstrapAnalyze(options: SemanticFlowCliOptions): Promise<BootstrapAnalyzeResult> {
    const phase1OutputDir = path.join(options.outputDir, "phase1");
    console.log(`semanticflow_phase=bootstrap_analyze start output_dir=${phase1OutputDir}`);
    const run = await withAnalyzeHeartbeat("bootstrap_analyze", () => runAnalyze(buildAnalyzeOptions(options, phase1OutputDir, {
        profile: options.profile,
        entryModel: options.entryModel || "arkMain",
        reportMode: options.reportMode,
        maxEntries: options.maxEntries,
        llmModel: options.model,
        arkMainMaxCandidates: options.arkMainMaxCandidates,
        modelRoots: options.modelRoots || [],
        enabledModels: options.enabledModels || [],
        disabledModels: options.disabledModels || [],
        ruleOptions: {
            autoDiscoverLayers: true,
            ruleCatalogPath: options.modelRoots?.[0],
            ruleCatalogPaths: options.modelRoots,
        },
    })));
    const feedbackDir = path.join(phase1OutputDir, "feedback", "rule_feedback");
    const apiModelingCandidatePath = path.join(feedbackDir, "api_modeling_candidates.json");
    const fallbackRuleInputPath = path.join(feedbackDir, "no_candidate_callsites.json");
    const selected = selectBootstrapRuleInput(apiModelingCandidatePath, fallbackRuleInputPath);
    console.log(
        `semanticflow_phase=bootstrap_analyze done rule_input=${selected.path} `
        + `selection=${selected.selection} api_modeling_candidates=${selected.apiModelingCandidateCount ?? ""} `
        + `fallback_candidates=${selected.fallbackCandidateCount ?? ""}`,
    );
    return {
        ruleInputPath: selected.path,
        run,
    };
}

function selectBootstrapRuleInput(
    apiModelingCandidatePath: string,
    fallbackRuleInputPath: string,
): {
    path: string;
    selection: "api_modeling_candidates" | "fallback_callsites" | "missing";
    apiModelingCandidateCount: number | null;
    fallbackCandidateCount: number | null;
} {
    const apiModelingCandidateCount = readCandidatePayloadCount(apiModelingCandidatePath);
    const fallbackCandidateCount = readCandidatePayloadCount(fallbackRuleInputPath);
    if (apiModelingCandidateCount !== null && apiModelingCandidateCount > 0) {
        return {
            path: apiModelingCandidatePath,
            selection: "api_modeling_candidates",
            apiModelingCandidateCount,
            fallbackCandidateCount,
        };
    }
    if (fallbackCandidateCount !== null && fallbackCandidateCount > 0) {
        return {
            path: fallbackRuleInputPath,
            selection: "fallback_callsites",
            apiModelingCandidateCount,
            fallbackCandidateCount,
        };
    }
    if (apiModelingCandidateCount !== null) {
        return {
            path: apiModelingCandidatePath,
            selection: "api_modeling_candidates",
            apiModelingCandidateCount,
            fallbackCandidateCount,
        };
    }
    if (fallbackCandidateCount !== null) {
        return {
            path: fallbackRuleInputPath,
            selection: "fallback_callsites",
            apiModelingCandidateCount,
            fallbackCandidateCount,
        };
    }
    return {
        path: fallbackRuleInputPath,
        selection: "missing",
        apiModelingCandidateCount,
        fallbackCandidateCount,
    };
}

function readCandidatePayloadCount(filePath: string): number | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (Array.isArray(parsed)) {
            return parsed.length;
        }
        if (Array.isArray(parsed?.items)) {
            return parsed.items.length;
        }
        if (typeof parsed?.total === "number" && Number.isFinite(parsed.total)) {
            return parsed.total;
        }
    } catch {
        return null;
    }
    return null;
}

function hasModeledSemanticFlowArtifacts(summary: ReturnType<typeof collectAggregateSummary>["summary"]): boolean {
    return summary.trustedAnalysisAssetCount > 0
        || summary.trustedAnalysisModuleCount > 0
        || summary.sourceRuleCount > 0
        || summary.sinkRuleCount > 0
        || summary.sanitizerRuleCount > 0
        || summary.transferRuleCount > 0;
}

function canReuseBootstrapAnalyzeForFinal(
    options: SemanticFlowCliOptions,
    aggregate: ReturnType<typeof collectAggregateSummary>,
    bootstrap?: BootstrapAnalyzeResult,
): bootstrap is BootstrapAnalyzeResult & { run: Awaited<ReturnType<typeof runAnalyze>> } {
    return !!bootstrap?.run
        && !options.publishModel
        && !hasModeledSemanticFlowArtifacts(aggregate.summary);
}

function materializeReusedFinalAnalyzeArtifacts(
    outputDir: string,
    run: Awaited<ReturnType<typeof runAnalyze>>,
): Awaited<ReturnType<typeof runAnalyze>> {
    const copyDir = (fromDir: string, toDir: string): void => {
        if (!fs.existsSync(fromDir) || !fs.statSync(fromDir).isDirectory()) {
            return;
        }
        fs.mkdirSync(path.dirname(toDir), { recursive: true });
        fs.cpSync(fromDir, toDir, { recursive: true, force: true });
    };
    const finalSummaryDir = path.join(outputDir, "final", "summary");
    const finalDiagnosticsDir = path.join(outputDir, "final", "diagnostics");
    copyDir(path.dirname(run.jsonPath), finalSummaryDir);
    copyDir(path.dirname(run.diagnosticsJsonPath), finalDiagnosticsDir);
    return {
        ...run,
        jsonPath: path.join(finalSummaryDir, "summary.json"),
        mdPath: path.join(finalSummaryDir, "summary.md"),
        diagnosticsJsonPath: path.join(finalDiagnosticsDir, "diagnostics.json"),
        diagnosticsTextPath: path.join(finalDiagnosticsDir, "diagnostics.txt"),
    };
}

async function runFinalAnalyze(
    options: SemanticFlowCliOptions,
    aggregatePaths: {
        generatedModelRoot: string;
        generatedModelProjectId: string;
    },
): Promise<Awaited<ReturnType<typeof runAnalyze>>> {
    const arkMainCandidateLimit = resolveArkMainCandidateLimit(options);
    const finalOutputDir = path.join(options.outputDir, "final");
    console.log(`semanticflow_phase=final_analyze start output_dir=${finalOutputDir}`);
    return withAnalyzeHeartbeat("final_analyze", () => runAnalyze(buildAnalyzeOptions(options, finalOutputDir, {
        profile: options.profile,
        reportMode: options.reportMode,
        llmModel: options.model,
        arkMainMaxCandidates: arkMainCandidateLimit,
        modelRoots: [
            aggregatePaths.generatedModelRoot,
            ...(options.modelRoots || []),
        ],
        ...(options.publishModel
            ? {
                enabledModels: [...new Set([...(options.enabledModels || []), options.publishModel])],
                disabledModels: options.disabledModels || [],
                ruleOptions: {
                    autoDiscoverLayers: true,
                    ruleCatalogPath: options.modelRoots?.[0],
                    ruleCatalogPaths: options.modelRoots,
                },
            }
            : {
                enabledModels: [...new Set([...(options.enabledModels || []), aggregatePaths.generatedModelProjectId])],
                disabledModels: options.disabledModels || [],
                ruleOptions: {
                    autoDiscoverLayers: true,
                    ruleCatalogPath: aggregatePaths.generatedModelRoot,
                    ruleCatalogPaths: [
                        aggregatePaths.generatedModelRoot,
                        ...(options.modelRoots || []),
                    ],
                },
            }),
    })));
}

function writeSemanticFlowRunManifest(
    outputDir: string,
    options: SemanticFlowCliOptions,
    info: {
        llmConfigPath?: string;
        llmProfile?: string;
        llmModel?: string;
        llmSessionCacheDir?: string;
        llmSessionCacheMode?: string;
        bootstrapRuleInputPath: string;
        aggregateSessionPath: string;
        aggregateAssetsPath: string;
        generatedModelRoot: string;
        generatedModelProjectId: string;
        aggregateSummaryPath: string;
        sourceRunsPath: string;
        finalSummaryJsonPath?: string;
        finalSummaryMdPath?: string;
    },
): void {
    const relative = (targetPath?: string) => targetPath ? path.relative(outputDir, targetPath).replace(/\\/g, "/") : undefined;
    fs.writeFileSync(path.join(outputDir, "run.json"), JSON.stringify({
        runKind: "semanticflow",
        generatedAt: new Date().toISOString(),
        repo: options.repo,
        sourceDirs: options.sourceDirs,
        profile: {
            llmConfigPath: info.llmConfigPath,
            llmProfile: info.llmProfile,
            llmModel: info.llmModel,
            llmSessionCacheDir: info.llmSessionCacheDir,
            llmSessionCacheMode: info.llmSessionCacheMode,
            llmTimeoutMs: options.llmTimeoutMs,
            llmConnectTimeoutMs: options.llmConnectTimeoutMs,
            llmMaxAttempts: options.llmMaxAttempts,
            llmMaxFailures: options.llmMaxFailures,
            llmRepairAttempts: options.llmRepairAttempts,
            maxLlmItems: options.maxLlmItems,
        },
        paths: {
            phase1RuleInput: relative(info.bootstrapRuleInputPath),
            session: relative(info.aggregateSessionPath),
            assets: relative(info.aggregateAssetsPath),
            generatedModelRoot: relative(info.generatedModelRoot),
            generatedModelProjectId: info.generatedModelProjectId,
            summary: relative(info.aggregateSummaryPath),
            sourceRuns: relative(info.sourceRunsPath),
            finalSummaryJson: relative(info.finalSummaryJsonPath),
            finalSummaryMd: relative(info.finalSummaryMdPath),
        },
    }, null, 2), "utf-8");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    await runSemanticFlowCli(options);
}

export async function runSemanticFlowCli(options: SemanticFlowCliOptions): Promise<void> {
    const profile = resolveLlmProfile({
        configPath: options.llmConfigPath,
        profile: options.llmProfile,
        model: options.model,
    });
    if (!profile) {
        throw new Error("LLM profile unavailable; configure it with node out/cli/llm.js");
    }

    const invoker = createSemanticFlowModelInvokerFromConfig({
        enabled: true,
        configPath: options.llmConfigPath,
        profile: options.llmProfile,
        model: options.model,
        timeoutMs: options.llmTimeoutMs,
        connectTimeoutMs: options.llmConnectTimeoutMs,
        maxAttempts: options.llmMaxAttempts ?? 1,
    });
    if (!invoker) {
        throw new Error("semanticflow model invoker unavailable; check llm profile configuration");
    }

    const loggedInvoker = createLoggedModelInvoker(invoker, {
        maxFailures: options.llmMaxFailures,
    });

    const sessionCache = options.llmSessionCacheDir
        ? new SemanticFlowSessionCache({
            rootDir: options.llmSessionCacheDir,
            mode: normalizeSemanticFlowSessionCacheMode(
                options.llmSessionCacheMode ?? "rw",
                "--llmSessionCacheMode",
            ),
        })
        : undefined;

    const arkMainCandidateLimit = resolveArkMainCandidateLimit(options);
    const bootstrapAnalyze: BootstrapAnalyzeResult = options.ruleInput && fs.existsSync(options.ruleInput)
        ? { ruleInputPath: options.ruleInput }
        : await runBootstrapAnalyze(options);
    const bootstrapRuleInputPath = bootstrapAnalyze.ruleInputPath;
    const ruleCandidates = loadRuleCandidates(options, bootstrapRuleInputPath);
    console.log(`semanticflow_phase=load_candidates done rule_candidates=${ruleCandidates.items.length} rule_known_covered=${ruleCandidates.skippedKnown} arkmain_limit=${arkMainCandidateLimit} min_interval_ms=${profile.minIntervalMs} timeout_ms=${options.llmTimeoutMs ?? profile.timeoutMs} max_attempts=${options.llmMaxAttempts ?? 1}`);

    const bundles: SemanticFlowSessionBundle[] = [];
    const sourceRuns: SemanticFlowSourceRunRecord[] = [];
    for (const sourceDir of options.sourceDirs) {
        const sourceStartedAt = Date.now();
        const sourceAbs = path.resolve(options.repo, sourceDir);
        if (!fs.existsSync(sourceAbs)) {
            sourceRuns.push({
                sourceDir,
                absPath: sourceAbs,
                status: "missing",
                elapsedMs: Date.now() - sourceStartedAt,
                error: "source directory does not exist",
            });
            continue;
        }
        try {
            console.log(`semanticflow_phase=source_dir start source_dir=${sourceDir} abs=${sourceAbs}`);
            console.log(`semanticflow_phase=build_scene start source_dir=${sourceDir}`);
            const scene = buildScene(sourceAbs);
            const methodCount = scene.getMethods().length;
            console.log(`semanticflow_phase=build_scene done source_dir=${sourceDir} methods=${methodCount}`);
            const sourceRuleCandidates = capRuleCandidatesForSourceDir(
                sourceDir,
                sourceAbs,
                ruleCandidates.items,
                options.maxLlmItems,
            );
            const sourceRuleCompanionCandidates = scopeRuleCandidatesForSourceDir(
                sourceDir,
                sourceAbs,
                ruleCandidates.items,
            );
            if (sourceRuleCandidates.length !== ruleCandidates.items.length) {
                console.log(`semanticflow_phase=source_dir candidates source_dir=${sourceDir} scoped=${sourceRuleCandidates.length} global=${ruleCandidates.items.length} max_items=${options.maxLlmItems ?? ""}`);
            }
            const result = await runSemanticFlowProject({
                scene,
                modelInvoker: loggedInvoker,
                model: profile.model,
                ruleCandidates: sourceRuleCandidates,
                ruleCompanionCandidates: sourceRuleCompanionCandidates,
                includeArkMainCandidates: true,
                arkMainMaxCandidates: arkMainCandidateLimit,
                maxRounds: options.maxRounds,
                maxRepairAttempts: options.llmRepairAttempts ?? 0,
                concurrency: options.concurrency,
                onProgress: emitSemanticFlowProgress,
                sessionCache,
            });
            console.log(
                `semanticflow_phase=source_dir done source_dir=${sourceDir} items=${result.session.run.items.length} rule_known_covered=${ruleCandidates.skippedKnown} arkmain_candidates=${result.arkMainCandidates.length} arkmain_kernel_covered=${result.skippedArkMainCandidates.length} arkmain_ineligible=${result.ineligibleArkMainCandidates.length}`,
            );
            sourceRuns.push({
                sourceDir,
                absPath: sourceAbs,
                status: "ok",
                methods: methodCount,
                itemCount: result.session.run.items.length,
                arkMainCandidateCount: result.arkMainCandidates.length,
                arkMainIneligibleCount: result.ineligibleArkMainCandidates.length,
                elapsedMs: Date.now() - sourceStartedAt,
            });
            bundles.push({ sourceDir, result, skippedKnownRuleCandidates: ruleCandidates.skippedKnown });
        } catch (error) {
            const detail = String((error as any)?.message || error).replace(/\s+/g, " ").trim();
            console.log(`semanticflow_phase=source_dir exception source_dir=${sourceDir} elapsed_ms=${Date.now() - sourceStartedAt} error=${detail}`);
            sourceRuns.push({
                sourceDir,
                absPath: sourceAbs,
                status: "exception",
                elapsedMs: Date.now() - sourceStartedAt,
                error: detail,
            });
        }
    }

    const aggregatePaths = writeSemanticFlowArtifacts(options.outputDir, bundles);
    const sourceRunsPath = path.join(options.outputDir, "source_runs.json");
    fs.writeFileSync(sourceRunsPath, JSON.stringify(sourceRuns, null, 2), "utf-8");
    console.log(`semanticflow_phase=write_artifacts done session=${aggregatePaths.aggregateSessionPath}`);
    const aggregateSummary = collectAggregateSummary(bundles);
    if (options.publishModel) {
        const aggregate = aggregateSummary;
        const published = publishSemanticFlowProjectAssets({
            projectId: options.publishModel,
            modelRoot: options.modelRoots?.[0],
            assets: aggregate.augment.assets,
        });
        console.log(`semanticflow_phase=publish_model done pack=${options.publishModel} rules=${published.rulePath || "-"} modules=${published.modulePath || "-"} arkmain=${published.arkMainPath || "-"}`);
    }
    let finalRun: Awaited<ReturnType<typeof runAnalyze>> | undefined;
    if (options.analyze) {
        if (canReuseBootstrapAnalyzeForFinal(options, aggregateSummary, bootstrapAnalyze)) {
            finalRun = materializeReusedFinalAnalyzeArtifacts(options.outputDir, bootstrapAnalyze.run);
            console.log(`semanticflow_phase=final_analyze skipped reason=no_modeled_artifacts reuse=bootstrap summary_json=${finalRun.jsonPath}`);
        } else {
            finalRun = await runFinalAnalyze(options, aggregatePaths);
        }
    }
    if (finalRun) {
        console.log(`semanticflow_phase=final_analyze done summary_json=${finalRun.jsonPath}`);
    }

    const analysisSummaryPath = path.join(options.outputDir, "analysis.json");
    fs.writeFileSync(analysisSummaryPath, JSON.stringify(finalRun
        ? {
            totalEntries: finalRun.report.summary.totalEntries,
            okEntries: finalRun.report.summary.okEntries,
            withSeeds: finalRun.report.summary.withSeeds,
            withFlows: finalRun.report.summary.withFlows,
            totalFlows: finalRun.report.summary.totalFlows,
            statusCount: finalRun.report.summary.statusCount,
            summaryJsonPath: finalRun.jsonPath,
            summaryMdPath: finalRun.mdPath,
            diagnosticsJsonPath: finalRun.diagnosticsJsonPath,
            diagnosticsTextPath: finalRun.diagnosticsTextPath,
            sourceRunsPath,
            sourceRunStatusCount: countSourceRunStatuses(sourceRuns),
        }
        : {
            itemCount: aggregateSummary.summary.itemCount,
            resolutions: aggregateSummary.summary.resolutions,
            planes: aggregateSummary.summary.planes,
            assetCount: aggregateSummary.summary.assetCount,
            modeled: true,
            finalAnalyze: false,
            sourceRunsPath,
            sourceRunStatusCount: countSourceRunStatuses(sourceRuns),
        }, null, 2), "utf-8");

    writeSemanticFlowRunManifest(options.outputDir, options, {
        llmConfigPath: profile.configPath,
        llmProfile: profile.profileName,
        llmModel: profile.model,
        llmSessionCacheDir: options.llmSessionCacheDir,
        llmSessionCacheMode: options.llmSessionCacheMode,
        bootstrapRuleInputPath,
        ...aggregatePaths,
        sourceRunsPath,
        finalSummaryJsonPath: finalRun?.jsonPath,
        finalSummaryMdPath: finalRun?.mdPath,
    });

    console.log("====== SemanticFlow ======");
    console.log(`repo=${options.repo}`);
    console.log(`source_dirs=${options.sourceDirs.join(",")}`);
    console.log(`llm_profile=${profile.profileName}`);
    console.log(`llm_model=${profile.model}`);
    console.log(`rule_input=${bootstrapRuleInputPath}`);
    console.log(`rule_candidates=${ruleCandidates.items.length}`);
    console.log(`rule_known_covered=${aggregateSummary.summary.ruleKnownCoveredCount}`);
    console.log(`items=${aggregateSummary.summary.itemCount}`);
    console.log(`arkmain_kernel_covered=${aggregateSummary.summary.arkMainKernelCoveredCount}`);
    console.log(`arkmain_ineligible=${aggregateSummary.summary.arkMainIneligibleCount}`);
    console.log(`analyze=${options.analyze}`);
    console.log(`output_dir=${options.outputDir}`);
    if (finalRun) {
        console.log(`final_summary_json=${finalRun.jsonPath}`);
        console.log(`final_summary_md=${finalRun.mdPath}`);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
