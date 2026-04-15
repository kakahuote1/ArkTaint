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
    serializeSemanticFlowArkMain,
    serializeSemanticFlowModules,
    serializeSemanticFlowSession,
} from "../core/semanticflow/SemanticFlowSerialize";
import { publishSemanticFlowProjectAssets } from "../core/semanticflow/SemanticFlowProjectAssets";
import {
    SemanticFlowSessionCache,
    normalizeSemanticFlowSessionCacheMode,
    resolveDefaultSemanticFlowSessionCacheDir,
    type SemanticFlowSessionCacheEvent,
    type SemanticFlowSessionCacheMode,
    type SemanticFlowSessionCacheStats,
} from "../core/semanticflow/SemanticFlowSessionCache";
import { createSemanticFlowModelInvokerFromConfig } from "./semanticflowLlmClient";
import { resolveLlmProfile } from "./llmConfig";
import { runAnalyze } from "./analyzeRunner";
import type { AnalyzeProfile, CliOptions, ReportMode } from "./analyzeCliOptions";
import type { SemanticFlowProgressEvent } from "../core/semanticflow/SemanticFlowPipeline";
import { filterKnownSemanticFlowRuleCandidates } from "./semanticflowKnownRuleCandidates";

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
    llmSessionCacheDir?: string;
    llmSessionCacheMode?: SemanticFlowSessionCacheMode;
    profile: AnalyzeProfile;
    reportMode: ReportMode;
    maxEntries: number;
    k: number;
    stopOnFirstFlow: boolean;
    maxFlowsPerEntry?: number;
}

interface SemanticFlowSessionBundle {
    sourceDir: string;
    skippedKnownRuleCandidates: number;
    result: Awaited<ReturnType<typeof runSemanticFlowProject>>;
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
    console.log(`semanticflow_progress=item_done index=${event.index}/${event.totalItems} anchor=${event.anchorId} resolution=${event.resolution} classification=${event.classification || ""}`);
}

