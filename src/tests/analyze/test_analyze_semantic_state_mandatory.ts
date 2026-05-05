import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "../../cli/analyzeCliOptions";
import {
    readAnalyzeSummary,
    runAnalyzeCli,
} from "../helpers/AnalyzeCliRunner";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";

interface AnalyzeReport {
    summary: {
        semanticState?: {
            enabled: boolean;
            seedCount: number;
            sinkHitCount: number;
            candidateSeedCount: number;
            provenanceCount: number;
            gapCount: number;
        };
    };
}

function run(): void {
    const baseArgs = [
        "--repo", "tests/demo/rule_transfer_variants",
        "--maxEntries", "2",
        "--no-incremental",
        "--outputDir", "tmp/test_runs/analyze/semantic_state_mandatory/latest",
    ];

    const parsed = parseArgs(baseArgs);
    assert.strictEqual((parsed as any).semanticStateSolver, undefined);
    assert.throws(() => parseArgs([...baseArgs, "--semanticStateSolver", "on"]), /unknown option/);
    assert.throws(() => parseArgs([...baseArgs, "--semantic-state-solver=off"]), /unknown option/);

    const root = resolveTestRunDir("analyze", "semantic_state_mandatory");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    runAnalyzeCli([
        "--repo", "tests/demo/rule_transfer_variants",
        "--maxEntries", "2",
        "--no-incremental",
        "--outputDir", root,
    ]);

    const report = readAnalyzeSummary<AnalyzeReport>(root);
    assert.ok(report.summary.semanticState, "expected mandatory semanticState summary");
    assert.strictEqual(report.summary.semanticState.enabled, true);
    assert.ok(report.summary.semanticState.seedCount >= 0);
    assert.ok(report.summary.semanticState.sinkHitCount >= 0);
    assert.ok(report.summary.semanticState.candidateSeedCount >= 0);
    assert.ok(report.summary.semanticState.provenanceCount >= 0);
    assert.ok(report.summary.semanticState.gapCount >= 0);

    const cachePath = path.join(root, "semantic_state.incremental.cache.json");
    const incrementalRound1 = path.join(root, "round1");
    const incrementalRound2 = path.join(root, "round2");
    runAnalyzeCli([
        "--repo", "tests/demo/rule_transfer_variants",
        "--maxEntries", "2",
        "--incremental",
        "--incrementalCache", cachePath,
        "--outputDir", incrementalRound1,
    ]);
    runAnalyzeCli([
        "--repo", "tests/demo/rule_transfer_variants",
        "--maxEntries", "2",
        "--incremental",
        "--incrementalCache", cachePath,
        "--outputDir", incrementalRound2,
    ]);
    const cachedReport = readAnalyzeSummary<AnalyzeReport>(incrementalRound2);
    assert.ok(cachedReport.summary.semanticState, "expected mandatory semanticState summary on cached run");
    assert.strictEqual(cachedReport.summary.semanticState.enabled, true);

    console.log("test_analyze_semantic_state_mandatory=PASS");
}

if (require.main === module) {
    try {
        run();
    } catch (error) {
        console.error("test_analyze_semantic_state_mandatory=FAIL");
        console.error(error);
        process.exitCode = 1;
    }
}
