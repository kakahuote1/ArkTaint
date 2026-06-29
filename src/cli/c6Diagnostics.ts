import * as fs from "fs";
import * as path from "path";
import type { AnalyzeOutputLayout } from "./analyzeOutputLayout";
import {
    summarizeSemanticEffectLedger,
    type SemanticEffectLedgerRecord,
} from "../core/api/effects";
import { buildOrdinaryPropagationGapRowsFromEntries } from "../core/trace/OrdinaryPropagationGapLedger";

interface C6AnalyzeReport {
    generatedAt: string;
    repo: string;
    summary: {
        officialIdentityCoverage: unknown;
    };
}

type C6EntryAnalyzeResult = any;

export const EXPECTED_FLOW_GAP_LAYERS = [
    "identity",
    "asset",
    "effect_site",
    "endpoint",
    "source_reachability",
    "sanitizer_guard",
    "transfer_scheduler",
    "module_scheduler",
    "ordinary_propagation",
    "sink_not_tainted",
    "materialization",
    "ledger_correction",
] as const;

export type ExpectedFlowGapLayer = typeof EXPECTED_FLOW_GAP_LAYERS[number];

export const C2_C3_PENDING_CONSUMER_FIELDS = [
    "effectSiteId",
    "capability",
    "effectAssetId",
    "consumer",
    "consumerStatus",
    "endpointBindingRef",
    "valueKind",
    "materializedExact",
];

function toRelative(rootDir: string, targetPath: string): string {
    return path.relative(rootDir, targetPath).replace(/\\/g, "/");
}

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function writeJsonl(filePath: string, rows: readonly unknown[]): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
        filePath,
        rows.length > 0 ? `${rows.map(row => JSON.stringify(row)).join("\n")}\n` : "",
        "utf-8",
    );
}

function allOfficialOccurrenceRows(entries: readonly C6EntryAnalyzeResult[]): any[] {
    const rows: any[] = [];
    for (const entry of entries) {
        for (const record of entry.officialOccurrenceLedger || []) {
            rows.push({
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                ...record,
            });
        }
    }
    return rows;
}

function allEndpointRows(entries: readonly C6EntryAnalyzeResult[]): any[] {
    const rows: any[] = [];
    for (const entry of entries) {
        for (const record of entry.pagNodeResolutionAudit.endpointResolutionRecords || []) {
            rows.push({
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                ...record,
            });
        }
    }
    return rows;
}

function allSemanticEffectRows(entries: readonly C6EntryAnalyzeResult[]): any[] {
    const rows: any[] = [];
    for (const entry of entries) {
        for (const record of entry.semanticEffectLedger || []) {
            rows.push({
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                ...record,
            });
        }
    }
    return rows;
}

function allCallEdgeMaterializationRows(entries: readonly C6EntryAnalyzeResult[]): any[] {
    const rows: any[] = [];
    for (const entry of entries) {
        for (const record of entry.callEdgeMaterializationLedger || []) {
            rows.push({
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                ...record,
            });
        }
    }
    return rows;
}

