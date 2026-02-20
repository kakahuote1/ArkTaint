import * as fs from "fs";
import * as path from "path";
import { runCommandOrThrow } from "./ProcessRunner";

export function runAnalyzeCli(args: string[]): void {
    const cli = path.resolve("out/cli/analyze.js");
    runCommandOrThrow("analyze", process.execPath, [cli, ...args], { stdio: "pipe" });
}

export function readAnalyzeSummary<T>(outputDir: string): T {
    const summaryPath = path.resolve(outputDir, "summary.json");
    if (!fs.existsSync(summaryPath)) {
        throw new Error(`summary json missing: ${summaryPath}`);
    }
    return JSON.parse(fs.readFileSync(summaryPath, "utf-8")) as T;
}

export function getAnalyzeSummaryMarkdownPath(outputDir: string): string {
    const markdownPath = path.resolve(outputDir, "summary.md");
    if (!fs.existsSync(markdownPath)) {
        throw new Error(`summary md missing: ${markdownPath}`);
    }
    return markdownPath;
}
