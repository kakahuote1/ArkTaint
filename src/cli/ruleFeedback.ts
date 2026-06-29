import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../arkanalyzer/out/src/core/base/Expr";
import { LoadedRuleSet } from "../core/rules/RuleLoader";
import {
    RuleInvokeKind,
    SinkRule,
    SourceRule,
    SourceRuleKind,
    TransferRule,
} from "../core/rules/RuleSchema";
import { AnalyzeReport, EntryAnalyzeResult } from "./analyzeTypes";
import { getSourceRules } from "./analyzeUtils";
import { RuleHitCounters } from "../core/orchestration/TaintPropagationEngine";
import {
    discoverApiCallbackModelingCandidates,
    discoverApiSurfaceModelingCandidates,
} from "../core/semanticflow/ApiModelingCandidateScanner";
import {
    enrichNoCandidateItemsWithCallsiteSlices,
    type NormalizedCallsiteItem,
} from "../core/model/callsite/callsiteContextSlices";
import { assertValidCanonicalApiId } from "../core/api/identity";

interface InvokeSiteStat {
    signature: string;
    methodName: string;
    invokeKind: RuleInvokeKind;
    argCount: number;
    calleeFilePath: string;
    calleeClassText: string;
    callerFilePath: string;
    callerClassText: string;
    callerMethodName: string;
    sourceDir: string;
    count: number;
}

interface NoCandidateCallsiteStat {
    callee_signature: string;
    canonicalApiId?: string;
    method: string;
    invokeKind: RuleInvokeKind;
    argCount: number;
    sourceFile: string;
    count: number;
    topEntries: string[];
}

export type NoCandidateCategory = "C0_NON_TRANSFER_HELPER" | "C1_UI_NOISE" | "C2_API_MODELING_CANDIDATE" | "C3_FRAMEWORK_GAP";

export interface ClassifiedNoCandidateCallsite extends NoCandidateCallsiteStat {
    category: NoCandidateCategory;
    reason: string;
    evidence: string[];
}

export interface NoCandidateCallsiteClassificationArtifacts {
    items: ClassifiedNoCandidateCallsite[];
    categoryCount: Record<NoCandidateCategory, number>;
    apiModelingCandidates: ClassifiedNoCandidateCallsite[];
}

