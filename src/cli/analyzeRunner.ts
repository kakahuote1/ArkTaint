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
import { writeC6DiagnosticArtifacts } from "./c6Diagnostics";
import { summarizeSemanticEffectLedger } from "../core/api/effects";
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
import { buildCurrentAssetCandidateTraceGraph } from "./ruleFeedbackTrace";
import { injectArkUiSdk } from "../core/substrate/ArkUiSdkConfig";
import { loadModules, type ModuleLoadResult } from "../core/orchestration/modules/ModuleLoader";
import { loadEnginePlugins, type EnginePluginLoadResult } from "../core/orchestration/plugins/EnginePluginLoader";
import { loadArkMainSeeds, ArkMainLoadResult } from "../core/entry/arkmain/ArkMainLoader";
import * as fs from "fs";
import * as path from "path";
import { resolveModelSelections, type ResolvedModelSelections } from "./modelSelection";
import {
    buildTraceGraph,
    FullTraceRun,
    mergeTraceGraphs,
    TraceGate,
    TraceGraph,
    writeTraceGraphArtifacts,
} from "../core/trace/TraceGraph";
import {
    emptyOfficialOccurrenceCoverageSnapshot,
    summarizeOfficialOccurrenceCoverage,
    type OfficialOccurrenceCoverageSnapshot,
    type OfficialOccurrenceRecord,
} from "../core/api/occurrence";
import {
    buildSourceCandidateCoverageTraceGraph,
    collectSourceCoverageCandidates,
} from "../core/trace/SourceCandidateCoverageTraceGraph";

function verboseAnalyzeLog(message: string): void {
    if (process.env.ARKTAINT_VERBOSE_BUILD === "1") {
        console.log(`[analyzeRunner] ${message}`);
    }
}

function progressAnalyzeLog(enabled: boolean, message: string): void {
    if (!enabled && process.env.ARKTAINT_VERBOSE_BUILD !== "1") return;
    console.log(`[analyzeRunner] ${new Date().toISOString()} ${message}`);
}

function buildRuleSourceTraceGraph(run: FullTraceRun, loadedRules: LoadedRuleSet): TraceGraph {
    const gates: TraceGate[] = (loadedRules.ruleSourceStatus || []).map((status, index) => {
        const sourceRuleCount = status.sourceRuleCount || 0;
        const sinkRuleCount = status.sinkRuleCount || 0;
        const sanitizerRuleCount = status.sanitizerRuleCount || 0;
        const transferRuleCount = status.transferRuleCount || 0;
        const totalRuleCount = sourceRuleCount + sinkRuleCount + sanitizerRuleCount + transferRuleCount;
        const emitted = Boolean(status.applied && totalRuleCount > 0);
        const skippedReason = status.exists === false
            ? "rule_source_missing"
            : !status.applied
                ? "rule_source_not_enabled"
                : emitted
                    ? undefined
                    : "rule_source_lowered_zero_rules";
        return {
            id: `rule_source:${index}`,
            label: `${status.name}:${status.packId || status.path}`,
            stage: "asset_lowering",
            producer: "asset",
            gateKind: "asset_lowering",
            scope: `rule_source:${status.name}:${status.packId || status.path}`,
            attempted: true,
            matched: Boolean(status.applied),
            emitted,
            skippedReason,
            evidence: {
                sourceName: status.name,
                path: status.path,
                source: status.source,
                packId: status.packId,
                exists: status.exists,
                applied: status.applied,
                sourceRuleCount,
                sinkRuleCount,
                sanitizerRuleCount,
                transferRuleCount,
                sourceRuleIds: status.sourceRuleIds || [],
                sinkRuleIds: status.sinkRuleIds || [],
            },
        };
    });
    return buildTraceGraph(
        {
            ...run,
            notes: [...(run.notes || []), "rule_source_asset_lowering_fragment"],
        },
        [],
        [],
        gates,
    );
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
    dst.substitutedValueCount += src.substitutedValueCount;
    dst.awaitUnwrapCount += src.awaitUnwrapCount;
    dst.expressionUseResolveCount += src.expressionUseResolveCount;
    dst.anchorLeftResolveCount += src.anchorLeftResolveCount;
    dst.addAttemptCount += src.addAttemptCount;
    dst.addFailureCount += src.addFailureCount;
    dst.unresolvedCount += src.unresolvedCount;
    for (const [kind, count] of Object.entries(src.unsupportedValueKinds || {})) {
        dst.unsupportedValueKinds[kind] = (dst.unsupportedValueKinds[kind] || 0) + count;
    }
    dst.endpointResolutionRecordCount = (dst.endpointResolutionRecordCount || 0)
        + (src.endpointResolutionRecordCount || src.endpointResolutionRecords?.length || 0);
    dst.endpointResolutionStatusCounts = dst.endpointResolutionStatusCounts || {};
    for (const [status, count] of Object.entries(src.endpointResolutionStatusCounts || {})) {
        dst.endpointResolutionStatusCounts[status as keyof NonNullable<PagNodeResolutionAuditSnapshot["endpointResolutionStatusCounts"]>] =
            (dst.endpointResolutionStatusCounts[status as keyof NonNullable<PagNodeResolutionAuditSnapshot["endpointResolutionStatusCounts"]>] || 0) + count;
    }
    dst.endpointResolutionRecords = [];
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

function transferSiteConsumptionKey(
    item: AnalyzeReport["summary"]["transferProfile"]["siteConsumptions"][number],
): string {
    return [
        item.ruleId,
        item.canonicalApiId,
        item.effectSiteId || "",
        item.callSignature || "",
        item.scheduled ? "scheduled" : "not_scheduled",
        item.fromMatched ? "from_matched" : "from_unmatched",
        item.toProjected ? "to_projected" : "to_unprojected",
        item.blockedReason || "",
        item.fromEndpoint?.status || "",
        item.fromEndpoint?.reason || "",
        item.toEndpoint?.status || "",
        item.toEndpoint?.reason || "",
    ].join("|");
}

function cloneTransferSiteConsumption(
    item: AnalyzeReport["summary"]["transferProfile"]["siteConsumptions"][number],
): AnalyzeReport["summary"]["transferProfile"]["siteConsumptions"][number] {
    return {
        ...item,
        fromEndpoint: item.fromEndpoint
            ? {
                ...item.fromEndpoint,
                nodeIds: [...item.fromEndpoint.nodeIds],
                carrierNodeIds: [...item.fromEndpoint.carrierNodeIds],
                fieldPath: item.fromEndpoint.fieldPath ? [...item.fromEndpoint.fieldPath] : undefined,
            }
            : undefined,
        toEndpoint: item.toEndpoint
            ? {
                ...item.toEndpoint,
                nodeIds: [...item.toEndpoint.nodeIds],
                carrierNodeIds: [...item.toEndpoint.carrierNodeIds],
                fieldPath: item.toEndpoint.fieldPath ? [...item.toEndpoint.fieldPath] : undefined,
            }
            : undefined,
        count: item.count || 1,
    };
}

function officialOccurrenceCoverageOf(engine: TaintPropagationEngine | undefined): OfficialOccurrenceCoverageSnapshot {
    return engine?.getOfficialOccurrenceCoverageSnapshot() || emptyOfficialOccurrenceCoverageSnapshot();
}

function officialOccurrenceLedgerOf(engine: TaintPropagationEngine | undefined): OfficialOccurrenceRecord[] {
    return engine?.getOfficialOccurrenceLedger() || [];
}

function semanticEffectLedgerOf(engine: TaintPropagationEngine | undefined) {
    return engine?.getSemanticEffectLedger() || [];
}

function writeOfficialOccurrenceArtifacts(
    layout: ReturnType<typeof resolveAnalyzeOutputLayout>,
    entries: readonly EntryAnalyzeResult[],
    coverage: OfficialOccurrenceCoverageSnapshot,
): void {
    const lines: string[] = [];
    const graphLines: string[] = [];
    for (const entry of entries) {
        for (const record of entry.officialOccurrenceLedger || []) {
            lines.push(JSON.stringify({
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                ...record,
            }));
            graphLines.push(JSON.stringify({
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                occurrenceId: record.occurrenceId,
                rawOccurrenceId: record.rawOccurrenceId,
                sourceFile: record.sourceFile,
                sourceLocation: record.sourceLocation,
                evidenceGraph: record.evidenceGraph,
            }));
        }
    }
    fs.writeFileSync(
        layout.officialOccurrenceLedgerJsonlPath,
        lines.length > 0 ? `${lines.join("\n")}\n` : "",
        "utf-8",
    );
    fs.writeFileSync(
        layout.officialOccurrenceEvidenceGraphJsonlPath,
        graphLines.length > 0 ? `${graphLines.join("\n")}\n` : "",
        "utf-8",
    );
    fs.writeFileSync(
        layout.officialIdentityCoverageJsonPath,
        JSON.stringify(coverage, null, 2),
        "utf-8",
    );
}

function writeEndpointResolutionArtifacts(
    layout: ReturnType<typeof resolveAnalyzeOutputLayout>,
    entries: readonly EntryAnalyzeResult[],
): void {
    const lines: string[] = [];
    for (const entry of entries) {
        for (const record of entry.pagNodeResolutionAudit.endpointResolutionRecords || []) {
            lines.push(JSON.stringify({
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                ...record,
            }));
        }
    }
    fs.writeFileSync(
        layout.endpointResolutionLedgerJsonlPath,
        lines.length > 0 ? `${lines.join("\n")}\n` : "",
        "utf-8",
    );
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

function collectExistingFilesUnder(root: string, extensions: Set<string>): string[] {
    const absRoot = path.resolve(root);
    if (!fs.existsSync(absRoot)) return [];
    const out: string[] = [];
    const stack = [absRoot];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const abs = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(abs);
                continue;
            }
            if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
                out.push(abs);
            }
        }
    }
    return out.sort((a, b) => a.localeCompare(b));
}

