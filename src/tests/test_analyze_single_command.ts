import * as fs from "fs";
import * as path from "path";
import {
    getAnalyzeSummaryMarkdownPath,
    readAnalyzeSummary,
    runAnalyzeCli,
} from "./helpers/AnalyzeCliRunner";

interface AnalyzeReport {
    repo: string;
    sourceDirs: string[];
    ruleLayers: string[];
    summary: {
        totalEntries: number;
        stageProfile: {
            totalMs: number;
        };
    };
}

function runAnalyze(outputDir: string): AnalyzeReport {
    const args = [
        "--repo", "tests/demo/rule_transfer_variants",
        "--maxEntries", "6",
        "--outputDir", outputDir,
    ];
    runAnalyzeCli(args);
    getAnalyzeSummaryMarkdownPath(outputDir);
    return readAnalyzeSummary<AnalyzeReport>(outputDir);
}

async function main(): Promise<void> {
    const root = path.resolve("tmp/phase57/analyze_single_command");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const report = runAnalyze(root);

    console.log("====== Analyze Single Command Test ======");
    console.log(`repo=${report.repo}`);
    console.log(`source_dirs=${(report.sourceDirs || []).join(",")}`);
    console.log(`rule_layers=${(report.ruleLayers || []).join(" -> ")}`);
    console.log(`total_entries=${report.summary?.totalEntries || 0}`);
    console.log(`total_ms=${report.summary?.stageProfile?.totalMs || 0}`);

    if (!Array.isArray(report.sourceDirs) || report.sourceDirs.length === 0) {
        throw new Error("expected sourceDirs auto discovery to produce at least one sourceDir");
    }
    if (!Array.isArray(report.ruleLayers) || !report.ruleLayers.includes("default")) {
        throw new Error(`expected default rule layer, got: ${JSON.stringify(report.ruleLayers)}`);
    }
    if ((report.summary?.totalEntries || 0) <= 0) {
        throw new Error(`expected totalEntries > 0, got ${report.summary?.totalEntries || 0}`);
    }
    if ((report.summary?.stageProfile?.totalMs || 0) <= 0) {
        throw new Error(`expected stageProfile.totalMs > 0, got ${report.summary?.stageProfile?.totalMs || 0}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