export function buildRuleFeedback(
    repoRoot: string,
    loadedRules: LoadedRuleSet,
    ruleHits: RuleHitCounters,
    sourceContextCache: Map<string, { scene: Scene }>,
    entryResults: EntryAnalyzeResult[],
    options: {
        includeCoverageScan?: boolean;
    } = {},
): AnalyzeReport["summary"]["ruleFeedback"] {
    const enabledSources = (loadedRules.ruleSet.sources || []).filter(r => r.enabled !== false);
    const enabledSinks = (loadedRules.ruleSet.sinks || []).filter(r => r.enabled !== false);
    const enabledTransfers = (loadedRules.ruleSet.transfers || []).filter(r => r.enabled !== false);

    const zeroHitRules: RuleHitCounters = {
        source: {},
        sink: {},
        transfer: {},
    };
    for (const rule of enabledSources) {
        if (!(ruleHits.source[rule.id] > 0)) zeroHitRules.source[rule.id] = 0;
    }
    for (const rule of enabledSinks) {
        if (!(ruleHits.sink[rule.id] > 0)) zeroHitRules.sink[rule.id] = 0;
    }
    for (const rule of enabledTransfers) {
        if (!(ruleHits.transfer[rule.id] > 0)) zeroHitRules.transfer[rule.id] = 0;
    }

    const rank = (record: Record<string, number>) => Object.entries(record)
        .filter(([, v]) => Number.isFinite(v) && v > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 20)
        .map(([key, count]) => ({ key, count }));

    const includeCoverageScan = options.includeCoverageScan !== false;
    const invokeStats = new Map<string, InvokeSiteStat>();
    if (includeCoverageScan) {
        for (const [sourceAbs, ctx] of sourceContextCache.entries()) {
            const rel = path.relative(repoRoot, sourceAbs).replace(/\\/g, "/");
            const bySource = collectInvokeSiteStatsForSourceDir(ctx.scene, rel);
            for (const [key, stat] of bySource.entries()) {
                const cur = invokeStats.get(key);
                if (cur) {
                    cur.count += stat.count;
                } else {
                    invokeStats.set(key, { ...stat });
                }
            }
        }
    }

    const sourceRules = getAnalyzeSourceRules(loadedRules);
    const sinkRules = loadedRules.ruleSet.sinks || [];
    const transferRules = loadedRules.ruleSet.transfers || [];
    const uncovered = includeCoverageScan
        ? [...invokeStats.values()]
            .filter(site => {
                const coveredBySource = sourceRules.some(rule => isSourceCallLikeRule(rule) && ruleMatchesInvokeForSourceCoverage(rule, site));
                const coveredBySink = sinkRules.some(rule => rule.enabled !== false && ruleMatchesInvokeForSinkCoverage(rule, site));
                const coveredByTransfer = transferRules.some(rule => rule.enabled !== false && ruleMatchesInvokeForTransferCoverage(rule, site));
                return !coveredBySource && !coveredBySink && !coveredByTransfer;
            })
            .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature))
            .slice(0, 100)
            .map(site => ({
                signature: site.signature,
                methodName: site.methodName,
                count: site.count,
                sourceDir: site.sourceDir,
                invokeKind: site.invokeKind,
                argCount: site.argCount,
            }))
        : [];

    const noCandidateEntries = entryResults
        .filter(e => e.transferNoHitReasons.includes("no_candidate_rule_for_callsite"));
    const noCandidateSourceDirs = new Set(noCandidateEntries.map(e => e.sourceDir));
    const topEntriesBySourceDir = new Map<string, string[]>();
    for (const sourceDir of noCandidateSourceDirs) {
        const sorted = noCandidateEntries
            .filter(e => e.sourceDir === sourceDir)
            .sort((a, b) => b.score - a.score || a.entryName.localeCompare(b.entryName))
            .slice(0, 3)
            .map(e => e.entryName);
        topEntriesBySourceDir.set(sourceDir, sorted);
    }
    const noCandidateAggregate = new Map<string, NoCandidateCallsiteStat>();
    for (const entry of noCandidateEntries) {
        const topEntries = topEntriesBySourceDir.get(entry.sourceDir) || [entry.entryName];
        for (const site of entry.transferProfile.noCandidateCallsites || []) {
            const key = `${entry.sourceDir}|${site.canonicalApiId || ""}|${site.calleeSignature}|${site.method}|${site.invokeKind}|${site.argCount}|${site.sourceFile}`;
            const existing = noCandidateAggregate.get(key);
            if (existing) {
                existing.count += site.count;
            } else {
                noCandidateAggregate.set(key, {
                    callee_signature: site.calleeSignature,
                    canonicalApiId: site.canonicalApiId,
                    method: site.method,
                    invokeKind: site.invokeKind,
                    argCount: site.argCount,
                    sourceFile: site.sourceFile,
                    count: site.count,
                    topEntries,
                });
            }
        }
    }
    const noCandidateCallsites = [...noCandidateAggregate.values()]
        .sort((a, b) => b.count - a.count || a.callee_signature.localeCompare(b.callee_signature))
        .slice(0, 200);
    const sourceZeroHitAudit = collectSourceZeroHitAudit(entryResults);

    return {
        zeroHitRules,
        sourceZeroHitAudit,
        ruleHitRanking: {
            source: rank(ruleHits.source),
            sink: rank(ruleHits.sink),
            transfer: rank(ruleHits.transfer),
        },
        uncoveredHighFrequencyInvokes: uncovered,
        noCandidateCallsites,
    };
}

