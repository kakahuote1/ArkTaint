import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { RuleHitCounters, TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { ConfigBasedTransferExecutor } from "../core/engine/ConfigBasedTransferExecutor";
import { loadRuleSet, LoadedRuleSet } from "../core/rules/RuleLoader";
import { SinkRule, SourceRule, SourceRuleKind, TransferRule } from "../core/rules/RuleSchema";
import {
    collectSeedNodes,
    detectFlows,
    EntryCandidate,
    EntrySelectionResult,
    findEntryMethod,
    getSourcePattern,
    getSourceRules,
    selectEntryCandidates,
} from "./analyzeUtils";
import { CliOptions } from "./analyzeCliOptions";
import { renderMarkdownReport } from "./analyzeReport";
import {
    accumulateRuleHitCounters,
    AnalyzeReport,
    emptyAnalyzeStageProfile,
    emptyDetectProfile,
    emptyEntryStageProfile,
    emptyRuleHitCounters,
    emptyTransferProfile,
    elapsedMsSince,
    EntryAnalyzeResult,
    toReportEntry,
} from "./analyzeTypes";
import {
    buildEntryCacheKey,
    buildRuleFingerprint,
    cloneCachedEntryResult,
    EntryFileStamp,
    IncrementalCacheEntry,
    IncrementalCacheScope,
    loadIncrementalCache,
    resolveEntryFileStamp,
    sameEntryFileStamp,
    saveIncrementalCache,
} from "./analyzeIncremental";
import * as fs from "fs";
import * as path from "path";

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) return [];
    const limit = Math.max(1, Math.min(concurrency, items.length));
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
        while (true) {
            const idx = nextIndex++;
            if (idx >= items.length) break;
            results[idx] = await fn(items[idx], idx);
        }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < limit; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
    return results;
}

function summarizeTransferNoHitReasons(
    transferProfile: EntryAnalyzeResult["transferProfile"],
    transferRuleCount: number
): string[] {
    const reasons: string[] = [];
    if (transferRuleCount <= 0) {
        reasons.push("no_transfer_rules_loaded");
        return reasons;
    }
    if (transferProfile.factCount <= 0) {
        reasons.push("no_tainted_facts");
        return reasons;
    }
    if (transferProfile.invokeSiteCount <= 0) {
        reasons.push("no_invoke_site_from_tainted_fact");
    }
    if (transferProfile.ruleCheckCount <= 0 && transferProfile.invokeSiteCount > 0) {
        reasons.push("no_candidate_rule_for_callsite");
    }
    if (transferProfile.ruleCheckCount > 0 && transferProfile.ruleMatchCount <= 0) {
        reasons.push("rule_static_match_failed");
    }
    if (transferProfile.ruleMatchCount > 0 && transferProfile.endpointMatchCount <= 0) {
        reasons.push("from_endpoint_not_tainted_or_path_mismatch");
    }
    if (transferProfile.endpointMatchCount > 0 && transferProfile.resultCount <= 0) {
        reasons.push("to_endpoint_unresolved_or_no_target_nodes");
    }
    return reasons;
}

function resolveSourceRuleEndpoint(rule: SourceRule): string {
    const kind = rule.kind
        || (rule.profile === "entry_param" ? "entry_param" : "seed_local_name") as SourceRuleKind;
    const endpoint = rule.targetRef?.endpoint || rule.target
        || (kind === "entry_param" ? "arg0"
            : kind === "call_return" ? "result"
                : kind === "call_arg" ? "arg0"
                    : kind === "field_read" ? "result"
                        : "local");
    const path = rule.targetRef?.path && rule.targetRef.path.length > 0
        ? `.${rule.targetRef.path.join(".")}`
        : "";
    return `${endpoint}${path}`;
}

function resolveSinkRuleEndpoint(rule: SinkRule): string {
    const endpoint = rule.sinkTargetRef?.endpoint || rule.sinkTarget || "any_arg";
    const path = rule.sinkTargetRef?.path && rule.sinkTargetRef.path.length > 0
        ? `.${rule.sinkTargetRef.path.join(".")}`
        : "";
    return `${endpoint}${path}`;
}

