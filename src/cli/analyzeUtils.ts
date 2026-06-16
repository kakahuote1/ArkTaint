import { TaintFlow } from "../core/kernel/model/TaintFlow";
import { TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";
import { SanitizerRule, SinkRule, SourceRule } from "../core/rules/RuleSchema";
import { LoadedRuleSet } from "../core/rules/RuleLoader";

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
    materializedPaths?: Array<{
        factIds: string[];
        truncated?: boolean;
    }>;
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
        applyPreSinkSanitizers?: boolean;
    }
): {
    totalFlowCount: number;
    sinkSamples: string[];
    byKeyword: Record<string, number>;
    bySignature: Record<string, number>;
    flows: TaintFlow[];
    flowRuleTraces: FlowRuleTrace[];
} {
    const detailed = options?.detailed !== false;
    const maxFlowLimit = options?.stopOnFirstFlow
        ? 1
        : options?.maxFlowsPerEntry;
    const sinkSamples: string[] = [];
    const byKeyword: Record<string, number> = {};
    const bySignature: Record<string, number> = {};
    const uniqueFlowKeys = new Set<string>();
    const uniqueFlows: TaintFlow[] = [];
    const flowRuleAuditMap = new Map<string, FlowRuleTrace>();

    const sinkRules = loadedRules?.ruleSet.sinks || [];
    const sanitizerRules: SanitizerRule[] = options?.applyPreSinkSanitizers === false
        ? []
        : (loadedRules?.ruleSet.sanitizers || []);

    const parseSourceRuleId = (source: string): string | undefined => {
        if (!source.startsWith("source_rule:")) return undefined;
        const id = source.slice("source_rule:".length).trim();
        return id.length > 0 ? id : undefined;
    };

    const pushFlowRuleAudit = (key: string, flow: TaintFlow): void => {
        if (flowRuleAuditMap.has(key)) return;
        const transferRuleIds = [...new Set(flow.transferRuleIds || [])].sort();
        flowRuleAuditMap.set(key, {
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
    const buildFlowSummaryKey = (flow: TaintFlow): string => {
        const sinkText = flow.sink.toString();
        const sinkEndpoint = flow.sinkEndpoint || "";
        const sinkNodeId = flow.sinkNodeId === undefined ? "" : String(flow.sinkNodeId);
        const sinkFieldPath = flow.sinkFieldPath && flow.sinkFieldPath.length > 0
            ? flow.sinkFieldPath.join(".")
            : "";
        return `${flow.source} -> ${sinkText} -> ${sinkEndpoint} -> ${sinkNodeId} -> ${sinkFieldPath}`;
    };

    const collect = (label: string, token: string, flows: TaintFlow[]): number => {
        const bucket = new Set<string>();
        for (const flow of flows) {
            if (maxFlowLimit !== undefined && uniqueFlowKeys.size >= maxFlowLimit) break;
            const sinkText = flow.sink.toString();
            const key = buildFlowSummaryKey(flow);
            bucket.add(key);
            if (!uniqueFlowKeys.has(key)) {
                uniqueFlowKeys.add(key);
                uniqueFlows.push(flow);
                if (sinkSamples.length < 8) sinkSamples.push(`[${label}:${token}] ${sinkText}`);
            }
            if (detailed) {
                pushFlowRuleAudit(key, flow);
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
            flows: uniqueFlows,
            flowRuleTraces: detailed ? [...flowRuleAuditMap.values()] : [],
        };
    }

    return {
        totalFlowCount: uniqueFlowKeys.size,
        sinkSamples,
        byKeyword,
        bySignature,
        flows: uniqueFlows,
        flowRuleTraces: detailed ? [...flowRuleAuditMap.values()] : [],
    };
}

export function getSourceRules(loadedRules: LoadedRuleSet | undefined): SourceRule[] {
    return loadedRules?.ruleSet.sources || [];
}

