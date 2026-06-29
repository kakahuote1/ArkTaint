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
    postsolveResults?: Array<{
        flow: {
            source: string;
            sinkText: string;
            sinkFactId?: string;
        };
        skeleton?: {
            nodes: Array<unknown>;
            edges: Array<unknown>;
        };
        paths: Array<{
            factIds: string[];
            status?: string;
            truncated?: boolean;
            evidence: Array<{
                kind: string;
            }>;
            judgement: {
                kind: string;
                primaryReason?: string;
            };
            countability?: {
                status: string;
                reason: string;
            };
        }>;
        evidenceSummary: {
            evidenceKinds: string[];
            primaryReason?: string;
        };
        judgement: {
            kind: string;
            primaryReason?: string;
        };
        countability?: {
            status: string;
            reason: string;
        };
        report?: {
            witness?: {
                status?: string;
            };
        };
    }>;
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
        effectMatchMs: number;
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
        substitutedValueCount: number;
        awaitUnwrapCount: number;
        expressionUseResolveCount: number;
        anchorLeftResolveCount: number;
        addAttemptCount: number;
        addFailureCount: number;
        unresolvedCount: number;
        unsupportedValueKinds: Record<string, number>;
        endpointResolutionRecordCount?: number;
        endpointResolutionStatusCounts?: Record<string, number>;
    };
}