export function buildEndpointResolutionSummary(
    endpointRows: readonly any[],
    semanticEffectRows: readonly any[] = [],
): unknown {
    const byStatus: Record<string, number> = {};
    const byCapability: Record<string, Record<string, number>> = {};
    const byDiagnosticKind: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    const byEndpointKindGroup: Record<string, number> = {};
    const byStatusEndpointKindGroup: Record<string, Record<string, number>> = {};
    const byFailureCategory: Record<string, number> = {};
    const byAssetEndpointErrorCategory: Record<string, number> = {};
    const capabilityByEffectSiteId = semanticEffectCapabilityByEffectSiteId(semanticEffectRows);
    const endpointSemanticSiteCount = semanticEffectRows.filter(row => row?.recordKind === "semantic_effect_site").length;
    let unattributedEndpointRecordCount = 0;
    for (const row of endpointRows) {
        const status = String(row.status || "unknown");
        const reason = String(row.reason || "unknown_reason");
        const endpointKindGroup = String(row.endpointKindGroup || row.diagnosticDetails?.endpointKindGroup || "unclassified");
        const failureCategory = String(row.failureCategory || row.diagnosticDetails?.failureCategory || "none");
        const effectSiteId = String(row.effectSiteId || "");
        const capability = String(
            row.capability
            || (effectSiteId ? capabilityByEffectSiteId.get(effectSiteId) : "")
            || "",
        );
        const capabilityKey = capability || "unattributed_endpoint_record";
        if (!capability) unattributedEndpointRecordCount++;
        byStatus[status] = (byStatus[status] || 0) + 1;
        byReason[reason] = (byReason[reason] || 0) + 1;
        byEndpointKindGroup[endpointKindGroup] = (byEndpointKindGroup[endpointKindGroup] || 0) + 1;
        incrementNested(byStatusEndpointKindGroup, status, endpointKindGroup);
        byFailureCategory[failureCategory] = (byFailureCategory[failureCategory] || 0) + 1;
        if (status === "asset_endpoint_error") {
            byAssetEndpointErrorCategory[failureCategory] = (byAssetEndpointErrorCategory[failureCategory] || 0) + 1;
        }
        byCapability[capabilityKey] = byCapability[capabilityKey] || {};
        byCapability[capabilityKey][status] = (byCapability[capabilityKey][status] || 0) + 1;
        if (row.diagnosticKind) {
            const diagnosticKind = String(row.diagnosticKind);
            byDiagnosticKind[diagnosticKind] = (byDiagnosticKind[diagnosticKind] || 0) + 1;
        }
    }
    return {
        format: "arktaint-endpoint-resolution-summary",
        status: endpointRows.length > 0 ? "partial" : "empty",
        endpointRecordCount: endpointRows.length,
        endpointSemanticSiteCount,
        endpointRecordCountMatchesSemanticSites: endpointSemanticSiteCount === 0
            ? endpointRows.length === 0
            : endpointRows.length === endpointSemanticSiteCount,
        unattributedEndpointRecordCount,
        byStatus,
        byCapability,
        byDiagnosticKind,
        byReason,
        byEndpointKindGroup,
        byStatusEndpointKindGroup,
        byFailureCategory,
        byAssetEndpointErrorCategory,
        semanticEffectLedgerSummary: summarizeSemanticEffectLedger(semanticEffectRows as SemanticEffectLedgerRecord[]),
        summaryOnlyFields: [
            "anchor",
            "contextId",
        ],
        note: "Endpoint rows are joined to semantic effect site and asset/effect gap rows in semantic_effect_sites.jsonl.",
    };
}

function incrementNested(target: Record<string, Record<string, number>>, key: string, subKey: string): void {
    target[key] = target[key] || {};
    target[key][subKey] = (target[key][subKey] || 0) + 1;
}

function semanticEffectCapabilityByEffectSiteId(rows: readonly any[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const row of rows) {
        if (row?.recordKind !== "semantic_effect_site") continue;
        const effectSiteId = String(row.effectSiteId || "");
        const capability = String(row.capability || "");
        if (!effectSiteId || !capability) continue;
        out.set(effectSiteId, capability);
    }
    return out;
}

