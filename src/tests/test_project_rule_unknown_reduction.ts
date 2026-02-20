import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

interface CliOptions {
    repo: string;
    sourceDirs: string[];
    profile: string;
    k: number;
    maxEntries: number;
    defaultRulePath: string;
    projectRulePath: string;
    outputDir: string;
    threshold: number;
}

interface AnalyzeSummaryEntry {
    status: string;
    flowCount: number;
}

interface AnalyzeSummaryReport {
    summary: {
        totalEntries: number;
        withFlows: number;
    };
    entries: AnalyzeSummaryEntry[];
}

interface UnknownDeltaReport {
    generatedAt: string;
    options: {
        repo: string;
        sourceDirs: string[];
        profile: string;
        k: number;
        maxEntries: number;
        threshold: number;
        defaultRulePath: string;
        projectRulePath: string;
    };
    baseline: {
        summaryPath: string;
        totalEntries: number;
        withFlows: number;
        unknownCount: number;
        unknownRate: number;
    };
    withProjectRules: {
        summaryPath: string;
        totalEntries: number;
        withFlows: number;
        unknownCount: number;
        unknownRate: number;
    };
    delta: {
        unknownCountDelta: number;
        unknownRateDelta: number;
        unknownRelativeReduction: number;
        withFlowsDelta: number;
    };
    pass: boolean;
    artifacts: {
        jsonPath: string;
        markdownPath: string;
        baselineDir: string;
        withProjectDir: string;
    };
}

function parseArgs(argv: string[]): CliOptions {
    let repo = "tmp/phase43/repos/wanharmony";
    const sourceDirs: string[] = ["entry/src/main/ets"];
    let profile = "default";
    let k = 1;
    let maxEntries = 12;
    let defaultRulePath = "rules/default.rules.json";
    let projectRulePath = "tests/rules/real_project/wanharmony.project.rules.json";
    let outputDir = "tmp/phase53/unknown_reduction_wanharmony";
    let threshold = 0.2;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--repo" && i + 1 < argv.length) {
            repo = argv[++i];
            continue;
        }
        if (arg.startsWith("--repo=")) {
            repo = arg.slice("--repo=".length);
            continue;
        }
        if (arg === "--sourceDir" && i + 1 < argv.length) {
            sourceDirs.push(argv[++i]);
            continue;
        }
        if (arg.startsWith("--sourceDir=")) {
            sourceDirs.push(arg.slice("--sourceDir=".length));
            continue;
        }
        if (arg === "--profile" && i + 1 < argv.length) {
            profile = argv[++i];
            continue;
        }
        if (arg.startsWith("--profile=")) {
            profile = arg.slice("--profile=".length);
            continue;
        }
        if (arg === "--k" && i + 1 < argv.length) {
            k = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--k=")) {
            k = Number(arg.slice("--k=".length));
            continue;
        }
        if (arg === "--maxEntries" && i + 1 < argv.length) {
            maxEntries = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--maxEntries=")) {
            maxEntries = Number(arg.slice("--maxEntries=".length));
            continue;
        }
        if (arg === "--default" && i + 1 < argv.length) {
            defaultRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--default=")) {
            defaultRulePath = arg.slice("--default=".length);
            continue;
        }
        if (arg === "--project" && i + 1 < argv.length) {
            projectRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--project=")) {
            projectRulePath = arg.slice("--project=".length);
            continue;
        }
        if (arg === "--outputDir" && i + 1 < argv.length) {
            outputDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--outputDir=")) {
            outputDir = arg.slice("--outputDir=".length);
            continue;
        }
        if (arg === "--threshold" && i + 1 < argv.length) {
            threshold = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--threshold=")) {
            threshold = Number(arg.slice("--threshold=".length));
            continue;
        }
    }

    const uniqueSourceDirs = [...new Set(sourceDirs.filter(Boolean))];
    if (uniqueSourceDirs.length === 0) {
        throw new Error("At least one --sourceDir is required.");
    }
    if (!Number.isFinite(k) || (k !== 0 && k !== 1)) {
        throw new Error(`Invalid --k value: ${k}. Expected 0 or 1.`);
    }
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
        throw new Error(`Invalid --maxEntries value: ${maxEntries}. Expected positive integer.`);
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error(`Invalid --threshold value: ${threshold}. Expected [0, 1].`);
    }

    return {
        repo,
        sourceDirs: uniqueSourceDirs,
        profile,
        k,
        maxEntries: Math.floor(maxEntries),
        defaultRulePath,
        projectRulePath,
        outputDir,
        threshold,
    };
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function runAnalyze(options: CliOptions, runDir: string, withProjectRules: boolean): void {
    const args: string[] = [
        "out/cli/analyze.js",
        "--repo",
        path.resolve(options.repo),
        "--profile",
        options.profile,
        "--k",
        String(options.k),
        "--maxEntries",
        String(options.maxEntries),
        "--outputDir",
        runDir,
        "--default",
        path.resolve(options.defaultRulePath),
    ];

    for (const sourceDir of options.sourceDirs) {
        args.push("--sourceDir", sourceDir);
    }

    if (withProjectRules) {
        args.push("--project", path.resolve(options.projectRulePath));
    }

    const cmd = `${process.execPath} ${args.join(" ")}`;
    const startedAt = Date.now();
    const proc = spawnSync(process.execPath, args, {
        encoding: "utf-8",
        stdio: "pipe",
    });
    const durationMs = Date.now() - startedAt;

    console.log(`\n===== RUN: ${withProjectRules ? "with_project_rules" : "baseline"} =====`);
    console.log(`command=${cmd}`);
    console.log(`exitCode=${proc.status ?? 1}, durationMs=${durationMs}`);
    if ((proc.stdout || "").trim()) {
        console.log((proc.stdout || "").trimEnd());
    }
    if ((proc.stderr || "").trim()) {
        console.log((proc.stderr || "").trimEnd());
    }
    if (proc.error) {
        throw proc.error;
    }
    if (proc.status !== 0) {
        throw new Error(`Analyze run failed (${withProjectRules ? "with_project_rules" : "baseline"}), exitCode=${proc.status}`);
    }
}

