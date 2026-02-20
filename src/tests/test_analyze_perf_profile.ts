import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

type PerfMode = "baseline" | "optimized";

interface CliOptions {
    rounds: number;
    threshold: number;
    k: number;
    maxEntries: number;
    defaultRulePath: string;
    outputDir: string;
    tag: string;
}

interface ScenarioConfig {
    id: string;
    repo: string;
    sourceDir: string;
    projectRulePath: string;
}

interface AnalyzeSummary {
    summary: {
        totalFlows: number;
        stageProfile: {
            totalMs: number;
        };
    };
}

interface ScenarioRoundTiming {
    scenarioId: string;
    mode: PerfMode;
    round: number;
    totalMs: number;
    totalFlows: number;
}

interface RoundTiming {
    round: number;
    baselineTotalMs: number;
    optimizedTotalMs: number;
    baselineScenarioTimings: ScenarioRoundTiming[];
    optimizedScenarioTimings: ScenarioRoundTiming[];
}

interface PerfProfileReport {
    generatedAt: string;
    options: {
        rounds: number;
        threshold: number;
        k: number;
        maxEntries: number;
        defaultRulePath: string;
        tag: string;
    };
    environment: {
        node: string;
        platform: string;
        cpus: number;
        host: string;
    };
    scenarios: ScenarioConfig[];
    rounds: RoundTiming[];
    summary: {
        baselineMedianMs: number;
        optimizedMedianMs: number;
        reductionRatio: number;
        flowConsistencyPass: boolean;
        pass: boolean;
        reason: string;
    };
    artifacts: {
        jsonPath: string;
        markdownPath: string;
    };
}

function parseArgs(argv: string[]): CliOptions {
    let rounds = 3;
    let threshold = 0.3;
    let k = 1;
    let maxEntries = 12;
    let defaultRulePath = "tests/rules/minimal.rules.json";
    let outputDir = "tmp/phase56";
    let tag = "round1";

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--rounds" && i + 1 < argv.length) {
            rounds = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--rounds=")) {
            rounds = Number(arg.slice("--rounds=".length));
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
        if (arg === "--outputDir" && i + 1 < argv.length) {
            outputDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--outputDir=")) {
            outputDir = arg.slice("--outputDir=".length);
            continue;
        }
        if (arg === "--tag" && i + 1 < argv.length) {
            tag = argv[++i];
            continue;
        }
        if (arg.startsWith("--tag=")) {
            tag = arg.slice("--tag=".length);
            continue;
        }
    }

    if (!Number.isFinite(rounds) || rounds <= 0) {
        throw new Error(`invalid --rounds: ${rounds}`);
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error(`invalid --threshold: ${threshold}`);
    }
    if (k !== 0 && k !== 1) {
        throw new Error(`invalid --k: ${k}`);
    }
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
        throw new Error(`invalid --maxEntries: ${maxEntries}`);
    }

    return {
        rounds: Math.floor(rounds),
        threshold,
        k,
        maxEntries: Math.floor(maxEntries),
        defaultRulePath: path.resolve(defaultRulePath),
        outputDir: path.resolve(outputDir),
        tag: tag.trim() || "round1",
    };
}

