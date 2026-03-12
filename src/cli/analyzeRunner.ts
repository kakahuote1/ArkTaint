import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../arkanalyzer/out/src/core/base/Expr";
import { RuleHitCounters, TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { ConfigBasedTransferExecutor } from "../core/engine/ConfigBasedTransferExecutor";
import { loadRuleSet, LoadedRuleSet } from "../core/rules/RuleLoader";
import { RuleInvokeKind, RuleMatch, RuleScopeConstraint, RuleStringConstraint, SinkRule, SourceRule, SourceRuleKind, TransferRule } from "../core/rules/RuleSchema";
import {
    collectDummyMainSeedNodes,
    detectFlows,
    getSourcePattern,
    getSourceRules,
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

function hasEnabledSourcesInRuleFile(ruleFilePath?: string): boolean {
    if (!ruleFilePath) return false;
    if (!fs.existsSync(ruleFilePath)) return false;
    try {
        const raw = JSON.parse(fs.readFileSync(ruleFilePath, "utf-8")) as { sources?: Array<{ enabled?: boolean }> };
        const sources = raw.sources || [];
        return sources.some(rule => rule && rule.enabled !== false);
    } catch {
        return false;
    }
}

function resolveSourceDirStamp(repo: string, sourceDir: string): EntryFileStamp | undefined {
    const abs = path.resolve(repo, sourceDir);
    if (!fs.existsSync(abs)) return undefined;
    const stat = fs.statSync(abs);
    return {
        sourceFile: abs.replace(/\\/g, "/"),
        mtimeMs: Math.floor(stat.mtimeMs),
        size: stat.size,
    };
}

function getAnalyzeSourceRules(loadedRules: LoadedRuleSet, allowLocalNamePrimary: boolean): SourceRule[] {
    const rules = getSourceRules(loadedRules);
    if (allowLocalNamePrimary) return rules;
    return rules.filter(rule => rule.id !== "source.local_name.primary");
}

interface AnalyzeSeedingPolicy {
    allowLocalNamePrimaryRule: boolean;
    enableSourceLikeNameHeuristic: boolean;
    enableCrossFunctionFallback: boolean;
    enableSecondarySinkSweep: boolean;
}

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
    method: string;
    invokeKind: RuleInvokeKind;
    argCount: number;
    sourceFile: string;
    count: number;
    topEntries: string[];
}

type NoCandidateCategory = "C1_UI_NOISE" | "C2_PROJECT_WRAPPER" | "C3_FRAMEWORK_GAP";

interface ClassifiedNoCandidateCallsite extends NoCandidateCallsiteStat {
    category: NoCandidateCategory;
    reason: string;
    evidence: string[];
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

function matchStringConstraint(constraint: RuleStringConstraint | undefined, text: string): boolean {
    if (!constraint) return true;
    if (constraint.mode === "equals") return text === constraint.value;
    if (constraint.mode === "contains") return text.includes(constraint.value);
    try {
        return new RegExp(constraint.value).test(text);
    } catch {
        return false;
    }
}

function matchScopeForCallee(scope: RuleScopeConstraint | undefined, site: InvokeSiteStat): boolean {
    if (!scope) return true;
    if (!matchStringConstraint(scope.file, site.calleeFilePath)) return false;
    if (!matchStringConstraint(scope.module, site.signature || site.calleeFilePath)) return false;
    if (!matchStringConstraint(scope.className, site.calleeClassText)) return false;
    if (!matchStringConstraint(scope.methodName, site.methodName)) return false;
    return true;
}

function matchScopeForCaller(scope: RuleScopeConstraint | undefined, site: InvokeSiteStat): boolean {
    if (!scope) return true;
    if (!matchStringConstraint(scope.file, site.callerFilePath)) return false;
    if (!matchStringConstraint(scope.module, site.callerFilePath || site.callerClassText)) return false;
    if (!matchStringConstraint(scope.className, site.callerClassText)) return false;
    if (!matchStringConstraint(scope.methodName, site.callerMethodName)) return false;
    return true;
}

function matchInvokeShape(
    invokeKind: RuleInvokeKind | undefined,
    argCount: number | undefined,
    typeHint: string | undefined,
    site: InvokeSiteStat
): boolean {
    if (invokeKind && invokeKind !== "any" && invokeKind !== site.invokeKind) return false;
    if (argCount !== undefined && argCount !== site.argCount) return false;
    if (typeHint && typeHint.trim().length > 0) {
        const hint = typeHint.trim().toLowerCase();
        const haystack = `${site.signature} ${site.calleeClassText}`.toLowerCase();
        if (!haystack.includes(hint)) return false;
    }
    return true;
}

function matchRuleMatch(match: RuleMatch, site: InvokeSiteStat): boolean {
    const value = match.value || "";
    switch (match.kind) {
        case "method_name_equals":
            return site.methodName === value;
        case "method_name_regex":
            try {
                return new RegExp(value).test(site.methodName);
            } catch {
                return false;
            }
        case "signature_contains":
            return site.signature.includes(value);
        case "signature_equals":
        case "callee_signature_equals":
            return site.signature === value;
        case "signature_regex":
            try {
                return new RegExp(value).test(site.signature);
            } catch {
                return false;
            }
        case "declaring_class_equals":
            return site.calleeClassText === value;
        default:
            return false;
    }
}

function resolveSourceRuleKind(rule: SourceRule): SourceRuleKind {
    if (rule.kind) return rule.kind;
    if (rule.profile === "entry_param") return "entry_param";
    return "seed_local_name";
}

function isSourceCallLikeRule(rule: SourceRule): boolean {
    const kind = resolveSourceRuleKind(rule);
    return kind === "call_return" || kind === "call_arg" || kind === "callback_param";
}

function ruleMatchesInvokeForSourceCoverage(rule: SourceRule, site: InvokeSiteStat): boolean {
    if (!matchInvokeShape(rule.invokeKind, rule.argCount, rule.typeHint, site)) return false;
    if (!matchRuleMatch(rule.match, site)) return false;
    return matchScopeForCaller(rule.scope, site);
}

function ruleMatchesInvokeForSinkCoverage(rule: SinkRule, site: InvokeSiteStat): boolean {
    if (!matchInvokeShape(rule.invokeKind, rule.argCount, rule.typeHint, site)) return false;
    if (!matchRuleMatch(rule.match, site)) return false;
    return matchScopeForCallee(rule.scope, site);
}

function ruleMatchesInvokeForTransferCoverage(rule: TransferRule, site: InvokeSiteStat): boolean {
    if (!matchInvokeShape(rule.invokeKind, rule.argCount, rule.typeHint, site)) return false;
    if (!matchRuleMatch(rule.match, site)) return false;
    return matchScopeForCallee(rule.scope, site);
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

function buildRuleFeedback(
    repoRoot: string,
    loadedRules: LoadedRuleSet,
    ruleHits: RuleHitCounters,
    sourceContextCache: Map<string, { scene: Scene }>,
    entryResults: EntryAnalyzeResult[]
): AnalyzeReport["summary"]["ruleFeedback"] {
    const enabledSources = (loadedRules.ruleSet.sources || []).filter(r => r.enabled !== false);
    const enabledSinks = (loadedRules.ruleSet.sinks || []).filter(r => r.enabled !== false);
    const enabledTransfers = (loadedRules.ruleSet.transfers || []).filter(r => r.enabled !== false);

    const zeroHitRules = emptyRuleHitCounters();
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

    const invokeStats = new Map<string, InvokeSiteStat>();
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

    const noCandidateEntries = entryResults
        .filter(e => e.transferNoHitReasons.includes("no_candidate_rule_for_callsite"));
    const noCandidateSourceDirs = new Set(noCandidateEntries.map(e => e.sourceDir));
    const topEntriesBySourceDir = new Map<string, string[]>();
    for (const sourceDir of noCandidateSourceDirs) {
        const sorted = noCandidateEntries
            .filter(e => e.sourceDir === sourceDir)
            .sort((a, b) => b.score - a.score || a.entryName.localeCompare(b.entryName));
        const labels: string[] = [];
        const seen = new Set<string>();
        for (const e of sorted) {
            const label = e.entryPathHint ? `${e.entryName}@${e.entryPathHint}` : e.entryName;
            if (seen.has(label)) continue;
            seen.add(label);
            labels.push(label);
            if (labels.length >= 8) break;
        }
        topEntriesBySourceDir.set(sourceDir, labels);
    }

    const noCandidateAggregate = new Map<string, NoCandidateCallsiteStat>();
    for (const entry of noCandidateEntries) {
        const topEntries = topEntriesBySourceDir.get(entry.sourceDir) || [];
        for (const site of entry.transferProfile.noCandidateCallsites || []) {
            const sourceFile = site.sourceFile || extractFilePathFromSignature(site.calleeSignature);
            const key = `${site.calleeSignature}|${site.method}|${site.invokeKind}|${site.argCount}|${sourceFile}`;
            const existing = noCandidateAggregate.get(key);
            if (existing) {
                existing.count += site.count;
                continue;
            }
            noCandidateAggregate.set(key, {
                callee_signature: site.calleeSignature,
                method: site.method,
                invokeKind: site.invokeKind,
                argCount: site.argCount,
                sourceFile,
                count: site.count,
                topEntries,
            });
        }
    }
    const noCandidateCallsites = [...noCandidateAggregate.values()]
        .sort((a, b) => b.count - a.count || a.callee_signature.localeCompare(b.callee_signature));

    const uncovered = [...invokeStats.values()]
        .filter(site => {
            const sourceCovered = enabledSources.some(rule => isSourceCallLikeRule(rule) && ruleMatchesInvokeForSourceCoverage(rule, site));
            const sinkCovered = enabledSinks.some(rule => ruleMatchesInvokeForSinkCoverage(rule, site));
            const transferCovered = enabledTransfers.some(rule => ruleMatchesInvokeForTransferCoverage(rule, site));
            return !(sourceCovered || sinkCovered || transferCovered);
        })
        .sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature))
        .slice(0, 30)
        .map(site => ({
            signature: site.signature,
            methodName: site.methodName,
            count: site.count,
            sourceDir: site.sourceDir,
            invokeKind: site.invokeKind,
            argCount: site.argCount,
        }));

    return {
        zeroHitRules,
        ruleHitRanking: {
            source: rank(ruleHits.source),
            sink: rank(ruleHits.sink),
            transfer: rank(ruleHits.transfer),
        },
        uncoveredHighFrequencyInvokes: uncovered,
        noCandidateCallsites,
    };
}

function renderNoCandidateCallsitesMarkdown(items: NoCandidateCallsiteStat[], report: AnalyzeReport): string {
    const lines: string[] = [];
    lines.push("# No Candidate Callsites");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- repo: ${report.repo}`);
    lines.push(`- total: ${items.length}`);
    lines.push("");
    lines.push("| # | callee_signature | method | invokeKind | argCount | sourceFile | count | topEntries |");
    lines.push("|---|---|---|---|---:|---|---:|---|");
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const topEntries = item.topEntries.join("; ");
        lines.push(`| ${i + 1} | ${item.callee_signature} | ${item.method} | ${item.invokeKind} | ${item.argCount} | ${item.sourceFile} | ${item.count} | ${topEntries} |`);
    }
    return `${lines.join("\n")}\n`;
}

function writeNoCandidateCallsiteArtifacts(report: AnalyzeReport): void {
    const items = report.summary.ruleFeedback?.noCandidateCallsites || [];
    const outputDir = path.resolve("tmp", "real_projects");
    fs.mkdirSync(outputDir, { recursive: true });
    const jsonPath = path.resolve(outputDir, "no_candidate_callsites.json");
    const mdPath = path.resolve(outputDir, "no_candidate_callsites.md");
    const payload = {
        generatedAt: report.generatedAt,
        repo: report.repo,
        total: items.length,
        items,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderNoCandidateCallsitesMarkdown(items, report), "utf-8");
}

function loadAppliedFrameworkTransferRules(loadedRules: LoadedRuleSet): TransferRule[] {
    const frameworkLayer = loadedRules.layerStatus.find(s => s.name === "framework" && s.applied && !!s.path);
    if (!frameworkLayer?.path) return [];
    const frameworkPath = path.isAbsolute(frameworkLayer.path)
        ? frameworkLayer.path
        : path.resolve(frameworkLayer.path);
    if (!fs.existsSync(frameworkPath)) return [];
    try {
        const raw = JSON.parse(fs.readFileSync(frameworkPath, "utf-8")) as { transfers?: TransferRule[] };
        const transfers = Array.isArray(raw.transfers) ? raw.transfers : [];
        return transfers.filter(rule => !!rule && rule.enabled !== false);
    } catch {
        return [];
    }
}

function matchNoCandidateCallsiteToTransferRule(site: NoCandidateCallsiteStat, rule: TransferRule): boolean {
    if (rule.invokeKind && rule.invokeKind !== "any" && rule.invokeKind !== site.invokeKind) return false;
    if (rule.argCount !== undefined && rule.argCount !== site.argCount) return false;
    if (rule.scope) {
        if (!matchStringConstraint(rule.scope.file, site.sourceFile)) return false;
        if (!matchStringConstraint(rule.scope.module, site.callee_signature || site.sourceFile)) return false;
        if (!matchStringConstraint(rule.scope.className, site.callee_signature)) return false;
        if (!matchStringConstraint(rule.scope.methodName, site.method)) return false;
    }

    const value = rule.match.value || "";
    switch (rule.match.kind) {
        case "method_name_equals":
            return site.method === value;
        case "method_name_regex":
            try {
                return new RegExp(value).test(site.method);
            } catch {
                return false;
            }
        case "signature_contains":
            return site.callee_signature.includes(value);
        case "signature_equals":
        case "callee_signature_equals":
            return site.callee_signature === value;
        case "signature_regex":
            try {
                return new RegExp(value).test(site.callee_signature);
            } catch {
                return false;
            }
        case "declaring_class_equals":
            return site.callee_signature.includes(value);
        default:
            return false;
    }
}

function classifyNoCandidateCallsite(
    site: NoCandidateCallsiteStat,
    frameworkTransferRules: TransferRule[]
): ClassifiedNoCandidateCallsite {
    const sigLower = site.callee_signature.toLowerCase();
    const methodLower = site.method.toLowerCase();
    const sourceLower = site.sourceFile.toLowerCase();

    const uiNoiseMethods = new Set([
        "observecomponentcreation2",
        "ifelsebranchupdatefunction",
        "foreachupdatefunction",
        "updatestatevarsofchildbyelmtid",
        "initialrender",
        "rerender",
        "finalizeconstruction",
    ]);
    const uiNoiseByMethod = uiNoiseMethods.has(methodLower);
    const uiNoiseBySignature = sigLower.includes("arkui")
        || sigLower.includes("component")
        || sigLower.includes("builder");
    const uiNoiseBySource = sourceLower.includes("/pages/")
        || sourceLower.includes("/view/")
        || sourceLower.includes(".ets");
    const isUiNoise = uiNoiseByMethod || ((methodLower === "create" || methodLower === "pop") && uiNoiseBySignature && uiNoiseBySource);

    if (isUiNoise) {
        return {
            ...site,
            category: "C1_UI_NOISE",
            reason: "调用位点符合 UI 构建链噪音特征，进入报告层降噪。",
            evidence: [
                `method=${site.method}`,
                `signature=${site.callee_signature}`,
                `sourceFile=${site.sourceFile}`,
            ],
        };
    }

    if (site.callee_signature.includes("@%unk/%unk:")) {
        return {
            ...site,
            category: "C3_FRAMEWORK_GAP",
            reason: "命中 @%unk/%unk 未解析调用位点，归为 framework 漏匹配/解析缺口。",
            evidence: [
                `callee_signature=${site.callee_signature}`,
                `invokeKind=${site.invokeKind}`,
                `argCount=${site.argCount}`,
            ],
        };
    }

    const matchedFrameworkRules = frameworkTransferRules
        .filter(rule => matchNoCandidateCallsiteToTransferRule(site, rule))
        .slice(0, 3)
        .map(rule => rule.id);
    if (matchedFrameworkRules.length > 0) {
        return {
            ...site,
            category: "C3_FRAMEWORK_GAP",
            reason: "位点与现有 framework transfer 规则族接近，归为 framework 规则漏匹配。",
            evidence: matchedFrameworkRules.map(id => `matched_framework_rule=${id}`),
        };
    }

    return {
        ...site,
        category: "C2_PROJECT_WRAPPER",
        reason: "未命中 UI 噪音与 framework 缺口特征，归入项目私有封装候选。",
        evidence: [
            `method=${site.method}`,
            `sourceFile=${site.sourceFile}`,
        ],
    };
}

function renderNoCandidateCallsitesClassifiedMarkdown(
    items: ClassifiedNoCandidateCallsite[],
    categoryCount: Record<NoCandidateCategory, number>,
    report: AnalyzeReport
): string {
    const lines: string[] = [];
    lines.push("# No Candidate Callsites Classified");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- repo: ${report.repo}`);
    lines.push(`- total: ${items.length}`);
    lines.push(`- categoryCount: ${JSON.stringify(categoryCount)}`);
    lines.push("");
    lines.push("| # | category | callee_signature | method | invokeKind | argCount | sourceFile | count | reason | evidence |");
    lines.push("|---|---|---|---|---|---:|---|---:|---|---|");
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const evidence = item.evidence.join("; ");
        lines.push(`| ${i + 1} | ${item.category} | ${item.callee_signature} | ${item.method} | ${item.invokeKind} | ${item.argCount} | ${item.sourceFile} | ${item.count} | ${item.reason} | ${evidence} |`);
    }
    return `${lines.join("\n")}\n`;
}