function resolveTransferRuleEndpoint(rule: TransferRule): string {
    const fromEndpoint = rule.fromRef?.endpoint || rule.from;
    const toEndpoint = rule.toRef?.endpoint || rule.to;
    const fromPath = rule.fromRef?.path && rule.fromRef.path.length > 0
        ? `.${rule.fromRef.path.join(".")}`
        : "";
    const toPath = rule.toRef?.path && rule.toRef.path.length > 0
        ? `.${rule.toRef.path.join(".")}`
        : "";
    return `${fromEndpoint}${fromPath}->${toEndpoint}${toPath}`;
}

function buildRuleEndpointHits(
    ruleHits: RuleHitCounters,
    loadedRules: LoadedRuleSet
): RuleHitCounters {
    const sourceById = new Map<string, SourceRule>();
    const sinkById = new Map<string, SinkRule>();
    const transferById = new Map<string, TransferRule>();
    for (const rule of loadedRules.ruleSet.sources || []) sourceById.set(rule.id, rule);
    for (const rule of loadedRules.ruleSet.sinks || []) sinkById.set(rule.id, rule);
    for (const rule of loadedRules.ruleSet.transfers || []) transferById.set(rule.id, rule);

    const endpointHits = emptyRuleHitCounters();
    for (const [ruleId, hit] of Object.entries(ruleHits.source)) {
        const rule = sourceById.get(ruleId);
        const endpoint = rule ? resolveSourceRuleEndpoint(rule) : `unknown:${ruleId}`;
        endpointHits.source[endpoint] = (endpointHits.source[endpoint] || 0) + hit;
    }
    for (const [ruleId, hit] of Object.entries(ruleHits.sink)) {
        const rule = sinkById.get(ruleId);
        const endpoint = rule ? resolveSinkRuleEndpoint(rule) : `unknown:${ruleId}`;
        endpointHits.sink[endpoint] = (endpointHits.sink[endpoint] || 0) + hit;
    }
    for (const [ruleId, hit] of Object.entries(ruleHits.transfer)) {
        const rule = transferById.get(ruleId);
        const endpoint = rule ? resolveTransferRuleEndpoint(rule) : `unknown:${ruleId}`;
        endpointHits.transfer[endpoint] = (endpointHits.transfer[endpoint] || 0) + hit;
    }
    return endpointHits;
}

