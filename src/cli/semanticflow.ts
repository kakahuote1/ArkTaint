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
import type { PublishSemanticFlowProjectAssetsResult } from "../core/semanticflow/SemanticFlowProjectAssets";
import type { AssetDocumentBase } from "../core/assets/schema";
import { createSemanticFlowModelInvokerFromConfig } from "./semanticflowLlmClient";
import { resolveLlmProfile } from "./llmConfig";
import { runAnalyze } from "./analyzeRunner";
import type { AnalyzeEntryModel, AnalyzeProfile, CliOptions, ReportMode } from "./analyzeCliOptions";
import type { SemanticFlowProgressEvent } from "../core/semanticflow/SemanticFlowPipeline";
import { filterKnownSemanticFlowRuleCandidates } from "./semanticflowKnownRuleCandidates";
import { assertValidCanonicalApiId } from "../core/api/identity";
import { normalizeSemanticFlowSessionCacheMode, SemanticFlowSessionCache } from "../core/semanticflow/SemanticFlowSessionCache";
import {
    normalizeSemanticFlowRuleInputCandidatesWithTrace,
    type SemanticFlowRuleInputNormalizationTrace,
} from "../core/semanticflow/SemanticFlowRuleInputCandidates";
import { discoverArkTsSourceDirs, normalizeSourceDirsForCli } from "./sourceDiscovery";
import {
    appendTraceGraphFragments,
    TraceGraph,
    writeTraceGraphArtifacts,
} from "../core/trace/TraceGraph";
import { buildSemanticFlowTraceGraph } from "../core/trace/SemanticFlowTraceGraph";

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

export const DEFAULT_SEMANTICFLOW_MAX_LLM_ITEMS = 12;
export const DEFAULT_SEMANTICFLOW_LLM_REPAIR_ATTEMPTS = 1;

interface SemanticFlowSessionBundle {
    sourceDir: string;
    artifactName?: string;
    skippedKnownRuleCandidates: number;
    result: Awaited<ReturnType<typeof runSemanticFlowProject>>;
}

interface SemanticFlowSourceRunRecord {
    sourceDir: string;
    absPath: string;
    status: "ok" | "missing" | "exception";
    methods?: number;
    itemCount?: number;
    ruleCandidateCount?: number;
    ruleBatchCount?: number;
    ruleCandidatePackagingTrace?: SemanticFlowRuleInputNormalizationTrace;
    arkMainCandidateCount?: number;
    arkMainIneligibleCount?: number;
    elapsedMs: number;
    error?: string;
}

interface BootstrapAnalyzeResult {
    ruleInputPath: string;
    run?: Awaited<ReturnType<typeof runAnalyze>>;
}

interface SemanticFlowEvaluationOverlayInfo {
    applied: boolean;
    modelRoot?: string;
    projectId?: string;
    assetCount: number;
    assetCountByPlane: Record<string, number>;
    loadMode?: "semanticflow-evaluation";
    promoted: false;
}

interface SemanticFlowProgressRecorder {
    path: string;
    write(event: string, detail?: Record<string, unknown>): void;
}

function createSemanticFlowProgressRecorder(outputDir: string): SemanticFlowProgressRecorder {
    fs.mkdirSync(outputDir, { recursive: true });
    const progressPath = path.join(outputDir, "semanticflow_progress.jsonl");
    fs.writeFileSync(progressPath, "", "utf-8");
    return {
        path: progressPath,
        write(event: string, detail: Record<string, unknown> = {}): void {
            fs.appendFileSync(progressPath, JSON.stringify({
                ts: new Date().toISOString(),
                event,
                ...detail,
            }) + "\n", "utf-8");
        },
    };
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

function normalizePositiveInt(raw: string | undefined, flag: string, defaultValue: number): number {
    if (raw === undefined) {
        return defaultValue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`invalid ${flag}: ${raw}`);
    }
    return Math.floor(value);
}

function normalizeNonNegativeInt(raw: string | undefined, flag: string, defaultValue: number): number {
    if (raw === undefined) {
        return defaultValue;
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
    let llmRepairAttempts = DEFAULT_SEMANTICFLOW_LLM_REPAIR_ATTEMPTS;
    let maxLlmItems = DEFAULT_SEMANTICFLOW_MAX_LLM_ITEMS;

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
            arkMainMaxCandidates = normalizeNonNegativeInt(arkArg, "--arkMainMaxCandidates", 0);
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
    packagingTrace: SemanticFlowRuleInputNormalizationTrace;
} {
    if (!ruleInputPath || !fs.existsSync(ruleInputPath)) {
        return {
            items: [],
            skippedKnown: 0,
            packagingTrace: {
                rawCount: 0,
                normalizedCount: 0,
                returnedValueSiblingCreatedCount: 0,
                events: [],
            },
        };
    }
    const parsed = JSON.parse(fs.readFileSync(ruleInputPath, "utf-8"));
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
    if (!Array.isArray(items)) {
        return {
            items: [],
            skippedKnown: 0,
            packagingTrace: {
                rawCount: 0,
                normalizedCount: 0,
                returnedValueSiblingCreatedCount: 0,
                events: [],
            },
        };
    }
    const filterOptions = {
        modelRoots: options.modelRoots,
        enabledModels: options.enabledModels,
        disabledModels: options.disabledModels,
    };
    const normalized = normalizeSemanticFlowRuleInputCandidatesWithTrace(items as NormalizedCallsiteItem[]);
    const normalizedInput = normalized.items;
    const filtered = filterKnownSemanticFlowRuleCandidates(normalizedInput, filterOptions);
    const orderedForContext = orderSemanticFlowRuleCandidatesForModeling(filtered.candidates);
    const enriched = enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: options.repo,
        sourceDirs: options.sourceDirs,
        items: orderedForContext,
        maxItems: options.maxSliceItems,
        maxExamplesPerItem: options.examplesPerItem,
        contextRadius: options.contextRadius,
        cfgNeighborRadius: options.cfgNeighborRadius,
    });
    const contextFiltered = filterKnownSemanticFlowRuleCandidates(enriched, filterOptions);
    return {
        items: contextFiltered.candidates,
        skippedKnown: filtered.skippedKnown.length + contextFiltered.skippedKnown.length,
        packagingTrace: normalized.trace,
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
    const candidatePaths = semanticFlowCandidateScopePaths(item);
    if (candidatePaths.length === 0) {
        return true;
    }
    return candidatePaths.some(candidatePath =>
        semanticFlowPathBelongsToSourceDir(sourceDir, sourceAbs, candidatePath));
}

function semanticFlowCandidateScopePaths(item: NormalizedCallsiteItem): string[] {
    const paths: string[] = [];
    const add = (value: unknown): void => {
        const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/g, "").trim();
        if (normalized) {
            paths.push(normalized);
        }
    };
    add(item.sourceFile);
    const callerFiles = Array.isArray((item as any).callerFiles) ? (item as any).callerFiles : [];
    for (const callerFile of callerFiles) {
        add(callerFile);
    }
    const contextSlices = Array.isArray((item as any).contextSlices) ? (item as any).contextSlices : [];
    for (const slice of contextSlices) {
        add(slice?.callerFile);
        add(slice?.sourceFile);
    }
    return [...new Set(paths)];
}

