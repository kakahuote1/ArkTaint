import {
    DetectProfileSnapshot,
    ArkMainSeedReport,
    RuleHitCounters,
} from "../core/orchestration/TaintPropagationEngine";
import { WorklistProfileSnapshot } from "../core/kernel/debug/WorklistProfiler";
import { WorklistBudgetTruncation } from "../core/kernel/propagation/WorklistSolver";
import { EnginePluginAuditSnapshot } from "../core/orchestration/plugins/EnginePluginRuntime";
import { ExtensionModuleLoadIssue } from "../core/orchestration/ExtensionLoaderUtils";
import { SemanticSolveResult } from "../core/kernel/semantic_state/SemanticStateTypes";
import {
    emptyModuleAuditSnapshot,
    ModuleAuditEntry,
    ModuleAuditSnapshot,
} from "../core/kernel/contracts/ModuleContract";
import {
    emptyPagNodeResolutionAuditSnapshot,
    PagNodeResolutionAuditSnapshot,
} from "../core/kernel/contracts/PagNodeResolution";
import { RuleLoadIssue } from "../core/rules/RuleLoader";
import { RuleInvokeKind } from "../core/rules/RuleSchema";
import { AnalyzeProfile, ReportMode } from "./analyzeCliOptions";
import { FlowRuleTrace } from "./analyzeUtils";

export interface EntryStageProfile {
    buildPagMs: number;
    propagateRuleSeedMs: number;
    propagateHeuristicSeedMs: number;
    detectMs: number;
    postProcessMs: number;
    totalMs: number;
}

export interface AnalyzeStageProfile {
    ruleLoadMs: number;
    sceneBuildMs: number;
    entrySelectMs: number;
    entryAnalyzeMs: number;
    reportWriteMs: number;
    sceneCacheHitCount: number;
    sceneCacheMissCount: number;
    transferSceneRuleCacheHitCount: number;
    transferSceneRuleCacheMissCount: number;
    transferSceneRuleCacheDisabledCount: number;
    incrementalCacheHitCount: number;
    incrementalCacheMissCount: number;
    incrementalCacheWriteCount: number;
    entryConcurrency: number;
    entryParallelTaskCount: number;
    totalMs: number;
}

export interface AnalyzeMemoryProfile {
    sampleIntervalMs: number;
    sampleCount: number;
    rssMiB: number;
    heapUsedMiB: number;
    heapTotalMiB: number;
    externalMiB: number;
    arrayBuffersMiB: number;
    peakRssMiB: number;
    peakHeapUsedMiB: number;
    peakHeapTotalMiB: number;
    peakExternalMiB: number;
    peakArrayBuffersMiB: number;
}

export interface ExecutionHandoffAudit {
    contracts: number;
    syntheticEdges: number;
    syntheticCallers: number;
    syntheticCallees: number;
}

export interface EntryAnalyzeResult {
    sourceDir: string;
    entryName: string;
    entryPathHint?: string;
    score: number;
    status: "ok" | "no_entry" | "no_body" | "no_seed" | "budget_exceeded" | "exception";
    seedCount: number;
    seedLocalNames: string[];
    seedStrategies: string[];
    flowCount: number;
    sinkSamples: string[];
    flowRuleTraces: FlowRuleTrace[];
    ruleHits: RuleHitCounters;
    ruleHitEndpoints: RuleHitCounters;
    transferProfile: {
        factCount: number;
        invokeSiteCount: number;
        ruleCheckCount: number;
        ruleMatchCount: number;
        endpointCheckCount: number;
        endpointMatchCount: number;
        dedupSkipCount: number;
        resultCount: number;
        elapsedMs: number;
        elapsedShare: number;
        noCandidateCallsites: Array<{
            calleeSignature: string;
            method: string;
            invokeKind: RuleInvokeKind;
            argCount: number;
            sourceFile: string;
            count: number;
        }>;
    };
    detectProfile: DetectProfileSnapshot;
    stageProfile: EntryStageProfile;
    transferNoHitReasons: string[];
    pagNodeResolutionAudit: PagNodeResolutionAuditSnapshot;
    executionHandoffAudit: ExecutionHandoffAudit;
    moduleAudit: ModuleAuditSnapshot;
    enginePluginAudit: EnginePluginAuditSnapshot;
    semanticState?: SemanticSolveResult;
    arkMainSeeds?: ArkMainSeedReport;
    worklistProfile?: WorklistProfileSnapshot;
    worklistTruncation?: WorklistBudgetTruncation;
    elapsedMs: number;
    fromCache?: boolean;
    error?: string;
    errorStack?: string;
}

