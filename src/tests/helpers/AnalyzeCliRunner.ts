import * as fs from "fs";
import * as path from "path";
import { runCommandOrThrow } from "./ProcessRunner";

function resolveAnalyzeArtifactPath(outputDir: string, relativePaths: string[]): string {
    for (const rel of relativePaths) {
        const candidate = path.resolve(outputDir, rel);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return path.resolve(outputDir, relativePaths[0]);
}

export function getAnalyzeSummaryJsonPath(outputDir: string): string {
    return resolveAnalyzeArtifactPath(outputDir, [
        path.join("summary", "summary.json"),
        "summary.json",
    ]);
}

export function getAnalyzeDiagnosticsJsonPath(outputDir: string): string {
    return resolveAnalyzeArtifactPath(outputDir, [
        path.join("diagnostics", "diagnostics.json"),
        "diagnostics.json",
    ]);
}

export function getAnalyzeDiagnosticsTextPath(outputDir: string): string {
    return resolveAnalyzeArtifactPath(outputDir, [
        path.join("diagnostics", "diagnostics.txt"),
        "diagnostics.txt",
    ]);
}

export function getAnalyzePluginAuditPath(outputDir: string): string {
    return resolveAnalyzeArtifactPath(outputDir, [
        path.join("audit", "plugin_audit.json"),
        "plugin_audit.json",
    ]);
}

export function getAnalyzeRunJsonPath(outputDir: string): string {
    return resolveAnalyzeArtifactPath(outputDir, ["run.json"]);
}

export function runAnalyzeCli(args: string[]): void {
    const cli = path.resolve("out/cli/analyze.js");
    runCommandOrThrow("analyze", process.execPath, [cli, ...args], { stdio: "pipe" });
}

export function readAnalyzeSummary<T>(outputDir: string): T {
    const summaryPath = getAnalyzeSummaryJsonPath(outputDir);
    if (!fs.existsSync(summaryPath)) {
        throw new Error(`summary json missing: ${summaryPath}`);
    }
    return JSON.parse(fs.readFileSync(summaryPath, "utf-8")) as T;
}

export function getAnalyzeSummaryMarkdownPath(outputDir: string): string {
    const markdownPath = resolveAnalyzeArtifactPath(outputDir, [
        path.join("summary", "summary.md"),
        "summary.md",
    ]);
    if (!fs.existsSync(markdownPath)) {
        throw new Error(`summary md missing: ${markdownPath}`);
    }
    return markdownPath;
}
