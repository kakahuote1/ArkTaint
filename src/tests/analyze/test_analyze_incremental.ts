import * as fs from "fs";
import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";

interface AnalyzeSummary {
    summary: {
        withFlows: number;
        totalFlows: number;
        stageProfile: {
            incrementalCacheHitCount: number;
            incrementalCacheMissCount: number;
            incrementalCacheWriteCount: number;
        };
    };
}

interface AnalyzeManifest {
    paths?: {
        traceGraphJson?: string;
        traceGraphMd?: string;
    };
}

function runAnalyze(outputDir: string, cachePath: string): AnalyzeSummary {
    const args = [
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        "--kernelRule", "tests/rules/minimal.rules.json",
        "--project", "tests/rules/transfer_variants.rules.json",
        "--k", "1",
        "--maxEntries", "6",
        "--outputDir", outputDir,
        "--incremental",
        "--incrementalCache", cachePath,
    ];
    runAnalyzeCli(args);
    return readAnalyzeSummary<AnalyzeSummary>(outputDir);
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "incremental");
    const out1 = resolveTestRunPath("analyze", "incremental", "round1");
    const out2 = resolveTestRunPath("analyze", "incremental", "round2");
    const cachePath = resolveTestRunPath("analyze", "incremental", "analyze.incremental.cache.json");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const first = runAnalyze(out1, cachePath);
    const second = runAnalyze(out2, cachePath);

    const firstHit = first.summary.stageProfile.incrementalCacheHitCount || 0;
    const firstMiss = first.summary.stageProfile.incrementalCacheMissCount || 0;
    const firstWrite = first.summary.stageProfile.incrementalCacheWriteCount || 0;
    const secondHit = second.summary.stageProfile.incrementalCacheHitCount || 0;
    const secondMiss = second.summary.stageProfile.incrementalCacheMissCount || 0;
    const secondWrite = second.summary.stageProfile.incrementalCacheWriteCount || 0;
    const firstManifest = JSON.parse(
        fs.readFileSync(resolveTestRunPath("analyze", "incremental", "round1", "run.json"), "utf-8")
    ) as AnalyzeManifest;
    const secondManifest = JSON.parse(
        fs.readFileSync(resolveTestRunPath("analyze", "incremental", "round2", "run.json"), "utf-8")
    ) as AnalyzeManifest;

    console.log("====== Analyze Incremental Test ======");
    console.log(`first_hit=${firstHit}`);
    console.log(`first_miss=${firstMiss}`);
    console.log(`first_write=${firstWrite}`);
    console.log(`second_hit=${secondHit}`);
    console.log(`second_miss=${secondMiss}`);
    console.log(`second_write=${secondWrite}`);
    console.log(`first_total_flows=${first.summary.totalFlows}`);
    console.log(`second_total_flows=${second.summary.totalFlows}`);
    console.log(`cache_path=${cachePath}`);

    if (firstHit !== 0 || firstMiss !== 0 || firstWrite !== 0) {
        throw new Error(`FullTraceRun must bypass entry cache in round1, got hit/miss/write=${firstHit}/${firstMiss}/${firstWrite}`);
    }
    if (secondHit !== 0 || secondMiss !== 0 || secondWrite !== 0) {
        throw new Error(`FullTraceRun must bypass entry cache in round2, got hit/miss/write=${secondHit}/${secondMiss}/${secondWrite}`);
    }
    if (first.summary.totalFlows !== second.summary.totalFlows) {
        throw new Error(
            `expected stable flow total across incremental runs, got ${first.summary.totalFlows} vs ${second.summary.totalFlows}`
        );
    }
    for (const [name, dir, manifest] of [["round1", out1, firstManifest], ["round2", out2, secondManifest]] as const) {
        const traceGraphJson = manifest.paths?.traceGraphJson;
        const traceGraphMd = manifest.paths?.traceGraphMd;
        if (!traceGraphJson || !fs.existsSync(resolveTestRunPath("analyze", "incremental", name, traceGraphJson))) {
            throw new Error(`${name} missing traceGraphJson output`);
        }
        if (!traceGraphMd || !fs.existsSync(resolveTestRunPath("analyze", "incremental", name, traceGraphMd))) {
            throw new Error(`${name} missing traceGraphMd output`);
        }
        if (!fs.existsSync(dir)) {
            throw new Error(`${name} output dir missing`);
        }
    }
    if (fs.existsSync(cachePath)) {
        throw new Error(`FullTraceRun must not write entry incremental cache, found ${cachePath}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