function collectSourceZeroHitAudit(entryResults: EntryAnalyzeResult[]) {
    const byRuleId = new Map<string, NonNullable<EntryAnalyzeResult["sourceRuleZeroHitAudit"]>[number]>();
    const reasonRank: Record<string, number> = {
        source_rule_callsite_outside_allowed_methods: 4,
        source_rule_matching_callsite_no_seed_fact: 3,
        source_rule_no_matching_callsite: 2,
        source_rule_non_call_zero_hit: 1,
    };
    for (const entry of entryResults || []) {
        for (const audit of entry.sourceRuleZeroHitAudit || []) {
            const existing = byRuleId.get(audit.ruleId);
            if (!existing) {
                byRuleId.set(audit.ruleId, audit);
                continue;
            }
            const existingRank = reasonRank[existing.reason] || 0;
            const nextRank = reasonRank[audit.reason] || 0;
            if (nextRank > existingRank) {
                byRuleId.set(audit.ruleId, audit);
                continue;
            }
            if (nextRank === existingRank && audit.matchedCallsiteCount > existing.matchedCallsiteCount) {
                byRuleId.set(audit.ruleId, audit);
            }
        }
    }
    return [...byRuleId.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

export function writeNoCandidateCallsiteArtifacts(report: AnalyzeReport, outputDir: string): void {
    const items = collectSemanticFlowRuleCandidateItems(report);
    const feedbackOutputDir = resolveRuleFeedbackOutputDir(outputDir);
    fs.mkdirSync(feedbackOutputDir, { recursive: true });
    const jsonPath = path.resolve(feedbackOutputDir, "no_candidate_callsites.json");
    const mdPath = path.resolve(feedbackOutputDir, "no_candidate_callsites.md");
    const payload = {
        generatedAt: report.generatedAt,
        repo: report.repo,
        total: items.length,
        items,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderNoCandidateCallsitesMarkdown(items, report), "utf-8");
}

export function writeNoCandidateCallsiteClassificationArtifacts(
    report: AnalyzeReport,
    loadedRules: LoadedRuleSet,
    outputDir: string,
): NoCandidateCallsiteClassificationArtifacts {
    const artifacts = buildNoCandidateCallsiteClassificationArtifacts(report, loadedRules);
    const { items, categoryCount, apiModelingCandidates } = artifacts;
    const feedbackOutputDir = resolveRuleFeedbackOutputDir(outputDir);
    fs.mkdirSync(feedbackOutputDir, { recursive: true });
    const jsonPath = path.resolve(feedbackOutputDir, "no_candidate_callsites_classified.json");
    const mdPath = path.resolve(feedbackOutputDir, "no_candidate_callsites_classified.md");
    const apiModelingCandidateJsonPath = path.resolve(feedbackOutputDir, "api_modeling_candidates.json");
    const apiModelingCandidateMdPath = path.resolve(feedbackOutputDir, "api_modeling_candidates.md");

    fs.writeFileSync(jsonPath, JSON.stringify({
        generatedAt: report.generatedAt,
        repo: report.repo,
        total: items.length,
        categoryCount,
        items,
    }, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderNoCandidateCallsitesClassifiedMarkdown(items, categoryCount, report), "utf-8");

    fs.writeFileSync(apiModelingCandidateJsonPath, JSON.stringify({
        generatedAt: report.generatedAt,
        repo: report.repo,
        total: apiModelingCandidates.length,
        policy: "include_neutral_api_modeling_surfaces_and_selected_external_sdk_gaps",
        items: apiModelingCandidates,
    }, null, 2), "utf-8");
    fs.writeFileSync(apiModelingCandidateMdPath, renderApiModelingCandidatesMarkdown(apiModelingCandidates, report), "utf-8");

    return artifacts;
}

export function buildNoCandidateCallsiteClassificationArtifacts(
    report: AnalyzeReport,
    loadedRules: LoadedRuleSet,
): NoCandidateCallsiteClassificationArtifacts {
    const baseItems = collectSemanticFlowRuleCandidateItems(report);
    void loadedRules;
    const items = baseItems.map(site => classifyNoCandidateCallsite(site));
    const categoryCount = items.reduce((acc, item) => {
        acc[item.category] = (acc[item.category] || 0) + 1;
        return acc;
    }, {
        C0_NON_TRANSFER_HELPER: 0,
        C1_UI_NOISE: 0,
        C2_API_MODELING_CANDIDATE: 0,
        C3_FRAMEWORK_GAP: 0,
    } as Record<NoCandidateCategory, number>);
    const apiModelingCandidates = enrichApiModelingCandidatesForArtifacts(report, mergeApiModelingCandidatePools(
        buildApiModelingCandidatePool(items),
        buildRecalledApiModelingCandidates(report),
    ));

    return {
        items,
        categoryCount,
        apiModelingCandidates,
    };
}

function collectSemanticFlowRuleCandidateItems(report: AnalyzeReport): NoCandidateCallsiteStat[] {
    const merged = new Map<string, NoCandidateCallsiteStat>();
    const add = (item: NoCandidateCallsiteStat): void => {
        const key = `${item.canonicalApiId || ""}|${item.callee_signature}|${item.method}|${item.invokeKind}|${item.argCount}|${item.sourceFile}`;
        const existing = merged.get(key);
        if (existing) {
            existing.count = Math.max(existing.count, item.count);
            existing.topEntries = dedupStrings([...existing.topEntries, ...item.topEntries]);
            return;
        }
        merged.set(key, {
            callee_signature: item.callee_signature,
            canonicalApiId: item.canonicalApiId,
            method: item.method,
            invokeKind: item.invokeKind,
            argCount: item.argCount,
            sourceFile: item.sourceFile,
            count: item.count,
            topEntries: dedupStrings(item.topEntries),
        });
    };

    for (const item of report.summary.transferProfile.noCandidateCallsites || []) {
        add({
            callee_signature: item.calleeSignature,
            canonicalApiId: item.canonicalApiId,
            method: item.method,
            invokeKind: item.invokeKind,
            argCount: item.argCount,
            sourceFile: item.sourceFile,
            count: item.count,
            topEntries: [],
        });
    }
    for (const item of report.summary.ruleFeedback?.noCandidateCallsites || []) {
        add(item);
    }

    return [...merged.values()]
        .sort((a, b) => b.count - a.count || a.callee_signature.localeCompare(b.callee_signature))
        .slice(0, 200);
}

function dedupStrings(values: string[]): string[] {
    return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))];
}

