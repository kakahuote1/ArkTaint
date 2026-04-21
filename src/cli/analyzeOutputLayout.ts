import * as fs from "fs";
import * as path from "path";
import { AnalyzeReport } from "./analyzeTypes";

export interface AnalyzeOutputLayout {
    rootDir: string;
    summaryDir: string;
    diagnosticsDir: string;
    findingsDir: string;
    feedbackDir: string;
    ruleFeedbackDir: string;
    auditDir: string;
    debugDir: string;
    runJsonPath: string;
    summaryJsonPath: string;
    summaryMarkdownPath: string;
    diagnosticsJsonPath: string;
    diagnosticsTextPath: string;
    pluginAuditJsonPath: string;
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
    const debugDir = path.resolve(rootDir, "debug");
    return {
        rootDir,
        summaryDir,
        diagnosticsDir,
        findingsDir,
        feedbackDir,
        ruleFeedbackDir,
        auditDir,
        debugDir,
        runJsonPath: path.resolve(rootDir, "run.json"),
        summaryJsonPath: path.resolve(summaryDir, "summary.json"),
        summaryMarkdownPath: path.resolve(summaryDir, "summary.md"),
        diagnosticsJsonPath: path.resolve(diagnosticsDir, "diagnostics.json"),
        diagnosticsTextPath: path.resolve(diagnosticsDir, "diagnostics.txt"),
        pluginAuditJsonPath: path.resolve(auditDir, "plugin_audit.json"),
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
    fs.mkdirSync(layout.debugDir, { recursive: true });
}

export function writeAnalyzeRunManifest(
    layout: AnalyzeOutputLayout,
    report: AnalyzeReport,
    options: {
        pluginAuditEnabled: boolean;
    },
): void {
    const payload = {
        schemaVersion: "1.0",
        runKind: "analyze",
        generatedAt: report.generatedAt,
        repo: report.repo,
        profile: report.profile,
        reportMode: report.reportMode,
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
    },
): void {
    const payload = {
        schemaVersion: "1.0",
        runKind: "analyze",
        generatedAt: options.generatedAt,
        repo: options.repo,
        profile: options.profile,
        reportMode: options.reportMode,
        status: "failed",
        paths: {
            diagnosticsJson: toRelative(layout.rootDir, layout.diagnosticsJsonPath),
            diagnosticsTxt: toRelative(layout.rootDir, layout.diagnosticsTextPath),
        },
    };
    fs.writeFileSync(layout.runJsonPath, JSON.stringify(payload, null, 2), "utf-8");
}
