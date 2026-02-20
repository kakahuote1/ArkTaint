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
        stageProfile: any;
        transferNoHitReasons: Record<string, number>;
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
        no_transfer_rules_loaded: "建议在项目规则中补充 transfer 规则（from/to 端点）。",
        no_tainted_facts: "建议补充 source 规则，确保入口参数或关键局部变量能产生 seed。",
        no_invoke_site_from_tainted_fact: "建议检查 taint 到调用点前的传播链路，补充必要 transfer。",
        no_candidate_rule_for_callsite: "建议补充更宽的 match 条件（method/signature/regex）。",
        rule_static_match_failed: "建议调整 match（signature_contains/regex）或 invokeKind/argCount。",
        from_endpoint_not_tainted_or_path_mismatch: "建议核对 fromRef 路径与端点是否与真实 taint 位置一致。",
        to_endpoint_unresolved_or_no_target_nodes: "建议核对 toRef 端点是否可解析到目标节点。",
        no_source_seed: "建议增加 source 规则（entry_param/call_return/seed_local_name）。",
        no_entry_method: "建议补充 entryHint 或显式指定 sourceDir/entry。",
        entry_has_no_body: "目标方法无方法体，建议切换到有实现的入口。",
        no_selected_entry: "当前未选中入口，建议调整 include/exclude/entryHint。",
        analyze_exception: "分析异常，建议先查看 summary.json 的 status=exception 入口。",
    };
    return map[reason] || "建议根据该原因补充 source/sink/transfer 规则。";
}

function resolveProjectRulePath(report: AnalyzeReportLike): string {
    const appliedProject = report.ruleLayerStatus.find(s => s.name === "project" && s.applied);
    if (appliedProject) return appliedProject.path;
    const knownProject = report.ruleLayerStatus.find(s => s.name === "project");
    if (knownProject) return knownProject.path;
    return "rules/project.rules.json";
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
        lines.push("- 当前无规则命中，建议先补充最小 source/sink 规则集。");
    } else {
        if (topSourceHits.length > 0) {
            lines.push(`- source 鍛戒腑: ${topSourceHits.map(x => `${x.key}(${x.count})`).join(", ")}`);
        }
        if (topSinkHits.length > 0) {
            lines.push(`- sink 鍛戒腑: ${topSinkHits.map(x => `${x.key}(${x.count})`).join(", ")}`);
        }
        if (topTransferHits.length > 0) {
            lines.push(`- transfer 鍛戒腑: ${topTransferHits.map(x => `${x.key}(${x.count})`).join(", ")}`);
        }
    }

    lines.push("");
    lines.push("### 未命中原因（Top）");
    if (topNoHitReasons.length === 0) {
        lines.push("- 无明显未命中原因。");
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
        lines.push("- 当前无明显规则缺口位点。");
    } else {
        for (const e of sourceGaps) {
            lines.push(`- [source] ${e.entryName} @ ${e.entryPathHint || "N/A"}: 建议在 ${projectRulePath} 增加 entry_param/call_return source 规则。`);
        }
        for (const e of transferGaps) {
            lines.push(`- [transfer] ${e.entryName} @ ${e.entryPathHint || "N/A"}: 已有 seed 但无 flow，建议在 ${projectRulePath} 补充 from(arg/base)->to(result/base/arg) 的 transfer。`);
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
    lines.push(`- stageProfile: ${JSON.stringify(report.summary.stageProfile)}`);
    lines.push(`- transferNoHitReasons: ${JSON.stringify(report.summary.transferNoHitReasons)}`);
    lines.push("");
    lines.push(...renderGuidance(report));
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
