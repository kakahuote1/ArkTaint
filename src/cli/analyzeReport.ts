interface RuleHitCountersLike {
    source: Record<string, number>;
    sink: Record<string, number>;
    transfer: Record<string, number>;
}

interface FlowRuleTraceLike {
    sourceRuleId?: string;
    sinkRuleId?: string;
    sinkEndpoint?: string;
    transferRuleIds: string[];
}

interface EntryAnalyzeResultLike {
    entryName: string;
    entryPathHint?: string;
    score: number;
    status: string;
    seedCount: number;
    seedStrategies: string[];
    flowCount: number;
    sinkSamples: string[];
    flowRuleTraces: FlowRuleTraceLike[];
    ruleHits: RuleHitCountersLike;
    transferProfile: {
        ruleCheckCount: number;
        ruleMatchCount: number;
        endpointMatchCount: number;
        resultCount: number;
        dedupSkipCount: number;
        elapsedMs: number;
    };
    detectProfile: {
        detectCallCount: number;
        sinksChecked: number;
        sanitizerGuardCheckCount: number;
        sanitizerGuardHitCount: number;
        signatureMatchMs: number;
        candidateResolveMs: number;
        cfgGuardMs: number;
        taintEvalMs: number;
        sanitizerGuardMs: number;
        traversalMs: number;
        totalMs: number;
    };
    transferNoHitReasons: string[];
}

interface AnalyzeReportLike {
    generatedAt: string;
    repo: string;
    sourceDirs: string[];
    profile: string;
    reportMode: string;
    k: number;
    maxEntries: number;
    ruleLayers: string[];
    ruleLayerStatus: Array<{ name: string; path: string; applied: boolean }>;
    summary: {
        totalEntries: number;
        okEntries: number;
        withSeeds: number;
        withFlows: number;
        totalFlows: number;
        statusCount: Record<string, number>;
        ruleHits: RuleHitCountersLike;
        ruleHitEndpoints: RuleHitCountersLike;
        transferProfile: any;
        detectProfile: any;
        stageProfile: any;
        transferNoHitReasons: Record<string, number>;
        ruleFeedback?: {
            zeroHitRules?: RuleHitCountersLike;
            ruleHitRanking?: {
                source?: RankedCounter[];
                sink?: RankedCounter[];
                transfer?: RankedCounter[];
            };
            uncoveredHighFrequencyInvokes?: Array<{
                signature: string;
                methodName: string;
                count: number;
                sourceDir: string;
                invokeKind: string;
                argCount: number;
            }>;
        };
    };
    entries: EntryAnalyzeResultLike[];
}

interface RankedCounter {
    key: string;
    count: number;
}

function countTotalHits(record: Record<string, number>): number {
    let total = 0;
    for (const v of Object.values(record)) total += v;
    return total;
}

function rankCounters(record: Record<string, number>, limit: number): RankedCounter[] {
    return Object.entries(record || {})
        .filter(([, v]) => Number.isFinite(v) && v > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limit)
        .map(([key, count]) => ({ key, count }));
}

function noHitReasonAdvice(reason: string): string {
    const map: Record<string, string> = {
        no_transfer_rules_loaded: "Add transfer rules for the relevant from/to endpoints.",
        no_tainted_facts: "Add source rules so entry params or key locals can produce seeds.",
        no_invoke_site_from_tainted_fact: "Check the taint chain before the invoke site and add missing transfer rules.",
        no_candidate_rule_for_callsite: "Broaden the match condition with method/signature/regex coverage.",
        rule_static_match_failed: "Adjust the rule match or invokeKind/argCount constraints.",
        from_endpoint_not_tainted_or_path_mismatch: "Verify that fromRef matches the real tainted endpoint and path.",
        to_endpoint_unresolved_or_no_target_nodes: "Verify that toRef resolves to concrete target nodes.",
        no_source_seed: "Add source rules such as entry_param, call_return, or seed_local_name.",
        no_entry_method: "The current sourceDir did not produce reachable arkMain entries.",
        entry_has_no_body: "The target method has no body; check whether sourceDir contains the executable ArkTS implementation.",
        no_selected_entry: "The current sourceDir produced an empty arkMain reachable scope; check module layout or narrow sourceDir.",
        analyze_exception: "Analysis threw an exception; inspect the summary for the failing entry.",
    };
    return map[reason] || "Add or adjust source/sink/transfer rules based on the reported reason.";
}