function getAnalyzeSourceRules(loadedRules: LoadedRuleSet): SourceRule[] {
    const rules = getSourceRules(loadedRules);
    return rules.filter(rule => rule.id !== "source.local_name.primary");
}

function collectInvokeSiteStatsForSourceDir(scene: Scene, sourceDir: string): Map<string, InvokeSiteStat> {
    const stats = new Map<string, InvokeSiteStat>();
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        const callerSignature = method.getSignature().toString();
        const callerFilePath = extractFilePathFromSignature(callerSignature);
        const callerClassText = method.getDeclaringArkClass?.()?.getName?.() || callerSignature;
        const callerMethodName = method.getName();
        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            if (!invokeExpr) continue;
            const signature = invokeExpr.getMethodSignature?.().toString?.() || "";
            if (!signature) continue;
            const methodName = resolveInvokeMethodName(invokeExpr, signature);
            if (!methodName || methodName.startsWith("%") || methodName === "constructor") continue;
            if (signature.includes("/taint_mock.ts")) continue;
            let invokeKind: RuleInvokeKind = "static";
            if (invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkPtrInvokeExpr) {
                invokeKind = "instance";
            } else if (invokeExpr instanceof ArkStaticInvokeExpr) {
                invokeKind = "static";
            }
            const argCount = invokeExpr.getArgs ? invokeExpr.getArgs().length : 0;
            const calleeFilePath = extractFilePathFromSignature(signature);
            const calleeClassText = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || signature;
            const key = `${signature}|${callerSignature}`;
            const existing = stats.get(key);
            if (existing) {
                existing.count += 1;
            } else {
                stats.set(key, {
                    signature,
                    methodName,
                    invokeKind,
                    argCount,
                    calleeFilePath,
                    calleeClassText,
                    callerFilePath,
                    callerClassText,
                    callerMethodName,
                    sourceDir,
                    count: 1,
                });
            }
        }
    }
    return stats;
}

function extractFilePathFromSignature(signature: string): string {
    const m = signature.match(/@([^:>]+):/);
    return m ? m[1].replace(/\\/g, "/") : signature;
}