function buildProjectCandidatePool(items: ClassifiedNoCandidateCallsite[]): ClassifiedNoCandidateCallsite[] {
    return items
        .filter(item => item.category === "C2_PROJECT_WRAPPER")
        .sort((a, b) => b.count - a.count || a.callee_signature.localeCompare(b.callee_signature));
}

function renderProjectCandidatePoolMarkdown(
    items: ClassifiedNoCandidateCallsite[],
    report: AnalyzeReport
): string {
    const lines: string[] = [];
    lines.push("# No Candidate Project Candidate Pool");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- repo: ${report.repo}`);
    lines.push(`- total: ${items.length}`);
    lines.push("- policy: include only C2_PROJECT_WRAPPER; C1_UI_NOISE and C3_FRAMEWORK_GAP are excluded at report layer.");
    lines.push("");
    lines.push("| # | category | callee_signature | method | invokeKind | argCount | sourceFile | count | reason | evidence |");
    lines.push("|---|---|---|---|---|---:|---|---:|---|---|");
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const evidence = item.evidence.join("; ");
        lines.push(`| ${i + 1} | ${item.category} | ${item.callee_signature} | ${item.method} | ${item.invokeKind} | ${item.argCount} | ${item.sourceFile} | ${item.count} | ${item.reason} | ${evidence} |`);
    }
    return `${lines.join("\n")}\n`;
}

function writeNoCandidateCallsiteClassificationArtifacts(
    report: AnalyzeReport,
    loadedRules: LoadedRuleSet
): void {
    const baseItems = report.summary.ruleFeedback?.noCandidateCallsites || [];
    const frameworkTransferRules = loadAppliedFrameworkTransferRules(loadedRules);
    const items = baseItems
        .map(site => classifyNoCandidateCallsite(site, frameworkTransferRules))
        .sort((a, b) => b.count - a.count || a.callee_signature.localeCompare(b.callee_signature));

    const categoryCount: Record<NoCandidateCategory, number> = {
        C1_UI_NOISE: 0,
        C2_PROJECT_WRAPPER: 0,
        C3_FRAMEWORK_GAP: 0,
    };
    for (const item of items) {
        categoryCount[item.category] = (categoryCount[item.category] || 0) + 1;
    }

    const outputDir = path.resolve("tmp", "real_projects");
    fs.mkdirSync(outputDir, { recursive: true });
    const jsonPath = path.resolve(outputDir, "no_candidate_callsites_classified.json");
    const mdPath = path.resolve(outputDir, "no_candidate_callsites_classified.md");
    const projectCandidateJsonPath = path.resolve(outputDir, "no_candidate_project_candidates.json");
    const projectCandidateMdPath = path.resolve(outputDir, "no_candidate_project_candidates.md");
    const payload = {
        generatedAt: report.generatedAt,
        repo: report.repo,
        total: items.length,
        categoryCount,
        items,
    };
    const projectCandidates = buildProjectCandidatePool(items);
    const projectCandidatePayload = {
        generatedAt: report.generatedAt,
        repo: report.repo,
        total: projectCandidates.length,
        policy: "include_only_C2_PROJECT_WRAPPER",
        items: projectCandidates,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderNoCandidateCallsitesClassifiedMarkdown(items, categoryCount, report), "utf-8");
    fs.writeFileSync(projectCandidateJsonPath, JSON.stringify(projectCandidatePayload, null, 2), "utf-8");
    fs.writeFileSync(projectCandidateMdPath, renderProjectCandidatePoolMarkdown(projectCandidates, report), "utf-8");
}

async function analyzeSourceDir(
    scene: Scene,
    sourceDir: string,
    options: CliOptions,
    loadedRules: LoadedRuleSet,
    seedingPolicy: AnalyzeSeedingPolicy
): Promise<EntryAnalyzeResult> {
    const t0 = process.hrtime.bigint();
    const stageProfile = emptyEntryStageProfile();
    const dummyMainEntryName = "@dummyMain";
    try {
        const engine = new TaintPropagationEngine(scene, options.k, {
            transferRules: loadedRules.ruleSet.transfers || [],
            debug: {
                enableWorklistProfile: true,
            },
        });
        engine.verbose = false;
        const buildPagT0 = process.hrtime.bigint();
        await engine.buildPAG();
        stageProfile.buildPagMs = elapsedMsSince(buildPagT0);

        try {
            const reachableMethodSignatures = engine.computeReachableMethodSignatures();
            engine.setActiveReachableMethodSignatures(reachableMethodSignatures);
        } catch {
            engine.setActiveReachableMethodSignatures(undefined);
        }

        let seedCount = 0;
        const seedLocalNames = new Set<string>();
        const seedStrategies = new Set<string>();
        const sourceSeedT0 = process.hrtime.bigint();
        const sourceRuleResult = engine.propagateWithSourceRules(
            getAnalyzeSourceRules(loadedRules, seedingPolicy.allowLocalNamePrimaryRule)
        );
        stageProfile.propagateRuleSeedMs = elapsedMsSince(sourceSeedT0);
        seedCount += sourceRuleResult.seedCount;
        for (const x of sourceRuleResult.seededLocals) seedLocalNames.add(x);
        if (sourceRuleResult.seedCount > 0) seedStrategies.add("rule:source");

        const heuristicSeedT0 = process.hrtime.bigint();
        const heuristic = collectDummyMainSeedNodes(scene, engine, getSourcePattern(loadedRules), {
            enableSourceLikeNameSeed: seedingPolicy.enableSourceLikeNameHeuristic,
            enableCrossFunctionFallback: seedingPolicy.enableCrossFunctionFallback,
            allowedMethodSignatures: engine.getActiveReachableMethodSignatures(),
        });
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
                entryName: dummyMainEntryName,
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
            enableSecondarySinkSweep: seedingPolicy.enableSecondarySinkSweep,
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
            entryName: dummyMainEntryName,
            entryPathHint: sourceDir,
            score: 100,
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
            entryName: dummyMainEntryName,
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
    const hasProjectSourceRules = hasEnabledSourcesInRuleFile(loadedRules.projectRulePath);
    const useBroadHeuristics = options.profile === "fast";
    const seedingPolicy: AnalyzeSeedingPolicy = {
        allowLocalNamePrimaryRule: useBroadHeuristics,
        enableSourceLikeNameHeuristic: useBroadHeuristics || !hasProjectSourceRules,
        enableCrossFunctionFallback: options.enableCrossFunctionFallback,
        enableSecondarySinkSweep: options.enableSecondarySinkSweep,
    };
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
    const sourceContextCache = new Map<string, { scene: Scene }>();
    const orderedEntries: Array<EntryAnalyzeResult | undefined> = [];
    const pendingTasks: Array<{
        order: number;
        sourceDir: string;
        scene: Scene;
        entryCacheKey: string;
        entryStamp?: EntryFileStamp;
    }> = [];

    stageProfile.entryConcurrency = options.concurrency;

    for (const sourceDir of options.sourceDirs) {
        const sourceAbs = path.resolve(options.repo, sourceDir);
        if (!fs.existsSync(sourceAbs)) continue;
        let scene = sourceContextCache.get(sourceAbs)?.scene;
        if (!scene) {
            stageProfile.sceneCacheMissCount++;
            const sceneBuildT0 = process.hrtime.bigint();
            const config = new SceneConfig();
            config.buildFromProjectDir(sourceAbs);
            scene = new Scene();
            scene.buildSceneFromProjectDir(config);
            scene.inferTypes();
            stageProfile.sceneBuildMs += elapsedMsSince(sceneBuildT0);
            sourceContextCache.set(sourceAbs, { scene });
        } else {
            stageProfile.sceneCacheHitCount++;
        }

        const order = orderedEntries.length;
        orderedEntries.push(undefined);
        const syntheticCandidate = { pathHint: sourceDir, name: "@dummyMain" };
        const entryCacheKey = buildEntryCacheKey(sourceDir, syntheticCandidate);
        const entryStamp = resolveSourceDirStamp(options.repo, sourceDir);
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
                loadedRules,
                seedingPolicy
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
        noCandidateCallsites: [] as AnalyzeReport["summary"]["transferProfile"]["noCandidateCallsites"],
    };
    const noCandidateSummaryMap = new Map<string, AnalyzeReport["summary"]["transferProfile"]["noCandidateCallsites"][number]>();
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
    transferProfile.noCandidateCallsites = [...noCandidateSummaryMap.values()]
        .sort((a, b) => b.count - a.count || a.calleeSignature.localeCompare(b.calleeSignature))
        .slice(0, 200);
    const reportEntries = entries.map(e => toReportEntry(e, options.reportMode));
    const ruleFeedback = buildRuleFeedback(
        options.repo,
        loadedRules,
        ruleHits,
        sourceContextCache,
        entries
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
    writeNoCandidateCallsiteArtifacts(report);
    writeNoCandidateCallsiteClassificationArtifacts(report, loadedRules);

    return {
        report,
        jsonPath,
        mdPath,
    };
}

