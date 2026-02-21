import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readAnalyzeSummary, runAnalyzeCli } from "./helpers/AnalyzeCliRunner";

interface CliOptions {
    rounds: number;
    threshold: number;
    k: number;
    outputDir: string;
    tag: string;
}

interface ScenarioConfig {
    id: string;
    repo: string;
    sourceDir: string;
    projectRulePath: string;
    maxEntries: number;
}

interface AnalyzeSummary {
    summary: {
        totalFlows: number;
        detectProfile?: {
            totalMs?: number;
        };
    };
}

interface ScenarioRoundResult {
    scenarioId: string;
    round: number;
    baselineDetectMs: number;
    optimizedDetectMs: number;
    baselineFlows: number;
    optimizedFlows: number;
}

interface DetectPerfReport {
    generatedAt: string;
    options: CliOptions;
    environment: {
        node: string;
        platform: string;
        cpus: number;
        host: string;
    };
    scenarios: ScenarioConfig[];
    rounds: ScenarioRoundResult[];
    summary: {
        baselineMedianDetectMs: number;
        optimizedMedianDetectMs: number;
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
    let rounds = 5;
    let threshold = 0.2;
    let k = 1;
    let outputDir = "tmp/phase66";
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

    return {
        rounds: Math.floor(rounds),
        threshold,
        k,
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
    scenario: ScenarioConfig,
    options: CliOptions,
    outputDir: string,
    stopOnFirstFlow: boolean
): AnalyzeSummary {
    const args = [
        "--repo", scenario.repo,
        "--sourceDir", scenario.sourceDir,
        "--default", "tests/rules/minimal.rules.json",
        "--project", scenario.projectRulePath,
        "--profile", "fast",
        "--k", String(options.k),
        "--maxEntries", String(scenario.maxEntries),
        "--no-incremental",
        "--concurrency", "1",
        "--reportMode", "full",
        "--outputDir", outputDir,
    ];
    if (stopOnFirstFlow) {
        args.push("--stopOnFirstFlow");
    }
    runAnalyzeCli(args);
    return readAnalyzeSummary<AnalyzeSummary>(outputDir);
}

function renderMarkdown(report: DetectPerfReport): string {
    const lines: string[] = [];
    lines.push("# Phase 6.6 Detect Perf Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- rounds: ${report.options.rounds}`);
    lines.push(`- threshold: ${report.options.threshold}`);
    lines.push(`- k: ${report.options.k}`);
    lines.push(`- baseline median detect ms: ${report.summary.baselineMedianDetectMs.toFixed(4)}`);
    lines.push(`- optimized median detect ms: ${report.summary.optimizedMedianDetectMs.toFixed(4)}`);
    lines.push(`- reduction ratio: ${(report.summary.reductionRatio * 100).toFixed(2)}%`);
    lines.push(`- flowConsistencyPass: ${report.summary.flowConsistencyPass}`);
    lines.push(`- pass: ${report.summary.pass}`);
    lines.push(`- reason: ${report.summary.reason}`);
    lines.push("");
    lines.push("## Scenarios");
    for (const s of report.scenarios) {
        lines.push(`- ${s.id}: repo=${s.repo}, sourceDir=${s.sourceDir}, project=${s.projectRulePath}, maxEntries=${s.maxEntries}`);
    }
    lines.push("");
    lines.push("## Round Details");
    for (const r of report.rounds) {
        lines.push(
            `- ${r.scenarioId}#${r.round}: baselineDetectMs=${r.baselineDetectMs.toFixed(4)}, `
            + `optimizedDetectMs=${r.optimizedDetectMs.toFixed(4)}, `
            + `baselineFlows=${r.baselineFlows}, optimizedFlows=${r.optimizedFlows}`
        );
    }
    return lines.join("\n");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const scenarios: ScenarioConfig[] = [
        {
            id: "rule_transfer",
            repo: "tests/demo/rule_transfer",
            sourceDir: ".",
            projectRulePath: "tests/rules/transfer_only.rules.json",
            maxEntries: 12,
        },
        {
            id: "rule_transfer_variants",
            repo: "tests/demo/rule_transfer_variants",
            sourceDir: ".",
            projectRulePath: "tests/rules/transfer_variants.rules.json",
            maxEntries: 4,
        },
    ];

    fs.mkdirSync(options.outputDir, { recursive: true });
    const workDir = path.resolve(options.outputDir, `phase66_detect_perf_${options.tag}_work`);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });

    const roundResults: ScenarioRoundResult[] = [];
    let flowConsistencyPass = true;

    for (let round = 1; round <= options.rounds; round++) {
        for (const scenario of scenarios) {
            const root = path.resolve(workDir, `round${round}`, scenario.id);
            const baselineDir = path.resolve(root, "baseline");
            const optimizedDir = path.resolve(root, "optimized");
            const baseline = runAnalyze(scenario, options, baselineDir, false);
            const optimized = runAnalyze(scenario, options, optimizedDir, true);
            const baselineDetectMs = baseline.summary.detectProfile?.totalMs || 0;
            const optimizedDetectMs = optimized.summary.detectProfile?.totalMs || 0;
            const baselineFlows = baseline.summary.totalFlows || 0;
            const optimizedFlows = optimized.summary.totalFlows || 0;
            if (baselineFlows !== optimizedFlows) {
                flowConsistencyPass = false;
            }
            roundResults.push({
                scenarioId: scenario.id,
                round,
                baselineDetectMs,
                optimizedDetectMs,
                baselineFlows,
                optimizedFlows,
            });
        }
    }

    const baselineMedianDetectMs = median(roundResults.map(x => x.baselineDetectMs));
    const optimizedMedianDetectMs = median(roundResults.map(x => x.optimizedDetectMs));
    const reductionRatio = baselineMedianDetectMs > 0
        ? (baselineMedianDetectMs - optimizedMedianDetectMs) / baselineMedianDetectMs
        : 0;

    const pass = flowConsistencyPass && reductionRatio >= options.threshold;
    const reason = !flowConsistencyPass
        ? "flow_consistency_failed"
        : reductionRatio < options.threshold
            ? `reduction_ratio_below_threshold(${reductionRatio.toFixed(4)} < ${options.threshold.toFixed(4)})`
            : "ok";

    const jsonPath = path.resolve(options.outputDir, `phase66_detect_perf_${options.tag}.json`);
    const markdownPath = path.resolve(options.outputDir, `phase66_detect_perf_${options.tag}.md`);
    const report: DetectPerfReport = {
        generatedAt: new Date().toISOString(),
        options,
        environment: {
            node: process.version,
            platform: `${process.platform}-${process.arch}`,
            cpus: os.cpus().length,
            host: os.hostname(),
        },
        scenarios,
        rounds: roundResults,
        summary: {
            baselineMedianDetectMs,
            optimizedMedianDetectMs,
            reductionRatio,
            flowConsistencyPass,
            pass,
            reason,
        },
        artifacts: {
            jsonPath,
            markdownPath,
        },
    };

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(markdownPath, renderMarkdown(report), "utf-8");

    console.log("====== Phase 6.6 Detect Perf ======");
    console.log(`rounds=${options.rounds}`);
    console.log(`threshold=${options.threshold}`);
    console.log(`baseline_median_detect_ms=${baselineMedianDetectMs.toFixed(4)}`);
    console.log(`optimized_median_detect_ms=${optimizedMedianDetectMs.toFixed(4)}`);
    console.log(`reduction_ratio=${(reductionRatio * 100).toFixed(2)}%`);
    console.log(`flow_consistency_pass=${flowConsistencyPass}`);
    console.log(`pass=${pass}`);
    console.log(`reason=${reason}`);
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