function resolveInvokeMethodName(invokeExpr: any, signature: string): string {
    const fromSig = invokeExpr.getMethodSignature?.().getMethodSubSignature?.().getMethodName?.() || "";
    if (fromSig) return String(fromSig);
    const m = signature.match(/\.([A-Za-z0-9_$]+)\(/);
    return m ? m[1] : "";
}

function resolveSourceRuleKind(rule: SourceRule): SourceRuleKind {
    return rule.sourceKind || "seed_local_name";
}

function isSourceCallLikeRule(rule: SourceRule): boolean {
    const kind = resolveSourceRuleKind(rule);
    return kind === "call_return" || kind === "call_arg" || kind === "callback_param";
}

function ruleMatchesInvokeForSourceCoverage(rule: SourceRule, site: InvokeSiteStat): boolean {
    void rule;
    void site;
    return false;
}

function ruleMatchesInvokeForSinkCoverage(rule: SinkRule, site: InvokeSiteStat): boolean {
    void rule;
    void site;
    return false;
}

function ruleMatchesInvokeForTransferCoverage(rule: TransferRule, site: InvokeSiteStat): boolean {
    void rule;
    void site;
    return false;
}

function renderNoCandidateCallsitesMarkdown(items: NoCandidateCallsiteStat[], report: AnalyzeReport): string {
    const lines: string[] = [];
    lines.push("# No Candidate Callsites");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- repo: ${report.repo}`);
    lines.push(`- total: ${items.length}`);
    lines.push("");
    lines.push("| # | canonicalApiId | callee_signature | method | invokeKind | argCount | sourceFile | count | topEntries |");
    lines.push("|---|---|---|---|---|---:|---|---:|---|");
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const topEntries = item.topEntries.join("; ");
        lines.push(`| ${i + 1} | ${item.canonicalApiId || "-"} | ${item.callee_signature} | ${item.method} | ${item.invokeKind} | ${item.argCount} | ${item.sourceFile} | ${item.count} | ${topEntries} |`);
    }
    return `${lines.join("\n")}\n`;
}

function resolveRuleFeedbackOutputDir(outputDir: string): string {
    return path.resolve(outputDir, "feedback", "rule_feedback");
}

function classifyNoCandidateCallsite(
    site: NoCandidateCallsiteStat,
): ClassifiedNoCandidateCallsite {
    if (!site.canonicalApiId) {
        return {
            ...site,
            category: "C3_FRAMEWORK_GAP",
            reason: "Callsite has no accepted canonicalApiId and is retained as an unresolved identity gap.",
            evidence: [
                `identityStatus=unresolved`,
                `calleeSignature=${site.callee_signature}`,
                `invokeKind=${site.invokeKind}`,
                `argCount=${site.argCount}`,
                `sourceFile=${site.sourceFile}`,
            ],
        };
    }

    return {
        ...site,
        category: "C2_API_MODELING_CANDIDATE",
        reason: "Callsite has an exact canonicalApiId but no applicable semantic effect, so it is retained as an API modeling candidate.",
        evidence: [
            `canonicalApiId=${site.canonicalApiId}`,
            `sourceFile=${site.sourceFile}`,
        ],
    };
}

function renderNoCandidateCallsitesClassifiedMarkdown(
    items: ClassifiedNoCandidateCallsite[],
    categoryCount: Record<NoCandidateCategory, number>,
    report: AnalyzeReport,
): string {
    const lines: string[] = [];
    lines.push("# No Candidate Callsites Classified");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- repo: ${report.repo}`);
    lines.push(`- total: ${items.length}`);
    lines.push(`- categoryCount: ${JSON.stringify(categoryCount)}`);
    lines.push("");
    lines.push("| # | category | canonicalApiId | callee_signature | method | invokeKind | argCount | sourceFile | count | reason | evidence |");
    lines.push("|---|---|---|---|---|---|---:|---|---:|---|---|");
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const evidence = item.evidence.join("; ");
        lines.push(`| ${i + 1} | ${item.category} | ${item.canonicalApiId || "-"} | ${item.callee_signature} | ${item.method} | ${item.invokeKind} | ${item.argCount} | ${item.sourceFile} | ${item.count} | ${item.reason} | ${evidence} |`);
    }
    return `${lines.join("\n")}\n`;
}

function buildApiModelingCandidatePool(items: ClassifiedNoCandidateCallsite[]): ClassifiedNoCandidateCallsite[] {
    return items
        .filter(item => item.category === "C2_API_MODELING_CANDIDATE" && !!item.canonicalApiId)
        .sort((a, b) => b.count - a.count || String(a.canonicalApiId || "").localeCompare(String(b.canonicalApiId || "")));
}

function buildRecalledApiModelingCandidates(report: AnalyzeReport): ClassifiedNoCandidateCallsite[] {
    const callbackCandidates = discoverApiCallbackModelingCandidates(report.repo, report.sourceDirs || [], {
        maxCandidates: Number.MAX_SAFE_INTEGER,
    });
    const apiSurfaceCandidates = discoverApiSurfaceModelingCandidates(report.repo, report.sourceDirs || [], {
        maxCandidates: Number.MAX_SAFE_INTEGER,
    });
    return [...callbackCandidates, ...apiSurfaceCandidates]
        .filter(hasExactCandidateIdentity)
        .map(candidate => toRecalledClassifiedCandidate(candidate));
}