function emitSemanticFlowCacheEvent(event: SemanticFlowSessionCacheEvent): void {
    if (event.cache === "decision") {
        console.log(`semanticflow_llm_cache=${event.outcome} anchor=${event.anchorId} round=${event.round} key_prefix=${event.keyPrefix}`);
        return;
    }
    console.log(`semanticflow_item_cache=${event.outcome} anchor=${event.anchorId} key_prefix=${event.keyPrefix}`);
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
    let llmSessionCacheDir: string | undefined;
    let llmSessionCacheMode: SemanticFlowSessionCacheMode | undefined;
    let profile: AnalyzeProfile = "default";
    let reportMode: ReportMode = "light";
    let maxEntries = 12;
    let k = 1;
    let stopOnFirstFlow = false;
    let maxFlowsPerEntry: number | undefined;

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
        const cacheDirArg = readValue(argv, i, "--llmSessionCacheDir");
        if (cacheDirArg !== undefined) {
            llmSessionCacheDir = path.resolve(cacheDirArg);
            if (argv[i] === "--llmSessionCacheDir") i++;
            continue;
        }
        const cacheModeArg = readValue(argv, i, "--llmSessionCacheMode");
        if (cacheModeArg !== undefined) {
            llmSessionCacheMode = normalizeSemanticFlowSessionCacheMode(cacheModeArg);
            if (argv[i] === "--llmSessionCacheMode") i++;
            continue;
        }
        const profileArg = readValue(argv, i, "--profile");
        if (profileArg !== undefined) {
            profile = parseProfile(profileArg);
            if (argv[i] === "--profile") i++;
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
        if (argv[i].startsWith("--")) {
            throw new Error(`unknown option: ${argv[i]}`);
        }
    }

    if (!repo) {
        throw new Error("missing --repo");
    }
    if (sourceDirs.length === 0) {
        const auto = ["entry/src/main/ets", "src/main/ets", "."];
        sourceDirs = auto.filter(rel => fs.existsSync(path.resolve(repo, rel)));
    }
    if (sourceDirs.length === 0) {
        throw new Error("no sourceDir found; pass --sourceDir");
    }

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
        llmSessionCacheDir: llmSessionCacheDir || resolveDefaultSemanticFlowSessionCacheDir(repo),
        llmSessionCacheMode: llmSessionCacheMode || "rw",
        profile,
        reportMode,
        maxEntries,
        k,
        stopOnFirstFlow,
        maxFlowsPerEntry,
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
): NonNullable<ReturnType<typeof createSemanticFlowModelInvokerFromConfig>> {
    let requestSeq = 0;
    return async input => {
        const requestId = ++requestSeq;
        const startedAt = Date.now();
        console.log(`semanticflow_llm=request_start id=${requestId} model=${input.model || "-"}`);
        try {
            const raw = await invoker(input);
            const elapsedMs = Date.now() - startedAt;
            console.log(`semanticflow_llm=request_done id=${requestId} elapsed_ms=${elapsedMs} chars=${String(raw || "").length}`);
            return raw;
        } catch (error) {
            const elapsedMs = Date.now() - startedAt;
            const detail = String((error as any)?.message || error).replace(/\s+/g, " ").trim();
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
    const filtered = filterKnownSemanticFlowRuleCandidates(items as NormalizedCallsiteItem[], {
        modelRoots: options.modelRoots,
        enabledModels: options.enabledModels,
        disabledModels: options.disabledModels,
    });
    return {
        items: enrichNoCandidateItemsWithCallsiteSlices({
            repoRoot: options.repo,
            sourceDirs: options.sourceDirs,
            items: filtered.candidates,
            maxItems: options.maxSliceItems,
            maxExamplesPerItem: options.examplesPerItem,
            contextRadius: options.contextRadius,
            cfgNeighborRadius: options.cfgNeighborRadius,
        }),
        skippedKnown: filtered.skippedKnown.length,
    };
}

function collectAggregateSummary(
    bundles: SemanticFlowSessionBundle[],
    cacheStats?: SemanticFlowSessionCacheStats,
) {
    const items = bundles.flatMap(bundle => bundle.result.session.run.items);
    const classifications: Record<string, number> = {};
    for (const item of items) {
        const key = item.classification || item.resolution;
        classifications[key] = (classifications[key] || 0) + 1;
    }
    const augment = mergeSemanticFlowAnalysisAugments(bundles.map(bundle => bundle.result.session.augment));
    return {
        items,
        augment,
        engineAugment: buildSemanticFlowEngineAugment(augment),
        summary: {
            itemCount: items.length,
            classifications,
            ruleCandidateCount: bundles.reduce((sum, bundle) => sum + bundle.result.ruleCandidateCount, 0),
            ruleKnownCoveredCount: bundles.reduce((sum, bundle) => sum + bundle.skippedKnownRuleCandidates, 0),
            arkMainCandidateCount: bundles.reduce((sum, bundle) => sum + bundle.result.arkMainCandidates.length, 0),
            arkMainKernelCoveredCount: bundles.reduce((sum, bundle) => sum + bundle.result.skippedArkMainCandidates.length, 0),
            moduleCount: augment.moduleSpecs.length,
            sourceRuleCount: (augment.ruleSet.sources || []).length,
            sinkRuleCount: (augment.ruleSet.sinks || []).length,
            sanitizerRuleCount: (augment.ruleSet.sanitizers || []).length,
            transferRuleCount: (augment.ruleSet.transfers || []).length,
            arkMainSpecCount: augment.arkMainSpecs.length,
            llmCacheHitCount: cacheStats?.llmCacheHitCount || 0,
            llmCacheMissCount: cacheStats?.llmCacheMissCount || 0,
            llmCacheWriteCount: cacheStats?.llmCacheWriteCount || 0,
            itemCacheHitCount: cacheStats?.itemCacheHitCount || 0,
        },
    };
}

function writeSemanticFlowArtifacts(
    rootDir: string,
    bundles: SemanticFlowSessionBundle[],
    cacheStats?: SemanticFlowSessionCacheStats,
): {
    aggregateSessionPath: string;
    aggregateRulePath: string;
    aggregateModulePath: string;
    aggregateArkMainPath: string;
    aggregateSummaryPath: string;
} {
    const aggregate = collectAggregateSummary(bundles, cacheStats);
    fs.mkdirSync(rootDir, { recursive: true });
    const modelingDir = path.join(rootDir, "modeling");
    fs.mkdirSync(modelingDir, { recursive: true });

    for (const bundle of bundles) {
        const base = path.join(modelingDir, safeSourceDirName(bundle.sourceDir));
        fs.mkdirSync(base, { recursive: true });
        fs.writeFileSync(path.join(base, "session.json"), JSON.stringify(serializeSemanticFlowSession(bundle.result.session), null, 2), "utf-8");
        fs.writeFileSync(path.join(base, "rules.json"), JSON.stringify(bundle.result.session.augment.ruleSet, null, 2), "utf-8");
        fs.writeFileSync(path.join(base, "modules.json"), JSON.stringify(serializeSemanticFlowModules(bundle.result.session.augment), null, 2), "utf-8");
        fs.writeFileSync(path.join(base, "arkmain.json"), JSON.stringify(serializeSemanticFlowArkMain(bundle.result.session.augment), null, 2), "utf-8");
        fs.writeFileSync(path.join(base, "summary.json"), JSON.stringify({
            itemCount: bundle.result.session.run.items.length,
            classifications: bundle.result.session.run.items.reduce((acc, item) => {
                const key = item.classification || item.resolution;
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {} as Record<string, number>),
            ruleCandidateCount: bundle.result.ruleCandidateCount,
            ruleKnownCoveredCount: bundle.skippedKnownRuleCandidates,
            arkMainCandidateCount: bundle.result.arkMainCandidates.length,
            moduleCount: bundle.result.session.augment.moduleSpecs.length,
            sourceRuleCount: (bundle.result.session.augment.ruleSet.sources || []).length,
            sinkRuleCount: (bundle.result.session.augment.ruleSet.sinks || []).length,
            sanitizerRuleCount: (bundle.result.session.augment.ruleSet.sanitizers || []).length,
            transferRuleCount: (bundle.result.session.augment.ruleSet.transfers || []).length,
            arkMainSpecCount: bundle.result.session.augment.arkMainSpecs.length,
        }, null, 2), "utf-8");
    }

    const aggregateSessionPath = path.join(rootDir, "session.json");
    const aggregateRulePath = path.join(rootDir, "rules.json");
    const aggregateModulePath = path.join(rootDir, "modules.json");
    const aggregateArkMainPath = path.join(rootDir, "arkmain.json");
    const aggregateSummaryPath = path.join(rootDir, "summary.json");

    fs.writeFileSync(aggregateSessionPath, JSON.stringify(serializeSemanticFlowSession({
        run: { items: aggregate.items },
        augment: aggregate.augment,
        engineAugment: aggregate.engineAugment,
    }), null, 2), "utf-8");
    fs.writeFileSync(aggregateRulePath, JSON.stringify(aggregate.augment.ruleSet, null, 2), "utf-8");
    fs.writeFileSync(aggregateModulePath, JSON.stringify(serializeSemanticFlowModules(aggregate.augment), null, 2), "utf-8");
    fs.writeFileSync(aggregateArkMainPath, JSON.stringify(serializeSemanticFlowArkMain(aggregate.augment), null, 2), "utf-8");
    fs.writeFileSync(aggregateSummaryPath, JSON.stringify(aggregate.summary, null, 2), "utf-8");

    return {
        aggregateSessionPath,
        aggregateRulePath,
        aggregateModulePath,
        aggregateArkMainPath,
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
        reportMode: overrides.reportMode || options.reportMode,
        k: overrides.k ?? options.k,
        maxEntries: overrides.maxEntries ?? options.maxEntries,
        outputDir,
        concurrency: overrides.concurrency ?? options.concurrency,
        incremental: true,
        incrementalCachePath: undefined,
        showLoadWarnings: false,
        stopOnFirstFlow: overrides.stopOnFirstFlow ?? options.stopOnFirstFlow,
        maxFlowsPerEntry: overrides.maxFlowsPerEntry ?? options.maxFlowsPerEntry,
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
        moduleSpecFiles: overrides.moduleSpecFiles || [],
        enabledModels: overrides.enabledModels || options.enabledModels || [],
        disabledModels: overrides.disabledModels || options.disabledModels || [],
        disabledModuleIds: overrides.disabledModuleIds || [],
        arkMainSpecFiles: overrides.arkMainSpecFiles || [],
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

async function runBootstrapAnalyze(options: SemanticFlowCliOptions): Promise<string> {
    const phase1OutputDir = path.join(options.outputDir, "phase1");
    console.log(`semanticflow_phase=bootstrap_analyze start output_dir=${phase1OutputDir}`);
    await withAnalyzeHeartbeat("bootstrap_analyze", () => runAnalyze(buildAnalyzeOptions(options, phase1OutputDir, {
        profile: "fast",
        reportMode: "light",
        maxEntries: Math.max(options.maxEntries, 12),
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
    const ruleInputPath = path.join(phase1OutputDir, "feedback", "rule_feedback", "no_candidate_callsites.json");
    console.log(`semanticflow_phase=bootstrap_analyze done rule_input=${ruleInputPath}`);
    return ruleInputPath;
}

async function runFinalAnalyze(
    options: SemanticFlowCliOptions,
    aggregatePaths: {
        aggregateRulePath: string;
        aggregateModulePath: string;
        aggregateArkMainPath: string;
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
        modelRoots: options.modelRoots || [],
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
                moduleSpecFiles: [aggregatePaths.aggregateModulePath],
                arkMainSpecFiles: [aggregatePaths.aggregateArkMainPath],
                ruleOptions: {
                    autoDiscoverLayers: true,
                    ruleCatalogPath: options.modelRoots?.[0],
                    ruleCatalogPaths: options.modelRoots,
                    candidateRulePath: aggregatePaths.aggregateRulePath,
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
        bootstrapRuleInputPath: string;
        aggregateSessionPath: string;
        aggregateRulePath: string;
        aggregateModulePath: string;
        aggregateArkMainPath: string;
        aggregateSummaryPath: string;
        finalSummaryJsonPath?: string;
        finalSummaryMdPath?: string;
        cacheDir: string;
        cacheMode: SemanticFlowSessionCacheMode;
        cacheStats: SemanticFlowSessionCacheStats;
    },
): void {
    const relative = (targetPath?: string) => targetPath ? path.relative(outputDir, targetPath).replace(/\\/g, "/") : undefined;
    const payload = {
        schemaVersion: 1,
        runKind: "semanticflow",
        generatedAt: new Date().toISOString(),
        repo: options.repo,
        sourceDirs: options.sourceDirs,
        profile: {
            llmConfigPath: info.llmConfigPath,
            llmProfile: info.llmProfile,
            llmModel: info.llmModel,
        },
        llmSessionCache: {
            dir: relative(info.cacheDir),
            mode: info.cacheMode,
            ...info.cacheStats,
        },
        paths: {
            phase1RuleInput: relative(info.bootstrapRuleInputPath),
            session: relative(info.aggregateSessionPath),
            rules: relative(info.aggregateRulePath),
            modules: relative(info.aggregateModulePath),
            arkmain: relative(info.aggregateArkMainPath),
            summary: relative(info.aggregateSummaryPath),
            finalSummaryJson: relative(info.finalSummaryJsonPath),
            finalSummaryMd: relative(info.finalSummaryMdPath),
        },
    };
    fs.writeFileSync(path.join(outputDir, "run.json"), JSON.stringify(payload, null, 2), "utf-8");
    writeSemanticFlowSummaryRunManifest(outputDir, payload);
}

function writeSemanticFlowSummaryRunManifest(outputDir: string, payload: Record<string, unknown>): void {
    const summaryDir = path.join(outputDir, "summary");
    fs.mkdirSync(summaryDir, { recursive: true });
    fs.writeFileSync(path.join(summaryDir, "run.json"), JSON.stringify(payload, null, 2), "utf-8");
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
        maxAttempts: 2,
    });
    if (!invoker) {
        throw new Error("semanticflow model invoker unavailable; check llm profile configuration");
    }

    const loggedInvoker = createLoggedModelInvoker(invoker);
    const cacheDir = options.llmSessionCacheDir || resolveDefaultSemanticFlowSessionCacheDir(options.repo);
    const cacheMode = options.llmSessionCacheMode || "rw";
    const sessionCache = new SemanticFlowSessionCache({
        rootDir: cacheDir,
        mode: cacheMode,
        onEvent: emitSemanticFlowCacheEvent,
    });

    const arkMainCandidateLimit = resolveArkMainCandidateLimit(options);
    const bootstrapRuleInputPath = options.ruleInput && fs.existsSync(options.ruleInput)
        ? options.ruleInput
        : await runBootstrapAnalyze(options);
    const ruleCandidates = loadRuleCandidates(options, bootstrapRuleInputPath);
    console.log(`semanticflow_phase=load_candidates done rule_candidates=${ruleCandidates.items.length} rule_known_covered=${ruleCandidates.skippedKnown} arkmain_limit=${arkMainCandidateLimit} min_interval_ms=${profile.minIntervalMs}`);
    console.log(`semanticflow_cache_dir=${cacheDir}`);
    console.log(`semanticflow_cache_mode=${cacheMode}`);

    const bundles: SemanticFlowSessionBundle[] = [];
    for (const sourceDir of options.sourceDirs) {
        const sourceAbs = path.resolve(options.repo, sourceDir);
        if (!fs.existsSync(sourceAbs)) {
            continue;
        }
        console.log(`semanticflow_phase=source_dir start source_dir=${sourceDir} abs=${sourceAbs}`);
        console.log(`semanticflow_phase=build_scene start source_dir=${sourceDir}`);
        const scene = buildScene(sourceAbs);
        console.log(`semanticflow_phase=build_scene done source_dir=${sourceDir} methods=${scene.getMethods().length}`);
        const result = await runSemanticFlowProject({
            scene,
            modelInvoker: loggedInvoker,
            model: profile.model,
            ruleCandidates: ruleCandidates.items,
            includeArkMainCandidates: true,
            arkMainMaxCandidates: arkMainCandidateLimit,
            maxRounds: options.maxRounds,
            concurrency: options.concurrency,
            sessionCache,
            onProgress: emitSemanticFlowProgress,
        });
        console.log(
            `semanticflow_phase=source_dir done source_dir=${sourceDir} items=${result.session.run.items.length} rule_known_covered=${ruleCandidates.skippedKnown} arkmain_candidates=${result.arkMainCandidates.length} arkmain_kernel_covered=${result.skippedArkMainCandidates.length}`,
        );
        bundles.push({ sourceDir, result, skippedKnownRuleCandidates: ruleCandidates.skippedKnown });
    }

    const cacheStats = sessionCache.getStats();
    const aggregatePaths = writeSemanticFlowArtifacts(options.outputDir, bundles, cacheStats);
    console.log(`semanticflow_phase=write_artifacts done session=${aggregatePaths.aggregateSessionPath}`);
    if (options.publishModel) {
        const aggregate = collectAggregateSummary(bundles, cacheStats);
        const published = publishSemanticFlowProjectAssets({
            projectId: options.publishModel,
            modelRoot: options.modelRoots?.[0],
            ruleSet: aggregate.augment.ruleSet,
            moduleDocument: serializeSemanticFlowModules(aggregate.augment),
            arkMainDocument: serializeSemanticFlowArkMain(aggregate.augment),
        });
        console.log(`semanticflow_phase=publish_model done pack=${options.publishModel} rules=${published.rulePath || "-"} modules=${published.moduleSpecPath || "-"} arkmain=${published.arkMainSpecPath || "-"}`);
    }
    const finalRun = options.analyze
        ? await runFinalAnalyze(options, aggregatePaths)
        : undefined;
    if (finalRun) {
        console.log(`semanticflow_phase=final_analyze done summary_json=${finalRun.jsonPath}`);
    }

    const aggregateSummary = collectAggregateSummary(bundles, cacheStats);
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
        }
        : {
            itemCount: aggregateSummary.summary.itemCount,
            classifications: aggregateSummary.summary.classifications,
            llmCacheHitCount: cacheStats.llmCacheHitCount,
            llmCacheMissCount: cacheStats.llmCacheMissCount,
            llmCacheWriteCount: cacheStats.llmCacheWriteCount,
            itemCacheHitCount: cacheStats.itemCacheHitCount,
            modeled: true,
            finalAnalyze: false,
        }, null, 2), "utf-8");

    writeSemanticFlowRunManifest(options.outputDir, options, {
        llmConfigPath: profile.configPath,
        llmProfile: profile.profileName,
        llmModel: profile.model,
        bootstrapRuleInputPath,
        ...aggregatePaths,
        finalSummaryJsonPath: finalRun?.jsonPath,
        finalSummaryMdPath: finalRun?.mdPath,
        cacheDir,
        cacheMode,
        cacheStats,
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
    console.log(`llm_cache_hits=${cacheStats.llmCacheHitCount}`);
    console.log(`llm_cache_misses=${cacheStats.llmCacheMissCount}`);
    console.log(`llm_cache_writes=${cacheStats.llmCacheWriteCount}`);
    console.log(`item_cache_hits=${cacheStats.itemCacheHitCount}`);
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