export interface AnalyzeErrorDiagnostics {
    ruleLoadIssues: RuleLoadIssue[];
    moduleLoadIssues: ExtensionModuleLoadIssue[];
    moduleRuntimeFailures: ModuleAuditSnapshot["failureEvents"];
    enginePluginLoadIssues: ExtensionModuleLoadIssue[];
    enginePluginRuntimeFailures: EnginePluginAuditSnapshot["failureEvents"];
    systemFailures: Array<{
        phase: string;
        message: string;
        path?: string;
        line?: number;
        column?: number;
        stackExcerpt?: string;
        userMessage: string;
        code?: string;
        summary?: string;
        advice?: string;
        title?: string;
    }>;
}

export interface NormalizedAnalyzeDiagnosticItem {
    category: "Rule" | "Module" | "Plugin" | "System";
    code: string;
    title: string;
    summary: string;
    rawMessage: string;
    advice: string;
    path?: string;
    line?: number;
    column?: number;
    fieldPath?: string;
    stackExcerpt?: string;
}

export interface AnalyzeReport {
    generatedAt: string;
    repo: string;
    sourceDirs: string[];
    profile: AnalyzeProfile;
    reportMode: ReportMode;
    k: number;
    maxEntries: number;
    ruleLayers: string[];
    ruleLayerStatus: Array<{ name: string; path: string; applied: boolean; exists: boolean; source: string }>;
    summary: {
        totalEntries: number;
        okEntries: number;
        withSeeds: number;
        withFlows: number;
        totalFlows: number;
        statusCount: Record<string, number>;
        ruleHits: RuleHitCounters;
        ruleHitEndpoints: RuleHitCounters;
        transferProfile: {
            factCount: number;
            invokeSiteCount: number;
            ruleCheckCount: number;
            ruleMatchCount: number;
            endpointCheckCount: number;
            endpointMatchCount: number;
            dedupSkipCount: number;
            resultCount: number;
            elapsedMs: number;
            elapsedShareAvg: number;
            noCandidateCallsites: Array<{
                calleeSignature: string;
                method: string;
                invokeKind: RuleInvokeKind;
                argCount: number;
                sourceFile: string;
                count: number;
            }>;
        };
        detectProfile: DetectProfileSnapshot;
        stageProfile: AnalyzeStageProfile;
        memoryProfile: AnalyzeMemoryProfile;
        transferNoHitReasons: Record<string, number>;
        pagNodeResolutionAudit: PagNodeResolutionAuditSnapshot;
        executionHandoffAudit: ExecutionHandoffAudit;
        semanticState?: SemanticSolveResult;
        diagnostics: AnalyzeErrorDiagnostics;
        diagnosticItems: NormalizedAnalyzeDiagnosticItem[];
        moduleAudit: {
            loadedModuleIds: string[];
            failedModuleIds: string[];
            discoveredModuleProjects: string[];
            enabledModuleProjects: string[];
            modules: Record<string, ModuleAuditEntry>;
        };
        pluginAudit: {
            loadedPluginNames: string[];
            failedPluginNames: string[];
            plugins: Record<string, EnginePluginAuditSnapshot["pluginStats"][string]>;
        };
        arkMainSeeds?: ArkMainSeedReport;
        ruleFeedback: {
            zeroHitRules: RuleHitCounters;
            ruleHitRanking: {
                source: Array<{ key: string; count: number }>;
                sink: Array<{ key: string; count: number }>;
                transfer: Array<{ key: string; count: number }>;
            };
            uncoveredHighFrequencyInvokes: Array<{
                signature: string;
                methodName: string;
                count: number;
                sourceDir: string;
                invokeKind: RuleInvokeKind;
                argCount: number;
            }>;
            noCandidateCallsites: Array<{
                callee_signature: string;
                method: string;
                invokeKind: RuleInvokeKind;
                argCount: number;
                sourceFile: string;
                count: number;
                topEntries: string[];
            }>;
        };
    };
    entries: EntryAnalyzeResult[];
}

export function emptyRuleHitCounters(): RuleHitCounters {
    return {
        source: {},
        sink: {},
        transfer: {},
    };
}