function readAnalyzeSummary(summaryPath: string): AnalyzeSummaryReport {
    if (!fs.existsSync(summaryPath)) {
        throw new Error(`Analyze summary not found: ${summaryPath}`);
    }
    const raw = fs.readFileSync(summaryPath, "utf-8").replace(/^\uFEFF/, "");
    return JSON.parse(raw) as AnalyzeSummaryReport;
}

function calcUnknownCount(entries: AnalyzeSummaryEntry[]): number {
    return (entries || []).filter(entry => (entry.flowCount || 0) === 0).length;
}

function pct(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
}

function renderMarkdown(report: UnknownDeltaReport): string {
    const lines: string[] = [];
    lines.push("# Phase 5.3.7 Project Rule Unknown Reduction");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- repo: ${report.options.repo}`);
    lines.push(`- sourceDirs: ${report.options.sourceDirs.join(", ")}`);
    lines.push(`- k: ${report.options.k}`);
    lines.push(`- maxEntries: ${report.options.maxEntries}`);
    lines.push(`- threshold: ${pct(report.options.threshold)}`);
    lines.push(`- pass: ${report.pass}`);
    lines.push("");
    lines.push("## Baseline");
    lines.push("");
    lines.push(`- summaryPath: ${report.baseline.summaryPath}`);
    lines.push(`- totalEntries: ${report.baseline.totalEntries}`);
    lines.push(`- withFlows: ${report.baseline.withFlows}`);
    lines.push(`- unknownCount: ${report.baseline.unknownCount}`);
    lines.push(`- unknownRate: ${pct(report.baseline.unknownRate)}`);
    lines.push("");
    lines.push("## With Project Rules");
    lines.push("");
    lines.push(`- summaryPath: ${report.withProjectRules.summaryPath}`);
    lines.push(`- totalEntries: ${report.withProjectRules.totalEntries}`);
    lines.push(`- withFlows: ${report.withProjectRules.withFlows}`);
    lines.push(`- unknownCount: ${report.withProjectRules.unknownCount}`);
    lines.push(`- unknownRate: ${pct(report.withProjectRules.unknownRate)}`);
    lines.push("");
    lines.push("## Delta");
    lines.push("");
    lines.push(`- unknownCountDelta: ${report.delta.unknownCountDelta}`);
    lines.push(`- unknownRateDelta: ${pct(report.delta.unknownRateDelta)}`);
    lines.push(`- unknownRelativeReduction: ${pct(report.delta.unknownRelativeReduction)}`);
    lines.push(`- withFlowsDelta: ${report.delta.withFlowsDelta}`);
    lines.push("");
    return lines.join("\n");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const outputDir = path.resolve(options.outputDir);
    ensureDir(outputDir);

    const baselineDir = path.resolve(outputDir, "baseline");
    const withProjectDir = path.resolve(outputDir, "with_project");
    ensureDir(baselineDir);
    ensureDir(withProjectDir);

    runAnalyze(options, baselineDir, false);
    runAnalyze(options, withProjectDir, true);

    const baselineSummaryPath = path.resolve(baselineDir, "summary.json");
    const withProjectSummaryPath = path.resolve(withProjectDir, "summary.json");
    const baselineSummary = readAnalyzeSummary(baselineSummaryPath);
    const withProjectSummary = readAnalyzeSummary(withProjectSummaryPath);

    const baselineTotalEntries = baselineSummary.summary?.totalEntries ?? baselineSummary.entries.length;
    const withProjectTotalEntries = withProjectSummary.summary?.totalEntries ?? withProjectSummary.entries.length;
    const baselineUnknown = calcUnknownCount(baselineSummary.entries || []);
    const withProjectUnknown = calcUnknownCount(withProjectSummary.entries || []);
    const baselineUnknownRate = baselineTotalEntries > 0 ? baselineUnknown / baselineTotalEntries : 0;
    const withProjectUnknownRate = withProjectTotalEntries > 0 ? withProjectUnknown / withProjectTotalEntries : 0;
    const unknownCountDelta = baselineUnknown - withProjectUnknown;
    const unknownRateDelta = baselineUnknownRate - withProjectUnknownRate;
    const unknownRelativeReduction = baselineUnknown > 0 ? unknownCountDelta / baselineUnknown : 0;
    const baselineWithFlows = baselineSummary.summary?.withFlows ?? 0;
    const withProjectWithFlows = withProjectSummary.summary?.withFlows ?? 0;
    const withFlowsDelta = withProjectWithFlows - baselineWithFlows;
    const pass = unknownRelativeReduction >= options.threshold;

    const jsonPath = path.resolve(outputDir, "unknown_reduction_report.json");
    const markdownPath = path.resolve(outputDir, "unknown_reduction_report.md");

    const report: UnknownDeltaReport = {
        generatedAt: new Date().toISOString(),
        options: {
            repo: path.resolve(options.repo),
            sourceDirs: options.sourceDirs,
            profile: options.profile,
            k: options.k,
            maxEntries: options.maxEntries,
            threshold: options.threshold,
            defaultRulePath: path.resolve(options.defaultRulePath),
            projectRulePath: path.resolve(options.projectRulePath),
        },
        baseline: {
            summaryPath: baselineSummaryPath,
            totalEntries: baselineTotalEntries,
            withFlows: baselineWithFlows,
            unknownCount: baselineUnknown,
            unknownRate: baselineUnknownRate,
        },
        withProjectRules: {
            summaryPath: withProjectSummaryPath,
            totalEntries: withProjectTotalEntries,
            withFlows: withProjectWithFlows,
            unknownCount: withProjectUnknown,
            unknownRate: withProjectUnknownRate,
        },
        delta: {
            unknownCountDelta,
            unknownRateDelta,
            unknownRelativeReduction,
            withFlowsDelta,
        },
        pass,
        artifacts: {
            jsonPath,
            markdownPath,
            baselineDir,
            withProjectDir,
        },
    };

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(markdownPath, renderMarkdown(report), "utf-8");

    console.log("\n===== UNKNOWN REDUCTION SUMMARY =====");
    console.log(`baseline_unknown=${baselineUnknown}`);
    console.log(`with_project_unknown=${withProjectUnknown}`);
    console.log(`unknown_relative_reduction=${pct(unknownRelativeReduction)}`);
    console.log(`with_flows_delta=${withFlowsDelta}`);
    console.log(`threshold=${pct(options.threshold)}`);
    console.log(`pass=${pass}`);
    console.log(`report_json=${jsonPath}`);
    console.log(`report_md=${markdownPath}`);

    if (!pass) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