interface AnalyzeReportLike {
    generatedAt: string;
    repo: string;
    sourceDirs: string[];
    profile: string;
    reportMode: string;
    flowMode?: string;
    k: number;
    maxEntries: number;
    ruleSources: string[];
    ruleSourceStatus: Array<{
        name: string;
        path: string;
        applied: boolean;
        exists?: boolean;
        source?: string;
        packId?: string;
        sourceRuleCount?: number;
        sinkRuleCount?: number;
        sanitizerRuleCount?: number;
        transferRuleCount?: number;
        sourceRuleIds?: string[];
        sinkRuleIds?: string[];
    }>;
    summary: {
        totalEntries: number;
        okEntries: number;
        withSeeds: number;
        withFlows: number;
        withPartialFlows?: number;
        totalFlows: number;
        partialFlows?: number;
        statusCount: Record<string, number>;
        ruleHits: RuleHitCountersLike;
        ruleHitEndpoints: RuleHitCountersLike;
        transferProfile: any;
        detectProfile: any;
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
        semanticEffectLedgerSummary?: {
            recordCount: number;
            siteRecordCount: number;
            gapRecordCount: number;
            byRecordKind?: Record<string, number>;
            byStatus?: Record<string, number>;
            byReasonCode?: Record<string, number>;
            byCapability?: Record<string, number>;
            byGapKind?: Record<string, number>;
            endpointStatusCounts?: Record<string, number>;
        };
        officialIdentityCoverage?: {
            totalOccurrenceCount: number;
            acceptedCount: number;
            unresolvedCount: number;
            ambiguousCount: number;
            rejectedCount: number;
            byStatus?: Record<string, number>;
            bySyntaxKind?: Record<string, number>;
            acceptedCanonicalApiIds: number;
            byReasonCode?: Record<string, number>;
            bySourceFile?: Record<string, number>;
            byDomain?: Record<string, number>;
            byModuleSpecifier?: Record<string, number>;
            byResolutionKind?: Record<string, number>;
        };
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
            sourceZeroHitAudit?: unknown[];
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

function countPostsolveJudgements(entries: EntryAnalyzeResultLike[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const entry of entries) {
        for (const result of entry.postsolveResults || []) {
            const kind = result.judgement?.kind || "Unknown";
            out[kind] = (out[kind] || 0) + 1;
        }
    }
    return out;
}

function noHitReasonAdvice(reason: string): string {
    const map: Record<string, string> = {
        no_transfer_rules_loaded: "Asset/effect gap: no exact transfer effects were loaded for this run.",
        no_tainted_facts: "Source or propagation gap: accepted source effects did not produce reachable taint facts.",
        no_invoke_site_from_tainted_fact: "Propagation gap: taint did not reach an invoke site where an exact effect could apply.",
        no_candidate_rule_for_callsite: "Asset/effect gap: tainted callsites exist, but no exact canonical transfer effect applies.",
        rule_static_match_failed: "Effect constraint gap: a candidate effect was considered, but exact invoke or endpoint constraints failed.",
        from_endpoint_not_tainted_or_path_mismatch: "Endpoint or propagation gap: the effect from endpoint did not resolve to the tainted node/path.",
        to_endpoint_unresolved_or_no_target_nodes: "Endpoint gap: the effect matched, but the target endpoint did not resolve to PAG nodes.",
        no_source_seed: "Source or arkMain gap: no exact source capability produced an initial seed.",
        no_entry_method: "The current sourceDir did not produce reachable arkMain entries.",
        entry_has_no_body: "The target method has no body; check whether sourceDir contains the executable ArkTS implementation.",
        no_selected_entry: "The current sourceDir produced an empty arkMain reachable scope; check module layout or narrow sourceDir.",
        analyze_exception: "Analysis threw an exception; inspect the summary for the failing entry.",
        source_dir_exception: "SourceDir analysis failed before closure could be evaluated; inspect diagnostics for the build or scene error.",
        propagation_budget_exceeded: "Result gap: propagation stopped at the configured worklist budget before a complete answer was produced.",
    };
    if (reason.startsWith("propagation_budget_exceeded:")) {
        return "Result gap: propagation stopped at the configured worklist budget; inspect the specific budget reason.";
    }
    return map[reason] || "Inspect the closure ledger for the exact layer that stopped: identity, asset/effect, endpoint, propagation, or result.";
}

function resolveProjectRulePath(report: AnalyzeReportLike): string {
    const appliedProject = report.ruleSourceStatus.find(s => s.name === "project" && s.applied);
    if (appliedProject) return appliedProject.path;
    return "a reviewed project asset package for this analyzed project";
}

function renderOfficialClosureGuidance(report: AnalyzeReportLike): string[] {
    const coverage = report.summary.officialIdentityCoverage;
    const lines: string[] = [];
    lines.push("### Official Closure Gaps");
    if (!coverage) {
        lines.push("- No official occurrence coverage was recorded; inspect occurrence recovery before reasoning about API effects.");
        return lines;
    }

    const identityGapCount = coverage.unresolvedCount + coverage.ambiguousCount + coverage.rejectedCount;
    lines.push(`- identity: accepted=${coverage.acceptedCount}, unresolved=${coverage.unresolvedCount}, ambiguous=${coverage.ambiguousCount}, rejected=${coverage.rejectedCount}`);
    if (coverage.acceptedCount > 0) {
        lines.push(`- effect input: ${coverage.acceptedCount} accepted official occurrences can feed exact source/sink/transfer/module assets.`);
    }
    const semantic = report.summary.semanticEffectLedgerSummary;
    if (semantic) {
        lines.push(`- semantic effects: sites=${semantic.siteRecordCount}, gaps=${semantic.gapRecordCount}, endpointStatuses=${JSON.stringify(semantic.endpointStatusCounts || {})}`);
        const topEffectReasons = rankCounters(semantic.byReasonCode || {}, 5);
        if (topEffectReasons.length > 0) {
            lines.push(`- effect reasons: ${topEffectReasons.map(item => `${item.key}(${item.count})`).join(", ")}`);
        }
    }
    if (identityGapCount > 0) {
        lines.push("- identity gaps must be fixed by stronger import, receiver, declaration, ArkUI, decorator, or shape evidence. They must not emit semantics while unresolved or ambiguous.");
        const topReasons = rankCounters(coverage.byReasonCode || {}, 5);
        if (topReasons.length > 0) {
            lines.push(`- identity reasons: ${topReasons.map(item => `${item.key}(${item.count})`).join(", ")}`);
        }
    } else if (coverage.totalOccurrenceCount > 0) {
        lines.push("- identity gate is clean for recorded official occurrences. If flows are still absent, inspect asset/effect coverage, endpoint projection, and ordinary propagation.");
    }

    const topDomains = rankCounters(coverage.byDomain || {}, 5);
    if (topDomains.length > 0) {
        lines.push(`- domains: ${topDomains.map(item => `${item.key}(${item.count})`).join(", ")}`);
    }
    const topModules = rankCounters(coverage.byModuleSpecifier || {}, 5);
    if (topModules.length > 0) {
        lines.push(`- modules: ${topModules.map(item => `${item.key}(${item.count})`).join(", ")}`);
    }
    return lines;
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
    lines.push(...renderOfficialClosureGuidance(report));
    lines.push("");
    lines.push("### Hit Rules (Top)");
    if (topSourceHits.length === 0 && topSinkHits.length === 0 && topTransferHits.length === 0) {
        lines.push("- No effect hits yet; inspect whether exact assets loaded and accepted occurrences reached the effect layer.");
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
            lines.push(`- [source] ${e.entryName} @ ${e.entryPathHint || "N/A"}: inspect arkMain reachability and exact source capability lowering in ${projectRulePath}.`);
        }
        for (const e of transferGaps) {
            lines.push(`- [transfer] ${e.entryName} @ ${e.entryPathHint || "N/A"}: seeds exist but no flow; inspect exact transfer effects, endpoint projection, and ordinary propagation in ${projectRulePath}.`);
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
    const semanticEffectSummary = report.summary.semanticEffectLedgerSummary;
    const topNoHitSummary = rankCounters(report.summary.transferNoHitReasons || {}, 5)
        .map(item => `${item.key}(${item.count})`)
        .join(", ");
    const endpointStatusSummary = JSON.stringify(pagAudit.endpointResolutionStatusCounts || {});
    const lines: string[] = [];
    lines.push("# ArkTaint Analyze Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- repo: ${report.repo}`);
    lines.push(`- sourceDirs: ${report.sourceDirs.join(", ")}`);
    lines.push(`- profile: ${report.profile}`);
    lines.push(`- reportMode: ${report.reportMode}`);
    lines.push(`- flowMode: ${report.flowMode || "postsolve"}`);
    if (report.flowMode === "candidate") {
        lines.push("- flowModeNote: candidate mode is for no-LLM real-project batch scanning. It reports candidate source-to-sink hits and skips trace graph, path materialization, postsolve judgement, and explanation ledgers. Human review must decide true/false flows.");
    }
    if (report.flowMode === "raw") {
        lines.push("- flowModeNote: raw mode keeps full core analysis semantics but skips trace graph, path materialization, postsolve judgement, and explanation ledgers. Human review must decide true/false flows.");
    }
    lines.push(`- k: ${report.k}`);
    lines.push(`- maxEntries: ${report.maxEntries}`);
    lines.push(`- ruleSources: ${report.ruleSources.join(" -> ")}`);
    lines.push(`- totalEntries: ${report.summary.totalEntries}`);
    lines.push(`- okEntries: ${report.summary.okEntries}`);
    lines.push(`- withSeeds: ${report.summary.withSeeds}`);
    lines.push(`- withFlows: ${report.summary.withFlows}`);
    if (typeof report.summary.withPartialFlows === "number" && report.summary.withPartialFlows > 0) {
        lines.push(`- withPartialFlows: ${report.summary.withPartialFlows}`);
    }
    lines.push(`- totalFlows: ${report.summary.totalFlows}`);
    if (typeof report.summary.partialFlows === "number" && report.summary.partialFlows > 0) {
        lines.push(`- partialFlows: ${report.summary.partialFlows}`);
        lines.push("- partialFlowsNote: budget_exceeded entries are diagnostic evidence only and are not counted in totalFlows.");
    }
    const postsolveJudgementCounts = countPostsolveJudgements(report.entries || []);
    if (Object.keys(postsolveJudgementCounts).length > 0) {
        lines.push(`- postsolveJudgements: ${JSON.stringify(postsolveJudgementCounts)}`);
    }
    lines.push(`- statusCount: ${JSON.stringify(report.summary.statusCount)}`);
    lines.push(`- ruleHitsTotal: source=${sourceRuleHits}, sink=${sinkRuleHits}, transfer=${transferRuleHits}`);
    lines.push(`- transferProfile: checks=${report.summary.transferProfile.ruleCheckCount}, matches=${report.summary.transferProfile.ruleMatchCount}, endpointMatches=${report.summary.transferProfile.endpointMatchCount}, results=${report.summary.transferProfile.resultCount}, dedupSkips=${report.summary.transferProfile.dedupSkipCount}, elapsedMs=${report.summary.transferProfile.elapsedMs}`);
    lines.push(`- detectProfile: calls=${report.summary.detectProfile.detectCallCount}, sinksChecked=${report.summary.detectProfile.sinksChecked}, sanitizerChecks=${report.summary.detectProfile.sanitizerGuardCheckCount}, sanitizerHits=${report.summary.detectProfile.sanitizerGuardHitCount}, totalMs=${report.summary.detectProfile.totalMs}`);
    if (report.summary.memoryProfile) {
        lines.push(`- memoryProfile: peakRssMiB=${report.summary.memoryProfile.peakRssMiB}, peakHeapUsedMiB=${report.summary.memoryProfile.peakHeapUsedMiB}, rssMiB=${report.summary.memoryProfile.rssMiB}, heapUsedMiB=${report.summary.memoryProfile.heapUsedMiB}, samples=${report.summary.memoryProfile.sampleCount}`);
    }
    lines.push(`- pagNodeResolutionAudit: requests=${pagAudit.requestCount || 0}, directHits=${pagAudit.directHitCount || 0}, substitutions=${pagAudit.substitutedValueCount || 0}, addFailures=${pagAudit.addFailureCount || 0}, unresolved=${pagAudit.unresolvedCount || 0}`);
    lines.push(`- endpointResolutionLedger: records=${pagAudit.endpointResolutionRecordCount || 0}, statuses=${endpointStatusSummary}`);
    if (semanticEffectSummary) {
        lines.push(`- semanticEffectLedger: sites=${semanticEffectSummary.siteRecordCount}, gaps=${semanticEffectSummary.gapRecordCount}, statuses=${JSON.stringify(semanticEffectSummary.byStatus || {})}, gapKinds=${JSON.stringify(semanticEffectSummary.byGapKind || {})}`);
    }
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
    if (report.summary.officialIdentityCoverage) {
        const coverage = report.summary.officialIdentityCoverage;
        lines.push(`- officialIdentityCoverage: total=${coverage.totalOccurrenceCount}, accepted=${coverage.acceptedCount}, unresolved=${coverage.unresolvedCount}, ambiguous=${coverage.ambiguousCount}, rejected=${coverage.rejectedCount}, acceptedCanonicalApiIds=${coverage.acceptedCanonicalApiIds}`);
        const topIdentityReasons = rankCounters(coverage.byReasonCode || {}, 5)
            .map(item => `${item.key}(${item.count})`)
            .join(", ");
        if (topIdentityReasons) {
            lines.push(`- officialIdentityReasonsTop: ${topIdentityReasons}`);
        }
    }
    if (report.summary.ruleFeedback) {
        const zeroHit = report.summary.ruleFeedback.zeroHitRules || { source: {}, sink: {}, transfer: {} };
        lines.push(`- ruleFeedback.zeroHitRules: source=${Object.keys(zeroHit.source || {}).length}, sink=${Object.keys(zeroHit.sink || {}).length}, transfer=${Object.keys(zeroHit.transfer || {}).length}`);
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
        lines.push(`  - detectProfile: calls=${e.detectProfile.detectCallCount}, sinksChecked=${e.detectProfile.sinksChecked}, sanitizerChecks=${e.detectProfile.sanitizerGuardCheckCount}, sanitizerHits=${e.detectProfile.sanitizerGuardHitCount}, effectMs=${e.detectProfile.effectMatchMs}, candidateMs=${e.detectProfile.candidateResolveMs}, taintMs=${e.detectProfile.taintEvalMs}, sanitizerMs=${e.detectProfile.sanitizerGuardMs}, traversalMs=${e.detectProfile.traversalMs}, totalMs=${e.detectProfile.totalMs}`);
        if (e.pagNodeResolutionAudit) {
            lines.push(`  - pagNodeResolutionAudit: requests=${e.pagNodeResolutionAudit.requestCount}, directHits=${e.pagNodeResolutionAudit.directHitCount}, substitutions=${e.pagNodeResolutionAudit.substitutedValueCount}, addFailures=${e.pagNodeResolutionAudit.addFailureCount}, unresolved=${e.pagNodeResolutionAudit.unresolvedCount}`);
            lines.push(`  - endpointResolutionLedger: records=${e.pagNodeResolutionAudit.endpointResolutionRecordCount || 0}, statuses=${JSON.stringify(e.pagNodeResolutionAudit.endpointResolutionStatusCounts || {})}`);
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
        for (const result of (e.postsolveResults || []).slice(0, 2)) {
            lines.push(`  - postsolve: sinkFactId=${result.flow.sinkFactId || "N/A"}, judgement=${result.judgement.kind}, primaryReason=${result.evidenceSummary.primaryReason || "N/A"}, countability=${result.countability?.status || "N/A"}, countabilityReason=${result.countability?.reason || "N/A"}, evidenceKinds=${result.evidenceSummary.evidenceKinds.join(",") || "N/A"}, skeletonNodes=${result.skeleton?.nodes.length || 0}, pathCount=${result.paths.length}, materialization=${result.report.witness?.status || "N/A"}`);
            lines.push(`    - flow: source=${result.flow.source} | sink=${result.flow.sinkText}`);
            if (result.skeleton) {
                lines.push(`    - skeleton: nodes=${result.skeleton.nodes.length}, edges=${result.skeleton.edges.length}`);
            }
            for (const pathItem of result.paths.slice(0, 5)) {
                const evidenceKinds = [...new Set((pathItem.evidence || []).map(item => item.kind))];
                lines.push(`    - path: judgement=${pathItem.judgement.kind}, primaryReason=${pathItem.judgement.primaryReason || "N/A"}, countability=${pathItem.countability?.status || "N/A"}, countabilityReason=${pathItem.countability?.reason || "N/A"}, evidenceKinds=${evidenceKinds.join(",") || "N/A"}, status=${pathItem.status || "complete"}, truncated=${pathItem.truncated ? "true" : "false"}`);
                lines.push(`      - factIds: ${pathItem.factIds.join(" -> ") || "N/A"}`);
            }
        }
    }
    return lines.join("\n");
}