function buildSourceReachabilityGapRows(
    entries: readonly C6EntryAnalyzeResult[],
    callEdgeRows: readonly any[] = [],
): unknown[] {
    const rows: unknown[] = [];
    const callEdgesByCallee = groupCallEdgeRowsBySignature(callEdgeRows, "calleeSignature");
    for (const entry of entries) {
        const sourceRuleHits = entry.sourceRuleHits || {};
        for (const audit of entry.sourceRuleZeroHitAudit || []) {
            if ((Number(sourceRuleHits[audit.ruleId]) || 0) > 0) continue;
            if (audit.reason !== "source_rule_callsite_outside_allowed_methods") continue;
            const samples = (audit.sampleCallsites || []).filter((sample: any) => sample && sample.allowed === false);
            if (samples.length === 0) {
                rows.push({
                    recordKind: "source_reachability_gap",
                    gapKind: "accepted_source_site_excluded_by_reachability",
                    sourceDir: entry.sourceDir,
                    entryName: entry.entryName,
                    ruleId: audit.ruleId,
                    sourceKind: audit.sourceKind,
                    reason: "no_excluded_callsite_sample_available",
                    allowedMethodFilterActive: audit.allowedMethodFilterActive,
                    matchedCallsiteCount: audit.matchedCallsiteCount,
                    matchedAllowedCallsiteCount: audit.matchedAllowedCallsiteCount,
                    matchedExcludedCallsiteCount: audit.matchedExcludedCallsiteCount,
                    reachableGapChain: {
                        status: "blocked",
                        reason: "outside_allowed_methods_without_sample_callsite",
                        evidence: ["source_rule_zero_hit_audit"],
                    },
                });
                continue;
            }
            for (const sample of samples) {
                const materializationRows = callEdgesByCallee.get(String(sample.methodSignature || "")) || [];
                rows.push({
                    recordKind: "source_reachability_gap",
                    gapKind: "accepted_source_site_excluded_by_reachability",
                    sourceDir: entry.sourceDir,
                    entryName: entry.entryName,
                    ruleId: audit.ruleId,
                    sourceKind: audit.sourceKind,
                    reason: audit.reason,
                    allowedMethodFilterActive: audit.allowedMethodFilterActive,
                    matchedCallsiteCount: audit.matchedCallsiteCount,
                    matchedAllowedCallsiteCount: audit.matchedAllowedCallsiteCount,
                    matchedExcludedCallsiteCount: audit.matchedExcludedCallsiteCount,
                    effectSiteId: sample.effectSiteId,
                    occurrenceId: sample.occurrenceId,
                    rawOccurrenceId: sample.rawOccurrenceId,
                    canonicalApiId: sample.canonicalApiId,
                    effectAssetId: sample.effectAssetId,
                    methodSignature: sample.methodSignature,
                    calleeSignature: sample.calleeSignature,
                    stmtText: sample.stmtText,
                    line: sample.line,
                    reachableGapChain: buildReachabilityGapChain(sample, materializationRows),
                });
            }
        }
    }
    return rows;
}

function groupCallEdgeRowsBySignature(rows: readonly any[], field: "callerSignature" | "calleeSignature"): Map<string, any[]> {
    const out = new Map<string, any[]>();
    for (const row of rows) {
        const signature = String(row?.[field] || "");
        if (!signature) continue;
        if (!out.has(signature)) out.set(signature, []);
        out.get(signature)!.push(row);
    }
    return out;
}

function buildReachabilityGapChain(sample: any, materializationRows: readonly any[]): unknown {
    const evidence = materializationRows.slice(0, 12).map(row => ({
        builder: row.builder,
        edgeKind: row.edgeKind,
        status: row.status,
        reason: row.reason,
        callerSignature: row.callerSignature,
        calleeSignature: row.calleeSignature,
        line: row.line,
        builtEdgeCount: row.builtEdgeCount,
        calleeResolveReason: row.calleeResolveReason,
    }));
    const built = materializationRows.some(row => row.status === "built" && Number(row.builtEdgeCount || 0) > 0);
    const missing = materializationRows.some(row => row.status !== "built");
    const reason = built
        ? "call_edge_built_but_source_method_still_outside_allowed_chain"
        : missing
            ? "call_edge_materialization_missing_or_blocked_before_source_method"
            : "no_materialized_call_edge_to_source_method";
    return {
        ...(sample.reachableGapChain || {}),
        status: "blocked",
        reason,
        targetMethodSignature: sample.methodSignature,
        targetAllowed: false,
        sourceRuleCallsite: {
            calleeSignature: sample.calleeSignature,
            stmtText: sample.stmtText,
            line: sample.line,
        },
        materializationEvidenceCount: materializationRows.length,
        materializationEvidence: evidence,
    };
}

function buildSanitizerConsumptionRows(entries: readonly C6EntryAnalyzeResult[]): unknown[] {
    const rows: unknown[] = [];
    for (const entry of entries) {
        for (const audit of entry.sinkDetectionAudit.entries || []) {
            if (audit.kind !== "sanitized") continue;
            rows.push({
                recordKind: "sanitizer_semantic_site_consumption",
                status: "partial",
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                ...audit,
                projected: audit.candidateNodeIds && audit.candidateNodeIds.length > 0,
                guardApplied: true,
                pendingFields: ["effectSiteId", "endpointResolutionStatus", "guardMatched"],
            });
        }
    }
    return rows;
}

function semanticSiteRowsForCapability(entry: C6EntryAnalyzeResult, capability: string): any[] {
    return (entry.semanticEffectLedger || []).filter((row: any) =>
        row?.recordKind === "semantic_effect_site" && row.capability === capability
    );
}

