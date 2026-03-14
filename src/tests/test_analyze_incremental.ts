import * as fs from "fs";
import * as path from "path";
import { readAnalyzeSummary, runAnalyzeCli } from "./helpers/AnalyzeCliRunner";

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

function runAnalyze(outputDir: string, cachePath: string): AnalyzeSummary {
    const args = [
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        "--default", "tests/rules/minimal.rules.json",
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
    const root = path.resolve("tmp/phase56/analyze_incremental");
    const out1 = path.join(root, "round1");
    const out2 = path.join(root, "round2");
    const cachePath = path.join(root, "analyze.incremental.cache.json");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const first = runAnalyze(out1, cachePath);
    const second = runAnalyze(out2, cachePath);

    const firstHit = first.summary.stageProfile.incrementalCacheHitCount || 0;
    const firstMiss = first.summary.stageProfile.incrementalCacheMissCount || 0;
    const secondHit = second.summary.stageProfile.incrementalCacheHitCount || 0;
    const secondMiss = second.summary.stageProfile.incrementalCacheMissCount || 0;

    console.log("====== Analyze Incremental Test ======");
    console.log(`first_hit=${firstHit}`);
    console.log(`first_miss=${firstMiss}`);
    console.log(`second_hit=${secondHit}`);
    console.log(`second_miss=${secondMiss}`);
    console.log(`first_total_flows=${first.summary.totalFlows}`);
    console.log(`second_total_flows=${second.summary.totalFlows}`);
    console.log(`cache_path=${cachePath}`);

    if (firstMiss <= 0) {
        throw new Error(`expected first run incremental miss > 0, got ${firstMiss}`);
    }
    if (secondHit <= 0) {
        throw new Error(`expected second run incremental hit > 0, got ${secondHit}`);
    }
    if (first.summary.totalFlows !== second.summary.totalFlows) {
        throw new Error(
            `expected stable flow total across incremental runs, got ${first.summary.totalFlows} vs ${second.summary.totalFlows}`
        );
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
