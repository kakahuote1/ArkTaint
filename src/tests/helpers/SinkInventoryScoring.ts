import * as fs from "fs";
import * as path from "path";
import { TaintFlow } from "../../core/kernel/model/TaintFlow";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import { SinkRule, SourceRule, TaintRuleSet } from "../../core/rules/RuleSchema";

export interface SinkInventoryFlowSummary {
    inventoryFlowCount: number;
    targetFlowCount: number;
    spilloverFlowCount: number;
    detectedInventory: boolean;
    detectedTarget: boolean;
    sinkRuleHits: Record<string, number>;
    sourceRuleHits: Record<string, number>;
    sinkFamilyHits: Record<string, number>;
    sinkEndpointHits: Record<string, number>;
    targetSinkRuleIds: string[];
    targetSourceRuleIds: string[];
    hitSinkRuleIds: string[];
    hitSourceRuleIds: string[];
}

function uniqueSorted(values: Iterable<string>): string[] {
    return [...new Set([...values].filter(value => value.trim().length > 0))].sort((a, b) => a.localeCompare(b));
}

function toEnabledSinkRules(ruleSet: TaintRuleSet): SinkRule[] {
    return (ruleSet.sinks || []).filter(rule => rule.enabled !== false);
}

function toEnabledSourceRules(ruleSet: TaintRuleSet): SourceRule[] {
    return (ruleSet.sources || []).filter(rule => rule.enabled !== false);
}

function parseSourceRuleId(source: string | undefined): string {
    const text = String(source || "").trim();
    if (!text.startsWith("source_rule:")) {
        return "";
    }
    const rawId = text.slice("source_rule:".length).trim();
    return rawId
        ? rawId.split("#occ=")[0]?.trim() || ""
        : "";
}

export function readEnabledProjectSinkRuleIds(projectRulePath: string): string[] {
    const absPath = path.resolve(projectRulePath);
    if (!fs.existsSync(absPath)) {
        return [];
    }
    const parsed = JSON.parse(fs.readFileSync(absPath, "utf-8"));
    if (isV2AssetDocument(parsed)) {
        const lowered = lowerRuleAssetsToRuleSet([parsed]);
        return uniqueSorted(toEnabledSinkRules(lowered.ruleSet).map(rule => String(rule.id || "")));
    }
    const ruleSet = parsed as TaintRuleSet;
    return uniqueSorted(toEnabledSinkRules(ruleSet).map(rule => String(rule.id || "")));
}

export function readEnabledProjectSourceRuleIds(projectRulePath: string): string[] {
    const absPath = path.resolve(projectRulePath);
    if (!fs.existsSync(absPath)) {
        return [];
    }
    const parsed = JSON.parse(fs.readFileSync(absPath, "utf-8"));
    if (isV2AssetDocument(parsed)) {
        const lowered = lowerRuleAssetsToRuleSet([parsed]);
        return uniqueSorted(toEnabledSourceRules(lowered.ruleSet).map(rule => String(rule.id || "")));
    }
    const ruleSet = parsed as TaintRuleSet;
    return uniqueSorted(toEnabledSourceRules(ruleSet).map(rule => String(rule.id || "")));
}

function isV2AssetDocument(value: unknown): value is any {
    if (!value || typeof value !== "object") return false;
    const doc = value as Record<string, unknown>;
    return typeof doc.id === "string"
        && typeof doc.plane === "string"
        && Array.isArray(doc.surfaces)
        && Array.isArray(doc.bindings)
        && Array.isArray(doc.effectTemplates);
}

export function resolveExpectedSinkRuleIds(projectRulePath: string, loadedSinkRules: SinkRule[]): string[] {
    const projectSinkIds = readEnabledProjectSinkRuleIds(projectRulePath);
    if (projectSinkIds.length > 0) {
        return projectSinkIds;
    }
    return uniqueSorted((loadedSinkRules || []).map(rule => String(rule.id || "")));
}

export function resolveExpectedSourceRuleIds(projectRulePath: string): string[] {
    return readEnabledProjectSourceRuleIds(projectRulePath);
}

export function summarizeSinkInventoryFlows(
    flows: TaintFlow[],
    sinkRules: SinkRule[],
    expectedSinkRuleIds?: Iterable<string>,
    expectedSourceRuleIds?: Iterable<string>
): SinkInventoryFlowSummary {
    const sinkRuleById = new Map<string, SinkRule>();
    for (const rule of sinkRules || []) {
        if (rule.id) {
            sinkRuleById.set(rule.id, rule);
        }
    }

    const targetIds = uniqueSorted(expectedSinkRuleIds || []);
    const targetIdSet = new Set(targetIds);
    const targetSourceIds = uniqueSorted(expectedSourceRuleIds || []);
    const targetSourceIdSet = new Set(targetSourceIds);
    const sinkRuleHits: Record<string, number> = {};
    const sourceRuleHits: Record<string, number> = {};
    const sinkFamilyHits: Record<string, number> = {};
    const sinkEndpointHits: Record<string, number> = {};
    const hitSinkRuleIds = new Set<string>();
    const hitSourceRuleIds = new Set<string>();

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

        const sourceRuleId = String(flow.sourceRuleId || parseSourceRuleId(flow.source)).trim();
        if (sourceRuleId) {
            hitSourceRuleIds.add(sourceRuleId);
            sourceRuleHits[sourceRuleId] = (sourceRuleHits[sourceRuleId] || 0) + 1;
        }

        const rule = sinkRuleById.get(sinkRuleId);
        const family = String(rule?.family || "").trim();
        if (family) {
            sinkFamilyHits[family] = (sinkFamilyHits[family] || 0) + 1;
        }

        const endpoint = String(flow.sinkEndpoint || "").trim();
        if (endpoint) {
            sinkEndpointHits[endpoint] = (sinkEndpointHits[endpoint] || 0) + 1;
        }

        const isTargetSink = targetIdSet.size === 0 || targetIdSet.has(sinkRuleId);
        const isTargetSource = targetSourceIdSet.size === 0 || targetSourceIdSet.has(sourceRuleId);
        const isTargetFlow = isTargetSink && isTargetSource;
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
        sourceRuleHits,
        sinkFamilyHits,
        sinkEndpointHits,
        targetSinkRuleIds: targetIds,
        targetSourceRuleIds: targetSourceIds,
        hitSinkRuleIds: uniqueSorted(hitSinkRuleIds),
        hitSourceRuleIds: uniqueSorted(hitSourceRuleIds),
    };
}
