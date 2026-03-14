import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface CliOptions {
    rounds: number;
    k: number;
    outputDir: string;
    arktanRoot: string;
    tag: string;
    runStability: boolean;
}

interface TransferCompareReport {
    generatedAt: string;
    options: {
        rounds: number;
        k: number;
        arktanRoot: string;
    };
    scenarios: Array<{
        id: string;
        sourceDir: string;
        projectRulePath: string;
        caseCount: number;
    }>;
    performance: {
        arktaintMedianWallMs: number;
        arktanMedianWallMs: number;
    };
    precision: {
        arktaint: { fp: number; fn: number };
        arktan: { fp: number; fn: number };
    };
    finalDecision: {
        pass: boolean;
        reason: string;
    };
}

interface PerfCompareReport {
    generatedAt: string;
    options: {
        rounds: number;
        k: number;
        arktanRoot: string;
        tag: string;
    };
    environment: {
        node: string;
        platform: string;
        cpus: number;
        host: string;
    };
    dataset: {
        name: string;
        scenarioCount: number;
        scenarioIds: string[];
    };
    comparison: {
        arktaintMedianWallMs: number;
        arktanMedianWallMs: number;
        ratio: number;
        pass: boolean;
        reason: string;
    };
    precisionSnapshot: {
        arktaintFp: number;
        arktaintFn: number;
        arktanFp: number;
        arktanFn: number;
    };
    rawCompareReportPath: string;
    artifacts: {
        jsonPath: string;
        markdownPath: string;
    };
}

function parseArgs(argv: string[]): CliOptions {
    let rounds = 5;
    let k = 1;
    let outputDir = "tmp/phase56";
    let arktanRoot = "../Arktan";
    let tag = "round1";
    let runStability = false;

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
        if (arg === "--arktanRoot" && i + 1 < argv.length) {
            arktanRoot = argv[++i];
            continue;
        }
        if (arg.startsWith("--arktanRoot=")) {
            arktanRoot = arg.slice("--arktanRoot=".length);
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
        if (arg === "--runStability") {
            runStability = true;
            continue;
        }
    }

    if (!Number.isFinite(rounds) || rounds <= 0) {
        throw new Error(`invalid --rounds: ${rounds}`);
    }
    if (k !== 0 && k !== 1) {
        throw new Error(`invalid --k: ${k}`);
    }

    return {
        rounds: Math.floor(rounds),
        k,
        outputDir: path.resolve(outputDir),
        arktanRoot: path.resolve(arktanRoot),
        tag: tag.trim() || "round1",
        runStability,
    };
}