function semanticFlowPathBelongsToSourceDir(sourceDir: string, sourceAbs: string, candidatePath: string): boolean {
    const sourceFile = String(candidatePath || "").replace(/\\/g, "/").replace(/^\/+/g, "");
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

interface SemanticFlowRuleCandidateBatch {
    index: number;
    candidates: NormalizedCallsiteItem[];
}

interface SemanticFlowRuleCandidateBatchPlan {
    scoped: NormalizedCallsiteItem[];
    queue: SemanticFlowModelingQueue;
    batches: SemanticFlowRuleCandidateBatch[];
}

function buildRuleCandidateBatchPlanForSourceDir(
    sourceDir: string,
    sourceAbs: string,
    candidates: NormalizedCallsiteItem[],
    batchSize: number | undefined,
): SemanticFlowRuleCandidateBatchPlan {
    const scoped = scopeRuleCandidatesForSourceDir(sourceDir, sourceAbs, candidates);
    const queue = buildSemanticFlowRuleCandidateModelingQueue(scoped, batchSize);
    const byBatch = new Map<number, NormalizedCallsiteItem[]>();
    for (const entry of queue.selected) {
        const index = entry.batchIndex ?? 0;
        byBatch.set(index, [...(byBatch.get(index) || []), entry.item]);
    }
    const batches = [...byBatch.entries()]
        .sort(([left], [right]) => left - right)
        .map(([index, batchCandidates]) => ({ index, candidates: batchCandidates }));
    return { scoped, queue, batches };
}

function scopeRuleCandidatesForSourceDir(
    sourceDir: string,
    sourceAbs: string,
    candidates: NormalizedCallsiteItem[],
): NormalizedCallsiteItem[] {
    return candidates.filter(item => semanticFlowCandidateBelongsToSourceDir(sourceDir, sourceAbs, item));
}

export type SemanticFlowModelingQueueStatus =
    | "selected"
    | "need-more-evidence";

export type SemanticFlowModelingQueueTier =
    | "external-boundary"
    | "security-wrapper"
    | "returned-value-source"
    | "state-handoff"
    | "payload-transform"
    | "callback-payload"
    | "observed-callsite"
    | "utility"
    | "need-more-evidence";

export interface SemanticFlowModelingQueueEntry {
    item: NormalizedCallsiteItem;
    tier: SemanticFlowModelingQueueTier;
    status: SemanticFlowModelingQueueStatus;
    reasons: string[];
    originalIndex: number;
    batchIndex?: number;
}

export interface SemanticFlowModelingQueue {
    entries: SemanticFlowModelingQueueEntry[];
    selected: SemanticFlowModelingQueueEntry[];
    deferred: SemanticFlowModelingQueueEntry[];
    needMoreEvidence: SemanticFlowModelingQueueEntry[];
}

const semanticFlowModelingTierOrder: SemanticFlowModelingQueueTier[] = [
    "external-boundary",
    "security-wrapper",
    "returned-value-source",
    "state-handoff",
    "payload-transform",
    "callback-payload",
    "observed-callsite",
    "utility",
    "need-more-evidence",
];

const semanticFlowModelingTierRank = new Map(
    semanticFlowModelingTierOrder.map((tier, index) => [tier, index]),
);

const SEMANTICFLOW_DATA_ENDPOINT_TOKEN_RE = /\b(payload|body|data|message|msg|content|text|value|values?|params?|query|header|authorization|token|password|passwd|credential|secret|cookie|file|buffer|record|url|uri|server|address|host|endpoint|user|username|key|path|result|response)\b/;
const SEMANTICFLOW_CALL_SHAPE_RE = /\.\s*[A-Za-z_$][\w$]*\s*\(/;

export function classifySemanticFlowRuleCandidateForModeling(
    item: NormalizedCallsiteItem,
): Pick<SemanticFlowModelingQueueEntry, "tier" | "reasons"> {
    if (!acceptedSemanticFlowCanonicalApiId(item)) {
        return { tier: "need-more-evidence", reasons: ["canonical-api-id-missing"] };
    }
    const method = String(item.method || "").toLowerCase();
    const sig = String(item.callee_signature || "").toLowerCase();
    const origin = String((item as any).candidateOrigin || "").trim();
    const semanticFocus = String((item as any).semanticFocus || "").trim();
    const evidenceText = semanticFlowCandidateModelingText(item).toLowerCase();
    const hasStableMethod = method.length > 0 && !/%unk|@unk/.test(`${sig} ${method}`);
    const isApiRecall = isApiModelingRecallOrigin(origin);
    const isReturnedValue = isReturnedValueSemanticFocus(semanticFocus);
    const hasOutboundBoundaryEvidence = hasSemanticFlowOutboundBoundaryEvidence(evidenceText);
    const hasKeyedStateEvidence = hasKeyedStateModelingEvidence(evidenceText);
    const hasSecuritySurfaceEvidence = hasSecurityRelevantModelingSurface(method, sig, evidenceText);
    const hasPayloadCallbackEvidence = hasPayloadCallbackModelingEvidence(item, evidenceText);
    const hasDelegatedWrapperEvidence = hasSemanticFlowDelegatedWrapperEvidence(item, evidenceText);
    const hasDeclaredOwnerEvidence = hasSemanticFlowDeclaredOwnerEvidence(item);
    const reasons: string[] = [];

    if (!hasStableMethod && !hasPayloadCallbackEvidence) {
        return { tier: "need-more-evidence", reasons: ["surface-identity-unresolved"] };
    }

    if (hasOutboundBoundaryEvidence) {
        reasons.push("outbound-or-external-boundary-evidence");
        if (/candidateboundary=project_or_third_party_wrapper_evidence/.test(evidenceText)) {
            reasons.push("project-or-third-party-wrapper-evidence");
        }
        if (hasDeclaredOwnerEvidence) {
            reasons.push("analyzer-backed-declared-owner-surface");
        }
        return { tier: "external-boundary", reasons };
    }

    if (hasDeclaredOwnerEvidence && (hasSecuritySurfaceEvidence || hasOutboundBoundaryEvidence || isReturnedValue)) {
        reasons.push("analyzer-backed-declared-owner-surface");
        reasons.push("payload-or-boundary-structure");
        return { tier: "external-boundary", reasons };
    }

    if ((isApiRecall || isReturnedValue || origin === "") && hasSecuritySurfaceEvidence && hasDelegatedWrapperEvidence) {
        reasons.push("security-relevant-wrapper-evidence");
        return { tier: "security-wrapper", reasons };
    }

    if (isReturnedValue && (hasDelegatedWrapperEvidence || hasSecuritySurfaceEvidence || hasKeyedStateEvidence)) {
        reasons.push("returned-value-source-candidate");
        return { tier: "returned-value-source", reasons };
    }

    if (hasKeyedStateEvidence) {
        reasons.push("state-or-handoff-storage-evidence");
        return { tier: "state-handoff", reasons };
    }

    if (isProjectSerializationWrapperCandidate(method, sig, item.argCount)
        || (SEMANTICFLOW_DATA_ENDPOINT_TOKEN_RE.test(evidenceText) && SEMANTICFLOW_CALL_SHAPE_RE.test(evidenceText))
        || /^(process|parse|decode|encode|transform|convert|collect|save|insert|update)/.test(method)) {
        reasons.push("payload-transform-or-persistence-evidence");
        return { tier: "payload-transform", reasons };
    }

    if (origin === "recall_callback_surface"
        && (hasCallbackPropertyModelingSignal(item)
            || hasPayloadCallbackEvidence
            || hasResolvedLifecycleCallbackModelingEvidence(item, evidenceText))) {
        reasons.push(hasResolvedLifecycleCallbackModelingEvidence(item, evidenceText)
            ? "resolved-lifecycle-callback-owner-evidence"
            : "callback-payload-evidence");
        return { tier: "callback-payload", reasons };
    }

    if (isLikelyContextOrUiSetupCandidate(method, sig)
        || isNoPayloadMaintenanceCandidate(method, sig, item.argCount)
        || isInternalNavigationControlCandidate(method, sig)
        || isUiFeedbackOnlyModelingCandidate(method, sig, item.argCount, hasSecuritySurfaceEvidence)
        || /pages\/|components\//.test(sig)) {
        reasons.push("utility-or-ui-helper");
        return { tier: "utility", reasons };
    }

    if (origin === "" || origin === "observed_callsite" || origin === "no_candidate") {
        reasons.push("observed-uncovered-callsite");
        return { tier: "observed-callsite", reasons };
    }

    reasons.push("uncovered-candidate-deferred-by-structural-order");
    return { tier: "utility", reasons };
}

export function orderSemanticFlowRuleCandidatesForModeling(candidates: NormalizedCallsiteItem[]): NormalizedCallsiteItem[] {
    return buildOrderedSemanticFlowModelingEntries(candidates).map(entry => entry.item);
}

function buildOrderedSemanticFlowModelingEntries(candidates: NormalizedCallsiteItem[]): SemanticFlowModelingQueueEntry[] {
    return candidates
        .map((item, originalIndex) => {
            const classified = classifySemanticFlowRuleCandidateForModeling(item);
            return {
                item,
                tier: classified.tier,
                status: "selected" as SemanticFlowModelingQueueStatus,
                reasons: classified.reasons,
                originalIndex,
            };
        });
}

function compareSemanticFlowModelingQueueEntries(
    left: SemanticFlowModelingQueueEntry,
    right: SemanticFlowModelingQueueEntry,
): number {
    return semanticFlowTierIndex(left.tier) - semanticFlowTierIndex(right.tier)
        || semanticFlowCandidateTieBreaker(left.item, right.item)
        || left.originalIndex - right.originalIndex;
}

function semanticFlowTierIndex(tier: SemanticFlowModelingQueueTier): number {
    return semanticFlowModelingTierRank.get(tier) ?? semanticFlowModelingTierOrder.length;
}

function semanticFlowCandidateTieBreaker(left: NormalizedCallsiteItem, right: NormalizedCallsiteItem): number {
    const leftDeclaredOwner = hasSemanticFlowDeclaredOwnerEvidence(left) ? 0 : 1;
    const rightDeclaredOwner = hasSemanticFlowDeclaredOwnerEvidence(right) ? 0 : 1;
    const leftReturned = isReturnedValueSemanticFocus(String((left as any).semanticFocus || "").trim()) ? 0 : 1;
    const rightReturned = isReturnedValueSemanticFocus(String((right as any).semanticFocus || "").trim()) ? 0 : 1;
    return leftDeclaredOwner - rightDeclaredOwner
        || leftReturned - rightReturned
        || semanticFlowModelingDiversityKey(left).localeCompare(semanticFlowModelingDiversityKey(right))
        || semanticFlowModelingItemKey(left).localeCompare(semanticFlowModelingItemKey(right));
}

function hasSemanticFlowDeclaredOwnerEvidence(item: NormalizedCallsiteItem): boolean {
    const topEntries = Array.isArray((item as any).topEntries)
        ? (item as any).topEntries
        : [];
    return topEntries.some((entry: unknown) => String(entry || "").includes("declaredOwnerFromCallsite="));
}

export function selectSemanticFlowRuleCandidatesForModeling(
    candidates: NormalizedCallsiteItem[],
    maxItems?: number,
): NormalizedCallsiteItem[] {
    return buildSemanticFlowRuleCandidateModelingQueue(candidates, maxItems).selected.map(entry => entry.item);
}

export function buildSemanticFlowRuleCandidateModelingQueue(
    candidates: NormalizedCallsiteItem[],
    maxItems?: number,
): SemanticFlowModelingQueue {
    const ordered = buildOrderedSemanticFlowModelingEntries(candidates);
    const batchSize = Math.max(1, maxItems ?? (ordered.length || 1));
    let selectedCount = 0;
    const entries = ordered.map(entry => {
        const status: SemanticFlowModelingQueueStatus = entry.tier === "need-more-evidence"
            ? "need-more-evidence"
            : "selected";
        const batchIndex = status === "selected"
            ? Math.floor(selectedCount++ / batchSize)
            : undefined;
        return {
            ...entry,
            status,
            batchIndex,
        };
    });
    return {
        entries,
        selected: entries.filter(entry => entry.status === "selected"),
        deferred: [],
        needMoreEvidence: entries.filter(entry => entry.status === "need-more-evidence"),
    };
}

function addContextLinkedSemanticFlowCandidates(
    seed: NormalizedCallsiteItem,
    ordered: SemanticFlowModelingQueueEntry[],
    selectedKeys: Set<string>,
    add: (item: NormalizedCallsiteItem, diversePass: boolean) => boolean,
    depth: number,
): void {
    if (depth >= 2) {
        return;
    }
    let added = 0;
    for (const candidate of findContextLinkedSemanticFlowCandidates(seed, ordered, selectedKeys)) {
        if (add(candidate, false)) {
            added++;
            addContextLinkedSemanticFlowCandidates(candidate, ordered, selectedKeys, add, depth + 1);
        }
        if (added >= 2) {
            break;
        }
    }
}

function addKeyedStateCompanionSemanticFlowCandidate(
    seed: NormalizedCallsiteItem,
    ordered: SemanticFlowModelingQueueEntry[],
    selectedKeys: Set<string>,
    add: (item: NormalizedCallsiteItem, diversePass: boolean) => boolean,
): void {
    if (!isKeyedStateReadModelingCandidate(seed)) {
        return;
    }
    const seedGroup = semanticFlowModelingDiversityKey(seed);
    const companions = ordered
        .map(entry => entry.item)
        .filter(candidate =>
            !selectedKeys.has(semanticFlowModelingItemKey(candidate))
            && semanticFlowModelingDiversityKey(candidate) === seedGroup
            && isKeyedStateWriteModelingCandidate(candidate))
        .sort(compareKeyedStateWriteCompanions);
    for (const companion of companions) {
        if (add(companion, false)) {
            return;
        }
    }
}

function compareKeyedStateWriteCompanions(left: NormalizedCallsiteItem, right: NormalizedCallsiteItem): number {
    const leftClass = classifySemanticFlowRuleCandidateForModeling(left);
    const rightClass = classifySemanticFlowRuleCandidateForModeling(right);
    const leftIsOrdinary = isReturnedValueSemanticFocus(String((left as any).semanticFocus || "").trim()) ? 1 : 0;
    const rightIsOrdinary = isReturnedValueSemanticFocus(String((right as any).semanticFocus || "").trim()) ? 1 : 0;
    const leftMethod = String(left.method || "").toLowerCase();
    const rightMethod = String(right.method || "").toLowerCase();
    const leftWrites = /^(put|set|save|write|store|update|insert)/.test(leftMethod) ? 0 : 1;
    const rightWrites = /^(put|set|save|write|store|update|insert)/.test(rightMethod) ? 0 : 1;
    const leftDeletes = /^(delete|remove|clear)/.test(leftMethod) ? 1 : 0;
    const rightDeletes = /^(delete|remove|clear)/.test(rightMethod) ? 1 : 0;
    return semanticFlowTierIndex(leftClass.tier) - semanticFlowTierIndex(rightClass.tier)
        || leftIsOrdinary - rightIsOrdinary
        || leftWrites - rightWrites
        || leftDeletes - rightDeletes
        || semanticFlowModelingItemKey(left).localeCompare(semanticFlowModelingItemKey(right));
}

function findContextLinkedSemanticFlowCandidates(
    seed: NormalizedCallsiteItem,
    ordered: SemanticFlowModelingQueueEntry[],
    selectedKeys: Set<string>,
): NormalizedCallsiteItem[] {
    const seedText = semanticFlowCandidateModelingText(seed);
    if (!seedText.trim()) {
        return [];
    }
    const out: SemanticFlowModelingQueueEntry[] = [];
    for (const entry of ordered) {
        const candidate = entry.item;
        if (selectedKeys.has(semanticFlowModelingItemKey(candidate))) {
            continue;
        }
        if (!isContextLinkableApiCandidate(candidate)) {
            continue;
        }
        const method = String(candidate.method || "").trim();
        if (!method || method.length < 4 || !methodOccursAsCall(seedText, method)) {
            continue;
        }
        out.push(entry);
    }
    return out.sort(compareSemanticFlowModelingQueueEntries)
        .map(entry => entry.item);
}

function isContextLinkableApiCandidate(item: NormalizedCallsiteItem): boolean {
    const origin = String((item as any).candidateOrigin || "").trim();
    if (!isApiModelingRecallOrigin(origin) && origin !== "recall_returned_value_surface") {
        return false;
    }
    const text = semanticFlowCandidateModelingText(item).toLowerCase();
    if (isLikelyContextOrUiSetupCandidate(String(item.method || "").toLowerCase(), text)) {
        return false;
    }
    return /candidateboundary=/.test(text)
        || SEMANTICFLOW_DATA_ENDPOINT_TOKEN_RE.test(text)
        || SEMANTICFLOW_CALL_SHAPE_RE.test(text);
}

function isKeyedStateReadModelingCandidate(item: NormalizedCallsiteItem): boolean {
    const method = String(item.method || "").toLowerCase();
    const text = semanticFlowCandidateModelingText(item).toLowerCase();
    if (!hasKeyedStateModelingEvidence(text)) {
        return false;
    }
    return /^(get|load|read|query|fetch|select|find)/.test(method)
        || /\.\s*(?:get|getall|load|read|query|select)\s*\(/.test(text)
        || isReturnedValueSemanticFocus(String((item as any).semanticFocus || "").trim());
}

function isKeyedStateWriteModelingCandidate(item: NormalizedCallsiteItem): boolean {
    const method = String(item.method || "").toLowerCase();
    const text = semanticFlowCandidateModelingText(item).toLowerCase();
    if (!hasKeyedStateModelingEvidence(text)) {
        return false;
    }
    return /^(put|set|save|write|store|update|insert|delete|remove|clear)/.test(method)
        || /\.\s*(?:put|set|save|write|store|update|insert|delete|remove|clear|flush)\s*\(/.test(text);
}

function hasKeyedStateModelingEvidence(text: string): boolean {
    return /\b(preferences|appstorage|persistentstorage|persistent|localstorage)\b/.test(text);
}

function methodOccursAsCall(text: string, method: string): boolean {
    const escaped = escapeRegExp(method);
    return new RegExp(`(?:\\b|\\.|\\?\\.)${escaped}\\s*\\(`).test(text);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    ordered: SemanticFlowModelingQueueEntry[],
    nextIndex: number,
    selectedKeys: Set<string>,
    selected: NormalizedCallsiteItem[],
    limit: number,
    forcedFirstPair: boolean,
    diversePass: boolean,
    diversityCounts: Map<string, number>,
    maxPerDiversityGroup: number,
    returnedValueFocusLimit: number,
): boolean {
    if (pairedCandidateWouldCrowdHigherReturnedValueCandidate(
        sibling,
        ordered,
        nextIndex,
        selectedKeys,
        selected,
        limit,
        diversePass,
        diversityCounts,
        maxPerDiversityGroup,
        returnedValueFocusLimit,
    )) {
        return false;
    }
    if (!forcedFirstPair) {
        return true;
    }
    const siblingTier = classifySemanticFlowRuleCandidateForModeling(sibling).tier;
    for (let i = nextIndex; i < ordered.length; i++) {
        const candidate = ordered[i].item;
        if (selectedKeys.has(semanticFlowModelingItemKey(candidate))) {
            continue;
        }
        if (semanticFlowTierIndex(classifySemanticFlowRuleCandidateForModeling(candidate).tier) < semanticFlowTierIndex(siblingTier)) {
            return false;
        }
        return true;
    }
    return true;
}

function pairedCandidateWouldCrowdHigherReturnedValueCandidate(
    sibling: NormalizedCallsiteItem,
    ordered: SemanticFlowModelingQueueEntry[],
    nextIndex: number,
    selectedKeys: Set<string>,
    selected: NormalizedCallsiteItem[],
    limit: number,
    diversePass: boolean,
    diversityCounts: Map<string, number>,
    maxPerDiversityGroup: number,
    returnedValueFocusLimit: number,
): boolean {
    const siblingTier = classifySemanticFlowRuleCandidateForModeling(sibling).tier;
    const siblingDiversityKey = semanticFlowModelingDiversityKey(sibling);
    const wouldFillOverallBudget = selected.length >= limit - 1;
    const wouldFillDiversityBudget = diversePass
        && (diversityCounts.get(siblingDiversityKey) || 0) >= maxPerDiversityGroup - 1;
    const siblingIsReturnedValue = isReturnedValueSemanticFocus(String((sibling as any).semanticFocus || "").trim());
    const selectedReturnedValueCount = selected.filter(item => isReturnedValueSemanticFocus(
        String((item as any).semanticFocus || "").trim(),
    )).length;
    const wouldFillReturnedValueBudget = siblingIsReturnedValue
        && selectedReturnedValueCount >= returnedValueFocusLimit - 1;

    if (!wouldFillOverallBudget && !wouldFillDiversityBudget && !wouldFillReturnedValueBudget) {
        return false;
    }

    for (let i = nextIndex; i < ordered.length; i++) {
        const candidate = ordered[i].item;
        if (selectedKeys.has(semanticFlowModelingItemKey(candidate))) {
            continue;
        }
        if (!isReturnedValueSemanticFocus(String((candidate as any).semanticFocus || "").trim())) {
            continue;
        }
        if (semanticFlowTierIndex(classifySemanticFlowRuleCandidateForModeling(candidate).tier) > semanticFlowTierIndex(siblingTier)) {
            continue;
        }
        if (wouldFillOverallBudget || wouldFillReturnedValueBudget) {
            return true;
        }
        if (wouldFillDiversityBudget && semanticFlowModelingDiversityKey(candidate) === siblingDiversityKey) {
            return true;
        }
    }
    return false;
}

function shouldSpendSemanticFlowBudgetOnSameSurfacePair(
    selected: NormalizedCallsiteItem[],
    limit: number,
): boolean {
    if (limit <= 2) {
        return false;
    }
    const selectedPairs = new Set(selected.map(item => semanticFlowModelingPairKey(item)));
    return selectedPairs.size >= 2 || selected.length <= Math.max(1, Math.floor(limit / 2));
}

function hasSemanticFlowOutboundBoundaryEvidence(text: string): boolean {
    return /candidateboundary=project_or_third_party_wrapper_evidence/.test(text)
        || /candidateboundary=project_or_third_party_bridge_evidence/.test(text)
        || (SEMANTICFLOW_CALL_SHAPE_RE.test(text) && SEMANTICFLOW_DATA_ENDPOINT_TOKEN_RE.test(text))
        || /\breturn\s+(?:await\s+)?[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\(/.test(text);
}

function isApiModelingRecallOrigin(origin: string): boolean {
    return origin === "recall_api_surface"
        || origin === "recall_api_surface_declared_owner"
        || origin === "recall_direct_boundary_surface";
}

function semanticFlowCandidateModelingText(item: NormalizedCallsiteItem): string {
    const parts: string[] = [
        String(item.method || ""),
        String(item.callee_signature || ""),
        String(item.sourceFile || ""),
        String((item as any).methodSnippet || ""),
    ];
    const callbackProperties = Array.isArray((item as any).callbackProperties)
        ? (item as any).callbackProperties
        : [];
    parts.push(...callbackProperties.map(value => String(value || "")));
    const evidence = Array.isArray((item as any).evidence)
        ? (item as any).evidence
        : [];
    parts.push(...evidence.map(value => String(value || "")));
    const topEntries = Array.isArray((item as any).topEntries)
        ? (item as any).topEntries
        : [];
    parts.push(...topEntries.map(value => String(value || "")));
    const contextSlices = Array.isArray((item as any).contextSlices)
        ? (item as any).contextSlices
        : [];
    for (const slice of contextSlices) {
        parts.push(
            String(slice?.callerFile || ""),
            String(slice?.callerMethod || ""),
            String(slice?.invokeStmtText || ""),
            String(slice?.windowLines || ""),
            ...(Array.isArray(slice?.cfgNeighborStmts) ? slice.cfgNeighborStmts.map((stmt: unknown) => String(stmt || "")) : []),
        );
    }
    return parts.join("\n");
}

function hasCallbackPropertyModelingSignal(item: NormalizedCallsiteItem): boolean {
    const callbackProperties = Array.isArray((item as any).callbackProperties)
        ? (item as any).callbackProperties.map((value: unknown) => String(value || "").toLowerCase())
        : [];
    return callbackProperties.some(name =>
        /(?:send|submit|input|change|save|upload|request|confirm|login|message|select|search|record|did)/.test(name),
    );
}

function hasPayloadCallbackModelingEvidence(item: NormalizedCallsiteItem, evidenceLower: string): boolean {
    if (!hasCallbackPropertyModelingSignal(item)) {
        return false;
    }
    const payloadName = "(?:content|value|message|payload|body|data|text|keyword|token|password|userid|user|file|filepath|voicepath|imagepath|controller)";
    const callbackWithPayload = new RegExp(
        `\\bon[A-Za-z_$][\\w$]*\\s*:\\s*\\([^)]*\\b${payloadName}\\b[^)]*\\)\\s*=>[\\s\\S]{0,900}`
        + `(?:\\b(?:send|submit|request|post|put|save|write|insert|update|login|emit|dispatch)[A-Za-z_$\\w]*\\s*\\(|\\.\\s*(?:send|submit|request|post|put|save|write|insert|update|login|emit|dispatch)[A-Za-z_$\\w]*\\s*\\(|\\?\\.\\s*\\()`,
        "i",
    );
    if (callbackWithPayload.test(evidenceLower)) {
        return true;
    }
    return /\bon[A-Za-z_$][\w$]*send\b[\s\S]{0,900}\b(?:getRichEditorContent|create[A-Za-z_$\w]*Message|send[A-Za-z_$\w]*Message|send[A-Za-z_$\w]*\s*\()/.test(evidenceLower);
}

function hasResolvedLifecycleCallbackModelingEvidence(item: NormalizedCallsiteItem, evidenceLower: string): boolean {
    const callbackProperties = Array.isArray((item as any).callbackProperties)
        ? (item as any).callbackProperties.map((value: unknown) => String(value || "").toLowerCase())
        : [];
    if (!callbackProperties.some(name => /(?:load|ready|appear|shown|pageend|complete|success|finish|mounted|init)/.test(name))) {
        return false;
    }
    if (!/callbackownerresolved=true|resolvedcallbackownerfile=/.test(evidenceLower)) {
        return false;
    }
    return /\b(?:this\.)?on[A-Za-z_$][\w$]*\s*\(/.test(evidenceLower)
        || /\.on[A-Za-z_$][\w$]*\s*\(/.test(evidenceLower)
        || /\b(?:onPageEnd|onReady|onAppear|aboutToAppear|onComplete|onSuccess)\b/.test(evidenceLower);
}

function hasSecurityRelevantModelingSurface(
    methodLower: string,
    signatureLower: string,
    snippetLower: string,
): boolean {
    const text = `${methodLower} ${signatureLower} ${snippetLower}`;
    if (SEMANTICFLOW_DATA_ENDPOINT_TOKEN_RE.test(text)
        && (SEMANTICFLOW_CALL_SHAPE_RE.test(text) || /\breturn\b/.test(text))) {
        return true;
    }
    if (!/(pages\/|components\/)/.test(signatureLower)
        && /search/.test(methodLower)
        && /\b(data|source|provider|repository)\b/.test(signatureLower)) {
        return true;
    }
    return !/(pages\/|components\/)/.test(signatureLower)
        && /(message|payload|body|url|header)/.test(methodLower)
        && /\b(data|source|provider|repository|database)\b/.test(signatureLower);
}

function hasSemanticFlowDelegatedWrapperEvidence(item: NormalizedCallsiteItem, evidenceText: string): boolean {
    const origin = String((item as any).candidateOrigin || "").trim();
    if (isApiModelingRecallOrigin(origin) || origin === "recall_returned_value_surface") {
        return true;
    }
    return /candidateboundary=/.test(evidenceText)
        || /\bdeclaredownerfromcallsite=/.test(evidenceText)
        || (SEMANTICFLOW_CALL_SHAPE_RE.test(evidenceText) && SEMANTICFLOW_DATA_ENDPOINT_TOKEN_RE.test(evidenceText));
}

function isUiFeedbackOnlyModelingCandidate(
    methodLower: string,
    signatureLower: string,
    argCount: number | undefined,
    hasSecuritySurfaceEvidence: boolean,
): boolean {
    if (hasSecuritySurfaceEvidence) {
        return false;
    }
    if (!/(pages\/|components\/|viewmodels?\/)/.test(signatureLower)) {
        return false;
    }
    if (/^(showtoast|toast|notify|notifymessagesupdated|hidenotification|showloading|hideloading|showdialog|dismissdialog|hidekeyboard|hidesidebar|syncstatetoviewmodel|resetsetupstate|scrolltobottom)$/.test(methodLower)) {
        return true;
    }
    return (argCount ?? 0) === 0
        && /^(hide|show|notify|sync|reset|refresh|scroll|load|initialize)/.test(methodLower)
        && !/(settings|config|token|credential|message|request|search|database|storage)/.test(methodLower);
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
    const canonicalApiId = acceptedSemanticFlowCanonicalApiId(item);
    if (canonicalApiId) {
        return canonicalApiId;
    }
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

function semanticFlowDeclaredOwnerAlternativeKey(item: NormalizedCallsiteItem): string | undefined {
    const canonicalApiId = acceptedSemanticFlowCanonicalApiId(item);
    if (canonicalApiId) {
        return `${canonicalApiId}|${String((item as any).semanticFocus || "")}`;
    }
    const origin = String((item as any).candidateOrigin || "").trim();
    if (!isApiModelingRecallOrigin(origin)) {
        return undefined;
    }
    const method = String(item.method || "").trim();
    if (!method) {
        return undefined;
    }
    const implementationOwner = semanticFlowImplementationOwnerForAlternative(item);
    if (!implementationOwner) {
        return undefined;
    }
    return [
        String(item.sourceFile || "").replace(/\\/g, "/").toLowerCase(),
        implementationOwner.toLowerCase(),
        method.toLowerCase(),
        String((item as any).invokeKind || ""),
        String((item as any).argCount ?? ""),
        String((item as any).semanticFocus || ""),
    ].join("|");
}

function semanticFlowImplementationOwnerForAlternative(item: NormalizedCallsiteItem): string | undefined {
    const topEntries = Array.isArray((item as any).topEntries)
        ? (item as any).topEntries
        : [];
    for (const entry of topEntries) {
        const match = String(entry || "").match(/^implementationOwner=([A-Za-z_$][\w$]*)$/);
        if (match) {
            return match[1];
        }
    }
    return extractSemanticFlowOwnerFromSignature(String(item.callee_signature || ""));
}

function semanticFlowModelingDiversityKey(item: NormalizedCallsiteItem): string {
    const canonicalApiId = acceptedSemanticFlowCanonicalApiId(item);
    if (canonicalApiId) {
        return canonicalApiId;
    }
    const sourceFile = String(item.sourceFile || "").replace(/\\/g, "/").toLowerCase();
    const owner = extractSemanticFlowOwnerFromSignature(String(item.callee_signature || ""))
        || sourceFile;
    return `${sourceFile}|${owner.toLowerCase()}`;
}

function acceptedSemanticFlowCanonicalApiId(item: NormalizedCallsiteItem): string | undefined {
    const canonicalApiId = String((item as any).canonicalApiId || "").trim();
    if (!canonicalApiId) {
        return undefined;
    }
    try {
        assertValidCanonicalApiId(canonicalApiId);
        return canonicalApiId;
    } catch {
        return undefined;
    }
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
    return /(database|db|cache|cacher|configure|service|manager)/.test(signatureLower);
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
    generatedModelPublishResult: PublishSemanticFlowProjectAssetsResult;
    generatedModelPublishedAssets: AssetDocumentBase[];
    aggregateSummaryPath: string;
} {
    const aggregate = collectAggregateSummary(bundles);
    fs.mkdirSync(rootDir, { recursive: true });
    const modelingDir = path.join(rootDir, "modeling");
    fs.mkdirSync(modelingDir, { recursive: true });

    for (const bundle of bundles) {
        const base = path.join(modelingDir, safeSourceDirName(bundle.artifactName || bundle.sourceDir));
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
    const generatedModelPublishResult = publishSemanticFlowProjectAssets({
        projectId: generatedModelProjectId,
        modelRoot: generatedModelRoot,
        assets: aggregate.augment.assets,
    });
    const generatedModelPublishedAssets = readPublishedSemanticFlowAssets(generatedModelPublishResult);

    return {
        aggregateSessionPath,
        aggregateAssetsPath,
        generatedModelRoot,
        generatedModelProjectId,
        generatedModelPublishResult,
        generatedModelPublishedAssets,
        aggregateSummaryPath,
    };
}

function writeSemanticFlowTraceArtifacts(
    rootDir: string,
    options: SemanticFlowCliOptions,
    aggregate: ReturnType<typeof collectAggregateSummary>,
    aggregatePaths: ReturnType<typeof writeSemanticFlowArtifacts>,
    sourceRuns: SemanticFlowSourceRunRecord[],
): { jsonPath: string; markdownPath: string } {
    const graph = buildSemanticFlowTraceGraph({
        run: {
            runId: `semanticflow:${path.basename(options.repo)}:${Date.now()}`,
            project: options.repo,
            engineVersion: "arktaint",
            assetVersion: "semanticflow",
            configHash: `semanticflow:${aggregate.summary.itemCount}:${aggregate.summary.assetCount}`,
            llmSession: options.llmSessionCacheDir,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            status: sourceRuns.some(run => run.status === "exception") ? "completed_with_errors" : "completed",
            notes: [
                `sourceDirs=${sourceRuns.length}`,
                `items=${aggregate.summary.itemCount}`,
                `assets=${aggregate.summary.assetCount}`,
            ],
        },
        items: aggregate.items,
        assets: aggregate.augment.assets,
        publishedModel: {
            modelRoot: aggregatePaths.generatedModelRoot,
            projectId: aggregatePaths.generatedModelProjectId,
            paths: aggregatePaths.generatedModelPublishResult,
            assets: aggregatePaths.generatedModelPublishedAssets,
        },
        sourceRuns,
        summary: aggregate.summary,
    });
    return writeTraceGraphArtifacts(path.join(rootDir, "semanticflow_trace_graph"), graph);
}

function readPublishedSemanticFlowAssets(paths: PublishSemanticFlowProjectAssetsResult): AssetDocumentBase[] {
    const assets: AssetDocumentBase[] = [];
    for (const filePath of [paths.rulePath, paths.modulePath, paths.arkMainPath]) {
        if (!filePath || !fs.existsSync(filePath)) continue;
        assets.push(JSON.parse(fs.readFileSync(filePath, "utf-8")) as AssetDocumentBase);
    }
    return assets;
}

function mergeSemanticFlowTraceIntoFinalAnalyze(
    finalRun: Awaited<ReturnType<typeof runAnalyze>>,
    semanticFlowTracePath: string,
): { jsonPath?: string; markdownPath?: string; merged: boolean } {
    if (!fs.existsSync(semanticFlowTracePath)) {
        return { merged: false };
    }
    const finalRoot = path.resolve(path.dirname(path.dirname(finalRun.jsonPath)));
    const finalTraceDir = path.join(finalRoot, "audit", "trace_graph");
    const finalTracePath = path.join(finalTraceDir, "full_trace_graph.json");
    if (!fs.existsSync(finalTracePath)) {
        return { merged: false };
    }
    const runtimeGraph = JSON.parse(fs.readFileSync(finalTracePath, "utf-8")) as TraceGraph;
    const semanticGraph = JSON.parse(fs.readFileSync(semanticFlowTracePath, "utf-8")) as TraceGraph;
    const merged = appendTraceGraphFragments(runtimeGraph, [
        { graph: semanticGraph, prefix: "semanticflow" },
    ]);
    const written = writeTraceGraphArtifacts(finalTraceDir, merged);
    return { ...written, merged: true };
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
        flowMode: overrides.flowMode || "postsolve",
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
        semanticflowEvaluationModelRoots: overrides.semanticflowEvaluationModelRoots,
        enabledModels: overrides.enabledModels || options.enabledModels || [],
        disabledModels: overrides.disabledModels || options.disabledModels || [],
        disabledModuleIds: overrides.disabledModuleIds || [],
        pluginPaths: overrides.pluginPaths || [],
        disabledPluginNames: overrides.disabledPluginNames || [],
        pluginIsolate: overrides.pluginIsolate || [],
        pluginDryRun: overrides.pluginDryRun || false,
        pluginAudit: overrides.pluginAudit || false,
        ruleOptions: {
            autoDiscoverRuleSources: true,
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
            autoDiscoverRuleSources: true,
            ruleCatalogPath: options.modelRoots?.[0],
            ruleCatalogPaths: options.modelRoots,
        },
    })));
    const feedbackDir = path.join(phase1OutputDir, "feedback", "rule_feedback");
    const apiModelingCandidatePath = path.join(feedbackDir, "api_modeling_candidates.json");
    const selected = selectBootstrapRuleInput(apiModelingCandidatePath);
    console.log(
        `semanticflow_phase=bootstrap_analyze done rule_input=${selected.path} `
        + `selection=${selected.selection} api_modeling_candidates=${selected.apiModelingCandidateCount ?? ""} `
        + `candidate_scanner_gap=${selected.selection === "candidate_scanner_gap" ? "true" : "false"}`,
    );
    return {
        ruleInputPath: selected.path,
        run,
    };
}

function selectBootstrapRuleInput(
    apiModelingCandidatePath: string,
): {
    path: string;
    selection: "api_modeling_candidates" | "candidate_scanner_gap" | "missing";
    apiModelingCandidateCount: number | null;
} {
    const apiModelingCandidateCount = readCandidatePayloadCount(apiModelingCandidatePath);
    if (apiModelingCandidateCount !== null && apiModelingCandidateCount > 0) {
        return {
            path: apiModelingCandidatePath,
            selection: "api_modeling_candidates",
            apiModelingCandidateCount,
        };
    }
    if (apiModelingCandidateCount !== null) {
        return {
            path: apiModelingCandidatePath,
            selection: "candidate_scanner_gap",
            apiModelingCandidateCount,
        };
    }
    return {
        path: apiModelingCandidatePath,
        selection: "missing",
        apiModelingCandidateCount,
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

function hasGeneratedSemanticFlowEvaluationAssets(summary: ReturnType<typeof collectAggregateSummary>["summary"]): boolean {
    return summary.assetCount > 0;
}

function canReuseBootstrapAnalyzeForFinal(
    options: SemanticFlowCliOptions,
    aggregate: ReturnType<typeof collectAggregateSummary>,
    bootstrap?: BootstrapAnalyzeResult,
): bootstrap is BootstrapAnalyzeResult & { run: Awaited<ReturnType<typeof runAnalyze>> } {
    return !!bootstrap?.run
        && !options.publishModel
        && !hasGeneratedSemanticFlowEvaluationAssets(aggregate.summary);
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
    const evaluationRoots = options.publishModel ? [] : [aggregatePaths.generatedModelRoot];
    console.log(
        `semanticflow_phase=final_analyze start output_dir=${finalOutputDir} `
        + `evaluation_overlay=${evaluationRoots.length > 0 ? "semanticflow-evaluation" : "none"}`,
    );
    return withAnalyzeHeartbeat("final_analyze", () => runAnalyze(buildAnalyzeOptions(options, finalOutputDir, {
        profile: options.profile,
        reportMode: options.reportMode,
        llmModel: options.model,
        arkMainMaxCandidates: arkMainCandidateLimit,
        modelRoots: [
            aggregatePaths.generatedModelRoot,
            ...(options.modelRoots || []),
        ],
        semanticflowEvaluationModelRoots: evaluationRoots,
        ...(options.publishModel
            ? {
                enabledModels: [...new Set([...(options.enabledModels || []), options.publishModel])],
                disabledModels: options.disabledModels || [],
                ruleOptions: {
                    autoDiscoverRuleSources: true,
                    ruleCatalogPath: options.modelRoots?.[0],
                    ruleCatalogPaths: options.modelRoots,
                },
            }
            : {
                enabledModels: [...new Set([...(options.enabledModels || []), aggregatePaths.generatedModelProjectId])],
                disabledModels: options.disabledModels || [],
                ruleOptions: {
                    autoDiscoverRuleSources: true,
                    ruleCatalogPath: aggregatePaths.generatedModelRoot,
                    ruleCatalogPaths: [
                        aggregatePaths.generatedModelRoot,
                        ...(options.modelRoots || []),
                    ],
                },
            }),
    })));
}

function buildSemanticFlowEvaluationOverlayInfo(
    aggregateSummary: ReturnType<typeof collectAggregateSummary>,
    aggregatePaths: {
        generatedModelRoot: string;
        generatedModelProjectId: string;
    },
    applied: boolean,
): SemanticFlowEvaluationOverlayInfo {
    return {
        applied,
        modelRoot: applied ? aggregatePaths.generatedModelRoot : undefined,
        projectId: applied ? aggregatePaths.generatedModelProjectId : undefined,
        assetCount: aggregateSummary.summary.assetCount,
        assetCountByPlane: { ...aggregateSummary.summary.assetCountByPlane },
        loadMode: applied ? "semanticflow-evaluation" : undefined,
        promoted: false,
    };
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
        semanticFlowTraceGraphPath: string;
        progressJsonlPath: string;
        finalSummaryJsonPath?: string;
        finalSummaryMdPath?: string;
        semanticflowEvaluationOverlay?: SemanticFlowEvaluationOverlayInfo;
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
            semanticFlowTraceGraph: relative(info.semanticFlowTraceGraphPath),
            progressJsonl: relative(info.progressJsonlPath),
            finalSummaryJson: relative(info.finalSummaryJsonPath),
            finalSummaryMd: relative(info.finalSummaryMdPath),
        },
        semanticflowEvaluationOverlay: info.semanticflowEvaluationOverlay,
    }, null, 2), "utf-8");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    await runSemanticFlowCli(options);
}

export async function runSemanticFlowCli(options: SemanticFlowCliOptions): Promise<void> {
    options = {
        ...options,
        maxLlmItems: resolveEffectiveSemanticFlowMaxLlmItems(options.maxLlmItems),
        llmRepairAttempts: resolveEffectiveSemanticFlowLlmRepairAttempts(options.llmRepairAttempts),
    };
    const progress = createSemanticFlowProgressRecorder(options.outputDir);
    progress.write("start", {
        repo: options.repo,
        sourceDirs: options.sourceDirs,
        maxLlmItems: options.maxLlmItems,
        analyze: options.analyze,
    });
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
    progress.write("bootstrap_analyze_start", {});
    const bootstrapAnalyze: BootstrapAnalyzeResult = options.ruleInput && fs.existsSync(options.ruleInput)
        ? { ruleInputPath: options.ruleInput }
        : await runBootstrapAnalyze(options);
    const bootstrapRuleInputPath = bootstrapAnalyze.ruleInputPath;
    const ruleCandidates = loadRuleCandidates(options, bootstrapRuleInputPath);
    progress.write("load_candidates_done", {
        ruleCandidates: ruleCandidates.items.length,
        ruleKnownCovered: ruleCandidates.skippedKnown,
        arkMainLimit: arkMainCandidateLimit,
    });
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
            progress.write("source_dir_start", { sourceDir, absPath: sourceAbs });
            console.log(`semanticflow_phase=source_dir start source_dir=${sourceDir} abs=${sourceAbs}`);
            console.log(`semanticflow_phase=build_scene start source_dir=${sourceDir}`);
            progress.write("build_scene_start", { sourceDir });
            const scene = buildScene(sourceAbs);
            const methodCount = scene.getMethods().length;
            console.log(`semanticflow_phase=build_scene done source_dir=${sourceDir} methods=${methodCount}`);
            progress.write("build_scene_done", { sourceDir, methods: methodCount });
            const sourceDirModelInvoker = createLoggedModelInvoker(invoker, {
                maxFailures: options.llmMaxFailures,
            });
            const ruleBatchPlan = buildRuleCandidateBatchPlanForSourceDir(
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
            if (ruleBatchPlan.scoped.length !== ruleCandidates.items.length) {
                console.log(`semanticflow_phase=source_dir candidates source_dir=${sourceDir} scoped=${ruleBatchPlan.scoped.length} global=${ruleCandidates.items.length} batch_items=${options.maxLlmItems ?? ""} batches=${ruleBatchPlan.batches.length} need_more_evidence=${ruleBatchPlan.queue.needMoreEvidence.length}`);
            }
            progress.write("source_dir_candidates", {
                sourceDir,
                scoped: ruleBatchPlan.scoped.length,
                global: ruleCandidates.items.length,
                selected: ruleBatchPlan.queue.selected.length,
                batches: ruleBatchPlan.batches.length,
                batchItems: options.maxLlmItems,
                needMoreEvidence: ruleBatchPlan.queue.needMoreEvidence.length,
            });
            if (ruleBatchPlan.batches.length === 0 && ruleBatchPlan.queue.needMoreEvidence.length > 0) {
                console.log(`semanticflow_phase=source_dir no_modelable_candidates source_dir=${sourceDir} need_more_evidence=${ruleBatchPlan.queue.needMoreEvidence.length}`);
                progress.write("source_dir_no_modelable_candidates", {
                    sourceDir,
                    needMoreEvidence: ruleBatchPlan.queue.needMoreEvidence.length,
                });
            }
            let totalItems = 0;
            let totalArkMainCandidates = 0;
            let totalArkMainIneligible = 0;
            for (const batch of ruleBatchPlan.batches.length
                ? ruleBatchPlan.batches
                : [{ index: 0, candidates: [] } as SemanticFlowRuleCandidateBatch]) {
                const includeArkMainCandidates = batch.index === 0;
                console.log(`semanticflow_phase=source_dir batch_start source_dir=${sourceDir} batch=${batch.index + 1}/${Math.max(1, ruleBatchPlan.batches.length)} rule_candidates=${batch.candidates.length} include_arkmain=${includeArkMainCandidates}`);
                progress.write("source_dir_batch_start", {
                    sourceDir,
                    batch: batch.index + 1,
                    batchCount: Math.max(1, ruleBatchPlan.batches.length),
                    ruleCandidates: batch.candidates.length,
                    includeArkMainCandidates,
                });
                const result = await runSemanticFlowProject({
                    scene,
                    modelInvoker: sourceDirModelInvoker,
                    model: profile.model,
                    ruleCandidates: batch.candidates,
                    ruleCompanionCandidates: sourceRuleCompanionCandidates,
                    includeArkMainCandidates,
                    arkMainMaxCandidates: arkMainCandidateLimit,
                    maxRounds: options.maxRounds,
                    maxRepairAttempts: options.llmRepairAttempts ?? 0,
                    concurrency: options.concurrency,
                    onProgress: event => {
                        emitSemanticFlowProgress(event);
                        progress.write("session_progress", {
                            sourceDir,
                            batch: batch.index + 1,
                            ...event,
                        } as Record<string, unknown>);
                    },
                    sessionCache,
                });
                console.log(
                    `semanticflow_phase=source_dir batch_done source_dir=${sourceDir} batch=${batch.index + 1}/${Math.max(1, ruleBatchPlan.batches.length)} items=${result.session.run.items.length} arkmain_candidates=${result.arkMainCandidates.length} arkmain_kernel_covered=${result.skippedArkMainCandidates.length} arkmain_ineligible=${result.ineligibleArkMainCandidates.length}`,
                );
                progress.write("source_dir_batch_done", {
                    sourceDir,
                    batch: batch.index + 1,
                    batchCount: Math.max(1, ruleBatchPlan.batches.length),
                    items: result.session.run.items.length,
                    arkMainCandidates: result.arkMainCandidates.length,
                    arkMainKernelCovered: result.skippedArkMainCandidates.length,
                    arkMainIneligible: result.ineligibleArkMainCandidates.length,
                });
                totalItems += result.session.run.items.length;
                totalArkMainCandidates += result.arkMainCandidates.length;
                totalArkMainIneligible += result.ineligibleArkMainCandidates.length;
                bundles.push({
                    sourceDir,
                    artifactName: ruleBatchPlan.batches.length > 1
                        ? `${sourceDir}#batch-${batch.index + 1}`
                        : sourceDir,
                    result,
                    skippedKnownRuleCandidates: batch.index === 0 ? ruleCandidates.skippedKnown : 0,
                });
            }
            console.log(
                `semanticflow_phase=source_dir done source_dir=${sourceDir} batches=${Math.max(1, ruleBatchPlan.batches.length)} items=${totalItems} rule_known_covered=${ruleCandidates.skippedKnown} arkmain_candidates=${totalArkMainCandidates} arkmain_ineligible=${totalArkMainIneligible}`,
            );
            progress.write("source_dir_done", {
                sourceDir,
                batches: Math.max(1, ruleBatchPlan.batches.length),
                items: totalItems,
                ruleKnownCovered: ruleCandidates.skippedKnown,
                arkMainCandidates: totalArkMainCandidates,
                arkMainIneligible: totalArkMainIneligible,
                elapsedMs: Date.now() - sourceStartedAt,
            });
            sourceRuns.push({
                sourceDir,
                absPath: sourceAbs,
                status: "ok",
                methods: methodCount,
                itemCount: totalItems,
                ruleCandidateCount: ruleBatchPlan.queue.selected.length,
                ruleBatchCount: Math.max(1, ruleBatchPlan.batches.length),
                ruleCandidatePackagingTrace: ruleCandidates.packagingTrace,
                arkMainCandidateCount: totalArkMainCandidates,
                arkMainIneligibleCount: totalArkMainIneligible,
                elapsedMs: Date.now() - sourceStartedAt,
            });
        } catch (error) {
            const detail = String((error as any)?.message || error).replace(/\s+/g, " ").trim();
            console.log(`semanticflow_phase=source_dir exception source_dir=${sourceDir} elapsed_ms=${Date.now() - sourceStartedAt} error=${detail}`);
            progress.write("source_dir_exception", {
                sourceDir,
                elapsedMs: Date.now() - sourceStartedAt,
                error: detail,
            });
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
    const aggregateSummary = collectAggregateSummary(bundles);
    const semanticFlowTraceArtifacts = writeSemanticFlowTraceArtifacts(
        options.outputDir,
        options,
        aggregateSummary,
        aggregatePaths,
        sourceRuns,
    );
    progress.write("write_artifacts_done", {
        session: aggregatePaths.aggregateSessionPath,
        assets: aggregatePaths.aggregateAssetsPath,
        summary: aggregatePaths.aggregateSummaryPath,
        semanticFlowTraceGraph: semanticFlowTraceArtifacts.jsonPath,
    });
    const sourceRunsPath = path.join(options.outputDir, "source_runs.json");
    fs.writeFileSync(sourceRunsPath, JSON.stringify(sourceRuns, null, 2), "utf-8");
    console.log(`semanticflow_phase=write_artifacts done session=${aggregatePaths.aggregateSessionPath}`);
    if (options.publishModel) {
        const aggregate = aggregateSummary;
        const published = publishSemanticFlowProjectAssets({
            projectId: options.publishModel,
            modelRoot: options.modelRoots?.[0],
            assets: aggregate.augment.assets,
        });
        console.log(`semanticflow_phase=publish_model done pack=${options.publishModel} rules=${published.rulePath || "-"} modules=${published.modulePath || "-"} arkmain=${published.arkMainPath || "-"}`);
        progress.write("publish_model_done", {
            pack: options.publishModel,
            rulePath: published.rulePath,
            modulePath: published.modulePath,
            arkMainPath: published.arkMainPath,
        });
    }
    let finalRun: Awaited<ReturnType<typeof runAnalyze>> | undefined;
    let semanticflowEvaluationOverlay = buildSemanticFlowEvaluationOverlayInfo(
        aggregateSummary,
        aggregatePaths,
        false,
    );
    if (options.analyze) {
        if (canReuseBootstrapAnalyzeForFinal(options, aggregateSummary, bootstrapAnalyze)) {
            finalRun = materializeReusedFinalAnalyzeArtifacts(options.outputDir, bootstrapAnalyze.run);
            console.log(`semanticflow_phase=final_analyze skipped reason=no_modeled_artifacts reuse=bootstrap summary_json=${finalRun.jsonPath}`);
            progress.write("final_analyze_skipped", {
                reason: "no_modeled_artifacts",
                summaryJson: finalRun.jsonPath,
            });
        } else {
            progress.write("final_analyze_start", {});
            finalRun = await runFinalAnalyze(options, aggregatePaths);
            semanticflowEvaluationOverlay = buildSemanticFlowEvaluationOverlayInfo(
                aggregateSummary,
                aggregatePaths,
                !options.publishModel,
            );
        }
    }
    if (finalRun) {
        const mergedTrace = mergeSemanticFlowTraceIntoFinalAnalyze(finalRun, semanticFlowTraceArtifacts.jsonPath);
        console.log(`semanticflow_phase=final_analyze done summary_json=${finalRun.jsonPath}`);
        progress.write("final_analyze_done", {
            summaryJson: finalRun.jsonPath,
            semanticFlowTraceGraphMerged: mergedTrace.merged,
            traceGraphJson: mergedTrace.jsonPath,
        });
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
            progressJsonlPath: progress.path,
            semanticFlowTraceGraphPath: semanticFlowTraceArtifacts.jsonPath,
            semanticflowEvaluationOverlay,
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
            progressJsonlPath: progress.path,
            semanticFlowTraceGraphPath: semanticFlowTraceArtifacts.jsonPath,
            semanticflowEvaluationOverlay,
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
        semanticFlowTraceGraphPath: semanticFlowTraceArtifacts.jsonPath,
        finalSummaryJsonPath: finalRun?.jsonPath,
        finalSummaryMdPath: finalRun?.mdPath,
        semanticflowEvaluationOverlay,
        progressJsonlPath: progress.path,
    });
    progress.write("complete", {
        finalSummaryJson: finalRun?.jsonPath,
        aggregateSummary: aggregatePaths.aggregateSummaryPath,
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

export function resolveEffectiveSemanticFlowMaxLlmItems(value: number | undefined): number {
    if (value === undefined) {
        return DEFAULT_SEMANTICFLOW_MAX_LLM_ITEMS;
    }
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`invalid semanticflow maxLlmItems: ${value}`);
    }
    return Math.floor(value);
}

export function resolveEffectiveSemanticFlowLlmRepairAttempts(value: number | undefined): number {
    if (value === undefined) {
        return DEFAULT_SEMANTICFLOW_LLM_REPAIR_ATTEMPTS;
    }
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`invalid semanticflow llmRepairAttempts: ${value}`);
    }
    return Math.floor(value);
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