async function analyzeEntry(
    scene: Scene,
    sourceDir: string,
    candidate: EntryCandidate,
    options: CliOptions,
    loadedRules: LoadedRuleSet,
    sharedPagEntries?: EntryCandidate[]
): Promise<EntryAnalyzeResult> {
    const t0 = process.hrtime.bigint();
    const stageProfile = emptyEntryStageProfile();
    try {
        const engine = new TaintPropagationEngine(scene, options.k, {
            transferRules: loadedRules.ruleSet.transfers || [],
            debug: {
                enableWorklistProfile: true,
            },
        });
        engine.verbose = false;
        const buildPagT0 = process.hrtime.bigint();
        if (sharedPagEntries && sharedPagEntries.length > 0) {
            await engine.buildPAGForEntries(
                sharedPagEntries.map(entry => ({
                    name: entry.name,
                    pathHint: entry.pathHint,
                }))
            );
        } else {
            await engine.buildPAG(candidate.name, candidate.pathHint);
        }
        stageProfile.buildPagMs = elapsedMsSince(buildPagT0);

        const entryMethod = findEntryMethod(scene, candidate);
        if (!entryMethod) {
            stageProfile.totalMs = elapsedMsSince(t0);
            return {
                sourceDir,
                entryName: candidate.name,
                entryPathHint: candidate.pathHint,
                score: candidate.score,
                status: "no_entry",
                seedCount: 0,
                seedLocalNames: [],
                seedStrategies: [],
                flowCount: 0,
                sinkSamples: [],
                flowRuleTraces: [],
                ruleHits: emptyRuleHitCounters(),
                ruleHitEndpoints: emptyRuleHitCounters(),
                transferProfile: emptyTransferProfile(),
                detectProfile: emptyDetectProfile(),
                stageProfile,
                transferNoHitReasons: ["no_entry_method"],
                elapsedMs: stageProfile.totalMs
            };
        }

        try {
            const reachableMethodSignatures = engine.computeReachableMethodSignatures(candidate.name, candidate.pathHint);
            engine.setActiveReachableMethodSignatures(reachableMethodSignatures);
        } catch {
            engine.setActiveReachableMethodSignatures(undefined);
        }

        if (!entryMethod.getBody()) {
            stageProfile.totalMs = elapsedMsSince(t0);
            return {
                sourceDir,
                entryName: candidate.name,
                entryPathHint: candidate.pathHint,
                score: candidate.score,
                status: "no_body",
                seedCount: 0,
                seedLocalNames: [],
                seedStrategies: [],
                flowCount: 0,
                sinkSamples: [],
                flowRuleTraces: [],
                ruleHits: emptyRuleHitCounters(),
                ruleHitEndpoints: emptyRuleHitCounters(),
                transferProfile: emptyTransferProfile(),
                detectProfile: emptyDetectProfile(),
                stageProfile,
                transferNoHitReasons: ["entry_has_no_body"],
                elapsedMs: stageProfile.totalMs
            };
        }

        let seedCount = 0;
        const seedLocalNames = new Set<string>();
        const seedStrategies = new Set<string>();
        const sourceSeedT0 = process.hrtime.bigint();
        const sourceRuleResult = engine.propagateWithSourceRules(getSourceRules(loadedRules), {
            entryMethodName: candidate.name,
            entryMethodPathHint: candidate.pathHint,
        });
        stageProfile.propagateRuleSeedMs = elapsedMsSince(sourceSeedT0);
        seedCount += sourceRuleResult.seedCount;
        for (const x of sourceRuleResult.seededLocals) seedLocalNames.add(x);
        if (sourceRuleResult.seedCount > 0) seedStrategies.add("rule:source");

        const heuristicSeedT0 = process.hrtime.bigint();
        const heuristic = collectSeedNodes(scene, engine, entryMethod, getSourcePattern(loadedRules));
        if (heuristic.nodes.length > 0) {
            engine.propagateWithSeeds(heuristic.nodes);
            seedCount += heuristic.nodes.length;
            for (const x of heuristic.localNames) seedLocalNames.add(x);
            for (const x of heuristic.strategies) seedStrategies.add(x);
        }
        stageProfile.propagateHeuristicSeedMs = elapsedMsSince(heuristicSeedT0);

        if (seedCount === 0) {
            stageProfile.totalMs = elapsedMsSince(t0);
            return {
                sourceDir,
                entryName: candidate.name,
                entryPathHint: candidate.pathHint,
                score: candidate.score,
                status: "no_seed",
                seedCount: 0,
                seedLocalNames: [],
                seedStrategies: [],
                flowCount: 0,
                sinkSamples: [],
                flowRuleTraces: [],
                ruleHits: emptyRuleHitCounters(),
                ruleHitEndpoints: emptyRuleHitCounters(),
                transferProfile: emptyTransferProfile(),
                detectProfile: emptyDetectProfile(),
                stageProfile,
                transferNoHitReasons: ["no_source_seed"],
                elapsedMs: stageProfile.totalMs
            };
        }

        const detectT0 = process.hrtime.bigint();
        engine.resetDetectProfile();
        const detectStopPolicy = options.profile === "fast"
            ? {
                stopOnFirstFlow: options.stopOnFirstFlow,
                maxFlowsPerEntry: options.maxFlowsPerEntry,
            }
            : {
                stopOnFirstFlow: false,
                maxFlowsPerEntry: undefined,
            };
        const detected = detectFlows(engine, loadedRules, {
            detailed: options.reportMode === "full",
            stopOnFirstFlow: detectStopPolicy.stopOnFirstFlow,
            maxFlowsPerEntry: detectStopPolicy.maxFlowsPerEntry,
        });
        const detectProfile = engine.getDetectProfile();
        const ruleHits = engine.getRuleHitCounters();
        const ruleHitEndpoints = buildRuleEndpointHits(ruleHits, loadedRules);
        const transferProfile = engine.getWorklistProfile()?.transfer || emptyTransferProfile();
        const transferNoHitReasons = summarizeTransferNoHitReasons(
            transferProfile,
            (loadedRules.ruleSet.transfers || []).length
        );
        stageProfile.detectMs = elapsedMsSince(detectT0);
        const postProcessT0 = process.hrtime.bigint();
        stageProfile.postProcessMs = elapsedMsSince(postProcessT0);
        stageProfile.totalMs = elapsedMsSince(t0);
        return {
            sourceDir,
            entryName: candidate.name,
            entryPathHint: candidate.pathHint,
            score: candidate.score,
            status: "ok",
            seedCount,
            seedLocalNames: [...seedLocalNames].sort(),
            seedStrategies: [...seedStrategies].sort(),
            flowCount: detected.totalFlowCount,
            sinkSamples: detected.sinkSamples,
            flowRuleTraces: detected.flowRuleTraces,
            ruleHits,
            ruleHitEndpoints,
            transferProfile,
            detectProfile,
            stageProfile,
            transferNoHitReasons,
            elapsedMs: stageProfile.totalMs,
        };
    } catch (err: any) {
        stageProfile.totalMs = elapsedMsSince(t0);
        return {
            sourceDir,
            entryName: candidate.name,
            entryPathHint: candidate.pathHint,
            score: candidate.score,
            status: "exception",
            seedCount: 0,
            seedLocalNames: [],
            seedStrategies: [],
            flowCount: 0,
            sinkSamples: [],
            flowRuleTraces: [],
            ruleHits: emptyRuleHitCounters(),
            ruleHitEndpoints: emptyRuleHitCounters(),
            transferProfile: emptyTransferProfile(),
            detectProfile: emptyDetectProfile(),
            stageProfile,
            transferNoHitReasons: ["analyze_exception"],
            elapsedMs: stageProfile.totalMs,
            error: String(err?.message || err),
        };
    }
}