export function accumulateRuleHitCounters(dst: RuleHitCounters, src: RuleHitCounters): void {
    const merge = (a: Record<string, number>, b: Record<string, number>): void => {
        for (const [k, v] of Object.entries(b)) {
            a[k] = (a[k] || 0) + v;
        }
    };
    merge(dst.source, src.source);
    merge(dst.sink, src.sink);
    merge(dst.transfer, src.transfer);
}

export function emptyTransferProfile(): EntryAnalyzeResult["transferProfile"] {
    return {
        factCount: 0,
        invokeSiteCount: 0,
        ruleCheckCount: 0,
        ruleMatchCount: 0,
        endpointCheckCount: 0,
        endpointMatchCount: 0,
        dedupSkipCount: 0,
        resultCount: 0,
        elapsedMs: 0,
        elapsedShare: 0,
        noCandidateCallsites: [],
    };
}

export function emptyDetectProfile(): DetectProfileSnapshot {
    return {
        detectCallCount: 0,
        methodsVisited: 0,
        reachableMethodsVisited: 0,
        stmtsVisited: 0,
        invokeStmtsVisited: 0,
        signatureMatchedInvokeCount: 0,
        constraintRejectedInvokeCount: 0,
        sinksChecked: 0,
        candidateCount: 0,
        taintCheckCount: 0,
        defReachabilityCheckCount: 0,
        fieldPathCheckCount: 0,
        fieldPathHitCount: 0,
        sanitizerGuardCheckCount: 0,
        sanitizerGuardHitCount: 0,
        signatureMatchMs: 0,
        candidateResolveMs: 0,
        taintEvalMs: 0,
        sanitizerGuardMs: 0,
        traversalMs: 0,
        totalMs: 0,
    };
}

export function emptyEntryStageProfile(): EntryStageProfile {
    return {
        buildPagMs: 0,
        propagateRuleSeedMs: 0,
        propagateHeuristicSeedMs: 0,
        detectMs: 0,
        postProcessMs: 0,
        totalMs: 0,
    };
}

export function emptyAnalyzeStageProfile(): AnalyzeStageProfile {
    return {
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
    };
}

export function emptyAnalyzeMemoryProfile(): AnalyzeMemoryProfile {
    return {
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
    };
}

export function emptyExecutionHandoffAudit(): ExecutionHandoffAudit {
    return {
        contracts: 0,
        syntheticEdges: 0,
        syntheticCallers: 0,
        syntheticCallees: 0,
    };
}

export function emptyEnginePluginAuditSnapshot(): EnginePluginAuditSnapshot {
    return {
        loadedPluginNames: [],
        failedPluginNames: [],
        failureEvents: [],
        dryRun: false,
        optionOverrides: {},
        pluginStats: {},
        start: {
            sourceRulesAdded: 0,
            sinkRulesAdded: 0,
            transferRulesAdded: 0,
            sanitizerRulesAdded: 0,
        },
    };
}

export function emptyAnalyzeErrorDiagnostics(): AnalyzeErrorDiagnostics {
    return {
        ruleLoadIssues: [],
        moduleLoadIssues: [],
        moduleRuntimeFailures: [],
        enginePluginLoadIssues: [],
        enginePluginRuntimeFailures: [],
        systemFailures: [],
    };
}

export function elapsedMsSince(t0: bigint): number {
    return Number(process.hrtime.bigint() - t0) / 1_000_000;
}

export function toReportEntry(entry: EntryAnalyzeResult, reportMode: ReportMode): EntryAnalyzeResult {
    if (reportMode === "full") {
        return entry;
    }
    return {
        ...entry,
        sinkSamples: [],
        flowRuleTraces: [],
        ruleHits: emptyRuleHitCounters(),
        ruleHitEndpoints: emptyRuleHitCounters(),
        transferProfile: emptyTransferProfile(),
        detectProfile: emptyDetectProfile(),
        transferNoHitReasons: [],
        pagNodeResolutionAudit: emptyPagNodeResolutionAuditSnapshot(),
        // Keep lightweight numeric/structural audits in light mode so
        // real-project measurements can be diagnosed without switching to
        // full traces.
        stageProfile: entry.stageProfile,
        executionHandoffAudit: entry.executionHandoffAudit,
        moduleAudit: emptyModuleAuditSnapshot(),
        enginePluginAudit: emptyEnginePluginAuditSnapshot(),
    };
}