function renderMarkdown(report: PerfCompareReport): string {
    const lines: string[] = [];
    lines.push("# Phase 5.6 Analyze vs Arktan Perf Compare");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- rounds: ${report.options.rounds}`);
    lines.push(`- k: ${report.options.k}`);
    lines.push(`- dataset: ${report.dataset.name}`);
    lines.push(`- scenarioCount: ${report.dataset.scenarioCount}`);
    lines.push(`- arktaint median wall ms: ${report.comparison.arktaintMedianWallMs.toFixed(3)}`);
    lines.push(`- arktan median wall ms: ${report.comparison.arktanMedianWallMs.toFixed(3)}`);
    lines.push(`- ratio (arktaint/arktan): ${report.comparison.ratio.toFixed(4)}`);
    lines.push(`- pass: ${report.comparison.pass}`);
    lines.push(`- reason: ${report.comparison.reason}`);
    lines.push(`- precision snapshot: arktaint(FP=${report.precisionSnapshot.arktaintFp}, FN=${report.precisionSnapshot.arktaintFn}), arktan(FP=${report.precisionSnapshot.arktanFp}, FN=${report.precisionSnapshot.arktanFn})`);
    lines.push(`- raw compare report: ${report.rawCompareReportPath}`);
    lines.push("");
    lines.push("## Scenario IDs");
    for (const id of report.dataset.scenarioIds) {
        lines.push(`- ${id}`);
    }
    return lines.join("\n");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const compareScript = path.resolve("out/tests/test_transfer_compare_arktan.js");
    if (!fs.existsSync(compareScript)) {
        throw new Error(`script not found: ${compareScript}. run npm run build first`);
    }
    if (!fs.existsSync(options.arktanRoot)) {
        throw new Error(`arktan root not found: ${options.arktanRoot}`);
    }

    fs.mkdirSync(options.outputDir, { recursive: true });
    const rawDir = path.join(options.outputDir, `perf_compare_arktan_${options.tag}_raw`);
    fs.rmSync(rawDir, { recursive: true, force: true });
    fs.mkdirSync(rawDir, { recursive: true });

    const args = [
        compareScript,
        "--rounds", String(options.rounds),
        "--k", String(options.k),
        "--outputDir", rawDir,
        "--arktanRoot", options.arktanRoot,
        "--arktaintNoProfile",
    ];
    if (options.runStability) {
        args.push("--runStability");
    }
    const proc = spawnSync(process.execPath, args, { stdio: "pipe", encoding: "utf-8" });
    const rawReportPath = path.join(rawDir, "compare_report.json");
    if (proc.status !== 0 && !fs.existsSync(rawReportPath)) {
        throw new Error(`transfer compare failed: ${proc.stderr || proc.stdout || "no output"}`);
    }
    if (!fs.existsSync(rawReportPath)) {
        throw new Error(`raw compare report not found: ${rawReportPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(rawReportPath, "utf-8")) as TransferCompareReport;

    const arktaintMedianWallMs = raw.performance?.arktaintMedianWallMs || 0;
    const arktanMedianWallMs = raw.performance?.arktanMedianWallMs || 0;
    const ratio = arktanMedianWallMs > 0 ? arktaintMedianWallMs / arktanMedianWallMs : 0;
    const pass = arktaintMedianWallMs <= arktanMedianWallMs;
    const reason = pass
        ? "ok"
        : `arktaint_median_wall_gt_arktan(arktaint=${arktaintMedianWallMs.toFixed(3)},arktan=${arktanMedianWallMs.toFixed(3)})`;

    const report: PerfCompareReport = {
        generatedAt: new Date().toISOString(),
        options: {
            rounds: options.rounds,
            k: options.k,
            arktanRoot: options.arktanRoot,
            tag: options.tag,
        },
        environment: {
            node: process.version,
            platform: `${process.platform}-${process.arch}`,
            cpus: os.cpus()?.length || 0,
            host: os.hostname(),
        },
        dataset: {
            name: "phase55_fixed_compare_scenarios",
            scenarioCount: (raw.scenarios || []).length,
            scenarioIds: (raw.scenarios || []).map(s => s.id),
        },
        comparison: {
            arktaintMedianWallMs,
            arktanMedianWallMs,
            ratio,
            pass,
            reason,
        },
        precisionSnapshot: {
            arktaintFp: raw.precision?.arktaint?.fp || 0,
            arktaintFn: raw.precision?.arktaint?.fn || 0,
            arktanFp: raw.precision?.arktan?.fp || 0,
            arktanFn: raw.precision?.arktan?.fn || 0,
        },
        rawCompareReportPath: rawReportPath,
        artifacts: {
            jsonPath: path.resolve(options.outputDir, `perf_compare_arktan_${options.tag}.json`),
            markdownPath: path.resolve(options.outputDir, `perf_compare_arktan_${options.tag}.md`),
        },
    };

    fs.writeFileSync(report.artifacts.jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(report.artifacts.markdownPath, renderMarkdown(report), "utf-8");

    console.log("====== Analyze Perf Compare (ArkTaint vs Arktan) ======");
    console.log(`rounds=${options.rounds}`);
    console.log(`k=${options.k}`);
    console.log(`dataset=${report.dataset.name}`);
    console.log(`arktaint_median_wall_ms=${arktaintMedianWallMs.toFixed(3)}`);
    console.log(`arktan_median_wall_ms=${arktanMedianWallMs.toFixed(3)}`);
    console.log(`ratio=${ratio.toFixed(4)}`);
    console.log(`pass=${pass}`);
    console.log(`reason=${reason}`);
    console.log(`raw_report_json=${rawReportPath}`);
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
