import { TaintFlow } from "../core/kernel/model/TaintFlow";
import { TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";
import { SanitizerRule, SinkRule, SourceRule } from "../core/rules/RuleSchema";
import { buildSmokeRuleConfig, LoadedRuleSet } from "../core/rules/RuleLoader";

export interface FlowRuleTrace {
    source: string;
    sink: string;
    sourceRuleId?: string;
    sinkRuleId?: string;
    sinkEndpoint?: string;
    sinkNodeId?: number;
    sinkFieldPath?: string[];
    transferRuleIds: string[];
    handoffMarkers?: string[];
}

export function extractArkFileFromSignature(signature: string): string | undefined {
    const m = signature.match(/<@([^:>]+\.ets):/);
    if (m) return m[1].replace(/\\/g, "/");
    const m2 = signature.match(/@([^:>]+\.ets):/);
    if (m2) return m2[1].replace(/\\/g, "/");
    return undefined;
}

export function detectFlows(
    engine: TaintPropagationEngine,
    loadedRules: LoadedRuleSet | undefined,
    options?: {
        detailed?: boolean;
        stopOnFirstFlow?: boolean;
        maxFlowsPerEntry?: number;
        enableSecondarySinkSweep?: boolean;
    }
): {
    totalFlowCount: number;
    sinkSamples: string[];
    byKeyword: Record<string, number>;
    bySignature: Record<string, number>;
    flowRuleTraces: FlowRuleTrace[];
} {
    const detailed = options?.detailed !== false;
    const enableSecondarySinkSweep = options?.enableSecondarySinkSweep === true;
    const maxFlowLimit = options?.stopOnFirstFlow
        ? 1
        : options?.maxFlowsPerEntry;
    const sinkSamples: string[] = [];
    const byKeyword: Record<string, number> = {};
    const bySignature: Record<string, number> = {};
    const uniqueFlowKeys = new Set<string>();
    const flowTraceMap = new Map<string, FlowRuleTrace>();

    const sourcePattern = buildSmokeRuleConfig(loadedRules);
    const sinkKeywords = sourcePattern.sinkKeywords;
    const sinkSignatures = sourcePattern.sinkSignatures;
    const sinkRules = loadedRules?.ruleSet.sinks || [];
    const sanitizerRules: SanitizerRule[] = loadedRules?.ruleSet.sanitizers || [];

    const parseSourceRuleId = (source: string): string | undefined => {
        if (!source.startsWith("source_rule:")) return undefined;
        const id = source.slice("source_rule:".length).trim();
        return id.length > 0 ? id : undefined;
    };

    const pushFlowTrace = (key: string, flow: TaintFlow): void => {
        if (flowTraceMap.has(key)) return;
        const transferRuleIds = [...new Set(flow.transferRuleIds || [])].sort();
        flowTraceMap.set(key, {
            source: flow.source,
            sink: flow.sink.toString(),
            sourceRuleId: flow.sourceRuleId || parseSourceRuleId(flow.source),
            sinkRuleId: flow.sinkRuleId,
            sinkEndpoint: flow.sinkEndpoint,
            sinkNodeId: flow.sinkNodeId,
            sinkFieldPath: flow.sinkFieldPath ? [...flow.sinkFieldPath] : undefined,
            transferRuleIds,
            handoffMarkers: transferRuleIds.filter(ruleId => ruleId.startsWith("ude.handoff.")),
        });
    };

    const collect = (label: string, token: string, flows: TaintFlow[]): number => {
        const bucket = new Set<string>();
        for (const flow of flows) {
            if (maxFlowLimit !== undefined && uniqueFlowKeys.size >= maxFlowLimit) break;
            const sinkText = flow.sink.toString();
            const key = `${flow.source} -> ${sinkText}`;
            bucket.add(key);
            if (!uniqueFlowKeys.has(key)) {
                uniqueFlowKeys.add(key);
                if (sinkSamples.length < 8) sinkSamples.push(`[${label}:${token}] ${sinkText}`);
            }
            if (detailed) {
                pushFlowTrace(key, flow);
            }
        }
        return bucket.size;
    };

    if (sinkRules.length > 0) {
        const flows = engine.detectSinksByRules(sinkRules as SinkRule[], {
            stopOnFirstFlow: options?.stopOnFirstFlow,
            maxFlowsPerEntry: options?.maxFlowsPerEntry,
            sanitizerRules,
        });
        collect("rule", "all", flows);
    }

    if (maxFlowLimit !== undefined && uniqueFlowKeys.size >= maxFlowLimit) {
        return {
            totalFlowCount: uniqueFlowKeys.size,
            sinkSamples,
            byKeyword,
            bySignature,
            flowRuleTraces: detailed ? [...flowTraceMap.values()] : [],
        };
    }

    if (detailed && enableSecondarySinkSweep) {
        for (const keyword of sinkKeywords) {
            if (maxFlowLimit !== undefined && uniqueFlowKeys.size >= maxFlowLimit) break;
            byKeyword[keyword] = collect("kw", keyword, engine.detectSinks(keyword, { sanitizerRules }));
        }
        for (const signature of sinkSignatures) {
            if (maxFlowLimit !== undefined && uniqueFlowKeys.size >= maxFlowLimit) break;
            bySignature[signature] = collect("sig", signature, engine.detectSinks(signature, { sanitizerRules }));
        }
    }

    // Developer-friendly fallback for taint demo projects.
    if (enableSecondarySinkSweep && uniqueFlowKeys.size === 0) {
        const sinkByName = collect("sig", "Sink", engine.detectSinks("Sink", { sanitizerRules }));
        const sinkBySig = collect("sig", "taint.%dflt.Sink", engine.detectSinks("taint.%dflt.Sink", { sanitizerRules }));
        if (detailed) {
            bySignature["Sink"] = sinkByName;
            bySignature["taint.%dflt.Sink"] = sinkBySig;
        }
    }

    return {
        totalFlowCount: uniqueFlowKeys.size,
        sinkSamples,
        byKeyword,
        bySignature,
        flowRuleTraces: detailed ? [...flowTraceMap.values()] : [],
    };
}

export function getSourceRules(loadedRules: LoadedRuleSet | undefined): SourceRule[] {
    return loadedRules?.ruleSet.sources || [];
}

