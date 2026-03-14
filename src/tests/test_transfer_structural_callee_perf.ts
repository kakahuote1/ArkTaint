import * as fs from "fs";
import * as path from "path";
import { runCommandOrThrow } from "./helpers/ProcessRunner";

interface AnalyzeSummary {
    summary: {
        transferProfile?: { elapsedMs?: number };
        detectProfile?: { totalMs?: number };
        stageProfile?: { totalMs?: number };
    };
}

interface PerfPoint {
    transferMs: number;
    detectMs: number;
    totalMs: number;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function readSummary(outputDir: string): AnalyzeSummary {
    const summaryPath = path.resolve(outputDir, "summary.json");
    if (!fs.existsSync(summaryPath)) {
        throw new Error(`summary missing: ${summaryPath}`);
    }
    return JSON.parse(fs.readFileSync(summaryPath, "utf-8")) as AnalyzeSummary;
}

function runAnalyzeOnce(outputDir: string, envPatch: Record<string, string>): PerfPoint {
    const cli = path.resolve("out/cli/analyze.js");
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });
    runCommandOrThrow("analyze", process.execPath, [
        cli,
        "--repo", "tests/demo/complex_calls",
        "--sourceDir", ".",
        "--profile", "default",
        "--maxEntries", "12",
        "--concurrency", "1",
        "--no-incremental",
        "--outputDir", outputDir,
    ], {
        stdio: "pipe",
        env: {
            ...process.env,
            ...envPatch,
        },
    });
    const summary = readSummary(outputDir);
    return {
        transferMs: Number(summary.summary.transferProfile?.elapsedMs || 0),
        detectMs: Number(summary.summary.detectProfile?.totalMs || 0),
        totalMs: Number(summary.summary.stageProfile?.totalMs || 0),
    };
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

function medianPoint(points: PerfPoint[]): PerfPoint {
    return {
        transferMs: median(points.map(p => p.transferMs)),
        detectMs: median(points.map(p => p.detectMs)),
        totalMs: median(points.map(p => p.totalMs)),
    };
}

function main(): void {
    const root = path.resolve("tmp/phase79/transfer_structural_callee_perf");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const rounds = 3;
    const disabledPoints: PerfPoint[] = [];
    const enabledPoints: PerfPoint[] = [];
    for (let i = 0; i < rounds; i++) {
        disabledPoints.push(runAnalyzeOnce(
            path.resolve(root, `disabled_round_${i + 1}`),
            { ARKTAINT_TRANSFER_STRUCTURAL_CALLEE: "0" }
        ));
        enabledPoints.push(runAnalyzeOnce(
            path.resolve(root, `enabled_round_${i + 1}`),
            { ARKTAINT_TRANSFER_STRUCTURAL_CALLEE: "1" }
        ));
    }

    const disabled = medianPoint(disabledPoints);
    const enabled = medianPoint(enabledPoints);
    const totalRegression = disabled.totalMs > 0
        ? (enabled.totalMs - disabled.totalMs) / disabled.totalMs
        : 0;
    const transferRegression = disabled.transferMs > 0
        ? (enabled.transferMs - disabled.transferMs) / disabled.transferMs
        : 0;
    const detectRegression = disabled.detectMs > 0
        ? (enabled.detectMs - disabled.detectMs) / disabled.detectMs
        : 0;

    console.log("====== Transfer Structural Callee Perf Test ======");
    console.log(`rounds=${rounds}`);
    console.log(`disabled_total_ms=${disabled.totalMs.toFixed(3)}`);
    console.log(`enabled_total_ms=${enabled.totalMs.toFixed(3)}`);
    console.log(`disabled_transfer_ms=${disabled.transferMs.toFixed(3)}`);
    console.log(`enabled_transfer_ms=${enabled.transferMs.toFixed(3)}`);
    console.log(`disabled_detect_ms=${disabled.detectMs.toFixed(3)}`);
    console.log(`enabled_detect_ms=${enabled.detectMs.toFixed(3)}`);
    console.log(`total_regression=${(totalRegression * 100).toFixed(2)}%`);
    console.log(`transfer_regression=${(transferRegression * 100).toFixed(2)}%`);
    console.log(`detect_regression=${(detectRegression * 100).toFixed(2)}%`);

    const threshold = 0.15;
    assert(
        totalRegression <= threshold,
        `total regression too high: ${(totalRegression * 100).toFixed(2)}% > ${(threshold * 100).toFixed(0)}%`
    );
}

try {
    main();
} catch (err) {
    console.error(err);
    process.exitCode = 1;
}