function buildAnalyzerImplementationFingerprint(): string {
    const files = [
        ...collectExistingFilesUnder(path.resolve("src", "core"), new Set([".ts", ".json"])),
        ...collectExistingFilesUnder(path.resolve("src", "cli"), new Set([".ts"])),
    ];
    return buildLoadedFileFingerprint(files);
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
        sourceSeedAudit: [],
        sourceRuleZeroHitAudit: [],
        callEdgeMaterializationLedger: [],
        flowCount: 0,
        sinkSamples: [],
        flowRuleTraces: [],
        ruleHits: emptyRuleHitCounters(),
        ruleHitEndpoints: emptyRuleHitCounters(),
        transferProfile: emptyTransferProfile(),
        detectProfile: emptyDetectProfile(),
        sinkDetectionAudit: { entries: [], overflowCount: 0 },
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

async function analyzeSourceDir(
    scene: Scene,
    sourceDir: string,
    options: CliOptions,
    resolvedSelections: ReturnType<typeof resolveModelSelections>,
    loadedRules: LoadedRuleSet,
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
    const candidateFastMode = options.flowMode === "candidate";
    const lightFlowMode = candidateFastMode || options.flowMode === "raw";
    const analysisAuditEnabled = !lightFlowMode;
    const traceGraphEnabled = !lightFlowMode;
    const progressLog = (message: string): void => progressAnalyzeLog(lightFlowMode, message);
    try {
        progressLog(`[entry] sourceDir=${sourceDir || "."} engine_create start`);
        engine = new TaintPropagationEngine(scene, options.k, {
            apiAssets: loadedRules.assets,
            assetIdentityIndex: loadedRules.assetIdentityIndex,
            canonicalApiRegistry: loadedRules.canonicalApiRegistry,
            transferRules: loadedRules.ruleSet.transfers || [],
            executionHandoff: options.executionHandoff,
            currentness: options.currentness,
            provenanceRecording: lightFlowMode ? "disabled" : "enabled",
            factIdTracking: lightFlowMode ? "disabled" : "enabled",
            flowRuleChainTracking: lightFlowMode ? "disabled" : "enabled",
            progressOutput: lightFlowMode ? "enabled" : "disabled",
            arkMainEntryClosure: candidateFastMode ? "scheduledOnly" : "full",
            reachabilityDirectExpansion: "enabled",
            receiverFieldBridgeMap: candidateFastMode ? "disabled" : "enabled",
            syntheticInvokeMaterialization: candidateFastMode ? "disabled" : "enabled",
            moduleRoots: options.modelRoots,
            semanticflowEvaluationModelRoots: options.semanticflowEvaluationModelRoots,
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
                enableWorklistProfile: !lightFlowMode,
                enableTraceGraph: traceGraphEnabled,
                traceRun: {
                    runId: `entry:${sourceDir || "."}:${Date.now()}`,
                    project: options.repo,
                    engineVersion: "arktaint",
                    assetVersion: buildRuleFingerprint(loadedRules),
                    configHash: `${options.profile}|k=${options.k}|entry=${options.entryModel || "arkMain"}|handoff=${options.executionHandoff || "enabled"}|currentness=${options.currentness || "enabled"}`,
                    llmSession: options.llmSessionCacheDir,
                    status: "partial",
                    notes: [`sourceDir=${sourceDir || "."}`],
                },
                worklistMaxElapsedMs: options.worklistBudgetMs && options.worklistBudgetMs > 0
                    ? options.worklistBudgetMs
                    : undefined,
                worklistMaxDequeues: options.worklistMaxDequeues && options.worklistMaxDequeues > 0
                    ? options.worklistMaxDequeues
                    : undefined,
                worklistMaxVisited: options.worklistMaxVisited && options.worklistMaxVisited > 0
                    ? options.worklistMaxVisited
                    : undefined,
                moduleSetupMaxElapsedMs: options.moduleSetupBudgetMs && options.moduleSetupBudgetMs > 0
                    ? options.moduleSetupBudgetMs
                    : undefined,
                executionHandoffMaxElapsedMs: options.executionHandoffBudgetMs && options.executionHandoffBudgetMs > 0
                    ? options.executionHandoffBudgetMs
                    : undefined,
                pagIndexMaxElapsedMs: options.pagIndexBudgetMs && options.pagIndexBudgetMs > 0
                    ? options.pagIndexBudgetMs
                    : undefined,
                lazyMaterializerMaxElapsedMs: options.lazyMaterializerBudgetMs && options.lazyMaterializerBudgetMs > 0
                    ? options.lazyMaterializerBudgetMs
                    : undefined,
                reachableMaxElapsedMs: options.reachableBudgetMs && options.reachableBudgetMs > 0
                    ? options.reachableBudgetMs
                    : undefined,
            },
        });
        engine.verbose = process.env.ARKTAINT_VERBOSE_BUILD === "1";
        progressLog(`[entry] sourceDir=${sourceDir || "."} engine_create done`);
        const buildPagT0 = process.hrtime.bigint();
        progressLog(`[entry] sourceDir=${sourceDir || "."} buildPAG start`);
        verboseAnalyzeLog(`buildPAG start source_dir=${sourceDir || "."}`);
        await engine.buildPAG({ entryModel: options.entryModel || "arkMain" });
        stageProfile.buildPagMs = elapsedMsSince(buildPagT0);
        stageProfile.buildPagProfile = engine.getPagBuildProfileSnapshot();
        progressLog(`[entry] sourceDir=${sourceDir || "."} buildPAG done elapsed_ms=${Math.round(stageProfile.buildPagMs)}`);
        verboseAnalyzeLog(`buildPAG done source_dir=${sourceDir || "."} elapsed_ms=${Math.round(stageProfile.buildPagMs)}`);

        const activeReachableMethodSignatures = engine.getActiveReachableMethodSignatures();
        let reachableMethodSignatures = activeReachableMethodSignatures;
        if (!activeReachableMethodSignatures) {
            progressLog(`[entry] sourceDir=${sourceDir || "."} reachable recompute start`);
            verboseAnalyzeLog(`reachable recompute start source_dir=${sourceDir || "."}`);
            reachableMethodSignatures = engine.computeReachableMethodSignatures();
            engine.setActiveReachableMethodSignatures(reachableMethodSignatures);
            progressLog(`[entry] sourceDir=${sourceDir || "."} reachable recompute done count=${reachableMethodSignatures.size}`);
            verboseAnalyzeLog(`reachable recompute done source_dir=${sourceDir || "."} count=${reachableMethodSignatures.size}`);
        } else {
            progressLog(`[entry] sourceDir=${sourceDir || "."} reachable reused count=${reachableMethodSignatures.size}`);
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
        progressLog(`[entry] sourceDir=${sourceDir || "."} source_rule_propagation start`);
        verboseAnalyzeLog(`source rule propagation start source_dir=${sourceDir || "."}`);
        const sourceRuleResult = engine.propagateWithSourceRules(getAnalyzeSourceRules(loadedRules));
        stageProfile.propagateRuleSeedMs = elapsedMsSince(sourceSeedT0);
        stageProfile.sourceRulePropagationProfile = engine.getSourceRulePropagationProfileSnapshot();
        progressLog(`[entry] sourceDir=${sourceDir || "."} source_rule_propagation done elapsed_ms=${Math.round(stageProfile.propagateRuleSeedMs)} seeds=${sourceRuleResult.seedCount}`);
        verboseAnalyzeLog(
            `source rule propagation done source_dir=${sourceDir || "."} elapsed_ms=${Math.round(stageProfile.propagateRuleSeedMs)} seeds=${sourceRuleResult.seedCount}`,
        );
        const worklistTruncation = engine.getWorklistTruncation();
        const worklistProfile = engine.getWorklistProfile();
        seedCount += sourceRuleResult.seedCount;
        for (const x of sourceRuleResult.seededLocals) seedLocalNames.add(x);
        if (sourceRuleResult.seedCount > 0) seedStrategies.add("rule:source");
        stageProfile.propagateHeuristicSeedMs = 0;

        if (seedCount === 0) {
            stageProfile.totalMs = elapsedMsSince(t0);
        progressLog(`[entry] sourceDir=${sourceDir || "."} done status=no_seed elapsed_ms=${Math.round(stageProfile.totalMs)}`);
        return {
            sourceDir,
            entryName: arkMainEntryName,
            entryPathHint: sourceDir,
            score: 100,
            status: "no_seed",
            seedCount: 0,
            seedLocalNames: [],
            seedStrategies: [],
            sourceSeedAudit: analysisAuditEnabled ? sourceRuleResult.sourceSeedAudit : [],
            sourceRuleZeroHitAudit: analysisAuditEnabled ? sourceRuleResult.sourceRuleZeroHitAudit : [],
            officialOccurrenceCoverage: analysisAuditEnabled ? officialOccurrenceCoverageOf(engine) : undefined,
            officialOccurrenceLedger: analysisAuditEnabled ? officialOccurrenceLedgerOf(engine) : [],
            semanticEffectLedger: analysisAuditEnabled ? semanticEffectLedgerOf(engine) : [],
            callEdgeMaterializationLedger: analysisAuditEnabled ? engine.getCallEdgeMaterializationLedger() : [],
            flowCount: 0,
            sinkSamples: [],
            flowRuleTraces: [],
            materializedTaintFlows: [],
            postsolveResults: [],
            ruleHits: emptyRuleHitCounters(),
                ruleHitEndpoints: emptyRuleHitCounters(),
                transferProfile: emptyTransferProfile(),
                detectProfile: emptyDetectProfile(),
                sinkDetectionAudit: { entries: [], overflowCount: 0 },
                stageProfile,
                transferNoHitReasons: ["no_source_seed"],
                pagNodeResolutionAudit: analysisAuditEnabled
                    ? engine.getPagNodeResolutionAuditSnapshot()
                    : emptyPagNodeResolutionAuditSnapshot(),
                executionHandoffAudit,
                moduleAudit: analysisAuditEnabled ? engine.getModuleAuditSnapshot() : emptyModuleAuditSnapshot(),
                enginePluginAudit: analysisAuditEnabled ? engine.getEnginePluginAuditSnapshot() : emptyEnginePluginAuditSnapshot(),
                arkMainSeeds: engine.getArkMainSeedReport(),
                traceGraph: traceGraphEnabled
                    ? engine.getTraceGraphSnapshot({
                        project: options.repo,
                        status: "completed",
                        notes: [`sourceDir=${sourceDir || "."}`, "no_source_seed"],
                    })
                    : undefined,
                elapsedMs: stageProfile.totalMs
            };
        }

        let detected: ReturnType<typeof detectFlows> | undefined;
        let detectProfile = emptyDetectProfile();
        let detectElapsedMs = 0;
        const detectT0 = process.hrtime.bigint();
        engine.resetDetectProfile();
        progressLog(`[entry] sourceDir=${sourceDir || "."} detect start`);
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
            detailed: !lightFlowMode && options.reportMode === "full",
            stopOnFirstFlow: detectStopPolicy.stopOnFirstFlow,
            maxFlowsPerEntry: detectStopPolicy.maxFlowsPerEntry,
            applyPreSinkSanitizers: false,
        });
        const detectedFlows = detected.flows;
        detectProfile = engine.getDetectProfile();
        detectElapsedMs = elapsedMsSince(detectT0);
        progressLog(`[entry] sourceDir=${sourceDir || "."} detect done elapsed_ms=${Math.round(detectElapsedMs)} flows=${detected.totalFlowCount}`);
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
        progressLog(`[entry] sourceDir=${sourceDir || "."} postprocess start flow_mode=${options.flowMode}`);
        if (lightFlowMode) {
            transferNoHitReasons.push(`flow_mode_${options.flowMode}_postsolve_skipped`);
        }
        const postsolveResults = lightFlowMode
            ? { survivingFlows: detectedFlows, results: [] }
            : engine.evaluatePostsolveFlowResults(detectedFlows, {
                sanitizerRules: loadedRules.ruleSet.sanitizers || [],
                materialize: options.profile === "fast"
                    ? {
                        maxPaths: 16,
                        maxDepth: 64,
                        maxDagFacts: 2000,
                        maxDagEdges: 5000,
                        maxElapsedMs: 1500,
                    }
                    : {
                        maxPaths: 128,
                        maxDepth: 128,
                    },
            });
        const survivingFlows = postsolveResults.survivingFlows;
        const survivingSinkTexts = new Set<string>(survivingFlows.map(flow => flow.sink.toString()));
        const survivingSinkSamples = (detected?.sinkSamples || []).filter(sample =>
            [...survivingSinkTexts].some(text => sample.includes(text)),
        );
        const survivingFlowRuleTraces = (detected?.flowRuleTraces || []).filter(trace =>
            survivingFlows.some(flow =>
                flow.source === trace.source
                && flow.sink.toString() === trace.sink,
            ),
        );
        const materializedForReport = postsolveResults.results
            .map(result => ({
                sinkFactId: result.flow.sinkFactId || "",
                status: result.report.witness?.status,
                incompleteReasons: [...(result.report.witness?.incompleteReasons || [])],
                judgement: result.judgement.kind,
                evidenceKinds: [...result.evidenceSummary.evidenceKinds],
                paths: result.paths
                    .map(path => ({
                        factIds: path.factIds,
                        status: path.status,
                        incompleteReasons: [...(path.incompleteReasons || [])],
                        truncated: path.truncated,
                        judgement: path.judgement.kind,
                        evidenceKinds: [...new Set((path.evidence || []).map(item => item.kind))],
                    })),
            }))
            .filter(item => item.sinkFactId && item.paths.length > 0);
        const observedTaintFacts: Array<{
            factId: string;
            nodeId: number;
            fieldPath?: string[];
            source: string;
            value?: string;
        }> = [];
        let observedTaintFactOverflowCount = 0;
        const maxObservedTaintFactsForTrace = lightFlowMode ? 0 : 50000;
        if (maxObservedTaintFactsForTrace > 0) {
            for (const [nodeId, facts] of engine.getObservedTaintFacts().entries()) {
                for (const fact of facts) {
                    if (observedTaintFacts.length >= maxObservedTaintFactsForTrace) {
                        observedTaintFactOverflowCount++;
                        continue;
                    }
                    observedTaintFacts.push({
                        factId: fact.taintId,
                        nodeId,
                        fieldPath: fact.field ? [...fact.field] : undefined,
                        source: fact.source,
                        value: String(fact.node.getValue?.()?.toString?.() || ""),
                    });
                }
            }
        }
        const reportTransferProfile = lightFlowMode
            ? {
                ...transferProfile,
                noCandidateCallsites: [],
                siteConsumptions: [],
            }
            : transferProfile;
        stageProfile.postProcessMs = elapsedMsSince(postProcessT0);
        stageProfile.totalMs = elapsedMsSince(t0);
        progressLog(`[entry] sourceDir=${sourceDir || "."} postprocess done elapsed_ms=${Math.round(stageProfile.postProcessMs)} total_ms=${Math.round(stageProfile.totalMs)} flows=${survivingFlows.length}`);
        return {
            sourceDir,
            entryName: arkMainEntryName,
            entryPathHint: sourceDir,
            score: 100,
            status: worklistTruncation ? "budget_exceeded" : "ok",
            seedCount,
            seedLocalNames: [...seedLocalNames].sort(),
            seedStrategies: [...seedStrategies].sort(),
            sourceSeedAudit: analysisAuditEnabled ? sourceRuleResult.sourceSeedAudit : [],
            sourceRuleZeroHitAudit: analysisAuditEnabled ? sourceRuleResult.sourceRuleZeroHitAudit : [],
            officialOccurrenceCoverage: analysisAuditEnabled ? officialOccurrenceCoverageOf(engine) : undefined,
            officialOccurrenceLedger: analysisAuditEnabled ? officialOccurrenceLedgerOf(engine) : [],
            semanticEffectLedger: analysisAuditEnabled ? semanticEffectLedgerOf(engine) : [],
            callEdgeMaterializationLedger: analysisAuditEnabled ? engine.getCallEdgeMaterializationLedger() : [],
            observedTaintFacts,
            observedTaintFactOverflowCount,
            flowCount: survivingFlows.length,
            sinkSamples: survivingSinkSamples,
            flowRuleTraces: survivingFlowRuleTraces,
            materializedTaintFlows: materializedForReport.map(item => ({
                sinkFactId: item.sinkFactId,
                status: item.status,
                incompleteReasons: item.incompleteReasons,
                judgement: item.judgement,
                evidenceKinds: item.evidenceKinds,
                paths: item.paths.map(path => ({
                    factIds: path.factIds,
                    status: path.status,
                    incompleteReasons: path.incompleteReasons,
                    truncated: path.truncated,
                    judgement: path.judgement,
                    evidenceKinds: path.evidenceKinds,
                })),
            })),
            postsolveResults: postsolveResults.results,
            ruleHits,
            ruleHitEndpoints,
            transferProfile: reportTransferProfile,
            detectProfile,
            sinkDetectionAudit: analysisAuditEnabled
                ? engine.getSinkDetectionAuditSnapshot()
                : { entries: [], overflowCount: 0 },
            stageProfile,
            transferNoHitReasons,
            pagNodeResolutionAudit: analysisAuditEnabled
                ? engine.getPagNodeResolutionAuditSnapshot()
                : emptyPagNodeResolutionAuditSnapshot(),
            executionHandoffAudit,
            moduleAudit: analysisAuditEnabled ? engine.getModuleAuditSnapshot() : emptyModuleAuditSnapshot(),
            enginePluginAudit: analysisAuditEnabled ? engine.getEnginePluginAuditSnapshot() : emptyEnginePluginAuditSnapshot(),
            arkMainSeeds: engine.getArkMainSeedReport(),
            worklistProfile,
            worklistTruncation,
            traceGraph: traceGraphEnabled
                ? engine.getTraceGraphSnapshot({
                    project: options.repo,
                    status: worklistTruncation ? "partial" : "completed",
                    notes: [`sourceDir=${sourceDir || "."}`],
                })
                : undefined,
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
            sourceSeedAudit: [],
            sourceRuleZeroHitAudit: [],
            officialOccurrenceCoverage: analysisAuditEnabled ? officialOccurrenceCoverageOf(engine) : undefined,
            officialOccurrenceLedger: analysisAuditEnabled ? officialOccurrenceLedgerOf(engine) : [],
            semanticEffectLedger: analysisAuditEnabled ? semanticEffectLedgerOf(engine) : [],
            callEdgeMaterializationLedger: analysisAuditEnabled ? engine?.getCallEdgeMaterializationLedger() || [] : [],
            flowCount: 0,
            sinkSamples: [],
            flowRuleTraces: [],
            materializedTaintFlows: [],
            postsolveResults: [],
            ruleHits: emptyRuleHitCounters(),
            ruleHitEndpoints: emptyRuleHitCounters(),
            transferProfile: emptyTransferProfile(),
            detectProfile: emptyDetectProfile(),
            sinkDetectionAudit: analysisAuditEnabled
                ? engine?.getSinkDetectionAuditSnapshot() || { entries: [], overflowCount: 0 }
                : { entries: [], overflowCount: 0 },
            stageProfile,
            transferNoHitReasons: ["analyze_exception"],
            pagNodeResolutionAudit: analysisAuditEnabled
                ? engine?.getPagNodeResolutionAuditSnapshot() || emptyPagNodeResolutionAuditSnapshot()
                : emptyPagNodeResolutionAuditSnapshot(),
            executionHandoffAudit: engine
                ? {
                    contracts: engine.getExecutionHandoffContractSnapshot()?.totalContracts || 0,
                    syntheticEdges: engine.getSyntheticInvokeEdgeSnapshot().totalEdges || 0,
                    syntheticCallers: engine.getSyntheticInvokeEdgeSnapshot().callerSignatures.length || 0,
                    syntheticCallees: engine.getSyntheticInvokeEdgeSnapshot().calleeSignatures.length || 0,
                }
                : emptyExecutionHandoffAudit(),
            moduleAudit: analysisAuditEnabled ? engine?.getModuleAuditSnapshot() || emptyModuleAuditSnapshot() : emptyModuleAuditSnapshot(),
            enginePluginAudit: analysisAuditEnabled ? engine?.getEnginePluginAuditSnapshot() || emptyEnginePluginAuditSnapshot() : emptyEnginePluginAuditSnapshot(),
            arkMainSeeds: engine?.getArkMainSeedReport(),
            traceGraph: traceGraphEnabled
                ? engine?.getTraceGraphSnapshot({
                    project: options.repo,
                    status: "failed",
                    notes: [`sourceDir=${sourceDir || "."}`, "analyze_exception"],
                })
                : undefined,
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

export interface AnalyzeRuntime {
    resolvedSelections: ResolvedModelSelections;
    pluginDirs: string[];
    pluginFiles: string[];
    moduleResult: ModuleLoadResult;
    enginePluginResult: EnginePluginLoadResult;
    loadedRules: LoadedRuleSet;
    ruleLoadMs: number;
}

export function prepareAnalyzeRuntime(options: CliOptions): AnalyzeRuntime {
    const modelSelectionRoots = [
        ...(options.modelRoots || []),
        ...(options.semanticflowEvaluationModelRoots || []),
    ];
    const resolvedSelections = resolveModelSelections({
        ruleOptions: options.ruleOptions,
        modelRoots: modelSelectionRoots,
        enabledModels: options.enabledModels,
        disabledModels: options.disabledModels,
    });
    const pluginDirs = (options.pluginPaths || []).filter(p => fs.existsSync(p) && fs.statSync(p).isDirectory());
    const pluginFiles = (options.pluginPaths || []).filter(p => fs.existsSync(p) && fs.statSync(p).isFile());
    const moduleResult = loadModules({
        moduleRoots: options.modelRoots || [],
        semanticflowEvaluationModelRoots: options.semanticflowEvaluationModelRoots,
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
        semanticflowEvaluationModelRoots: options.semanticflowEvaluationModelRoots,
    });
    const ruleLoadMs = elapsedMsSince(ruleLoadT0);
    return {
        resolvedSelections,
        pluginDirs,
        pluginFiles,
        moduleResult,
        enginePluginResult,
        loadedRules,
        ruleLoadMs,
    };
}

export async function runAnalyze(options: CliOptions, preloadedRuntime?: AnalyzeRuntime): Promise<AnalyzeRunResult> {
    const analyzeStart = process.hrtime.bigint();
    const memoryTracker = createAnalyzeMemoryTracker();
    const stageProfile = emptyAnalyzeStageProfile();
    const lightFlowMode = options.flowMode === "candidate" || options.flowMode === "raw";
    const traceGraphEnabled = !lightFlowMode;
    ConfigBasedTransferExecutor.resetSceneRuleCacheStats();
    const runtimeWasPreloaded = !!preloadedRuntime;
    const runtime = preloadedRuntime || prepareAnalyzeRuntime(options);
    const resolvedSelections = runtime.resolvedSelections;
    const pluginDirs = runtime.pluginDirs;
    const pluginFiles = runtime.pluginFiles;
    const moduleResult = runtime.moduleResult;
    const enginePluginResult = runtime.enginePluginResult;
    const loadedRules = runtime.loadedRules;
    const arkMainWarningSet = new Set<string>();
    stageProfile.ruleLoadMs = runtimeWasPreloaded ? 0 : runtime.ruleLoadMs;
    progressAnalyzeLog(lightFlowMode, `[analyze] rule_load ${runtimeWasPreloaded ? "reused" : "done"} elapsed_ms=${Math.round(stageProfile.ruleLoadMs)}`);
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
    const ruleFingerprint = buildRuleFingerprint(loadedRules);
    const analysisFingerprint = buildIncrementalFingerprint({
        ruleFingerprint,
        moduleFiles: buildLoadedFileFingerprint(moduleResult.loadedFiles),
        enginePluginFiles: buildLoadedFileFingerprint(enginePluginResult.loadedFiles),
        modelRoots: (options.modelRoots || []).map(item => path.resolve(item)).sort(),
        semanticflowEvaluationModelRoots: (options.semanticflowEvaluationModelRoots || []).map(item => path.resolve(item)).sort(),
        enabledModuleProjects: [...resolvedSelections.enabledModuleProjects].sort(),
        disabledModuleProjects: [...resolvedSelections.disabledModuleProjects].sort(),
        disabledModuleIds: [...(options.disabledModuleIds || [])].sort(),
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
        flowMode: options.flowMode,
        analyzerImplementationFingerprint: buildAnalyzerImplementationFingerprint(),
        analysisCoreVersion: "handoff-sensitive-provenance-postsolve-v3-endpoint-scoped-sink-family",
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
    // A FullTraceRun must describe the current engine/assets/config execution.
    // Reusing entry-level incremental results would mix old propagation facts into
    // the current Trace Graph, so trace-enabled analysis deliberately bypasses
    // entry cache reads and writes.
    const traceGraphRequiresFreshEntries = traceGraphEnabled;
    const useIncrementalEntryCache = options.incremental && !traceGraphRequiresFreshEntries;
    const incrementalCache = useIncrementalEntryCache
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
                progressAnalyzeLog(lightFlowMode, `[analyze] sourceDir=${sourceDir} scene_config start`);
                traceAnalyzeBuild(`[analyze] sourceDir=${sourceDir} scene_config start`);
                const config = new SceneConfig();
                config.buildFromProjectDir(sourceAbs);
                injectArkUiSdk(config);
                progressAnalyzeLog(lightFlowMode, `[analyze] sourceDir=${sourceDir} scene_build start`);
                traceAnalyzeBuild(`[analyze] sourceDir=${sourceDir} scene_build start`);
                scene = new Scene();
                scene.buildSceneFromProjectDir(config);
                progressAnalyzeLog(lightFlowMode, `[analyze] sourceDir=${sourceDir} infer_types start`);
                traceAnalyzeBuild(`[analyze] sourceDir=${sourceDir} infer_types start`);
                scene.inferTypes();
                progressAnalyzeLog(lightFlowMode, `[analyze] sourceDir=${sourceDir} arkmain_load start`);
                traceAnalyzeBuild(`[analyze] sourceDir=${sourceDir} arkmain_load start`);
                arkMainLoad = loadArkMainSeeds(scene, {
                    arkMainRoots: options.modelRoots,
                    enabledArkMainProjects: resolvedSelections.enabledArkMainProjects,
                    disabledArkMainProjects: resolvedSelections.disabledArkMainProjects,
                    semanticflowEvaluationModelRoots: options.semanticflowEvaluationModelRoots,
                });
                progressAnalyzeLog(lightFlowMode, `[analyze] sourceDir=${sourceDir} arkmain_load done`);
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
                progressAnalyzeLog(lightFlowMode, `[analyze] sourceDir=${sourceDir} scene_total done elapsed_ms=${Math.round(elapsedMsSince(sceneBuildT0))}`);
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
        if (useIncrementalEntryCache) {
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
    progressAnalyzeLog(lightFlowMode, `[analyze] entry_tasks start count=${pendingTasks.length} concurrency=${options.concurrency}`);
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
                pluginDirs,
                pluginFiles,
                task.arkMainLoad,
            );
        }
    );
    progressAnalyzeLog(lightFlowMode, `[analyze] entry_tasks done count=${pendingResults.length}`);

    progressAnalyzeLog(lightFlowMode, "[analyze] entry_results merge start");
    for (let i = 0; i < pendingTasks.length; i++) {
        const task = pendingTasks[i];
        const entryResult = pendingResults[i];
        orderedEntries[task.order] = entryResult;
        stageProfile.entryAnalyzeMs += entryResult.stageProfile.totalMs;

        if (useIncrementalEntryCache && task.entryStamp && entryResult.status !== "exception") {
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
    progressAnalyzeLog(lightFlowMode, "[analyze] entry_results merge done");

    const entries: EntryAnalyzeResult[] = orderedEntries.filter((e): e is EntryAnalyzeResult => !!e);

    const aggregateStartedAt = process.hrtime.bigint();
    progressAnalyzeLog(lightFlowMode, `[analyze] aggregate_summary start entries=${entries.length}`);
    const statusCount: Record<string, number> = {};
    let okEntries = 0;
    let withSeeds = 0;
    let withFlows = 0;
    let withPartialFlows = 0;
    let totalFlows = 0;
    let partialFlows = 0;
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
        siteConsumptions: [] as AnalyzeReport["summary"]["transferProfile"]["siteConsumptions"],
    };
    const noCandidateSummaryMap = new Map<string, AnalyzeReport["summary"]["transferProfile"]["noCandidateCallsites"][number]>();
    const transferSiteConsumptionMap = new Map<string, AnalyzeReport["summary"]["transferProfile"]["siteConsumptions"][number]>();
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
        if (e.flowCount > 0) {
            if (e.status === "budget_exceeded") {
                withPartialFlows++;
                partialFlows += e.flowCount;
            } else {
                withFlows++;
                totalFlows += e.flowCount;
            }
        }
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
        if (!lightFlowMode) {
            for (const site of e.transferProfile.noCandidateCallsites || []) {
                const key = `${site.calleeSignature}|${site.method}|${site.invokeKind}|${site.argCount}|${site.sourceFile}`;
                const existing = noCandidateSummaryMap.get(key);
                if (existing) {
                    existing.count += site.count;
                } else {
                    noCandidateSummaryMap.set(key, { ...site });
                }
            }
            for (const item of e.transferProfile.siteConsumptions || []) {
                const key = transferSiteConsumptionKey(item);
                const existing = transferSiteConsumptionMap.get(key);
                if (existing) {
                    existing.count = (existing.count || 1) + (item.count || 1);
                    existing.resultCount += item.resultCount;
                } else {
                    transferSiteConsumptionMap.set(key, cloneTransferSiteConsumption(item));
                }
            }
        }
        detectProfile.detectCallCount += e.detectProfile.detectCallCount;
        detectProfile.methodsVisited += e.detectProfile.methodsVisited;
        detectProfile.reachableMethodsVisited += e.detectProfile.reachableMethodsVisited;
        detectProfile.stmtsVisited += e.detectProfile.stmtsVisited;
        detectProfile.invokeStmtsVisited += e.detectProfile.invokeStmtsVisited;
        detectProfile.effectMatchedInvokeCount += e.detectProfile.effectMatchedInvokeCount;
        detectProfile.constraintRejectedInvokeCount += e.detectProfile.constraintRejectedInvokeCount;
        detectProfile.sinksChecked += e.detectProfile.sinksChecked;
        detectProfile.candidateCount += e.detectProfile.candidateCount;
        detectProfile.taintCheckCount += e.detectProfile.taintCheckCount;
        detectProfile.defReachabilityCheckCount += e.detectProfile.defReachabilityCheckCount;
        detectProfile.fieldPathCheckCount += e.detectProfile.fieldPathCheckCount;
        detectProfile.fieldPathHitCount += e.detectProfile.fieldPathHitCount;
        detectProfile.sanitizerGuardCheckCount += e.detectProfile.sanitizerGuardCheckCount;
        detectProfile.sanitizerGuardHitCount += e.detectProfile.sanitizerGuardHitCount;
        detectProfile.effectMatchMs += e.detectProfile.effectMatchMs;
        detectProfile.candidateResolveMs += e.detectProfile.candidateResolveMs;
        detectProfile.taintEvalMs += e.detectProfile.taintEvalMs;
        detectProfile.sanitizerGuardMs += e.detectProfile.sanitizerGuardMs;
        detectProfile.traversalMs += e.detectProfile.traversalMs;
        detectProfile.totalMs += e.detectProfile.totalMs;
        if (!lightFlowMode) {
            accumulatePagNodeResolutionAudit(pagNodeResolutionAudit, e.pagNodeResolutionAudit);
        }
        executionHandoffAudit.contracts += e.executionHandoffAudit.contracts;
        executionHandoffAudit.syntheticEdges += e.executionHandoffAudit.syntheticEdges;
        executionHandoffAudit.syntheticCallers += e.executionHandoffAudit.syntheticCallers;
        executionHandoffAudit.syntheticCallees += e.executionHandoffAudit.syntheticCallees;
        if (!lightFlowMode) {
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
                        emissionSamples: (stats.emissionSamples || []).map(sample => ({
                            ...sample,
                            sourceFieldPath: sample.sourceFieldPath ? [...sample.sourceFieldPath] : undefined,
                            targetFieldPath: sample.targetFieldPath ? [...sample.targetFieldPath] : undefined,
                        })),
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
                current.emissionSampleOverflowCount += stats.emissionSampleOverflowCount || 0;
                for (const sample of stats.emissionSamples || []) {
                    if (current.emissionSamples.length < 200) {
                        current.emissionSamples.push({
                            ...sample,
                            sourceFieldPath: sample.sourceFieldPath ? [...sample.sourceFieldPath] : undefined,
                            targetFieldPath: sample.targetFieldPath ? [...sample.targetFieldPath] : undefined,
                        });
                    } else {
                        current.emissionSampleOverflowCount += 1;
                    }
                }
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
        }
        if (e.arkMainSeeds) {
            arkMainSeedSummary.enabled = arkMainSeedSummary.enabled || e.arkMainSeeds.enabled;
            arkMainSeedSummary.methodCount = Math.max(arkMainSeedSummary.methodCount, e.arkMainSeeds.methodCount || 0);
            arkMainSeedSummary.factCount = Math.max(arkMainSeedSummary.factCount, e.arkMainSeeds.factCount || 0);
        }
        if (!lightFlowMode && e.status === "exception") {
            diagnostics.systemFailures.push(buildEntryAnalyzeFailureEvent(e));
        }
        if (!lightFlowMode) {
            diagnostics.moduleRuntimeFailures.push(...e.moduleAudit.failureEvents);
            diagnostics.enginePluginRuntimeFailures.push(...e.enginePluginAudit.failureEvents);
        }
        transferShareCount++;
        for (const reason of e.transferNoHitReasons) {
            transferNoHitReasons[reason] = (transferNoHitReasons[reason] || 0) + 1;
        }
    }
    progressAnalyzeLog(lightFlowMode, `[analyze] aggregate_entries done elapsed_ms=${Math.round(elapsedMsSince(aggregateStartedAt))}`);
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
    progressAnalyzeLog(lightFlowMode, `[analyze] aggregate_diagnostics done elapsed_ms=${Math.round(elapsedMsSince(aggregateStartedAt))}`);
    transferProfile.noCandidateCallsites = [...noCandidateSummaryMap.values()]
        .sort((a, b) => b.count - a.count || a.calleeSignature.localeCompare(b.calleeSignature))
        .slice(0, 200);
    transferProfile.siteConsumptions = [...transferSiteConsumptionMap.values()]
        .sort((a, b) =>
            (b.count || 1) - (a.count || 1)
            || a.ruleId.localeCompare(b.ruleId)
            || (a.callSignature || "").localeCompare(b.callSignature || ""))
        .slice(0, 500);
    const analysisAuditEnabled = !lightFlowMode;
    const officialOccurrenceRecords = analysisAuditEnabled
        ? entries.flatMap(entry => entry.officialOccurrenceLedger || [])
        : [];
    const officialIdentityCoverage = summarizeOfficialOccurrenceCoverage(officialOccurrenceRecords);
    const semanticEffectLedgerRows = analysisAuditEnabled
        ? entries.flatMap(entry => entry.semanticEffectLedger || [])
        : [];
    const semanticEffectLedgerSummary = summarizeSemanticEffectLedger(semanticEffectLedgerRows);
    progressAnalyzeLog(lightFlowMode, `[analyze] aggregate_ledgers done elapsed_ms=${Math.round(elapsedMsSince(aggregateStartedAt))}`);
    const reportEntries = entries.map(e => toReportEntry(e, lightFlowMode ? "light" : options.reportMode));
    progressAnalyzeLog(lightFlowMode, `[analyze] report_entries done entries=${reportEntries.length} elapsed_ms=${Math.round(elapsedMsSince(aggregateStartedAt))}`);
    const ruleFeedback = analysisAuditEnabled
        ? buildRuleFeedback(
            options.repo,
            loadedRules,
            ruleHits,
            sourceContextCache,
            entries,
            {
                includeCoverageScan: options.reportMode === "full",
            },
        )
        : {
            zeroHitRules: emptyRuleHitCounters(),
            sourceZeroHitAudit: [],
            ruleHitRanking: {
                source: [],
                sink: [],
                transfer: [],
            },
            uncoveredHighFrequencyInvokes: [],
            noCandidateCallsites: [],
        };
    progressAnalyzeLog(lightFlowMode, `[analyze] rule_feedback done enabled=${analysisAuditEnabled} elapsed_ms=${Math.round(elapsedMsSince(aggregateStartedAt))}`);

    const report: AnalyzeReport = {
        generatedAt: new Date().toISOString(),
        repo: options.repo,
        sourceDirs: options.sourceDirs,
        profile: options.profile,
        reportMode: lightFlowMode ? "light" : options.reportMode,
        flowMode: options.flowMode,
        k: options.k,
        maxEntries: options.maxEntries,
        ruleSources: loadedRules.appliedRuleSources,
        ruleSourceStatus: loadedRules.ruleSourceStatus.map(s => ({
            name: s.name,
            path: s.path,
            applied: s.applied,
            exists: s.exists,
            source: s.source,
            packId: s.packId,
            sourceRuleCount: s.sourceRuleCount,
            sinkRuleCount: s.sinkRuleCount,
            sanitizerRuleCount: s.sanitizerRuleCount,
            transferRuleCount: s.transferRuleCount,
            sourceRuleIds: s.sourceRuleIds,
            sinkRuleIds: s.sinkRuleIds,
        })),
        summary: {
            totalEntries: entries.length,
            okEntries,
            withSeeds,
            withFlows,
            withPartialFlows,
            totalFlows,
            partialFlows,
            statusCount,
            ruleHits,
            ruleHitEndpoints,
            transferProfile,
            detectProfile,
            memoryProfile: emptyAnalyzeMemoryProfile(),
            pagNodeResolutionAudit,
            executionHandoffAudit,
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
            officialIdentityCoverage,
            semanticEffectLedgerSummary,
            ruleFeedback,
        },
        entries: reportEntries,
    };
    if (lightFlowMode) {
        report.summary.transferProfile.noCandidateCallsites = [];
        report.summary.transferProfile.siteConsumptions = [];
        report.summary.pagNodeResolutionAudit = emptyPagNodeResolutionAuditSnapshot();
        report.summary.officialIdentityCoverage = emptyOfficialOccurrenceCoverageSnapshot();
        report.summary.semanticEffectLedgerSummary = summarizeSemanticEffectLedger([]);
        report.summary.moduleAudit = {
            loadedModuleIds: [],
            failedModuleIds: [],
            discoveredModuleProjects: [],
            enabledModuleProjects: [],
            modules: {},
        };
        report.summary.pluginAudit = {
            loadedPluginNames: [],
            failedPluginNames: [],
            plugins: {},
        };
        report.summary.ruleFeedback = {
            zeroHitRules: emptyRuleHitCounters(),
            sourceZeroHitAudit: [],
            ruleHitRanking: {
                source: [],
                sink: [],
                transfer: [],
            },
            uncoveredHighFrequencyInvokes: [],
            noCandidateCallsites: [],
        };
    }
    const reportWriteT0 = process.hrtime.bigint();
    progressAnalyzeLog(lightFlowMode, "[analyze] report_write start");
    const outputLayout = resolveAnalyzeOutputLayout(options.outputDir);
    ensureAnalyzeOutputLayout(outputLayout);
    if (useIncrementalEntryCache) {
        saveIncrementalCache(incrementalCachePath, incrementalCacheScope, incrementalCache);
    }
    const jsonPath = outputLayout.summaryJsonPath;
    const mdPath = outputLayout.summaryMarkdownPath;
    const transferSceneCacheStats = ConfigBasedTransferExecutor.getSceneRuleCacheStats();
    report.summary.stageProfile.transferSceneRuleCacheHitCount = transferSceneCacheStats.hitCount;
    report.summary.stageProfile.transferSceneRuleCacheMissCount = transferSceneCacheStats.missCount;
    report.summary.stageProfile.transferSceneRuleCacheDisabledCount = transferSceneCacheStats.disabledCount;
    report.summary.memoryProfile = memoryTracker.stop();
    report.summary.stageProfile.totalMs = Number(elapsedMsSince(analyzeStart).toFixed(3));
    const jsonIndent = lightFlowMode ? 0 : 2;
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, jsonIndent), "utf-8");
    fs.writeFileSync(mdPath, renderMarkdownReport(report), "utf-8");
    report.summary.stageProfile.reportWriteMs = Number(elapsedMsSince(reportWriteT0).toFixed(3));
    report.summary.stageProfile.totalMs = Number(elapsedMsSince(analyzeStart).toFixed(3));
    if (!lightFlowMode) {
        fs.writeFileSync(jsonPath, JSON.stringify(report, null, jsonIndent), "utf-8");
        fs.writeFileSync(mdPath, renderMarkdownReport(report), "utf-8");
    }
    progressAnalyzeLog(lightFlowMode, `[analyze] report_write done elapsed_ms=${Math.round(report.summary.stageProfile.reportWriteMs)} total_ms=${Math.round(report.summary.stageProfile.totalMs)} total_flows=${report.summary.totalFlows}`);
    if (analysisAuditEnabled) {
        writeOfficialOccurrenceArtifacts(outputLayout, entries, report.summary.officialIdentityCoverage);
        writeEndpointResolutionArtifacts(outputLayout, entries);
        writeC6DiagnosticArtifacts(outputLayout, entries, report);
        writeNoCandidateCallsiteArtifacts(report, options.outputDir);
    }
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
    if (traceGraphEnabled) {
        const noCandidateClassificationArtifacts = writeNoCandidateCallsiteClassificationArtifacts(report, loadedRules, options.outputDir);
        const entryRecoveryGates: TraceGate[] = entries.map((entry, index) => ({
            id: `gate:entry_recovery:${index + 1}`,
            stage: "entry_recovery",
            producer: "entry",
            gateKind: "entry_recovery",
            scope: `entry:${entry.sourceDir}:${entry.entryName}`,
            attempted: true,
            matched: entry.status !== "no_entry" && entry.status !== "exception",
            emitted: entry.status === "ok" || entry.status === "no_seed" || entry.status === "budget_exceeded",
            skippedReason: entry.status === "no_entry" || entry.status === "no_body" ? entry.status : undefined,
            blockedReason: entry.status === "exception" ? entry.error || "entry_exception" : undefined,
            evidence: {
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                entryPathHint: entry.entryPathHint,
                status: entry.status,
                seedCount: entry.seedCount,
                flowCount: entry.flowCount,
                fromCache: entry.fromCache,
            },
        }));
        const entryRecoveryGraph = buildTraceGraph({
            runId: `entry-recovery:${path.basename(options.repo)}:${Date.now()}`,
            project: options.repo,
            engineVersion: "arktaint",
            assetVersion: ruleFingerprint,
            configHash: analysisFingerprint,
            llmSession: options.llmSessionCacheDir,
            startedAt: report.generatedAt,
            completedAt: new Date().toISOString(),
            status: report.summary.statusCount.exception ? "partial" : "completed",
            notes: ["entry_recovery_coverage_fragment"],
        }, [], [], entryRecoveryGates);
        const currentAssetCandidateGraph = buildCurrentAssetCandidateTraceGraph({
            run: {
                runId: `current-assets-candidates:${path.basename(options.repo)}:${Date.now()}`,
                project: options.repo,
                engineVersion: "arktaint",
                assetVersion: ruleFingerprint,
                configHash: analysisFingerprint,
                llmSession: options.llmSessionCacheDir,
                startedAt: report.generatedAt,
                completedAt: new Date().toISOString(),
                status: "completed",
                notes: ["current_assets_api_modeling_candidate_coverage_fragment"],
            },
            report,
            artifacts: noCandidateClassificationArtifacts,
        });
        const sourceCandidateCoverageGraphs = [...sourceContextCache.entries()].map(([sourceAbs, context], index) => {
            const sourceDir = path.relative(options.repo, sourceAbs) || ".";
            return {
                graph: buildSourceCandidateCoverageTraceGraph({
                    run: {
                        runId: `source-candidates:${path.basename(options.repo)}:${index + 1}:${Date.now()}`,
                        project: options.repo,
                        engineVersion: "arktaint",
                        assetVersion: ruleFingerprint,
                        configHash: analysisFingerprint,
                        llmSession: options.llmSessionCacheDir,
                        startedAt: report.generatedAt,
                        completedAt: new Date().toISOString(),
                        status: "completed",
                        notes: ["source_candidate_coverage_fragment", `sourceDir=${sourceDir}`],
                    },
                    sourceDir,
                    candidates: collectSourceCoverageCandidates(context.scene),
                }),
                prefix: `source_candidates${index}`,
            };
        });
        const entryTraceGraphs = entries
            .map((entry, index) => entry.traceGraph ? { graph: entry.traceGraph, prefix: `entry${index}` } : undefined)
            .filter((item): item is { graph: TraceGraph; prefix: string } => !!item);
        const cachedTraceMissingCount = entries.filter(entry => entry.fromCache && !entry.traceGraph).length;
        const runTrace: FullTraceRun = {
            runId: `full:${path.basename(options.repo)}:${Date.now()}`,
            project: options.repo,
            engineVersion: "arktaint",
            assetVersion: ruleFingerprint,
            configHash: analysisFingerprint,
            llmSession: options.llmSessionCacheDir,
            startedAt: report.generatedAt,
            completedAt: new Date().toISOString(),
            status: cachedTraceMissingCount > 0 || report.summary.statusCount.exception ? "partial" : "completed",
            notes: [
                `sourceDirs=${options.sourceDirs.length}`,
                `entryGraphs=${entryTraceGraphs.length}`,
                ...(cachedTraceMissingCount > 0 ? [`cachedEntriesWithoutTrace=${cachedTraceMissingCount}`] : []),
            ],
        };
        const traceGraph = mergeTraceGraphs(runTrace, [
            ...entryTraceGraphs,
            { graph: buildRuleSourceTraceGraph(runTrace, loadedRules), prefix: "rule_sources" },
            { graph: entryRecoveryGraph, prefix: "entry_recovery" },
            { graph: currentAssetCandidateGraph, prefix: "current_assets_candidates" },
            ...sourceCandidateCoverageGraphs,
        ]);
        writeTraceGraphArtifacts(outputLayout.traceGraphDir, traceGraph);
    }
    writeAnalyzeRunManifest(outputLayout, report, {
        pluginAuditEnabled: options.pluginAudit,
        traceGraphEnabled,
        analysisAuditEnabled,
    });

    return {
        report,
        jsonPath,
        mdPath,
        diagnosticsJsonPath: diagnosticsArtifacts.jsonPath,
        diagnosticsTextPath: diagnosticsArtifacts.textPath,
    };
}


