import * as fs from "fs";
import * as path from "path";

interface AnalyzeRunManifestReport {
    generatedAt: string;
    repo: string;
    profile: string;
    reportMode: string;
    flowMode?: string;
    summary: {
        statusCount: Record<string, number>;
    };
}

export interface AnalyzeOutputLayout {
    rootDir: string;
    summaryDir: string;
    diagnosticsDir: string;
    findingsDir: string;
    feedbackDir: string;
    ruleFeedbackDir: string;
    auditDir: string;
    traceGraphDir: string;
    debugDir: string;
    runJsonPath: string;
    summaryJsonPath: string;
    summaryMarkdownPath: string;
    diagnosticsJsonPath: string;
    diagnosticsTextPath: string;
    pluginAuditJsonPath: string;
    traceGraphJsonPath: string;
    traceGraphMarkdownPath: string;
    officialOccurrenceLedgerJsonlPath: string;
    officialOccurrenceEvidenceGraphJsonlPath: string;
    officialIdentityCoverageJsonPath: string;
    endpointResolutionLedgerJsonlPath: string;
    semanticEffectSitesJsonlPath: string;
    endpointResolutionSummaryJsonPath: string;
    sourceReachabilityGapsJsonlPath: string;
    callEdgeMaterializationLedgerJsonlPath: string;
    sanitizerSemanticSiteConsumptionJsonlPath: string;
    transferSemanticSiteConsumptionJsonlPath: string;
    moduleSemanticSiteConsumptionJsonlPath: string;
    ordinaryPropagationGapsJsonlPath: string;
    expectedFlowGapReportJsonPath: string;
    expectedFlowGapReportMarkdownPath: string;
    officialCoverageForLlmFilteringJsonPath: string;
}

function toRelative(rootDir: string, targetPath: string): string {
    return path.relative(rootDir, targetPath).replace(/\\/g, "/");
}

export function resolveAnalyzeOutputLayout(outputDir: string): AnalyzeOutputLayout {
    const rootDir = path.resolve(outputDir);
    const summaryDir = path.resolve(rootDir, "summary");
    const diagnosticsDir = path.resolve(rootDir, "diagnostics");
    const findingsDir = path.resolve(rootDir, "findings");
    const feedbackDir = path.resolve(rootDir, "feedback");
    const ruleFeedbackDir = path.resolve(feedbackDir, "rule_feedback");
    const auditDir = path.resolve(rootDir, "audit");
    const traceGraphDir = path.resolve(auditDir, "trace_graph");
    const debugDir = path.resolve(rootDir, "debug");
    return {
        rootDir,
        summaryDir,
        diagnosticsDir,
        findingsDir,
        feedbackDir,
        ruleFeedbackDir,
        auditDir,
        traceGraphDir,
        debugDir,
        runJsonPath: path.resolve(rootDir, "run.json"),
        summaryJsonPath: path.resolve(summaryDir, "summary.json"),
        summaryMarkdownPath: path.resolve(summaryDir, "summary.md"),
        diagnosticsJsonPath: path.resolve(diagnosticsDir, "diagnostics.json"),
        diagnosticsTextPath: path.resolve(diagnosticsDir, "diagnostics.txt"),
        pluginAuditJsonPath: path.resolve(auditDir, "plugin_audit.json"),
        traceGraphJsonPath: path.resolve(traceGraphDir, "full_trace_graph.json"),
        traceGraphMarkdownPath: path.resolve(traceGraphDir, "full_trace_graph.md"),
        officialOccurrenceLedgerJsonlPath: path.resolve(auditDir, "official_occurrence_ledger.jsonl"),
        officialOccurrenceEvidenceGraphJsonlPath: path.resolve(auditDir, "official_occurrence_evidence_graph.jsonl"),
        officialIdentityCoverageJsonPath: path.resolve(auditDir, "official_identity_coverage.json"),
        endpointResolutionLedgerJsonlPath: path.resolve(auditDir, "endpoint_resolution_ledger.jsonl"),
        semanticEffectSitesJsonlPath: path.resolve(auditDir, "semantic_effect_sites.jsonl"),
        endpointResolutionSummaryJsonPath: path.resolve(auditDir, "endpoint_resolution_summary.json"),
        sourceReachabilityGapsJsonlPath: path.resolve(auditDir, "source_reachability_gaps.jsonl"),
        callEdgeMaterializationLedgerJsonlPath: path.resolve(auditDir, "call_edge_materialization_ledger.jsonl"),
        sanitizerSemanticSiteConsumptionJsonlPath: path.resolve(auditDir, "sanitizer_semantic_site_consumption.jsonl"),
        transferSemanticSiteConsumptionJsonlPath: path.resolve(auditDir, "transfer_semantic_site_consumption.jsonl"),
        moduleSemanticSiteConsumptionJsonlPath: path.resolve(auditDir, "module_semantic_site_consumption.jsonl"),
        ordinaryPropagationGapsJsonlPath: path.resolve(auditDir, "ordinary_propagation_gaps.jsonl"),
        expectedFlowGapReportJsonPath: path.resolve(auditDir, "expected_flow_gap_report.json"),
        expectedFlowGapReportMarkdownPath: path.resolve(auditDir, "expected_flow_gap_report.md"),
        officialCoverageForLlmFilteringJsonPath: path.resolve(auditDir, "official_coverage_for_llm_filtering.json"),
    };
}

