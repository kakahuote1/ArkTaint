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
        taintEvalMs: number;
        sanitizerGuardMs: number;
        traversalMs: number;
        totalMs: number;
    };
    transferNoHitReasons: string[];
    pagNodeResolutionAudit?: {
        requestCount: number;
        directHitCount: number;
        fallbackResolveCount: number;
        awaitFallbackCount: number;
        exprUseFallbackCount: number;
        anchorLeftFallbackCount: number;
        addAttemptCount: number;
        addFailureCount: number;
        unresolvedCount: number;
        unsupportedValueKinds: Record<string, number>;
    };
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
        semanticState?: {
            enabled: boolean;
            seedCount: number;
            sinkHitCount: number;
            candidateSeedCount: number;
            provenanceCount: number;
            gapCount: number;
            pathConditionCount?: number;
            sinkHits: Array<{ sinkSignature: string; carrierKey: string }>;
            candidateSeeds: Array<{ reason: string; carrierKey: string }>;
            provenance: Array<{ transitionId: string; reason: string }>;
            gaps: Array<{ transitionId: string; blockedBy: string }>;
            pathConditions?: Array<{ normalizedCondition: string; assumption: string }>;
        };
        memoryProfile?: {
            sampleIntervalMs: number;
            sampleCount: number;
            rssMiB: number;
            heapUsedMiB: number;
            peakRssMiB: number;
            peakHeapUsedMiB: number;
        };
        pagNodeResolutionAudit?: any;
        diagnostics?: {
            ruleLoadIssues?: Array<{ userMessage?: string; message: string }>;
            moduleLoadIssues?: Array<{ modulePath: string; message: string; userMessage?: string }>;
            moduleRuntimeFailures?: Array<{ moduleId: string; phase: string; message: string; userMessage?: string }>;
            enginePluginLoadIssues?: Array<{ modulePath: string; message: string; userMessage?: string }>;
            enginePluginRuntimeFailures?: Array<{ pluginName: string; phase: string; message: string; userMessage?: string }>;
            systemFailures?: Array<{ phase: string; message: string; userMessage?: string }>;
        };
        pluginAudit?: {
            loadedPluginNames: string[];
            failedPluginNames: string[];
            plugins: Record<string, {
                sourcePath?: string;
                startHookCalls: number;
                entryHookCalls: number;
                propagationHookCalls: number;
                detectionHookCalls: number;
                resultHookCalls: number;
                finishHookCalls: number;
            }>;
        };
        arkMainSeeds?: {
            enabled: boolean;
            methodCount: number;
            factCount: number;
        };
        stageProfile: any;
        transferNoHitReasons: Record<string, number>;
        diagnosticItems?: Array<{
            category: "Rule" | "Module" | "Plugin" | "System";
            code: string;
            title: string;
            summary: string;
            rawMessage: string;
            advice: string;
            path?: string;
            line?: number;
            column?: number;
            fieldPath?: string;
        }>;
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
    return "src/models/project/<pack>/rules/semanticflow.rules.json";
}