function resolveProjectRulePath(report: AnalyzeReportLike): string {
    const appliedProject = report.ruleLayerStatus.find(s => s.name === "project" && s.applied);
    if (appliedProject) return appliedProject.path;
    const knownProject = report.ruleLayerStatus.find(s => s.name === "project");
    if (knownProject) return knownProject.path;
    return "src/rules/project.rules.json";
}

function renderGuidance(report: AnalyzeReportLike): string[] {
    const lines: string[] = [];
    const projectRulePath = resolveProjectRulePath(report);
    const topSourceHits = rankCounters(report.summary.ruleHits.source, 5);
    const topSinkHits = rankCounters(report.summary.ruleHits.sink, 5);
    const topTransferHits = rankCounters(report.summary.ruleHits.transfer, 5);
    const topNoHitReasons = rankCounters(report.summary.transferNoHitReasons, 5);

    lines.push("## 下一步建议");
    lines.push("");
    lines.push("### 命中规则（Top）");
    if (topSourceHits.length === 0 && topSinkHits.length === 0 && topTransferHits.length === 0) {
        lines.push("- No rule hits yet; start by adding a minimal source/sink rule set.");
    } else {
        if (topSourceHits.length > 0) {
            lines.push(`- source hits: ${topSourceHits.map(x => `${x.key}(${x.count})`).join(", ")}`);
        }
        if (topSinkHits.length > 0) {
            lines.push(`- sink hits: ${topSinkHits.map(x => `${x.key}(${x.count})`).join(", ")}`);
        }
        if (topTransferHits.length > 0) {
            lines.push(`- transfer hits: ${topTransferHits.map(x => `${x.key}(${x.count})`).join(", ")}`);
        }
    }

    lines.push("");
    lines.push("### 未命中原因（Top）");
    if (topNoHitReasons.length === 0) {
        lines.push("- No obvious no-hit reasons.");
    } else {
        for (const item of topNoHitReasons) {
            lines.push(`- ${item.key}(${item.count}): ${noHitReasonAdvice(item.key)}`);
        }
    }

    const sourceGaps = report.entries
        .filter(e => e.status === "no_seed")
        .sort((a, b) => b.score - a.score || a.entryName.localeCompare(b.entryName))
        .slice(0, 3);
    const transferGaps = report.entries
        .filter(e => e.status === "ok" && e.seedCount > 0 && e.flowCount === 0)
        .sort((a, b) => b.seedCount - a.seedCount || b.score - a.score)
        .slice(0, 3);

    lines.push("");
    lines.push("### 建议补规则位点（Top）");
    if (sourceGaps.length === 0 && transferGaps.length === 0) {
        lines.push("- No obvious rule gaps.");
    } else {
        for (const e of sourceGaps) {
            lines.push(`- [source] ${e.entryName} @ ${e.entryPathHint || "N/A"}: add entry_param or call_return source rules in ${projectRulePath}.`);
        }
        for (const e of transferGaps) {
            lines.push(`- [transfer] ${e.entryName} @ ${e.entryPathHint || "N/A"}: seeds exist but no flow; add from(arg/base)->to(result/base/arg) transfers in ${projectRulePath}.`);
        }
    }
    return lines;
}

