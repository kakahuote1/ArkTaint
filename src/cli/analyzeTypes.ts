import { RuleHitCounters } from "../core/TaintPropagationEngine";
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

export interface EntryAnalyzeResult {
    sourceDir: string;
    entryName: string;
    entryPathHint?: string;
    score: number;
    status: "ok" | "no_entry" | "no_body" | "no_seed" | "exception";
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
    };
    stageProfile: EntryStageProfile;
    transferNoHitReasons: string[];
    elapsedMs: number;
    fromCache?: boolean;
    error?: string;
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
        };
        stageProfile: AnalyzeStageProfile;
        transferNoHitReasons: Record<string, number>;
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
        stageProfile: emptyEntryStageProfile(),
        transferNoHitReasons: [],
    };
}