export function ensureAnalyzeOutputLayout(layout: AnalyzeOutputLayout): void {
    fs.mkdirSync(layout.rootDir, { recursive: true });
    fs.mkdirSync(layout.summaryDir, { recursive: true });
    fs.mkdirSync(layout.diagnosticsDir, { recursive: true });
    fs.mkdirSync(layout.findingsDir, { recursive: true });
    fs.mkdirSync(layout.feedbackDir, { recursive: true });
    fs.mkdirSync(layout.ruleFeedbackDir, { recursive: true });
    fs.mkdirSync(layout.auditDir, { recursive: true });
    fs.mkdirSync(layout.traceGraphDir, { recursive: true });
    fs.mkdirSync(layout.debugDir, { recursive: true });
}

export function writeAnalyzeRunManifest(
    layout: AnalyzeOutputLayout,
    report: AnalyzeRunManifestReport,
    options: {
        pluginAuditEnabled: boolean;
        traceGraphEnabled?: boolean;
        analysisAuditEnabled?: boolean;
    },
): void {
    const analysisAuditEnabled = options.analysisAuditEnabled !== false;
    const payload = {
        format: "analyze-run",
        runKind: "analyze",
        generatedAt: report.generatedAt,
        repo: report.repo,
        profile: report.profile,
        reportMode: report.reportMode,
        flowMode: report.flowMode || "postsolve",
        status: report.summary.statusCount.exception ? "completed_with_errors" : "ok",
        paths: {
            summaryJson: toRelative(layout.rootDir, layout.summaryJsonPath),
            summaryMd: toRelative(layout.rootDir, layout.summaryMarkdownPath),
            diagnosticsJson: toRelative(layout.rootDir, layout.diagnosticsJsonPath),
            diagnosticsTxt: toRelative(layout.rootDir, layout.diagnosticsTextPath),
            ruleFeedbackDir: toRelative(layout.rootDir, layout.ruleFeedbackDir),
            pluginAuditJson: options.pluginAuditEnabled
                ? toRelative(layout.rootDir, layout.pluginAuditJsonPath)
                : undefined,
            traceGraphJson: options.traceGraphEnabled
                ? toRelative(layout.rootDir, layout.traceGraphJsonPath)
                : undefined,
            traceGraphMd: options.traceGraphEnabled
                ? toRelative(layout.rootDir, layout.traceGraphMarkdownPath)
                : undefined,
            officialOccurrenceLedgerJsonl: analysisAuditEnabled ? toRelative(layout.rootDir, layout.officialOccurrenceLedgerJsonlPath) : undefined,
            officialOccurrenceEvidenceGraphJsonl: analysisAuditEnabled ? toRelative(layout.rootDir, layout.officialOccurrenceEvidenceGraphJsonlPath) : undefined,
            officialIdentityCoverageJson: analysisAuditEnabled ? toRelative(layout.rootDir, layout.officialIdentityCoverageJsonPath) : undefined,
            endpointResolutionLedgerJsonl: analysisAuditEnabled ? toRelative(layout.rootDir, layout.endpointResolutionLedgerJsonlPath) : undefined,
            semanticEffectSitesJsonl: analysisAuditEnabled ? toRelative(layout.rootDir, layout.semanticEffectSitesJsonlPath) : undefined,
            endpointResolutionSummaryJson: analysisAuditEnabled ? toRelative(layout.rootDir, layout.endpointResolutionSummaryJsonPath) : undefined,
            sourceReachabilityGapsJsonl: analysisAuditEnabled ? toRelative(layout.rootDir, layout.sourceReachabilityGapsJsonlPath) : undefined,
            callEdgeMaterializationLedgerJsonl: analysisAuditEnabled ? toRelative(layout.rootDir, layout.callEdgeMaterializationLedgerJsonlPath) : undefined,
            sanitizerSemanticSiteConsumptionJsonl: analysisAuditEnabled ? toRelative(layout.rootDir, layout.sanitizerSemanticSiteConsumptionJsonlPath) : undefined,
            transferSemanticSiteConsumptionJsonl: analysisAuditEnabled ? toRelative(layout.rootDir, layout.transferSemanticSiteConsumptionJsonlPath) : undefined,
            moduleSemanticSiteConsumptionJsonl: analysisAuditEnabled ? toRelative(layout.rootDir, layout.moduleSemanticSiteConsumptionJsonlPath) : undefined,
            ordinaryPropagationGapsJsonl: analysisAuditEnabled ? toRelative(layout.rootDir, layout.ordinaryPropagationGapsJsonlPath) : undefined,
            expectedFlowGapReportJson: analysisAuditEnabled ? toRelative(layout.rootDir, layout.expectedFlowGapReportJsonPath) : undefined,
            expectedFlowGapReportMd: analysisAuditEnabled ? toRelative(layout.rootDir, layout.expectedFlowGapReportMarkdownPath) : undefined,
            officialCoverageForLlmFilteringJson: analysisAuditEnabled ? toRelative(layout.rootDir, layout.officialCoverageForLlmFilteringJsonPath) : undefined,
        },
    };
    fs.writeFileSync(layout.runJsonPath, JSON.stringify(payload, null, 2), "utf-8");
}

export function writeAnalyzeFailureRunManifest(
    layout: AnalyzeOutputLayout,
    options: {
        generatedAt: string;
        repo?: string;
        profile?: string;
        reportMode?: string;
        flowMode?: string;
    },
): void {
    const payload = {
        format: "analyze-run",
        runKind: "analyze",
        generatedAt: options.generatedAt,
        repo: options.repo,
        profile: options.profile,
        reportMode: options.reportMode,
        flowMode: options.flowMode || "postsolve",
        status: "failed",
        paths: {
            diagnosticsJson: toRelative(layout.rootDir, layout.diagnosticsJsonPath),
            diagnosticsTxt: toRelative(layout.rootDir, layout.diagnosticsTextPath),
        },
    };
    fs.writeFileSync(layout.runJsonPath, JSON.stringify(payload, null, 2), "utf-8");
}