export function renderMarkdownReport(report: AnalyzeReportLike): string {
    const sourceRuleHits = countTotalHits(report.summary.ruleHits.source);
    const sinkRuleHits = countTotalHits(report.summary.ruleHits.sink);
    const transferRuleHits = countTotalHits(report.summary.ruleHits.transfer);
    const lines: string[] = [];
    lines.push("# ArkTaint Analyze Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- repo: ${report.repo}`);
    lines.push(`- sourceDirs: ${report.sourceDirs.join(", ")}`);
    lines.push(`- profile: ${report.profile}`);
    lines.push(`- reportMode: ${report.reportMode}`);
    lines.push(`- k: ${report.k}`);
    lines.push(`- maxEntries: ${report.maxEntries}`);
    lines.push(`- ruleLayers: ${report.ruleLayers.join(" -> ")}`);
    lines.push(`- totalEntries: ${report.summary.totalEntries}`);
    lines.push(`- okEntries: ${report.summary.okEntries}`);
    lines.push(`- withSeeds: ${report.summary.withSeeds}`);
    lines.push(`- withFlows: ${report.summary.withFlows}`);
    lines.push(`- totalFlows: ${report.summary.totalFlows}`);
    lines.push(`- statusCount: ${JSON.stringify(report.summary.statusCount)}`);
    lines.push(`- ruleHitsTotal: source=${sourceRuleHits}, sink=${sinkRuleHits}, transfer=${transferRuleHits}`);
    lines.push(`- ruleHitEndpoints: ${JSON.stringify(report.summary.ruleHitEndpoints)}`);
    lines.push(`- transferProfile: ${JSON.stringify(report.summary.transferProfile)}`);
    lines.push(`- detectProfile: ${JSON.stringify(report.summary.detectProfile)}`);
    lines.push(`- stageProfile: ${JSON.stringify(report.summary.stageProfile)}`);
    lines.push(`- transferNoHitReasons: ${JSON.stringify(report.summary.transferNoHitReasons)}`);
    if (report.summary.ruleFeedback) {
        lines.push(`- ruleFeedback.zeroHitRules: ${JSON.stringify(report.summary.ruleFeedback.zeroHitRules || {})}`);
    }
    lines.push("");
    lines.push(...renderGuidance(report));
    if (report.summary.ruleFeedback) {
        lines.push("");
        lines.push("## Rule Feedback");
        lines.push("");
        const rf = report.summary.ruleFeedback;
        const ranking = rf.ruleHitRanking || {};
        lines.push(`- ruleHitRanking.source: ${JSON.stringify(ranking.source || [])}`);
        lines.push(`- ruleHitRanking.sink: ${JSON.stringify(ranking.sink || [])}`);
        lines.push(`- ruleHitRanking.transfer: ${JSON.stringify(ranking.transfer || [])}`);
        const uncovered = rf.uncoveredHighFrequencyInvokes || [];
        if (uncovered.length > 0) {
            lines.push("");
            lines.push("### uncovered high-frequency invokes");
            for (const item of uncovered.slice(0, 20)) {
                lines.push(`- ${item.signature} | method=${item.methodName} | count=${item.count} | sourceDir=${item.sourceDir} | invokeKind=${item.invokeKind} | argCount=${item.argCount}`);
            }
        } else {
            lines.push("");
            lines.push("- uncovered high-frequency invokes: []");
        }
    }
    lines.push("");
    lines.push("## Top Entries");
    lines.push("");
    const top = [...report.entries].sort((a, b) => b.flowCount - a.flowCount || b.seedCount - a.seedCount || b.score - a.score).slice(0, 20);
    for (const e of top) {
        const sHit = countTotalHits(e.ruleHits.source);
        const skHit = countTotalHits(e.ruleHits.sink);
        const tHit = countTotalHits(e.ruleHits.transfer);
        lines.push(`- ${e.entryName} @ ${e.entryPathHint || "N/A"} | status=${e.status} | flows=${e.flowCount} | seeds=${e.seedCount} | seedBy=${e.seedStrategies.join(",") || "N/A"} | ruleHits=source:${sHit},sink:${skHit},transfer:${tHit} | score=${e.score}`);
        if (report.reportMode !== "full") {
            continue;
        }
        lines.push(`  - transferProfile: checks=${e.transferProfile.ruleCheckCount}, matches=${e.transferProfile.ruleMatchCount}, endpointMatches=${e.transferProfile.endpointMatchCount}, results=${e.transferProfile.resultCount}, dedupSkips=${e.transferProfile.dedupSkipCount}, elapsedMs=${e.transferProfile.elapsedMs}`);
        lines.push(`  - detectProfile: calls=${e.detectProfile.detectCallCount}, sinksChecked=${e.detectProfile.sinksChecked}, sanitizerChecks=${e.detectProfile.sanitizerGuardCheckCount}, sanitizerHits=${e.detectProfile.sanitizerGuardHitCount}, signatureMs=${e.detectProfile.signatureMatchMs}, candidateMs=${e.detectProfile.candidateResolveMs}, cfgMs=${e.detectProfile.cfgGuardMs}, taintMs=${e.detectProfile.taintEvalMs}, sanitizerMs=${e.detectProfile.sanitizerGuardMs}, traversalMs=${e.detectProfile.traversalMs}, totalMs=${e.detectProfile.totalMs}`);
        if (e.transferNoHitReasons.length > 0) {
            lines.push(`  - transferNoHitReasons: ${e.transferNoHitReasons.join(",")}`);
        }
        for (const sample of e.sinkSamples.slice(0, 3)) {
            lines.push(`  - ${sample}`);
        }
        for (const trace of e.flowRuleTraces.slice(0, 2)) {
            lines.push(`  - flowRuleChain: sourceRule=${trace.sourceRuleId || "N/A"}, sinkRule=${trace.sinkRuleId || "N/A"}, sinkEndpoint=${trace.sinkEndpoint || "N/A"}, transferRules=${trace.transferRuleIds.join(" -> ") || "N/A"}`);
        }
    }
    return lines.join("\n");
}