function renderGuidance(report: AnalyzeReportLike): string[] {
    const lines: string[] = [];
    const projectRulePath = resolveProjectRulePath(report);
    const topSourceHits = rankCounters(report.summary.ruleHits.source, 5);
    const topSinkHits = rankCounters(report.summary.ruleHits.sink, 5);
    const topTransferHits = rankCounters(report.summary.ruleHits.transfer, 5);
    const topNoHitReasons = rankCounters(report.summary.transferNoHitReasons, 5);

    lines.push("## Next Steps");
    lines.push("");
    lines.push("### Hit Rules (Top)");
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
    lines.push("### No-Hit Reasons (Top)");
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
    lines.push("### Suggested Rule Gaps (Top)");
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
    const diagnostics = report.summary.diagnostics;
    const pagAudit = report.summary.pagNodeResolutionAudit || {};
    const topNoHitSummary = rankCounters(report.summary.transferNoHitReasons || {}, 5)
        .map(item => `${item.key}(${item.count})`)
        .join(", ");
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
    lines.push(`- transferProfile: checks=${report.summary.transferProfile.ruleCheckCount}, matches=${report.summary.transferProfile.ruleMatchCount}, endpointMatches=${report.summary.transferProfile.endpointMatchCount}, results=${report.summary.transferProfile.resultCount}, dedupSkips=${report.summary.transferProfile.dedupSkipCount}, elapsedMs=${report.summary.transferProfile.elapsedMs}`);
    lines.push(`- detectProfile: calls=${report.summary.detectProfile.detectCallCount}, sinksChecked=${report.summary.detectProfile.sinksChecked}, sanitizerChecks=${report.summary.detectProfile.sanitizerGuardCheckCount}, sanitizerHits=${report.summary.detectProfile.sanitizerGuardHitCount}, totalMs=${report.summary.detectProfile.totalMs}`);
    if (report.summary.semanticState) {
        const semantic = report.summary.semanticState;
        lines.push(`- semanticState: enabled=${semantic.enabled}, seeds=${semantic.seedCount}, sinkHits=${semantic.sinkHitCount}, candidateSeeds=${semantic.candidateSeedCount}, provenance=${semantic.provenanceCount}, gaps=${semantic.gapCount}, pathConditions=${semantic.pathConditionCount || 0}`);
    }
    if (report.summary.memoryProfile) {
        lines.push(`- memoryProfile: peakRssMiB=${report.summary.memoryProfile.peakRssMiB}, peakHeapUsedMiB=${report.summary.memoryProfile.peakHeapUsedMiB}, rssMiB=${report.summary.memoryProfile.rssMiB}, heapUsedMiB=${report.summary.memoryProfile.heapUsedMiB}, samples=${report.summary.memoryProfile.sampleCount}`);
    }
    lines.push(`- pagNodeResolutionAudit: requests=${pagAudit.requestCount || 0}, directHits=${pagAudit.directHitCount || 0}, fallbacks=${pagAudit.fallbackResolveCount || 0}, addFailures=${pagAudit.addFailureCount || 0}, unresolved=${pagAudit.unresolvedCount || 0}`);
    if (report.summary.arkMainSeeds) {
        const arkmain = report.summary.arkMainSeeds;
        lines.push(`- arkMainSeeds: enabled=${arkmain.enabled}, methods=${arkmain.methodCount}, facts=${arkmain.factCount}`);
    }
    if (diagnostics) {
        lines.push(`- diagnostics: total=${(report.summary.diagnosticItems || []).length}, rule=${(diagnostics.ruleLoadIssues || []).length}, moduleLoad=${(diagnostics.moduleLoadIssues || []).length}, moduleRuntime=${(diagnostics.moduleRuntimeFailures || []).length}, pluginLoad=${(diagnostics.enginePluginLoadIssues || []).length}, pluginRuntime=${(diagnostics.enginePluginRuntimeFailures || []).length}`);
    }
    if (report.summary.pluginAudit) {
        lines.push(`- pluginAudit: loaded=${report.summary.pluginAudit.loadedPluginNames.length}, failed=${report.summary.pluginAudit.failedPluginNames.length}`);
    }
    if (topNoHitSummary) {
        lines.push(`- transferNoHitReasonsTop: ${topNoHitSummary}`);
    }
    if (report.summary.ruleFeedback) {
        const zeroHit = report.summary.ruleFeedback.zeroHitRules || { source: {}, sink: {}, transfer: {} };
        lines.push(`- ruleFeedback.zeroHitRules: source=${Object.keys(zeroHit.source || {}).length}, sink=${Object.keys(zeroHit.sink || {}).length}, transfer=${Object.keys(zeroHit.transfer || {}).length}`);
    }
    if (report.summary.semanticState) {
        const semantic = report.summary.semanticState;
        lines.push(`- semantic sink hits: ${semantic.sinkHits.slice(0, 10).map(item => `${item.sinkSignature}@${item.carrierKey}`).join(", ") || "[]"}`);
        lines.push(`- semantic candidate seeds: ${semantic.candidateSeeds.slice(0, 10).map(item => `${item.reason}@${item.carrierKey}`).join(", ") || "[]"}`);
        lines.push(`- semantic provenance: ${semantic.provenance.slice(0, 10).map(item => `${item.transitionId}:${item.reason}`).join(", ") || "[]"}`);
        lines.push(`- semantic gaps: ${semantic.gaps.slice(0, 10).map(item => `${item.transitionId}:${item.blockedBy}`).join(", ") || "[]"}`);
        lines.push(`- semantic path conditions: ${(semantic.pathConditions || []).slice(0, 10).map(item => `${item.normalizedCondition}:${item.assumption}`).join(", ") || "[]"}`);
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
    if (diagnostics) {
        lines.push("");
        lines.push("## Diagnostics");
        lines.push("");
        const normalizedItems = report.summary.diagnosticItems || [];
        if (normalizedItems.length > 0) {
            for (const item of normalizedItems) {
                const location = item.path
                    ? item.line && item.column
                        ? `${item.path}:${item.line}:${item.column}`
                        : item.path
                    : "(no file)";
                lines.push(`- [${item.category}] ${item.code} | ${item.title} | ${location}`);
                lines.push(`  - summary: ${item.summary}`);
                lines.push(`  - message: ${item.rawMessage}`);
                if (item.fieldPath) {
                    lines.push(`  - field: ${item.fieldPath}`);
                }
                lines.push(`  - advice: ${item.advice}`);
            }
            lines.push("");
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
        lines.push(`  - detectProfile: calls=${e.detectProfile.detectCallCount}, sinksChecked=${e.detectProfile.sinksChecked}, sanitizerChecks=${e.detectProfile.sanitizerGuardCheckCount}, sanitizerHits=${e.detectProfile.sanitizerGuardHitCount}, signatureMs=${e.detectProfile.signatureMatchMs}, candidateMs=${e.detectProfile.candidateResolveMs}, taintMs=${e.detectProfile.taintEvalMs}, sanitizerMs=${e.detectProfile.sanitizerGuardMs}, traversalMs=${e.detectProfile.traversalMs}, totalMs=${e.detectProfile.totalMs}`);
        if (e.pagNodeResolutionAudit) {
            lines.push(`  - pagNodeResolutionAudit: requests=${e.pagNodeResolutionAudit.requestCount}, directHits=${e.pagNodeResolutionAudit.directHitCount}, fallbacks=${e.pagNodeResolutionAudit.fallbackResolveCount}, addFailures=${e.pagNodeResolutionAudit.addFailureCount}, unresolved=${e.pagNodeResolutionAudit.unresolvedCount}`);
        }
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