function toRecalledClassifiedCandidate(candidate: NormalizedCallsiteItem): ClassifiedNoCandidateCallsite {
    const extra = candidate as any;
    const callbackProperties = Array.isArray((candidate as any).callbackProperties)
        ? ((candidate as any).callbackProperties as unknown[]).map(value => String(value || "").trim()).filter(Boolean)
        : [];
    const importSource = typeof (candidate as any).importSource === "string"
        ? String((candidate as any).importSource).trim()
        : "";
    const origin = typeof (candidate as any).candidateOrigin === "string"
        ? String((candidate as any).candidateOrigin).trim()
        : "recall_callback_surface";
    const semanticFocus = typeof (candidate as any).semanticFocus === "string"
        ? String((candidate as any).semanticFocus).trim()
        : "";
    return {
        ...extra,
        callee_signature: candidate.callee_signature,
        method: candidate.method,
        invokeKind: candidate.invokeKind,
        argCount: candidate.argCount,
        sourceFile: candidate.sourceFile,
        count: candidate.count || 1,
        topEntries: candidate.topEntries || [],
        category: "C2_API_MODELING_CANDIDATE",
        reason: "API/callback surface has an exact canonicalApiId and is retained as an LLM modeling candidate.",
        evidence: [
            `origin=${origin}`,
            `canonicalApiId=${candidate.canonicalApiId}`,
            ...(semanticFocus ? [`semanticFocus=${semanticFocus}`] : []),
            ...(callbackProperties.length > 0 ? [`callbacks=${callbackProperties.join(",")}`] : []),
            ...(importSource ? [`importSource=${importSource}`] : []),
        ],
        candidateOrigin: origin,
        ...(semanticFocus ? { semanticFocus } : {}),
    } as ClassifiedNoCandidateCallsite;
}

function mergeApiModelingCandidatePools(
    primary: ClassifiedNoCandidateCallsite[],
    recalled: ClassifiedNoCandidateCallsite[],
): ClassifiedNoCandidateCallsite[] {
    const merged = new Map<string, ClassifiedNoCandidateCallsite>();
    const add = (item: ClassifiedNoCandidateCallsite): void => {
        if (!item.canonicalApiId) {
            return;
        }
        const semanticFocus = typeof (item as any).semanticFocus === "string"
            ? String((item as any).semanticFocus).trim()
            : "";
        const key = `${item.canonicalApiId}|${semanticFocus}`;
        const existing = merged.get(key);
        if (existing) {
            existing.count = Math.max(existing.count, item.count);
            existing.evidence = dedupStrings([...existing.evidence, ...item.evidence]);
            existing.topEntries = dedupStrings([...existing.topEntries, ...item.topEntries]);
            return;
        }
        merged.set(key, item);
    };
    primary.forEach(add);
    recalled.forEach(add);
    return [...merged.values()]
        .sort((a, b) => b.count - a.count || String(a.canonicalApiId || "").localeCompare(String(b.canonicalApiId || "")))
        .slice(0, 200);
}

function enrichApiModelingCandidatesForArtifacts(
    report: AnalyzeReport,
    candidates: ClassifiedNoCandidateCallsite[],
): ClassifiedNoCandidateCallsite[] {
    if (candidates.length === 0 || !report.repo || !Array.isArray(report.sourceDirs) || report.sourceDirs.length === 0) {
        return candidates;
    }
    return enrichNoCandidateItemsWithCallsiteSlices({
        repoRoot: report.repo,
        sourceDirs: report.sourceDirs,
        items: candidates,
        maxItems: candidates.length,
        maxExamplesPerItem: 1,
        contextRadius: 3,
        cfgNeighborRadius: 1,
    }) as unknown as ClassifiedNoCandidateCallsite[];
}

function renderApiModelingCandidatesMarkdown(
    items: ClassifiedNoCandidateCallsite[],
    report: AnalyzeReport,
): string {
    const lines: string[] = [];
    lines.push("# API Modeling Candidates");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- repo: ${report.repo}`);
    lines.push(`- total: ${items.length}`);
    lines.push(`- policy: exact_canonical_api_id_only`);
    lines.push("");
    lines.push("| # | canonicalApiId | callee_signature | method | invokeKind | argCount | sourceFile | count | reason | evidence |");
    lines.push("|---|---|---|---|---|---:|---|---:|---|---|");
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const evidence = item.evidence.join("; ");
        lines.push(`| ${i + 1} | ${item.canonicalApiId || "-"} | ${item.callee_signature} | ${item.method} | ${item.invokeKind} | ${item.argCount} | ${item.sourceFile} | ${item.count} | ${item.reason} | ${evidence} |`);
    }
    return `${lines.join("\n")}\n`;
}

function hasExactCandidateIdentity(candidate: NormalizedCallsiteItem): boolean {
    const canonicalApiId = String((candidate as any).canonicalApiId || "").trim();
    if (!canonicalApiId) {
        return false;
    }
    try {
        assertValidCanonicalApiId(canonicalApiId);
        return true;
    } catch {
        return false;
    }
}
