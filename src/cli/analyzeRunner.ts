import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { RuleHitCounters, TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";
import { ConfigBasedTransferExecutor } from "../core/kernel/rules/ConfigBasedTransferExecutor";
import {
    emptyPagNodeResolutionAuditSnapshot,
    PagNodeResolutionAuditSnapshot,
} from "../core/kernel/contracts/PagNodeResolution";
import { loadRuleSet, LoadedRuleSet } from "../core/rules/RuleLoader";
import {
    normalizeEndpoint,
    SinkRule,
    SourceRule,
    TransferRule,
} from "../core/rules/RuleSchema";
import {
    detectFlows,
    getSourceRules,
} from "./analyzeUtils";
import { CliOptions } from "./analyzeCliOptions";
import { renderMarkdownReport } from "./analyzeReport";
import {
    buildSystemFailureEvent,
    normalizeDiagnosticsItems,
    writeDiagnosticsArtifacts,
} from "./diagnosticsFormat";
import {
    ensureAnalyzeOutputLayout,
    resolveAnalyzeOutputLayout,
    writeAnalyzeRunManifest,
} from "./analyzeOutputLayout";
import {
    accumulateRuleHitCounters,
    AnalyzeReport,
    emptyAnalyzeErrorDiagnostics,
    emptyAnalyzeMemoryProfile,
    emptyAnalyzeStageProfile,
    emptyDetectProfile,
    emptyExecutionHandoffAudit,
    emptyEnginePluginAuditSnapshot,
    emptyEntryStageProfile,
    emptyRuleHitCounters,
    emptyTransferProfile,
    elapsedMsSince,
    EntryAnalyzeResult,
    toReportEntry,
} from "./analyzeTypes";
import { emptyModuleAuditSnapshot } from "../core/kernel/contracts/ModuleContract";
import {
    buildEntryCacheKey,
    buildIncrementalFingerprint,
    buildRuleFingerprint,
    cloneCachedEntryResult,
    EntryFileStamp,
    IncrementalCacheEntry,
    IncrementalCacheScope,
    loadIncrementalCache,
    resolveDirectoryTreeStamp,
    sameEntryFileStamp,
    saveIncrementalCache,
} from "./analyzeIncremental";
import {
    buildRuleFeedback,
    writeNoCandidateCallsiteArtifacts,
    writeNoCandidateCallsiteClassificationArtifacts,
} from "./ruleFeedback";
import { injectArkUiSdk } from "../core/orchestration/ArkUiSdkConfig";
import { loadModules } from "../core/orchestration/modules/ModuleLoader";
import { loadEnginePlugins } from "../core/orchestration/plugins/EnginePluginLoader";
import { loadArkMainSeeds, ArkMainLoadResult } from "../core/entry/arkmain/ArkMainLoader";
import * as fs from "fs";
import * as path from "path";
import { resolveModelSelections } from "./modelSelection";

function verboseAnalyzeLog(message: string): void {
    if (process.env.ARKTAINT_VERBOSE_BUILD === "1") {
        console.log(`[analyzeRunner] ${message}`);
    }
}

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

function accumulatePagNodeResolutionAudit(
    dst: PagNodeResolutionAuditSnapshot,
    src: PagNodeResolutionAuditSnapshot,
): void {
    dst.requestCount += src.requestCount;
    dst.directHitCount += src.directHitCount;
    dst.fallbackResolveCount += src.fallbackResolveCount;
    dst.awaitFallbackCount += src.awaitFallbackCount;
    dst.exprUseFallbackCount += src.exprUseFallbackCount;
    dst.anchorLeftFallbackCount += src.anchorLeftFallbackCount;
    dst.addAttemptCount += src.addAttemptCount;
    dst.addFailureCount += src.addFailureCount;
    dst.unresolvedCount += src.unresolvedCount;
    for (const [kind, count] of Object.entries(src.unsupportedValueKinds || {})) {
        dst.unsupportedValueKinds[kind] = (dst.unsupportedValueKinds[kind] || 0) + count;
    }
}

function dedupFailureEvents<T extends { message: string }>(
    items: T[],
    keyOf: (item: T) => string,
): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const item of items) {
        const key = keyOf(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function appendRecentModuleMessages(target: string[], incoming: string[]): string[] {
    for (const message of incoming) {
        if (target.includes(message)) continue;
        target.push(message);
    }
    if (target.length > 12) {
        target.splice(12);
    }
    return target;
}

function appendUniqueStrings(target: string[], incoming: string[]): string[] {
    for (const value of incoming) {
        if (target.includes(value)) continue;
        target.push(value);
    }
    return target;
}

function buildLoadedFileFingerprint(filePaths: string[]): string {
    const records = filePaths
        .map(filePath => path.resolve(filePath))
        .sort((a, b) => a.localeCompare(b))
        .map(filePath => {
            if (!fs.existsSync(filePath)) {
                return { filePath, exists: false };
            }
            const stat = fs.statSync(filePath);
            return {
                filePath,
                exists: true,
                mtimeMs: Math.floor(stat.mtimeMs),
                size: stat.size,
            };
        });
    return buildIncrementalFingerprint(records);
}

function resolveSourceRuleEndpoint(rule: SourceRule): string {
    const targetNorm = normalizeEndpoint(rule.target);
    const endpoint = targetNorm.endpoint;
    const path = targetNorm.path && targetNorm.path.length > 0
        ? `.${targetNorm.path.join(".")}`
        : "";
    return `${endpoint}${path}`;
}

function resolveSinkRuleEndpoint(rule: SinkRule): string {
    if (!rule.target) return "any_arg";
    const pathNorm = normalizeEndpoint(rule.target);
    const endpoint = pathNorm.endpoint;
    const path = pathNorm.path && pathNorm.path.length > 0
        ? `.${pathNorm.path.join(".")}`
        : "";
    return `${endpoint}${path}`;
}

function resolveTransferRuleEndpoint(rule: TransferRule): string {
    const fromNorm = normalizeEndpoint(rule.from);
    const toNorm = normalizeEndpoint(rule.to);
    const fromEndpoint = fromNorm.endpoint;
    const toEndpoint = toNorm.endpoint;
    const fromPath = fromNorm.pathFrom && fromNorm.slotKind
        ? `[${fromNorm.slotKind}:${fromNorm.pathFrom}]`
        : "";
    const toPath = toNorm.pathFrom && toNorm.slotKind
        ? `[${toNorm.slotKind}:${toNorm.pathFrom}]`
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

function getAnalyzeSourceRules(loadedRules: LoadedRuleSet): SourceRule[] {
    const rules = getSourceRules(loadedRules);
    return rules.filter(rule => rule.id !== "source.local_name.primary");
}

interface AnalyzeMemoryTracker {
    sample(): void;
    stop(): ReturnType<typeof emptyAnalyzeMemoryProfile>;
}

function roundMiB(bytes: number): number {
    return Number((bytes / (1024 * 1024)).toFixed(3));
}

function createAnalyzeMemoryTracker(sampleIntervalMs = 100): AnalyzeMemoryTracker {
    const snapshot = emptyAnalyzeMemoryProfile();
    snapshot.sampleIntervalMs = sampleIntervalMs;
    const sampleOnce = (): void => {
        const usage = process.memoryUsage();
        snapshot.sampleCount += 1;
        snapshot.rssMiB = roundMiB(usage.rss);
        snapshot.heapUsedMiB = roundMiB(usage.heapUsed);
        snapshot.heapTotalMiB = roundMiB(usage.heapTotal);
        snapshot.externalMiB = roundMiB(usage.external);
        snapshot.arrayBuffersMiB = roundMiB(usage.arrayBuffers || 0);
        snapshot.peakRssMiB = Math.max(snapshot.peakRssMiB, snapshot.rssMiB);
        snapshot.peakHeapUsedMiB = Math.max(snapshot.peakHeapUsedMiB, snapshot.heapUsedMiB);
        snapshot.peakHeapTotalMiB = Math.max(snapshot.peakHeapTotalMiB, snapshot.heapTotalMiB);
        snapshot.peakExternalMiB = Math.max(snapshot.peakExternalMiB, snapshot.externalMiB);
        snapshot.peakArrayBuffersMiB = Math.max(snapshot.peakArrayBuffersMiB, snapshot.arrayBuffersMiB);
    };
    sampleOnce();
    const timer = setInterval(sampleOnce, sampleIntervalMs);
    if (typeof timer.unref === "function") {
        timer.unref();
    }
    return {
        sample: sampleOnce,
        stop(): ReturnType<typeof emptyAnalyzeMemoryProfile> {
            clearInterval(timer);
            sampleOnce();
            return { ...snapshot };
        },
    };
}

function formatAnalyzeErrorMessage(error: unknown): string {
    return String((error as any)?.message || error);
}

function formatAnalyzeErrorStack(error: unknown, maxLines = 24): string | undefined {
    const stack = (error as any)?.stack;
    if (typeof stack !== "string" || stack.trim().length === 0) {
        return undefined;
    }
    return stack.split(/\r?\n/).slice(0, maxLines).join("\n");
}

function traceAnalyzeBuild(message: string): void {
    if (process.env.ARKTAINT_VERBOSE_BUILD === "1") {
        process.stderr.write(`${message}\n`);
    }
}

function createSourceDirExceptionResult(
    sourceDir: string,
    startedAt: bigint,
    error: unknown,
): EntryAnalyzeResult {
    const stageProfile = emptyEntryStageProfile();
    stageProfile.totalMs = elapsedMsSince(startedAt);
    return {
        sourceDir,
        entryName: "@arkMain",
        entryPathHint: sourceDir,
        score: 100,
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
        transferNoHitReasons: ["source_dir_exception"],
        pagNodeResolutionAudit: emptyPagNodeResolutionAuditSnapshot(),
        executionHandoffAudit: emptyExecutionHandoffAudit(),
        moduleAudit: emptyModuleAuditSnapshot(),
        enginePluginAudit: emptyEnginePluginAuditSnapshot(),
        elapsedMs: stageProfile.totalMs,
        error: formatAnalyzeErrorMessage(error),
        errorStack: formatAnalyzeErrorStack(error),
    };
}

function buildEntryAnalyzeFailureEvent(entry: EntryAnalyzeResult): ReturnType<typeof buildSystemFailureEvent> {
    const reasonSet = new Set(entry.transferNoHitReasons || []);
    const sourceDirFailure = reasonSet.has("source_dir_exception");
    const phase = sourceDirFailure ? "source_dir_build" : "entry_analyze";
    const error = {
        message: entry.error || "Entry analysis failed",
        stack: entry.errorStack,
    };
    return buildSystemFailureEvent(error, {
        phase,
        code: sourceDirFailure ? "SYSTEM_SOURCE_DIR_BUILD_THROW" : "SYSTEM_ENTRY_ANALYZE_THROW",
        title: sourceDirFailure ? "SourceDir Build" : "Entry Analyze",
        summary: sourceDirFailure
            ? `Scene build failed for sourceDir ${entry.sourceDir}.`
            : `Entry analysis failed for ${entry.entryName || "@arkMain"} in ${entry.sourceDir}.`,
        advice: "Inspect the stack frame and failing sourceDir. If the same frame recurs across projects, fix the engine path rather than the individual project.",
    });
}

interface AnalyzeSeedingPolicy {
    enableSecondarySinkSweep: boolean;
}

async function analyzeSourceDir(
    scene: Scene,
    sourceDir: string,
    options: CliOptions,
    resolvedSelections: ReturnType<typeof resolveModelSelections>,
    loadedRules: LoadedRuleSet,
    seedingPolicy: AnalyzeSeedingPolicy,
    pluginDirs: string[],
    pluginFiles: string[],
    arkMainLoadResult?: ArkMainLoadResult,
): Promise<EntryAnalyzeResult> {
    const t0 = process.hrtime.bigint();
    const stageProfile = emptyEntryStageProfile();
    const arkMainEntryName = "@arkMain";
    let engine: TaintPropagationEngine | undefined;
    const arkMainSeeds = arkMainLoadResult && (arkMainLoadResult.methods.length > 0 || arkMainLoadResult.facts.length > 0)
        ? {
            methods: arkMainLoadResult.methods,
            facts: arkMainLoadResult.facts,
        }
        : undefined;
    try {
        engine = new TaintPropagationEngine(scene, options.k, {
            transferRules: loadedRules.ruleSet.transfers || [],
            executionHandoff: options.executionHandoff,
            moduleRoots: options.modelRoots,
            moduleSpecFiles: options.moduleSpecFiles,
            enabledModuleProjects: resolvedSelections.enabledModuleProjects,
            disabledModuleProjects: resolvedSelections.disabledModuleProjects,
            disabledModuleIds: options.disabledModuleIds,
            enginePluginDirs: pluginDirs,
            enginePluginFiles: pluginFiles,
            disabledEnginePluginNames: options.disabledPluginNames,
            includeBuiltinModules: true,
            includeBuiltinEnginePlugins: true,
            pluginDryRun: options.pluginDryRun,
            pluginIsolate: options.pluginIsolate,
            arkMainSeeds: arkMainSeeds
                ? {
                    methods: arkMainSeeds.methods,
                    facts: arkMainSeeds.facts,
                }
                : undefined,
            debug: {
                enableWorklistProfile: true,
                worklistMaxElapsedMs: options.worklistBudgetMs && options.worklistBudgetMs > 0
                    ? options.worklistBudgetMs
                    : undefined,
                worklistMaxDequeues: options.worklistMaxDequeues && options.worklistMaxDequeues > 0
                    ? options.worklistMaxDequeues
                    : undefined,
                worklistMaxVisited: options.worklistMaxVisited && options.worklistMaxVisited > 0
                    ? options.worklistMaxVisited
                    : undefined,
            },
        });
        engine.verbose = process.env.ARKTAINT_VERBOSE_BUILD === "1";
        const buildPagT0 = process.hrtime.bigint();
        verboseAnalyzeLog(`buildPAG start source_dir=${sourceDir || "."}`);
        await engine.buildPAG({ entryModel: options.entryModel || "arkMain" });
        stageProfile.buildPagMs = elapsedMsSince(buildPagT0);
        verboseAnalyzeLog(`buildPAG done source_dir=${sourceDir || "."} elapsed_ms=${Math.round(stageProfile.buildPagMs)}`);

        const activeReachableMethodSignatures = engine.getActiveReachableMethodSignatures();
        let reachableMethodSignatures = activeReachableMethodSignatures;
        if (!activeReachableMethodSignatures) {
            verboseAnalyzeLog(`reachable recompute start source_dir=${sourceDir || "."}`);
            reachableMethodSignatures = engine.computeReachableMethodSignatures();
            engine.setActiveReachableMethodSignatures(reachableMethodSignatures);
            verboseAnalyzeLog(`reachable recompute done source_dir=${sourceDir || "."} count=${reachableMethodSignatures.size}`);
        } else {
            verboseAnalyzeLog(`reachable reused source_dir=${sourceDir || "."} count=${reachableMethodSignatures.size}`);
        }
        const executionHandoffContractSnapshot = engine.getExecutionHandoffContractSnapshot();
        const syntheticInvokeEdgeSnapshot = engine.getSyntheticInvokeEdgeSnapshot();
        const executionHandoffAudit = {
            contracts: executionHandoffContractSnapshot?.totalContracts || 0,
            syntheticEdges: syntheticInvokeEdgeSnapshot.totalEdges || 0,
            syntheticCallers: syntheticInvokeEdgeSnapshot.callerSignatures.length || 0,
            syntheticCallees: syntheticInvokeEdgeSnapshot.calleeSignatures.length || 0,
        };

        let seedCount = 0;
        const seedLocalNames = new Set<string>();
        const seedStrategies = new Set<string>();
        const sourceSeedT0 = process.hrtime.bigint();
        verboseAnalyzeLog(`source rule propagation start source_dir=${sourceDir || "."}`);
        const sourceRuleResult = engine.propagateWithSourceRules(getAnalyzeSourceRules(loadedRules));
        stageProfile.propagateRuleSeedMs = elapsedMsSince(sourceSeedT0);
        verboseAnalyzeLog(
            `source rule propagation done source_dir=${sourceDir || "."} elapsed_ms=${Math.round(stageProfile.propagateRuleSeedMs)} seeds=${sourceRuleResult.seedCount}`,
        );
        const worklistTruncation = engine.getWorklistTruncation();
        const worklistProfile = engine.getWorklistProfile();
        seedCount += sourceRuleResult.seedCount;
        for (const x of sourceRuleResult.seededLocals) seedLocalNames.add(x);
        if (sourceRuleResult.seedCount > 0) seedStrategies.add("rule:source");
        stageProfile.propagateHeuristicSeedMs = 0;
        const semanticState = engine.solveSemanticState(getAnalyzeSourceRules(loadedRules), loadedRules.ruleSet.sinks || [], {
            budget: {
                maxDequeues: options.worklistMaxDequeues && options.worklistMaxDequeues > 0 ? options.worklistMaxDequeues : undefined,
                maxVisited: options.worklistMaxVisited && options.worklistMaxVisited > 0 ? options.worklistMaxVisited : undefined,
                maxElapsedMs: options.worklistBudgetMs && options.worklistBudgetMs > 0 ? options.worklistBudgetMs : undefined,
            },
        });

        if (seedCount === 0) {
            stageProfile.totalMs = elapsedMsSince(t0);
            return {
                sourceDir,
                entryName: arkMainEntryName,
                entryPathHint: sourceDir,
                score: 100,
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
                pagNodeResolutionAudit: engine.getPagNodeResolutionAuditSnapshot(),
                executionHandoffAudit,
                moduleAudit: engine.getModuleAuditSnapshot(),
                enginePluginAudit: engine.getEnginePluginAuditSnapshot(),
                semanticState,
                arkMainSeeds: engine.getArkMainSeedReport(),
                elapsedMs: stageProfile.totalMs
            };
        }

        if (worklistTruncation) {
            const transferProfile = engine.getWorklistProfile()?.transfer || emptyTransferProfile();
            const ruleHits = engine.getRuleHitCounters();
            const ruleHitEndpoints = buildRuleEndpointHits(ruleHits, loadedRules);
            engine.finishEnginePlugins({
                sourceDir,
                elapsedMs: stageProfile.propagateRuleSeedMs,
                reachableMethodCount: engine.getActiveReachableMethodSignatures()?.size,
            });
            stageProfile.totalMs = elapsedMsSince(t0);
            return {
                sourceDir,
                entryName: arkMainEntryName,
                entryPathHint: sourceDir,
                score: 100,
                status: "budget_exceeded",
                seedCount,
                seedLocalNames: [...seedLocalNames].sort(),
                seedStrategies: [...seedStrategies].sort(),
                flowCount: 0,
                sinkSamples: [],
                flowRuleTraces: [],
                ruleHits,
                ruleHitEndpoints,
                transferProfile,
                detectProfile: emptyDetectProfile(),
                stageProfile,
                transferNoHitReasons: [
                    "propagation_budget_exceeded",
                    `propagation_budget_exceeded:${worklistTruncation.reason}`,
                ],
                pagNodeResolutionAudit: engine.getPagNodeResolutionAuditSnapshot(),
                executionHandoffAudit,
                moduleAudit: engine.getModuleAuditSnapshot(),
                enginePluginAudit: engine.getEnginePluginAuditSnapshot(),
                semanticState,
                arkMainSeeds: engine.getArkMainSeedReport(),
                worklistProfile,
                worklistTruncation,
                elapsedMs: stageProfile.totalMs,
            };
        }

        let detected: ReturnType<typeof detectFlows> | undefined;
        let detectProfile = emptyDetectProfile();
        let detectElapsedMs = 0;
        const detectT0 = process.hrtime.bigint();
        engine.resetDetectProfile();
        verboseAnalyzeLog(`detect start source_dir=${sourceDir || "."}`);
        const detectStopPolicy = options.profile === "fast"
            ? {
                stopOnFirstFlow: options.stopOnFirstFlow,
                maxFlowsPerEntry: options.maxFlowsPerEntry,
            }
            : {
                stopOnFirstFlow: false,
                maxFlowsPerEntry: undefined,
            };
        detected = detectFlows(engine, loadedRules, {
            detailed: options.reportMode === "full",
            stopOnFirstFlow: detectStopPolicy.stopOnFirstFlow,
            maxFlowsPerEntry: detectStopPolicy.maxFlowsPerEntry,
            enableSecondarySinkSweep: seedingPolicy.enableSecondarySinkSweep,
        });
        detectProfile = engine.getDetectProfile();
        detectElapsedMs = elapsedMsSince(detectT0);
        verboseAnalyzeLog(
            `detect done source_dir=${sourceDir || "."} elapsed_ms=${Math.round(detectElapsedMs)} flows=${detected.totalFlowCount}`,
        );
        const ruleHits = engine.getRuleHitCounters();
        const ruleHitEndpoints = buildRuleEndpointHits(ruleHits, loadedRules);
        const transferProfile = worklistProfile?.transfer || emptyTransferProfile();
        const transferNoHitReasons = summarizeTransferNoHitReasons(
            transferProfile,
            (loadedRules.ruleSet.transfers || []).length
        );
        if (worklistTruncation) {
            transferNoHitReasons.push("propagation_budget_exceeded");
            transferNoHitReasons.push(`propagation_budget_exceeded:${worklistTruncation.reason}`);
        }
        stageProfile.detectMs = detectElapsedMs;
        engine.finishEnginePlugins({
            sourceDir,
            elapsedMs: stageProfile.detectMs,
            reachableMethodCount: engine.getActiveReachableMethodSignatures()?.size,
        });
        const postProcessT0 = process.hrtime.bigint();
        stageProfile.postProcessMs = elapsedMsSince(postProcessT0);
        stageProfile.totalMs = elapsedMsSince(t0);
        return {
            sourceDir,
            entryName: arkMainEntryName,
            entryPathHint: sourceDir,
            score: 100,
            status: worklistTruncation ? "budget_exceeded" : "ok",
            seedCount,
            seedLocalNames: [...seedLocalNames].sort(),
            seedStrategies: [...seedStrategies].sort(),
            flowCount: detected?.totalFlowCount || 0,
            sinkSamples: detected?.sinkSamples || [],
            flowRuleTraces: detected?.flowRuleTraces || [],
            ruleHits,
            ruleHitEndpoints,
            transferProfile,
            detectProfile,
            stageProfile,
            transferNoHitReasons,
            pagNodeResolutionAudit: engine.getPagNodeResolutionAuditSnapshot(),
            executionHandoffAudit,
            moduleAudit: engine.getModuleAuditSnapshot(),
            enginePluginAudit: engine.getEnginePluginAuditSnapshot(),
            semanticState,
            arkMainSeeds: engine.getArkMainSeedReport(),
            worklistProfile,
            worklistTruncation,
            elapsedMs: stageProfile.totalMs,
        };
    } catch (err: any) {
        stageProfile.totalMs = elapsedMsSince(t0);
        return {
            sourceDir,
            entryName: arkMainEntryName,
            entryPathHint: sourceDir,
            score: 100,
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
            pagNodeResolutionAudit: engine?.getPagNodeResolutionAuditSnapshot() || emptyPagNodeResolutionAuditSnapshot(),
            executionHandoffAudit: engine
                ? {
                    contracts: engine.getExecutionHandoffContractSnapshot()?.totalContracts || 0,
                    syntheticEdges: engine.getSyntheticInvokeEdgeSnapshot().totalEdges || 0,
                    syntheticCallers: engine.getSyntheticInvokeEdgeSnapshot().callerSignatures.length || 0,
                    syntheticCallees: engine.getSyntheticInvokeEdgeSnapshot().calleeSignatures.length || 0,
                }
                : emptyExecutionHandoffAudit(),
            moduleAudit: engine?.getModuleAuditSnapshot() || emptyModuleAuditSnapshot(),
            enginePluginAudit: engine?.getEnginePluginAuditSnapshot() || emptyEnginePluginAuditSnapshot(),
            semanticState: undefined,
            arkMainSeeds: engine?.getArkMainSeedReport(),
            elapsedMs: stageProfile.totalMs,
            error: formatAnalyzeErrorMessage(err),
            errorStack: formatAnalyzeErrorStack(err),
        };
    }
}

export interface AnalyzeRunResult {
    report: AnalyzeReport;
    jsonPath: string;
    mdPath: string;
    diagnosticsJsonPath: string;
    diagnosticsTextPath: string;
}

export async function runAnalyze(options: CliOptions): Promise<AnalyzeRunResult> {
    const analyzeStart = process.hrtime.bigint();
    const memoryTracker = createAnalyzeMemoryTracker();
    const stageProfile = emptyAnalyzeStageProfile();
    ConfigBasedTransferExecutor.resetSceneRuleCacheStats();
    const resolvedSelections = resolveModelSelections({
        ruleOptions: options.ruleOptions,
        modelRoots: options.modelRoots,
        enabledModels: options.enabledModels,
        disabledModels: options.disabledModels,
    });
    const pluginDirs = (options.pluginPaths || []).filter(p => fs.existsSync(p) && fs.statSync(p).isDirectory());
    const pluginFiles = (options.pluginPaths || []).filter(p => fs.existsSync(p) && fs.statSync(p).isFile());
    const arkMainWarningSet = new Set<string>();
    const moduleResult = loadModules({
        moduleRoots: options.modelRoots || [],
        moduleSpecFiles: options.moduleSpecFiles || [],
        enabledModuleProjects: resolvedSelections.enabledModuleProjects,
        disabledModuleProjects: resolvedSelections.disabledModuleProjects,
        disabledModuleIds: options.disabledModuleIds || [],
    });
    const enginePluginResult = loadEnginePlugins({
        pluginDirs,
        pluginFiles,
        disabledPluginNames: options.disabledPluginNames || [],
        isolatePluginNames: options.pluginIsolate || [],
    });
    const ruleLoadT0 = process.hrtime.bigint();
    const loadedRules = loadRuleSet({
        ...resolvedSelections.ruleOptions,
    });
    stageProfile.ruleLoadMs = elapsedMsSince(ruleLoadT0);
    memoryTracker.sample();
    if (options.showLoadWarnings !== false) {
        for (const warning of loadedRules.warnings) {
            console.warn(`rule warning: ${warning}`);
        }
        for (const warning of moduleResult.warnings) {
            console.warn(`module warning: ${warning}`);
        }
        for (const warning of enginePluginResult.warnings) {
            console.warn(`engine plugin warning: ${warning}`);
        }
    }
    const seedingPolicy: AnalyzeSeedingPolicy = {
        enableSecondarySinkSweep: options.enableSecondarySinkSweep,
    };
    const ruleFingerprint = buildRuleFingerprint(loadedRules);
    const analysisFingerprint = buildIncrementalFingerprint({
        ruleFingerprint,
        moduleFiles: buildLoadedFileFingerprint(moduleResult.loadedFiles),
        enginePluginFiles: buildLoadedFileFingerprint(enginePluginResult.loadedFiles),
        modelRoots: (options.modelRoots || []).map(item => path.resolve(item)).sort(),
        moduleSpecFiles: (options.moduleSpecFiles || []).map(item => path.resolve(item)).sort(),
        enabledModuleProjects: [...resolvedSelections.enabledModuleProjects].sort(),
        disabledModuleProjects: [...resolvedSelections.disabledModuleProjects].sort(),
        disabledModuleIds: [...(options.disabledModuleIds || [])].sort(),
        arkMainSpecFiles: (options.arkMainSpecFiles || []).map(item => path.resolve(item)).sort(),
        enabledArkMainProjects: [...resolvedSelections.enabledArkMainProjects].sort(),
        disabledArkMainProjects: [...resolvedSelections.disabledArkMainProjects].sort(),
        enabledModels: [...(options.enabledModels || [])].sort(),
        disabledModels: [...(options.disabledModels || [])].sort(),
        pluginPaths: (options.pluginPaths || []).map(item => path.resolve(item)).sort(),
        disabledPluginNames: [...(options.disabledPluginNames || [])].sort(),
        pluginIsolate: [...(options.pluginIsolate || [])].sort(),
        pluginDryRun: options.pluginDryRun === true,
        stopOnFirstFlow: options.stopOnFirstFlow,
        maxFlowsPerEntry: options.maxFlowsPerEntry ?? null,
        enableSecondarySinkSweep: options.enableSecondarySinkSweep,
        semanticStateKernelVersion: "algorithm-e-mandatory-v1",
    });
    const incrementalCacheScope: IncrementalCacheScope = {
        repo: options.repo,
        k: options.k,
        profile: options.profile,
        analysisFingerprint,
    };
    const repoTag = path.basename(options.repo).replace(/[^A-Za-z0-9._-]/g, "_");
    const incrementalCachePath = options.incrementalCachePath
        || path.resolve("tmp", "analyze", ".incremental", `${repoTag}.analyze.cache.json`);
    const incrementalCache = options.incremental
        ? loadIncrementalCache<EntryAnalyzeResult>(incrementalCachePath, incrementalCacheScope)
        : new Map<string, IncrementalCacheEntry<EntryAnalyzeResult>>();
    const sourceContextCache = new Map<string, { scene: Scene; arkMainLoad: ArkMainLoadResult }>();
    const orderedEntries: Array<EntryAnalyzeResult | undefined> = [];
    const pendingTasks: Array<{
        order: number;
        sourceDir: string;
        scene: Scene;
        arkMainLoad: ArkMainLoadResult;
        entryCacheKey: string;
        entryStamp?: EntryFileStamp;
    }> = [];

    stageProfile.entryConcurrency = options.concurrency;

    for (const sourceDir of options.sourceDirs) {
        const sourceAbs = path.resolve(options.repo, sourceDir);
        if (!fs.existsSync(sourceAbs)) continue;
        const sourceStartedAt = process.hrtime.bigint();
        let scene = sourceContextCache.get(sourceAbs)?.scene;
        let arkMainLoad = sourceContextCache.get(sourceAbs)?.arkMainLoad;
        if (!scene || !arkMainLoad) {
            try {
                stageProfile.sceneCacheMissCount++;
                const sceneBuildT0 = process.hrtime.bigint();
                traceAnalyzeBuild(`[analyze] sourceDir=${sourceDir} scene_config start`);
                const config = new SceneConfig();
                config.buildFromProjectDir(sourceAbs);
                injectArkUiSdk(config);
                traceAnalyzeBuild(`[analyze] sourceDir=${sourceDir} scene_build start`);
                scene = new Scene();
                scene.buildSceneFromProjectDir(config);
                traceAnalyzeBuild(`[analyze] sourceDir=${sourceDir} infer_types start`);
                scene.inferTypes();
                traceAnalyzeBuild(`[analyze] sourceDir=${sourceDir} arkmain_load start`);
                arkMainLoad = loadArkMainSeeds(scene, {
                    arkMainRoots: options.modelRoots,
                    arkMainSpecFiles: options.arkMainSpecFiles,
                    enabledArkMainProjects: resolvedSelections.enabledArkMainProjects,
                    disabledArkMainProjects: resolvedSelections.disabledArkMainProjects,
                });
                traceAnalyzeBuild(`[analyze] sourceDir=${sourceDir} arkmain_load done`);
                for (const warning of arkMainLoad.warnings) {
                    if (arkMainWarningSet.has(warning)) {
                        continue;
                    }
                    arkMainWarningSet.add(warning);
                    if (options.showLoadWarnings !== false) {
                        console.warn(`arkmain warning: ${warning}`);
                    }
                }
                stageProfile.sceneBuildMs += elapsedMsSince(sceneBuildT0);
                memoryTracker.sample();
                sourceContextCache.set(sourceAbs, { scene, arkMainLoad });
            } catch (error) {
                const order = orderedEntries.length;
                orderedEntries.push(createSourceDirExceptionResult(sourceDir, sourceStartedAt, error));
                stageProfile.entryAnalyzeMs += orderedEntries[order]!.stageProfile.totalMs;
                memoryTracker.sample();
                continue;
            }
        } else {
            stageProfile.sceneCacheHitCount++;
        }

        const order = orderedEntries.length;
        orderedEntries.push(undefined);
        const syntheticCandidate = { pathHint: sourceDir, name: "@arkMain" };
        const entryCacheKey = buildEntryCacheKey(sourceDir, syntheticCandidate);
        const entryStamp = resolveDirectoryTreeStamp(path.resolve(options.repo, sourceDir));
        if (options.incremental) {
            const cached = incrementalCache.get(entryCacheKey);
            if (cached && sameEntryFileStamp(cached.stamp, entryStamp)) {
                const cachedResult = cloneCachedEntryResult(cached.result, 100, emptyEntryStageProfile);
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
            arkMainLoad,
            entryCacheKey,
            entryStamp,
        });
    }

    stageProfile.entryParallelTaskCount = pendingTasks.length;
    const pendingResults = await mapWithConcurrency(
        pendingTasks,
        options.concurrency,
        async (task): Promise<EntryAnalyzeResult> => {
            return analyzeSourceDir(
                task.scene,
                task.sourceDir,
                options,
                resolvedSelections,
                loadedRules,
                seedingPolicy,
                pluginDirs,
                pluginFiles,
                task.arkMainLoad,
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
        memoryTracker.sample();
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
        noCandidateCallsites: [] as AnalyzeReport["summary"]["transferProfile"]["noCandidateCallsites"],
    };
    const noCandidateSummaryMap = new Map<string, AnalyzeReport["summary"]["transferProfile"]["noCandidateCallsites"][number]>();
    const detectProfile = emptyDetectProfile();
    const pagNodeResolutionAudit = emptyPagNodeResolutionAuditSnapshot();
    const executionHandoffAudit = emptyExecutionHandoffAudit();
    const moduleAuditSummary = {
        loadedModuleIds: [] as string[],
        failedModuleIds: [] as string[],
        discoveredModuleProjects: [...moduleResult.discoveredModuleProjects],
        enabledModuleProjects: [...moduleResult.enabledModuleProjects],
        modules: {} as Record<string, ReturnType<typeof emptyModuleAuditSnapshot>["moduleStats"][string]>,
    };
    const pluginAuditSummary = {
        loadedPluginNames: [] as string[],
        failedPluginNames: [] as string[],
        plugins: {} as Record<string, AnalyzeReport["summary"]["pluginAudit"]["plugins"][string]>,
    };
    const arkMainSeedSummary = {
        enabled: false,
        methodCount: 0,
        factCount: 0,
    };
    const loadedModuleIdSet = new Set<string>();
    const failedModuleIdSet = new Set<string>();
    const loadedPluginNameSet = new Set<string>();
    const failedPluginNameSet = new Set<string>();
    const diagnostics = emptyAnalyzeErrorDiagnostics();
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
        for (const site of e.transferProfile.noCandidateCallsites || []) {
            const key = `${site.calleeSignature}|${site.method}|${site.invokeKind}|${site.argCount}|${site.sourceFile}`;
            const existing = noCandidateSummaryMap.get(key);
            if (existing) {
                existing.count += site.count;
            } else {
                noCandidateSummaryMap.set(key, { ...site });
            }
        }
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
        detectProfile.defReachabilityCheckCount += e.detectProfile.defReachabilityCheckCount;
        detectProfile.fieldPathCheckCount += e.detectProfile.fieldPathCheckCount;
        detectProfile.fieldPathHitCount += e.detectProfile.fieldPathHitCount;
        detectProfile.sanitizerGuardCheckCount += e.detectProfile.sanitizerGuardCheckCount;
        detectProfile.sanitizerGuardHitCount += e.detectProfile.sanitizerGuardHitCount;
        detectProfile.signatureMatchMs += e.detectProfile.signatureMatchMs;
        detectProfile.candidateResolveMs += e.detectProfile.candidateResolveMs;
        detectProfile.taintEvalMs += e.detectProfile.taintEvalMs;
        detectProfile.sanitizerGuardMs += e.detectProfile.sanitizerGuardMs;
        detectProfile.traversalMs += e.detectProfile.traversalMs;
        detectProfile.totalMs += e.detectProfile.totalMs;
        accumulatePagNodeResolutionAudit(pagNodeResolutionAudit, e.pagNodeResolutionAudit);
        executionHandoffAudit.contracts += e.executionHandoffAudit.contracts;
        executionHandoffAudit.syntheticEdges += e.executionHandoffAudit.syntheticEdges;
        executionHandoffAudit.syntheticCallers += e.executionHandoffAudit.syntheticCallers;
        executionHandoffAudit.syntheticCallees += e.executionHandoffAudit.syntheticCallees;
        for (const moduleId of e.moduleAudit.loadedModuleIds) {
            loadedModuleIdSet.add(moduleId);
        }
        for (const moduleId of e.moduleAudit.failedModuleIds) {
            failedModuleIdSet.add(moduleId);
        }
        for (const pluginName of e.enginePluginAudit.loadedPluginNames) {
            loadedPluginNameSet.add(pluginName);
        }
        for (const pluginName of e.enginePluginAudit.failedPluginNames) {
            failedPluginNameSet.add(pluginName);
        }
        for (const [moduleId, stats] of Object.entries(e.moduleAudit.moduleStats || {})) {
            const current = moduleAuditSummary.modules[moduleId];
            if (!current) {
                moduleAuditSummary.modules[moduleId] = {
                    ...stats,
                    recentDebugMessages: [...stats.recentDebugMessages],
                };
                continue;
            }
            current.sourcePath = current.sourcePath || stats.sourcePath;
            current.factHookCalls += stats.factHookCalls;
            current.invokeHookCalls += stats.invokeHookCalls;
            current.copyEdgeChecks += stats.copyEdgeChecks;
            current.factHookMs += stats.factHookMs;
            current.invokeHookMs += stats.invokeHookMs;
            current.copyEdgeMs += stats.copyEdgeMs;
            current.factEmissionCount += stats.factEmissionCount;
            current.invokeEmissionCount += stats.invokeEmissionCount;
            current.totalEmissionCount += stats.totalEmissionCount;
            current.skipCopyEdgeCount += stats.skipCopyEdgeCount;
            current.debugHitCount += stats.debugHitCount;
            current.debugSkipCount += stats.debugSkipCount;
            current.debugLogCount += stats.debugLogCount;
            current.recentDebugMessages = appendRecentModuleMessages(
                current.recentDebugMessages,
                stats.recentDebugMessages,
            );
        }
        for (const [pluginName, stats] of Object.entries(e.enginePluginAudit.pluginStats || {})) {
            const current = pluginAuditSummary.plugins[pluginName];
            if (!current) {
                pluginAuditSummary.plugins[pluginName] = {
                    ...stats,
                    detectionCheckNames: [...stats.detectionCheckNames],
                };
                continue;
            }
            current.description = current.description || stats.description;
            current.sourcePath = current.sourcePath || stats.sourcePath;
            current.startHookCalls += stats.startHookCalls;
            current.entryHookCalls += stats.entryHookCalls;
            current.propagationHookCalls += stats.propagationHookCalls;
            current.detectionHookCalls += stats.detectionHookCalls;
            current.resultHookCalls += stats.resultHookCalls;
            current.finishHookCalls += stats.finishHookCalls;
            current.sourceRulesAdded += stats.sourceRulesAdded;
            current.sinkRulesAdded += stats.sinkRulesAdded;
            current.transferRulesAdded += stats.transferRulesAdded;
            current.sanitizerRulesAdded += stats.sanitizerRulesAdded;
            current.optionOverrideCount += stats.optionOverrideCount;
            current.entryAdds += stats.entryAdds;
            current.entryReplaceUsed = current.entryReplaceUsed || stats.entryReplaceUsed;
            current.callEdgeObserverCount += stats.callEdgeObserverCount;
            current.taintFlowObserverCount += stats.taintFlowObserverCount;
            current.methodReachedObserverCount += stats.methodReachedObserverCount;
            current.propagationReplaceUsed = current.propagationReplaceUsed || stats.propagationReplaceUsed;
            current.addedFlowCount += stats.addedFlowCount;
            current.addedBridgeCount += stats.addedBridgeCount;
            current.addedSyntheticEdgeCount += stats.addedSyntheticEdgeCount;
            current.enqueuedFactCount += stats.enqueuedFactCount;
            current.detectionCheckNames = appendUniqueStrings(
                current.detectionCheckNames,
                stats.detectionCheckNames,
            );
            current.detectionCheckRunCount += stats.detectionCheckRunCount;
            current.detectionReplaceUsed = current.detectionReplaceUsed || stats.detectionReplaceUsed;
            current.resultFilterCount += stats.resultFilterCount;
            current.resultTransformCount += stats.resultTransformCount;
            current.resultAddedFindingCount += stats.resultAddedFindingCount;
        }
        if (e.arkMainSeeds) {
            arkMainSeedSummary.enabled = arkMainSeedSummary.enabled || e.arkMainSeeds.enabled;
            arkMainSeedSummary.methodCount = Math.max(arkMainSeedSummary.methodCount, e.arkMainSeeds.methodCount || 0);
            arkMainSeedSummary.factCount = Math.max(arkMainSeedSummary.factCount, e.arkMainSeeds.factCount || 0);
        }
        if (e.status === "exception") {
            diagnostics.systemFailures.push(buildEntryAnalyzeFailureEvent(e));
        }
        diagnostics.moduleRuntimeFailures.push(...e.moduleAudit.failureEvents);
        diagnostics.enginePluginRuntimeFailures.push(...e.enginePluginAudit.failureEvents);
        transferShareCount++;
        for (const reason of e.transferNoHitReasons) {
            transferNoHitReasons[reason] = (transferNoHitReasons[reason] || 0) + 1;
        }
    }
    diagnostics.moduleLoadIssues = moduleResult.loadIssues.map(issue => ({ ...issue }));
    diagnostics.enginePluginLoadIssues = enginePluginResult.loadIssues.map(issue => ({ ...issue }));
    diagnostics.moduleRuntimeFailures = dedupFailureEvents(
        diagnostics.moduleRuntimeFailures,
        item => `${item.moduleId}|${item.phase}|${item.message}|${item.path || ""}|${item.line || ""}|${item.column || ""}`,
    );
    diagnostics.enginePluginRuntimeFailures = dedupFailureEvents(
        diagnostics.enginePluginRuntimeFailures,
        item => `${item.pluginName}|${item.phase}|${item.message}|${item.path || ""}|${item.line || ""}|${item.column || ""}`,
    );
    transferProfile.elapsedShareAvg = transferShareCount > 0
        ? Number((transferProfile.elapsedShareAvg / transferShareCount).toFixed(6))
        : 0;
    moduleAuditSummary.loadedModuleIds = [...loadedModuleIdSet].sort((a, b) => a.localeCompare(b));
    moduleAuditSummary.failedModuleIds = [...failedModuleIdSet].sort((a, b) => a.localeCompare(b));
    pluginAuditSummary.loadedPluginNames = [...loadedPluginNameSet].sort((a, b) => a.localeCompare(b));
    pluginAuditSummary.failedPluginNames = [...failedPluginNameSet].sort((a, b) => a.localeCompare(b));
    const diagnosticItems = normalizeDiagnosticsItems(diagnostics);
    transferProfile.noCandidateCallsites = [...noCandidateSummaryMap.values()]
        .sort((a, b) => b.count - a.count || a.calleeSignature.localeCompare(b.calleeSignature))
        .slice(0, 200);
    const semanticEntries = entries
        .map(entry => entry.semanticState)
        .filter((item): item is NonNullable<EntryAnalyzeResult["semanticState"]> => !!item && item.enabled);
    const semanticSinkSeen = new Set<string>();
    const semanticCandidateSeen = new Set<string>();
    const semanticProvenanceSeen = new Set<string>();
    const semanticGapSeen = new Set<string>();
    const semanticState = semanticEntries.length > 0
        ? semanticEntries.reduce((acc, item) => {
            acc.enabled = true;
            acc.seedCount += item.seedCount;
            acc.sinkHitCount += item.sinkHitCount;
            acc.candidateSeedCount += item.candidateSeedCount;
            acc.provenanceCount += item.provenanceCount;
            acc.gapCount += item.gapCount;
            acc.truncated = acc.truncated || item.truncated;
            acc.stats.dequeues += item.stats?.dequeues || 0;
            acc.stats.visited += item.stats?.visited || 0;
            acc.stats.elapsedMs += item.stats?.elapsedMs || 0;
            for (const [transitionId, count] of Object.entries(item.stats?.transitionCounts || {})) {
                acc.stats.transitionCounts[transitionId] = (acc.stats.transitionCounts[transitionId] || 0) + count;
            }
            for (const hit of item.sinkHits || []) {
                const key = `${hit.factId}|${hit.sinkSignature}|${hit.sinkRuleId || ""}|${hit.argIndex ?? ""}`;
                if (semanticSinkSeen.has(key)) continue;
                semanticSinkSeen.add(key);
                acc.sinkHits.push({ ...hit });
            }
            for (const candidate of item.candidateSeeds || []) {
                const key = `${candidate.factId}|${candidate.carrierKey}|${candidate.reason}`;
                if (semanticCandidateSeen.has(key)) continue;
                semanticCandidateSeen.add(key);
                acc.candidateSeeds.push({ ...candidate });
            }
            for (const fact of item.derivedFacts || []) {
                acc.derivedFacts.push({ ...fact });
            }
            for (const record of item.provenance || []) {
                const key = `${record.fromFactId}|${record.toFactId}|${record.transitionId}|${record.reason}`;
                if (semanticProvenanceSeen.has(key)) continue;
                semanticProvenanceSeen.add(key);
                acc.provenance.push({ ...record });
            }
            for (const gap of item.gaps || []) {
                const key = `${gap.factId}|${gap.transitionId}|${gap.reason}|${gap.blockedBy}`;
                if (semanticGapSeen.has(key)) continue;
                semanticGapSeen.add(key);
                acc.gaps.push({ ...gap });
            }
            return acc;
        }, {
            enabled: true,
            truncated: false,
            stats: {
                dequeues: 0,
                visited: 0,
                elapsedMs: 0,
                transitionCounts: {},
            },
            seedCount: 0,
            sinkHitCount: 0,
            candidateSeedCount: 0,
            provenanceCount: 0,
            gapCount: 0,
            sinkHits: [] as NonNullable<EntryAnalyzeResult["semanticState"]>["sinkHits"],
            candidateSeeds: [] as NonNullable<EntryAnalyzeResult["semanticState"]>["candidateSeeds"],
            derivedFacts: [] as NonNullable<EntryAnalyzeResult["semanticState"]>["derivedFacts"],
            provenance: [] as NonNullable<EntryAnalyzeResult["semanticState"]>["provenance"],
            gaps: [] as NonNullable<EntryAnalyzeResult["semanticState"]>["gaps"],
        })
        : undefined;
    const reportEntries = entries.map(e => toReportEntry(e, options.reportMode));
    const ruleFeedback = buildRuleFeedback(
        options.repo,
        loadedRules,
        ruleHits,
        sourceContextCache,
        entries,
        {
            includeCoverageScan: options.reportMode === "full",
        },
    );

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
            memoryProfile: emptyAnalyzeMemoryProfile(),
            pagNodeResolutionAudit,
            executionHandoffAudit,
            semanticState,
            diagnostics,
            diagnosticItems,
            moduleAudit: moduleAuditSummary,
            pluginAudit: pluginAuditSummary,
            arkMainSeeds: arkMainSeedSummary.enabled
                ? arkMainSeedSummary
                : undefined,
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
            ruleFeedback,
        },
        entries: reportEntries,
    };

    const reportWriteT0 = process.hrtime.bigint();
    const outputLayout = resolveAnalyzeOutputLayout(options.outputDir);
    ensureAnalyzeOutputLayout(outputLayout);
    if (options.incremental) {
        saveIncrementalCache(incrementalCachePath, incrementalCacheScope, incrementalCache);
    }
    const jsonPath = outputLayout.summaryJsonPath;
    const mdPath = outputLayout.summaryMarkdownPath;
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderMarkdownReport(report), "utf-8");
    report.summary.stageProfile.reportWriteMs = Number(elapsedMsSince(reportWriteT0).toFixed(3));
    report.summary.stageProfile.totalMs = Number(elapsedMsSince(analyzeStart).toFixed(3));
    const transferSceneCacheStats = ConfigBasedTransferExecutor.getSceneRuleCacheStats();
    report.summary.stageProfile.transferSceneRuleCacheHitCount = transferSceneCacheStats.hitCount;
    report.summary.stageProfile.transferSceneRuleCacheMissCount = transferSceneCacheStats.missCount;
    report.summary.stageProfile.transferSceneRuleCacheDisabledCount = transferSceneCacheStats.disabledCount;
    report.summary.memoryProfile = memoryTracker.stop();
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderMarkdownReport(report), "utf-8");
    writeNoCandidateCallsiteArtifacts(report, options.outputDir);
    writeNoCandidateCallsiteClassificationArtifacts(report, loadedRules, options.outputDir);
    const diagnosticsArtifacts = writeDiagnosticsArtifacts(outputLayout.diagnosticsDir, report.summary.diagnostics);
    if (options.pluginAudit) {
        const pluginAuditPayload = {
            dryRun: options.pluginDryRun,
            isolate: options.pluginIsolate || [],
            loadedPlugins: enginePluginResult.plugins.map(plugin => plugin.name),
            loadedFiles: enginePluginResult.loadedFiles,
            warnings: enginePluginResult.warnings,
            loadIssues: enginePluginResult.loadIssues,
            summary: report.summary.pluginAudit,
            runtimeFailures: report.summary.diagnostics.enginePluginRuntimeFailures,
            diagnosticItems: report.summary.diagnosticItems.filter(item => item.category === "Plugin"),
        };
        fs.writeFileSync(outputLayout.pluginAuditJsonPath, JSON.stringify(pluginAuditPayload, null, 2), "utf-8");
    }
    writeAnalyzeRunManifest(outputLayout, report, {
        pluginAuditEnabled: options.pluginAudit,
    });

    return {
        report,
        jsonPath,
        mdPath,
        diagnosticsJsonPath: diagnosticsArtifacts.jsonPath,
        diagnosticsTextPath: diagnosticsArtifacts.textPath,
    };
}


