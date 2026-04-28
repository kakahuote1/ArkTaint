import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../arkanalyzer/out/src/core/base/Expr";
import { LoadedRuleSet } from "../core/rules/RuleLoader";
import {
    normalizeEndpoint,
    RuleInvokeKind,
    RuleMatch,
    RuleScopeConstraint,
    RuleStringConstraint,
    SinkRule,
    SourceRule,
    SourceRuleKind,
    TransferRule,
} from "../core/rules/RuleSchema";
import { AnalyzeReport, EntryAnalyzeResult } from "./analyzeTypes";
import { getSourceRules } from "./analyzeUtils";
import { RuleHitCounters } from "../core/orchestration/TaintPropagationEngine";

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

type NoCandidateCategory = "C0_NON_TRANSFER_HELPER" | "C1_UI_NOISE" | "C2_PROJECT_WRAPPER" | "C3_FRAMEWORK_GAP";

interface ClassifiedNoCandidateCallsite extends NoCandidateCallsiteStat {
    category: NoCandidateCategory;
    reason: string;
    evidence: string[];
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
            const key = `${entry.sourceDir}|${site.calleeSignature}|${site.method}|${site.invokeKind}|${site.argCount}|${site.sourceFile}`;
            const existing = noCandidateAggregate.get(key);
            if (existing) {
                existing.count += site.count;
            } else {
                noCandidateAggregate.set(key, {
                    callee_signature: site.calleeSignature,
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
): void {
    const baseItems = collectSemanticFlowRuleCandidateItems(report);
    const kernelTransferRules = loadAppliedKernelTransferRules(loadedRules);
    const items = baseItems.map(site => classifyNoCandidateCallsite(site, kernelTransferRules));
    const categoryCount = items.reduce((acc, item) => {
        acc[item.category] = (acc[item.category] || 0) + 1;
        return acc;
    }, {
        C0_NON_TRANSFER_HELPER: 0,
        C1_UI_NOISE: 0,
        C2_PROJECT_WRAPPER: 0,
        C3_FRAMEWORK_GAP: 0,
    } as Record<NoCandidateCategory, number>);
    const projectCandidates = buildProjectCandidatePool(items);

    const feedbackOutputDir = resolveRuleFeedbackOutputDir(outputDir);
    fs.mkdirSync(feedbackOutputDir, { recursive: true });
    const jsonPath = path.resolve(feedbackOutputDir, "no_candidate_callsites_classified.json");
    const mdPath = path.resolve(feedbackOutputDir, "no_candidate_callsites_classified.md");
    const projectCandidateJsonPath = path.resolve(feedbackOutputDir, "no_candidate_project_candidates.json");
    const projectCandidateMdPath = path.resolve(feedbackOutputDir, "no_candidate_project_candidates.md");

    fs.writeFileSync(jsonPath, JSON.stringify({
        generatedAt: report.generatedAt,
        repo: report.repo,
        total: items.length,
        categoryCount,
        items,
    }, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderNoCandidateCallsitesClassifiedMarkdown(items, categoryCount, report), "utf-8");

    fs.writeFileSync(projectCandidateJsonPath, JSON.stringify({
        generatedAt: report.generatedAt,
        repo: report.repo,
        total: projectCandidates.length,
        policy: "include_only_C2_PROJECT_WRAPPER",
        items: projectCandidates,
    }, null, 2), "utf-8");
    fs.writeFileSync(projectCandidateMdPath, renderNoCandidateProjectCandidatesMarkdown(projectCandidates, report), "utf-8");
}

function collectSemanticFlowRuleCandidateItems(report: AnalyzeReport): NoCandidateCallsiteStat[] {
    const merged = new Map<string, NoCandidateCallsiteStat>();
    const add = (item: NoCandidateCallsiteStat): void => {
        const key = `${item.callee_signature}|${item.method}|${item.invokeKind}|${item.argCount}|${item.sourceFile}`;
        const existing = merged.get(key);
        if (existing) {
            existing.count = Math.max(existing.count, item.count);
            existing.topEntries = dedupStrings([...existing.topEntries, ...item.topEntries]);
            return;
        }
        merged.set(key, {
            callee_signature: item.callee_signature,
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

function extractFilePathFromSignature(signature: string): string {
    const m = signature.match(/@([^:>]+):/);
    return m ? m[1].replace(/\\/g, "/") : signature;
}

function extractDeclaringClassFromMethodSignature(signature: string): string {
    const openParen = signature.indexOf("(");
    const methodDot = signature.lastIndexOf(".", openParen >= 0 ? openParen : signature.length);
    if (methodDot < 0) return signature;
    return signature.slice(0, methodDot).trim();
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
    site: InvokeSiteStat,
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
    return rule.sourceKind || "seed_local_name";
}

function isSourceCallLikeRule(rule: SourceRule): boolean {
    const kind = resolveSourceRuleKind(rule);
    return kind === "call_return" || kind === "call_arg" || kind === "callback_param";
}

function ruleMatchesInvokeForSourceCoverage(rule: SourceRule, site: InvokeSiteStat): boolean {
    if (!matchInvokeShape(rule.match.invokeKind, rule.match.argCount, rule.match.typeHint, site)) return false;
    if (!matchRuleMatch(rule.match, site)) return false;
    return matchScopeForCaller(rule.scope, site);
}

function ruleMatchesInvokeForSinkCoverage(rule: SinkRule, site: InvokeSiteStat): boolean {
    if (!matchInvokeShape(rule.match.invokeKind, rule.match.argCount, rule.match.typeHint, site)) return false;
    if (!matchRuleMatch(rule.match, site)) return false;
    return matchScopeForCallee(rule.scope, site);
}

function ruleMatchesInvokeForTransferCoverage(rule: TransferRule, site: InvokeSiteStat): boolean {
    if (!matchInvokeShape(rule.match.invokeKind, rule.match.argCount, rule.match.typeHint, site)) return false;
    if (!matchRuleMatch(rule.match, site)) return false;
    return matchScopeForCallee(rule.scope, site);
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

function resolveRuleFeedbackOutputDir(outputDir: string): string {
    return path.resolve(outputDir, "feedback", "rule_feedback");
}

function loadAppliedKernelTransferRules(loadedRules: LoadedRuleSet): TransferRule[] {
    return (loadedRules.ruleSet.transfers || []).filter(rule => rule.enabled !== false && rule.layer === "kernel");
}

function matchNoCandidateCallsiteToTransferRule(site: NoCandidateCallsiteStat, rule: TransferRule): boolean {
    const m = rule.match;
    if (m.invokeKind && m.invokeKind !== "any" && m.invokeKind !== site.invokeKind) return false;
    if (m.argCount !== undefined && m.argCount !== site.argCount) return false;
    if (rule.scope) {
        if (!matchStringConstraint(rule.scope.file, site.sourceFile)) return false;
        if (!matchStringConstraint(rule.scope.module, site.callee_signature || site.sourceFile)) return false;
        if (!matchStringConstraint(rule.scope.className, extractDeclaringClassFromMethodSignature(site.callee_signature))) return false;
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
            return site.callee_signature === value;
        case "signature_regex":
            try {
                return new RegExp(value).test(site.callee_signature);
            } catch {
                return false;
            }
        case "declaring_class_equals":
            return extractDeclaringClassFromMethodSignature(site.callee_signature) === value;
        default:
            return false;
    }
}

function classifyNoCandidateCallsite(
    site: NoCandidateCallsiteStat,
    kernelTransferRules: TransferRule[],
): ClassifiedNoCandidateCallsite {
    const sigLower = site.callee_signature.toLowerCase();
    const methodLower = site.method.toLowerCase();
    const sourceLower = site.sourceFile.toLowerCase();

    if (isNonTransferProjectHelper(site, sigLower, methodLower)) {
        return {
            ...site,
            category: "C0_NON_TRANSFER_HELPER",
            reason: "Callsite is a project helper without argument-to-result transfer semantics and is excluded from LLM modeling.",
            evidence: [
                `method=${site.method}`,
                `invokeKind=${site.invokeKind}`,
                `argCount=${site.argCount}`,
                `sourceFile=${site.sourceFile}`,
            ],
        };
    }

    if (isArkUiAttributeNoise(site, sigLower, methodLower)) {
        return {
            ...site,
            category: "C1_UI_NOISE",
            reason: "Callsite is an ArkUI attribute/builder helper and is excluded from LLM modeling.",
            evidence: [
                `method=${site.method}`,
                `signature=${site.callee_signature}`,
                `sourceFile=${site.sourceFile}`,
            ],
        };
    }

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
            reason: "Callsite matches UI construction noise and is downgraded at report layer.",
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
            reason: "Callsite hits @%unk/%unk unresolved signature and is classified as a framework gap.",
            evidence: [
                `callee_signature=${site.callee_signature}`,
                `invokeKind=${site.invokeKind}`,
                `argCount=${site.argCount}`,
            ],
        };
    }

    const matchedFrameworkRules = kernelTransferRules
        .filter(rule => matchNoCandidateCallsiteToTransferRule(site, rule))
        .slice(0, 3)
        .map(rule => rule.id);
    if (matchedFrameworkRules.length > 0) {
        return {
            ...site,
            category: "C3_FRAMEWORK_GAP",
            reason: "Callsite is close to existing framework transfer rules and is classified as a framework gap.",
            evidence: matchedFrameworkRules.map(id => `matched_framework_rule=${id}`),
        };
    }

    return {
        ...site,
        category: "C2_PROJECT_WRAPPER",
        reason: "Callsite matches neither UI noise nor framework-gap traits and is classified as a project wrapper candidate.",
        evidence: [
            `method=${site.method}`,
            `sourceFile=${site.sourceFile}`,
        ],
    };
}

function isNonTransferProjectHelper(
    site: NoCandidateCallsiteStat,
    sigLower: string,
    methodLower: string,
): boolean {
    if (methodLower === "constructor" || methodLower.includes("instinit") || methodLower.startsWith("%")) {
        return true;
    }
    if (isPageOrComponentGetter(site, sigLower, methodLower)) {
        return true;
    }
    if (site.invokeKind !== "static" || site.argCount !== 0) {
        return false;
    }
    const singletonAccessors = new Set([
        "shared",
        "getcontext",
        "getinstance",
        "sharedinstance",
        "getsharedinstance",
    ]);
    if (!singletonAccessors.has(methodLower)) {
        return false;
    }
    return sigLower.includes(".[static]") || sigLower.includes("[static]");
}

function isPageOrComponentGetter(
    site: NoCandidateCallsiteStat,
    sigLower: string,
    methodLower: string,
): boolean {
    const uiHelperMethods = new Set([
        "collecticon",
        "getpage",
        "getrightitems",
        "routesaction",
        "shareaction",
        "tabbaritem",
    ]);
    if (uiHelperMethods.has(methodLower) && site.argCount <= 1) {
        return true;
    }
    if (site.argCount !== 0) {
        return false;
    }
    if (!/\/(pages|page|components|component|view)\//.test(sigLower)) {
        return false;
    }
    if (/^(get|is|has)[a-z0-9_$]*/.test(methodLower)) {
        return true;
    }
    return false;
}

function isArkUiAttributeNoise(
    site: NoCandidateCallsiteStat,
    sigLower: string,
    methodLower: string,
): boolean {
    if (!sigLower.includes("arkui-builtin") && !sigLower.includes("commonattribute")) {
        return false;
    }
    const uiAttributeMethods = new Set([
        "title",
        "height",
        "width",
        "fontcolor",
        "fontsize",
        "backgroundcolor",
        "margin",
        "padding",
        "align",
        "layoutweight",
        "visibility",
    ]);
    return uiAttributeMethods.has(methodLower) || site.sourceFile.toLowerCase().includes("arkui-builtin");
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

function renderNoCandidateProjectCandidatesMarkdown(
    items: ClassifiedNoCandidateCallsite[],
    report: AnalyzeReport,
): string {
    const lines: string[] = [];
    lines.push("# No Candidate Project Candidates");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- repo: ${report.repo}`);
    lines.push(`- total: ${items.length}`);
    lines.push(`- policy: include_only_C2_PROJECT_WRAPPER`);
    lines.push("");
    lines.push("| # | callee_signature | method | invokeKind | argCount | sourceFile | count | reason | evidence |");
    lines.push("|---|---|---|---|---:|---|---:|---|---|");
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const evidence = item.evidence.join("; ");
        lines.push(`| ${i + 1} | ${item.callee_signature} | ${item.method} | ${item.invokeKind} | ${item.argCount} | ${item.sourceFile} | ${item.count} | ${item.reason} | ${evidence} |`);
    }
    return `${lines.join("\n")}\n`;
}