function endpointStatusCounts(rows: readonly any[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const row of rows) {
        const status = String(row.endpointResolution?.status || row.status || "unknown");
        counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
}

function resolvedEndpointSiteCount(rows: readonly any[]): number {
    return rows.filter(row => row.endpointResolution?.status === "resolved" || row.status === "resolved").length;
}

function sampleSemanticSites(rows: readonly any[]): unknown[] {
    return rows.slice(0, 8).map(row => ({
        effectSiteId: row.effectSiteId,
        occurrenceId: row.occurrenceId,
        canonicalApiId: row.canonicalApiId,
        capability: row.capability,
        effectAssetId: row.effectAssetId,
        endpointStatus: row.endpointResolution?.status || row.status,
        endpointPath: row.endpointResolution?.endpointPath,
        sourceFile: row.endpointResolution?.anchor?.methodSignature ? undefined : row.anchor?.sourceFile,
        methodSignature: row.endpointResolution?.anchor?.methodSignature || row.anchor?.enclosingMethodSignature,
        stmtText: row.endpointResolution?.anchor?.stmtText || row.anchor?.statementText,
    }));
}

function buildTransferConsumptionRows(entries: readonly C6EntryAnalyzeResult[]): unknown[] {
    const rows: unknown[] = [];
    for (const entry of entries) {
        const profile = entry.transferProfile;
        for (const consumption of profile.siteConsumptions || []) {
            rows.push({
                recordKind: "transfer_semantic_site_consumption",
                status: consumption.toProjected
                    ? "projected"
                    : consumption.scheduled
                        ? "blocked"
                        : "not_scheduled",
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                ...consumption,
                transferProfile: {
                    factCount: profile.factCount,
                    invokeSiteCount: profile.invokeSiteCount,
                    ruleCheckCount: profile.ruleCheckCount,
                    ruleMatchCount: profile.ruleMatchCount,
                    endpointCheckCount: profile.endpointCheckCount,
                    endpointMatchCount: profile.endpointMatchCount,
                    resultCount: profile.resultCount,
                },
                noHitReasons: entry.transferNoHitReasons,
            });
        }
    }
    return rows;
}

function moduleBlockedReason(
    stats: any,
    moduleSites: readonly any[],
    resolvedModuleSiteTotal: number,
): string | undefined {
    if (moduleSites.length === 0) return "no_accepted_module_semantic_sites";
    if (resolvedModuleSiteTotal === 0) return "module_semantic_sites_endpoint_unconsumable";
    if ((stats.invokeHookCalls || 0) <= 0) return "accepted_module_sites_not_scheduled_or_no_fact_endpoint_match";
    if ((stats.totalEmissionCount || 0) <= 0) return "module_hook_no_emission";
    return undefined;
}

function buildModuleConsumptionRows(entries: readonly C6EntryAnalyzeResult[]): unknown[] {
    const rows: unknown[] = [];
    for (const entry of entries) {
        const moduleSites = semanticSiteRowsForCapability(entry, "module");
        const resolvedModuleSiteTotal = resolvedEndpointSiteCount(moduleSites);
        for (const [moduleId, rawStats] of Object.entries(entry.moduleAudit.moduleStats || {})) {
            const stats: any = rawStats;
            const blockedReason = moduleBlockedReason(stats, moduleSites, resolvedModuleSiteTotal);
            rows.push({
                recordKind: "module_semantic_site_consumption",
                status: stats.totalEmissionCount > 0
                    ? "emitted"
                    : ((stats.invokeHookCalls || 0) > 0 ? "matched_no_emission" : "blocked"),
                sourceDir: entry.sourceDir,
                entryName: entry.entryName,
                moduleId,
                sourcePath: stats.sourcePath,
                acceptedModuleSiteCount: moduleSites.length,
                resolvedModuleSiteCount: resolvedModuleSiteTotal,
                endpointStatusCounts: endpointStatusCounts(moduleSites),
                acceptedModuleSiteSamples: sampleSemanticSites(moduleSites),
                factHookCalls: stats.factHookCalls,
                invokeHookCalls: stats.invokeHookCalls,
                factEmissionCount: stats.factEmissionCount,
                invokeEmissionCount: stats.invokeEmissionCount,
                totalEmissionCount: stats.totalEmissionCount,
                blockedReason,
                emissionSamples: stats.emissionSamples,
            });
        }
    }
    return rows;
}

function buildOfficialCoverageForLlmFiltering(input: {
    layout: AnalyzeOutputLayout;
    report: C6AnalyzeReport;
    occurrenceRows: readonly any[];
    endpointSummary: unknown;
}): unknown {
    const acceptedCanonicalApiIds = [...new Set(input.occurrenceRows
        .filter(record => record.status === "accepted" && record.canonicalApiId)
        .map(record => String(record.canonicalApiId)))]
        .sort((a, b) => a.localeCompare(b));
    return {
        format: "arktaint-official-coverage-for-llm-filtering",
        generatedAt: input.report.generatedAt,
        project: input.report.repo,
        source: "dynamic_registry_coverage_ledger",
        inputs: {
            officialOccurrenceLedgerJsonl: toRelative(input.layout.auditDir, input.layout.officialOccurrenceLedgerJsonlPath),
            officialIdentityCoverageJson: toRelative(input.layout.auditDir, input.layout.officialIdentityCoverageJsonPath),
            endpointResolutionLedgerJsonl: toRelative(input.layout.auditDir, input.layout.endpointResolutionLedgerJsonlPath),
            endpointResolutionSummaryJson: toRelative(input.layout.auditDir, input.layout.endpointResolutionSummaryJsonPath),
        },
        officialIdentityCoverage: input.report.summary.officialIdentityCoverage,
        acceptedCanonicalApiIds,
        endpointResolutionSummary: input.endpointSummary,
        filterPolicy: {
            officialCandidatesSource: "registry_coverage_ledger",
            hardcodedOfficialApiNames: false,
            blockedWhenCoverageMissing: true,
        },
        pendingFields: ["semanticEffectConsumerStatus", "endpointConsumerStatus"],
    };
}

function writeExpectedFlowGapReportPlaceholder(layout: AnalyzeOutputLayout, report: C6AnalyzeReport): void {
    const payload = {
        format: "arktaint-expected-flow-gap-report",
        generatedAt: report.generatedAt,
        project: report.repo,
        status: "not_requested",
        summary: {
            total: 0,
            hit: 0,
            miss: 0,
            byGapLayer: {},
        },
        records: [],
        note: "Run expected_flow_gap_report with a manual ledger to populate this report from durable analyze artifacts.",
    };
    writeJson(layout.expectedFlowGapReportJsonPath, payload);
    fs.writeFileSync(
        layout.expectedFlowGapReportMarkdownPath,
        [
            "# Expected Flow Gap Report",
            "",
            `Project: ${report.repo}`,
            "",
            "Status: not_requested",
            "",
        ].join("\n"),
        "utf-8",
    );
}

export function writeC6DiagnosticArtifacts(
    layout: AnalyzeOutputLayout,
    entries: readonly C6EntryAnalyzeResult[],
    report: C6AnalyzeReport,
): void {
    const occurrenceRows = allOfficialOccurrenceRows(entries);
    const endpointRows = allEndpointRows(entries);
    const semanticEffectRows = allSemanticEffectRows(entries);
    const callEdgeRows = allCallEdgeMaterializationRows(entries);
    const endpointSummary = buildEndpointResolutionSummary(endpointRows, semanticEffectRows);
    writeJsonl(layout.semanticEffectSitesJsonlPath, semanticEffectRows);
    writeJson(layout.endpointResolutionSummaryJsonPath, endpointSummary);
    writeJsonl(layout.sourceReachabilityGapsJsonlPath, buildSourceReachabilityGapRows(entries, callEdgeRows));
    writeJsonl(layout.callEdgeMaterializationLedgerJsonlPath, callEdgeRows);
    writeJsonl(layout.sanitizerSemanticSiteConsumptionJsonlPath, buildSanitizerConsumptionRows(entries));
    writeJsonl(layout.transferSemanticSiteConsumptionJsonlPath, buildTransferConsumptionRows(entries));
    writeJsonl(layout.moduleSemanticSiteConsumptionJsonlPath, buildModuleConsumptionRows(entries));
    writeJsonl(layout.ordinaryPropagationGapsJsonlPath, buildOrdinaryPropagationGapRowsFromEntries(entries));
    writeExpectedFlowGapReportPlaceholder(layout, report);
    writeJson(
        layout.officialCoverageForLlmFilteringJsonPath,
        buildOfficialCoverageForLlmFiltering({
            layout,
            report,
            occurrenceRows,
            endpointSummary,
        }),
    );
}
