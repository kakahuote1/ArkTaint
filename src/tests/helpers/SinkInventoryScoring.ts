import * as fs from "fs";
import * as path from "path";
import { TaintFlow } from "../../core/kernel/model/TaintFlow";
import { SinkRule, TaintRuleSet } from "../../core/rules/RuleSchema";

export interface SinkInventoryFlowSummary {
    inventoryFlowCount: number;
    targetFlowCount: number;
    spilloverFlowCount: number;
    detectedInventory: boolean;
    detectedTarget: boolean;
    sinkRuleHits: Record<string, number>;
    sinkFamilyHits: Record<string, number>;
    sinkEndpointHits: Record<string, number>;
    targetSinkRuleIds: string[];
    hitSinkRuleIds: string[];
}

function uniqueSorted(values: Iterable<string>): string[] {
    return [...new Set([...values].filter(value => value.trim().length > 0))].sort((a, b) => a.localeCompare(b));
}

function toEnabledSinkRules(ruleSet: TaintRuleSet): SinkRule[] {
    return (ruleSet.sinks || []).filter(rule => rule.enabled !== false);
}

export function readEnabledProjectSinkRuleIds(projectRulePath: string): string[] {
    const absPath = path.resolve(projectRulePath);
    if (!fs.existsSync(absPath)) {
        return [];
    }
    const ruleSet = JSON.parse(fs.readFileSync(absPath, "utf-8")) as TaintRuleSet;
    return uniqueSorted(toEnabledSinkRules(ruleSet).map(rule => String(rule.id || "")));
}

export function resolveExpectedSinkRuleIds(projectRulePath: string, loadedSinkRules: SinkRule[]): string[] {
    const projectSinkIds = readEnabledProjectSinkRuleIds(projectRulePath);
    if (projectSinkIds.length > 0) {
        return projectSinkIds;
    }
    return uniqueSorted((loadedSinkRules || []).map(rule => String(rule.id || "")));
}

export function summarizeSinkInventoryFlows(
    flows: TaintFlow[],
    sinkRules: SinkRule[],
    expectedSinkRuleIds?: Iterable<string>
): SinkInventoryFlowSummary {
    const sinkRuleById = new Map<string, SinkRule>();
    for (const rule of sinkRules || []) {
        if (rule.id) {
            sinkRuleById.set(rule.id, rule);
        }
    }

    const targetIds = uniqueSorted(expectedSinkRuleIds || []);
    const targetIdSet = new Set(targetIds);
    const sinkRuleHits: Record<string, number> = {};
    const sinkFamilyHits: Record<string, number> = {};
    const sinkEndpointHits: Record<string, number> = {};
    const hitSinkRuleIds = new Set<string>();

    let inventoryFlowCount = 0;
    let targetFlowCount = 0;

    for (const flow of flows) {
        const sinkRuleId = String(flow.sinkRuleId || "").trim();
        if (!sinkRuleId) {
            continue;
        }
        inventoryFlowCount += 1;
        hitSinkRuleIds.add(sinkRuleId);
        sinkRuleHits[sinkRuleId] = (sinkRuleHits[sinkRuleId] || 0) + 1;

        const rule = sinkRuleById.get(sinkRuleId);
        const family = String(rule?.family || "").trim();
        if (family) {
            sinkFamilyHits[family] = (sinkFamilyHits[family] || 0) + 1;
        }

        const endpoint = String(flow.sinkEndpoint || "").trim();
        if (endpoint) {
            sinkEndpointHits[endpoint] = (sinkEndpointHits[endpoint] || 0) + 1;
        }

        const isTargetFlow = targetIdSet.size === 0 || targetIdSet.has(sinkRuleId);
        if (isTargetFlow) {
            targetFlowCount += 1;
        }
    }

    return {
        inventoryFlowCount,
        targetFlowCount,
        spilloverFlowCount: Math.max(0, inventoryFlowCount - targetFlowCount),
        detectedInventory: inventoryFlowCount > 0,
        detectedTarget: targetFlowCount > 0,
        sinkRuleHits,
        sinkFamilyHits,
        sinkEndpointHits,
        targetSinkRuleIds: targetIds,
        hitSinkRuleIds: uniqueSorted(hitSinkRuleIds),
    };
}