export interface AnalyzeRunResult {
    report: AnalyzeReport;
    jsonPath: string;
    mdPath: string;
}

export async function runAnalyze(options: CliOptions): Promise<AnalyzeRunResult> {
    const analyzeStart = process.hrtime.bigint();
    const stageProfile = emptyAnalyzeStageProfile();
    ConfigBasedTransferExecutor.resetSceneRuleCacheStats();
    const ruleLoadT0 = process.hrtime.bigint();
    const loadedRules = loadRuleSet(options.ruleOptions);
    stageProfile.ruleLoadMs = elapsedMsSince(ruleLoadT0);
    const ruleFingerprint = buildRuleFingerprint(loadedRules);
    const incrementalCacheScope: IncrementalCacheScope = {
        repo: options.repo,
        k: options.k,
        profile: options.profile,
        ruleFingerprint,
    };
    const repoTag = path.basename(options.repo).replace(/[^A-Za-z0-9._-]/g, "_");
    const incrementalCachePath = options.incrementalCachePath
        || path.resolve("tmp", "analyze", ".incremental", `${repoTag}.analyze.cache.json`);
    const incrementalCache = options.incremental
        ? loadIncrementalCache<EntryAnalyzeResult>(incrementalCachePath, incrementalCacheScope)
        : new Map<string, IncrementalCacheEntry<EntryAnalyzeResult>>();
    const perSourceMax = Math.max(1, Math.floor(options.maxEntries / Math.max(1, options.sourceDirs.length)));
    const sourceContextCache = new Map<string, { scene: Scene; selected: EntrySelectionResult }>();
    const sourceSharedEntryMap = new Map<string, EntryCandidate[]>();
    const sharedPagWarmPlans: Array<{
        sourceDir: string;
        scene: Scene;
        entries: EntryCandidate[];
    }> = [];
    const orderedEntries: Array<EntryAnalyzeResult | undefined> = [];
    const pendingTasks: Array<{
        order: number;
        sourceDir: string;
        scene: Scene;
        candidate: EntryCandidate;
        sharedPagEntries: EntryCandidate[];
        entryCacheKey: string;
        entryStamp?: EntryFileStamp;
    }> = [];

    stageProfile.entryConcurrency = options.concurrency;

    for (const sourceDir of options.sourceDirs) {
        const sourceAbs = path.resolve(options.repo, sourceDir);
        if (!fs.existsSync(sourceAbs)) continue;
        let scene = sourceContextCache.get(sourceAbs)?.scene;
        let selected = sourceContextCache.get(sourceAbs)?.selected;
        if (!scene || !selected) {
            stageProfile.sceneCacheMissCount++;
            const sceneBuildT0 = process.hrtime.bigint();
            const config = new SceneConfig();
            config.buildFromProjectDir(sourceAbs);
            scene = new Scene();
            scene.buildSceneFromProjectDir(config);
            scene.inferTypes();
            stageProfile.sceneBuildMs += elapsedMsSince(sceneBuildT0);

            const entrySelectT0 = process.hrtime.bigint();
            selected = selectEntryCandidates(scene, {
                maxEntries: perSourceMax,
                entryHints: options.entryHints,
                includePaths: options.includePaths,
                excludePaths: options.excludePaths,
            }, getSourcePattern(loadedRules));
            stageProfile.entrySelectMs += elapsedMsSince(entrySelectT0);
            sourceContextCache.set(sourceAbs, { scene, selected });
        } else {
            stageProfile.sceneCacheHitCount++;
        }

        if (selected.selected.length === 0) {
            orderedEntries.push({
                sourceDir,
                entryName: "<none>",
                score: 0,
                status: "no_entry",
                seedCount: 0,
                seedLocalNames: [],
                seedStrategies: [],
                flowCount: 0,
                sinkSamples: [],
                flowRuleTraces: [],
                ruleHits: emptyRuleHitCounters(),
                ruleHitEndpoints: emptyRuleHitCounters(),
                transferProfile: emptyTransferProfile(),
                detectProfile: emptyDetectProfile(),
                stageProfile: emptyEntryStageProfile(),
                transferNoHitReasons: ["no_selected_entry"],
                elapsedMs: 0,
            });
            continue;
        }

        sourceSharedEntryMap.set(sourceAbs, selected.selected);
        let hasPendingForSource = false;
        for (const candidate of selected.selected) {
            const order = orderedEntries.length;
            orderedEntries.push(undefined);
            const entryCacheKey = buildEntryCacheKey(sourceDir, candidate);
            const entryStamp = resolveEntryFileStamp(options.repo, sourceDir, candidate.pathHint);
            if (options.incremental) {
                const cached = incrementalCache.get(entryCacheKey);
                if (cached && sameEntryFileStamp(cached.stamp, entryStamp)) {
                    const cachedResult = cloneCachedEntryResult(cached.result, candidate.score, emptyEntryStageProfile);
                    orderedEntries[order] = cachedResult;
                    stageProfile.entryAnalyzeMs += cachedResult.stageProfile.totalMs;
                    stageProfile.incrementalCacheHitCount++;
                    continue;
                }
                stageProfile.incrementalCacheMissCount++;
            }

            pendingTasks.push({
                order,
                sourceDir,
                scene,
                candidate,
                sharedPagEntries: sourceSharedEntryMap.get(sourceAbs) || selected.selected,
                entryCacheKey,
                entryStamp,
            });
            hasPendingForSource = true;
        }

        if (hasPendingForSource) {
            sharedPagWarmPlans.push({
                sourceDir,
                scene,
                entries: sourceSharedEntryMap.get(sourceAbs) || selected.selected,
            });
        }
    }

    stageProfile.entryParallelTaskCount = pendingTasks.length;
    for (const warmPlan of sharedPagWarmPlans) {
        const warmT0 = process.hrtime.bigint();
        const warmEngine = new TaintPropagationEngine(warmPlan.scene, options.k, {
            transferRules: loadedRules.ruleSet.transfers || [],
        });
        warmEngine.verbose = false;
        await warmEngine.buildPAGForEntries(
            warmPlan.entries.map(entry => ({
                name: entry.name,
                pathHint: entry.pathHint,
            }))
        );
        stageProfile.entryAnalyzeMs += elapsedMsSince(warmT0);
    }

    const pendingResults = await mapWithConcurrency(
        pendingTasks,
        options.concurrency,
        async (task): Promise<EntryAnalyzeResult> => {
            return analyzeEntry(
                task.scene,
                task.sourceDir,
                task.candidate,
                options,
                loadedRules,
                task.sharedPagEntries
            );
        }
    );

    for (let i = 0; i < pendingTasks.length; i++) {
        const task = pendingTasks[i];
        const entryResult = pendingResults[i];
        orderedEntries[task.order] = entryResult;
        stageProfile.entryAnalyzeMs += entryResult.stageProfile.totalMs;

        if (options.incremental && task.entryStamp && entryResult.status !== "exception") {
            incrementalCache.set(task.entryCacheKey, {
                stamp: task.entryStamp,
                result: {
                    ...entryResult,
                    fromCache: undefined,
                },
            });
            stageProfile.incrementalCacheWriteCount++;
        }
    }

    const entries: EntryAnalyzeResult[] = orderedEntries.filter((e): e is EntryAnalyzeResult => !!e);

    const statusCount: Record<string, number> = {};
    let okEntries = 0;
    let withSeeds = 0;
    let withFlows = 0;
    let totalFlows = 0;
    const ruleHits = emptyRuleHitCounters();
    const ruleHitEndpoints = emptyRuleHitCounters();
    const transferProfile = {
        factCount: 0,
        invokeSiteCount: 0,
        ruleCheckCount: 0,
        ruleMatchCount: 0,
        endpointCheckCount: 0,
        endpointMatchCount: 0,
        dedupSkipCount: 0,
        resultCount: 0,
        elapsedMs: 0,
        elapsedShareAvg: 0,
    };
    const detectProfile = emptyDetectProfile();
    let transferShareCount = 0;
    const transferNoHitReasons: Record<string, number> = {};
    for (const e of entries) {
        statusCount[e.status] = (statusCount[e.status] || 0) + 1;
        if (e.status === "ok") okEntries++;
        if (e.seedCount > 0) withSeeds++;
        if (e.flowCount > 0) withFlows++;
        totalFlows += e.flowCount;
        accumulateRuleHitCounters(ruleHits, e.ruleHits);
        accumulateRuleHitCounters(ruleHitEndpoints, e.ruleHitEndpoints);
        transferProfile.factCount += e.transferProfile.factCount;
        transferProfile.invokeSiteCount += e.transferProfile.invokeSiteCount;
        transferProfile.ruleCheckCount += e.transferProfile.ruleCheckCount;
        transferProfile.ruleMatchCount += e.transferProfile.ruleMatchCount;
        transferProfile.endpointCheckCount += e.transferProfile.endpointCheckCount;
        transferProfile.endpointMatchCount += e.transferProfile.endpointMatchCount;
        transferProfile.dedupSkipCount += e.transferProfile.dedupSkipCount;
        transferProfile.resultCount += e.transferProfile.resultCount;
        transferProfile.elapsedMs += e.transferProfile.elapsedMs;
        transferProfile.elapsedShareAvg += e.transferProfile.elapsedShare;
        detectProfile.detectCallCount += e.detectProfile.detectCallCount;
        detectProfile.methodsVisited += e.detectProfile.methodsVisited;
        detectProfile.reachableMethodsVisited += e.detectProfile.reachableMethodsVisited;
        detectProfile.stmtsVisited += e.detectProfile.stmtsVisited;
        detectProfile.invokeStmtsVisited += e.detectProfile.invokeStmtsVisited;
        detectProfile.signatureMatchedInvokeCount += e.detectProfile.signatureMatchedInvokeCount;
        detectProfile.constraintRejectedInvokeCount += e.detectProfile.constraintRejectedInvokeCount;
        detectProfile.sinksChecked += e.detectProfile.sinksChecked;
        detectProfile.candidateCount += e.detectProfile.candidateCount;
        detectProfile.taintCheckCount += e.detectProfile.taintCheckCount;
        detectProfile.cfgGuardCheckCount += e.detectProfile.cfgGuardCheckCount;
        detectProfile.cfgGuardSkipCount += e.detectProfile.cfgGuardSkipCount;
        detectProfile.defReachabilityCheckCount += e.detectProfile.defReachabilityCheckCount;
        detectProfile.fieldPathCheckCount += e.detectProfile.fieldPathCheckCount;
        detectProfile.fieldPathHitCount += e.detectProfile.fieldPathHitCount;
        detectProfile.sanitizerGuardCheckCount += e.detectProfile.sanitizerGuardCheckCount;
        detectProfile.sanitizerGuardHitCount += e.detectProfile.sanitizerGuardHitCount;
        detectProfile.signatureMatchMs += e.detectProfile.signatureMatchMs;
        detectProfile.candidateResolveMs += e.detectProfile.candidateResolveMs;
        detectProfile.cfgGuardMs += e.detectProfile.cfgGuardMs;
        detectProfile.taintEvalMs += e.detectProfile.taintEvalMs;
        detectProfile.sanitizerGuardMs += e.detectProfile.sanitizerGuardMs;
        detectProfile.traversalMs += e.detectProfile.traversalMs;
        detectProfile.totalMs += e.detectProfile.totalMs;
        transferShareCount++;
        for (const reason of e.transferNoHitReasons) {
            transferNoHitReasons[reason] = (transferNoHitReasons[reason] || 0) + 1;
        }
    }
    transferProfile.elapsedShareAvg = transferShareCount > 0
        ? Number((transferProfile.elapsedShareAvg / transferShareCount).toFixed(6))
        : 0;
    const reportEntries = entries.map(e => toReportEntry(e, options.reportMode));

    const report: AnalyzeReport = {
        generatedAt: new Date().toISOString(),
        repo: options.repo,
        sourceDirs: options.sourceDirs,
        profile: options.profile,
        reportMode: options.reportMode,
        k: options.k,
        maxEntries: options.maxEntries,
        ruleLayers: loadedRules.appliedLayerOrder,
        ruleLayerStatus: loadedRules.layerStatus.map(s => ({ name: s.name, path: s.path, applied: s.applied, exists: s.exists, source: s.source })),
        summary: {
            totalEntries: entries.length,
            okEntries,
            withSeeds,
            withFlows,
            totalFlows,
            statusCount,
            ruleHits,
            ruleHitEndpoints,
            transferProfile,
            detectProfile,
                stageProfile: {
                    ruleLoadMs: Number(stageProfile.ruleLoadMs.toFixed(3)),
                    sceneBuildMs: Number(stageProfile.sceneBuildMs.toFixed(3)),
                    entrySelectMs: Number(stageProfile.entrySelectMs.toFixed(3)),
                    entryAnalyzeMs: Number(stageProfile.entryAnalyzeMs.toFixed(3)),
                    reportWriteMs: 0,
                    sceneCacheHitCount: stageProfile.sceneCacheHitCount,
                    sceneCacheMissCount: stageProfile.sceneCacheMissCount,
                    transferSceneRuleCacheHitCount: 0,
                    transferSceneRuleCacheMissCount: 0,
                    transferSceneRuleCacheDisabledCount: 0,
                    incrementalCacheHitCount: stageProfile.incrementalCacheHitCount,
                    incrementalCacheMissCount: stageProfile.incrementalCacheMissCount,
                    incrementalCacheWriteCount: stageProfile.incrementalCacheWriteCount,
                    entryConcurrency: stageProfile.entryConcurrency,
                    entryParallelTaskCount: stageProfile.entryParallelTaskCount,
                    totalMs: 0,
                },
                transferNoHitReasons,
        },
        entries: reportEntries,
    };

    const reportWriteT0 = process.hrtime.bigint();
    fs.mkdirSync(options.outputDir, { recursive: true });
    if (options.incremental) {
        saveIncrementalCache(incrementalCachePath, incrementalCacheScope, incrementalCache);
    }
    const jsonPath = path.resolve(options.outputDir, "summary.json");
    const mdPath = path.resolve(options.outputDir, "summary.md");
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderMarkdownReport(report), "utf-8");
    report.summary.stageProfile.reportWriteMs = Number(elapsedMsSince(reportWriteT0).toFixed(3));
    report.summary.stageProfile.totalMs = Number(elapsedMsSince(analyzeStart).toFixed(3));
    const transferSceneCacheStats = ConfigBasedTransferExecutor.getSceneRuleCacheStats();
    report.summary.stageProfile.transferSceneRuleCacheHitCount = transferSceneCacheStats.hitCount;
    report.summary.stageProfile.transferSceneRuleCacheMissCount = transferSceneCacheStats.missCount;
    report.summary.stageProfile.transferSceneRuleCacheDisabledCount = transferSceneCacheStats.disabledCount;
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderMarkdownReport(report), "utf-8");

    return {
        report,
        jsonPath,
        mdPath,
    };
}