function median(nums: number[]): number {
    if (nums.length === 0) return 0;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

function runAnalyze(
    mode: PerfMode,
    scenario: ScenarioConfig,
    options: CliOptions,
    outputDir: string,
    incrementalCachePath?: string
): AnalyzeSummary {
    const cli = path.resolve("out/cli/analyze.js");
    const args = [
        cli,
        "--repo", scenario.repo,
        "--sourceDir", scenario.sourceDir,
        "--default", options.defaultRulePath,
        "--project", scenario.projectRulePath,
        "--k", String(options.k),
        "--maxEntries", String(options.maxEntries),
        "--outputDir", outputDir,
    ];

    if (mode === "baseline") {
        args.push("--no-incremental", "--concurrency", "1", "--reportMode", "full");
    } else {
        args.push("--incremental", "--concurrency", "4", "--reportMode", "light");
        if (incrementalCachePath) {
            args.push("--incrementalCache", incrementalCachePath);
        }
    }

    const proc = spawnSync(process.execPath, args, { stdio: "pipe", encoding: "utf-8" });
    if (proc.status !== 0) {
        throw new Error(
            `analyze failed: mode=${mode}, scenario=${scenario.id}, stderr=${proc.stderr || proc.stdout || "no output"}`
        );
    }
    const summaryPath = path.resolve(outputDir, "summary.json");
    if (!fs.existsSync(summaryPath)) {
        throw new Error(`summary not found: ${summaryPath}`);
    }
    return JSON.parse(fs.readFileSync(summaryPath, "utf-8")) as AnalyzeSummary;
}

function renderMarkdown(report: PerfProfileReport): string {
    const lines: string[] = [];
    lines.push("# Phase 5.6 Analyze End-to-End Perf Profile");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- rounds: ${report.options.rounds}`);
    lines.push(`- threshold: ${report.options.threshold}`);
    lines.push(`- k: ${report.options.k}`);
    lines.push(`- maxEntries: ${report.options.maxEntries}`);
    lines.push(`- baseline median ms: ${report.summary.baselineMedianMs.toFixed(3)}`);
    lines.push(`- optimized median ms: ${report.summary.optimizedMedianMs.toFixed(3)}`);
    lines.push(`- reduction ratio: ${(report.summary.reductionRatio * 100).toFixed(2)}%`);
    lines.push(`- flowConsistencyPass: ${report.summary.flowConsistencyPass}`);
    lines.push(`- pass: ${report.summary.pass}`);
    lines.push(`- reason: ${report.summary.reason}`);
    lines.push("");
    lines.push("## Round Totals");
    for (const r of report.rounds) {
        lines.push(`- round ${r.round}: baseline=${r.baselineTotalMs.toFixed(3)}ms, optimized=${r.optimizedTotalMs.toFixed(3)}ms`);
    }
    lines.push("");
    lines.push("## Scenarios");
    for (const s of report.scenarios) {
        lines.push(`- ${s.id}: repo=${s.repo}, sourceDir=${s.sourceDir}, projectRule=${s.projectRulePath}`);
    }
    return lines.join("\n");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.defaultRulePath)) {
        throw new Error(`default rule path not found: ${options.defaultRulePath}`);
    }

    const scenarios: ScenarioConfig[] = [
        {
            id: "rule_transfer",
            repo: "tests/demo/rule_transfer",
            sourceDir: ".",
            projectRulePath: "tests/rules/transfer_only.rules.json",
        },
        {
            id: "rule_transfer_variants",
            repo: "tests/demo/rule_transfer_variants",
            sourceDir: ".",
            projectRulePath: "tests/rules/transfer_variants.rules.json",
        },
        {
            id: "rule_precision_transfer",
            repo: "tests/demo/rule_precision_transfer",
            sourceDir: ".",
            projectRulePath: "tests/rules/transfer_precision.rules.json",
        },
        {
            id: "transfer_overload_conflicts",
            repo: "tests/demo/transfer_overload_conflicts",
            sourceDir: ".",
            projectRulePath: "tests/rules/transfer_overload_conflicts.rules.json",
        },
        {
            id: "transfer_priority",
            repo: "tests/demo/transfer_priority",
            sourceDir: ".",
            projectRulePath: "tests/rules/transfer_priority.rules.json",
        },
    ];

    fs.mkdirSync(options.outputDir, { recursive: true });
    const workRoot = path.join(options.outputDir, `perf_profile_${options.tag}_work`);
    fs.rmSync(workRoot, { recursive: true, force: true });
    fs.mkdirSync(workRoot, { recursive: true });

    const rounds: RoundTiming[] = [];
    let flowConsistencyPass = true;

    for (let round = 1; round <= options.rounds; round++) {
        const baselineScenarioTimings: ScenarioRoundTiming[] = [];
        const optimizedScenarioTimings: ScenarioRoundTiming[] = [];
        let baselineTotalMs = 0;
        let optimizedTotalMs = 0;

        for (const scenario of scenarios) {
            const scenarioRoot = path.join(workRoot, `round${round}`, scenario.id);
            const baselineOut = path.join(scenarioRoot, "baseline");
            const baselineSummary = runAnalyze("baseline", scenario, options, baselineOut);
            const baselineMs = baselineSummary.summary.stageProfile?.totalMs || 0;
            const baselineFlows = baselineSummary.summary.totalFlows || 0;
            baselineTotalMs += baselineMs;
            baselineScenarioTimings.push({
                scenarioId: scenario.id,
                mode: "baseline",
                round,
                totalMs: baselineMs,
                totalFlows: baselineFlows,
            });

            const cachePath = path.join(workRoot, `.cache.${scenario.id}.json`);
            const warmupOut = path.join(scenarioRoot, "optimized_warmup");
            runAnalyze("optimized", scenario, options, warmupOut, cachePath);

            const optimizedOut = path.join(scenarioRoot, "optimized");
            const optimizedSummary = runAnalyze("optimized", scenario, options, optimizedOut, cachePath);
            const optimizedMs = optimizedSummary.summary.stageProfile?.totalMs || 0;
            const optimizedFlows = optimizedSummary.summary.totalFlows || 0;
            optimizedTotalMs += optimizedMs;
            optimizedScenarioTimings.push({
                scenarioId: scenario.id,
                mode: "optimized",
                round,
                totalMs: optimizedMs,
                totalFlows: optimizedFlows,
            });

            if (baselineFlows !== optimizedFlows) {
                flowConsistencyPass = false;
            }
        }

        rounds.push({
            round,
            baselineTotalMs,
            optimizedTotalMs,
            baselineScenarioTimings,
            optimizedScenarioTimings,
        });
    }

    const baselineMedianMs = median(rounds.map(r => r.baselineTotalMs));
    const optimizedMedianMs = median(rounds.map(r => r.optimizedTotalMs));
    const reductionRatio = baselineMedianMs > 0 ? (baselineMedianMs - optimizedMedianMs) / baselineMedianMs : 0;

    const pass = flowConsistencyPass && reductionRatio >= options.threshold;
    const reason = !flowConsistencyPass
        ? "flow_consistency_failed_between_baseline_and_optimized"
        : reductionRatio < options.threshold
            ? `reduction_${(reductionRatio * 100).toFixed(2)}%_below_threshold_${(options.threshold * 100).toFixed(2)}%`
            : "ok";

    const report: PerfProfileReport = {
        generatedAt: new Date().toISOString(),
        options: {
            rounds: options.rounds,
            threshold: options.threshold,
            k: options.k,
            maxEntries: options.maxEntries,
            defaultRulePath: options.defaultRulePath,
            tag: options.tag,
        },
        environment: {
            node: process.version,
            platform: `${process.platform}-${process.arch}`,
            cpus: os.cpus()?.length || 0,
            host: os.hostname(),
        },
        scenarios,
        rounds,
        summary: {
            baselineMedianMs,
            optimizedMedianMs,
            reductionRatio,
            flowConsistencyPass,
            pass,
            reason,
        },
        artifacts: {
            jsonPath: path.resolve(options.outputDir, `perf_profile_${options.tag}.json`),
            markdownPath: path.resolve(options.outputDir, `perf_profile_${options.tag}.md`),
        },
    };

    fs.writeFileSync(report.artifacts.jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(report.artifacts.markdownPath, renderMarkdown(report), "utf-8");

    console.log("====== Analyze Perf Profile (Phase 5.6) ======");
    console.log(`rounds=${options.rounds}`);
    console.log(`baseline_median_ms=${baselineMedianMs.toFixed(3)}`);
    console.log(`optimized_median_ms=${optimizedMedianMs.toFixed(3)}`);
    console.log(`reduction_ratio=${reductionRatio.toFixed(4)}`);
    console.log(`flow_consistency_pass=${flowConsistencyPass}`);
    console.log(`threshold=${options.threshold}`);
    console.log(`pass=${pass}`);
    console.log(`reason=${reason}`);
    console.log(`report_json=${report.artifacts.jsonPath}`);
    console.log(`report_md=${report.artifacts.markdownPath}`);

    if (!pass) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
