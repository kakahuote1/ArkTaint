import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { createFormalTestSuite } from "../helpers/TestOutputContract";

function main(): void {
    const outputDir = path.resolve("tmp/test_runs/runtime/formal_test_suite_helper/latest");
    fs.rmSync(outputDir, { recursive: true, force: true });

    const suite = createFormalTestSuite(outputDir, {
        suite: "formal_test_suite_helper",
        domain: "runtime",
        title: "Formal Test Suite Helper",
        purpose: "Verify the high-level formal suite helper writes the standard output layout and progress artifacts.",
    });

    const progress = suite.createProgress(3, {
        logEveryCount: 1,
        logEveryPercent: 50,
    });
    progress.update(1, "prepare", "step=prepare");
    progress.update(2, "run", "step=run");

    const report = {
        generatedAt: new Date().toISOString(),
        checks: ["progress", "report", "summary"],
        pass: true,
    };
    suite.writeReport(report, "# Formal Test Suite Helper\n\n- status: pass");
    progress.finish("DONE", "step=done");

    suite.finish({
        status: "pass",
        verdict: "Formal test suite helper produced the expected standard artifacts.",
        totals: {
            checks: report.checks.length,
            pass: report.pass,
        },
        highlights: [
            "progress artifacts were written",
            "report artifacts were written",
            "summary and run artifacts were written",
        ],
    });

    const summaryPath = path.join(outputDir, "summary.json");
    const runPath = path.join(outputDir, "run.json");
    const reportJsonPath = path.join(outputDir, "report.json");
    const reportMdPath = path.join(outputDir, "report.md");
    const progressJsonPath = path.join(outputDir, "progress.json");
    const progressMdPath = path.join(outputDir, "progress.md");

    for (const artifactPath of [summaryPath, runPath, reportJsonPath, reportMdPath, progressJsonPath, progressMdPath]) {
        assert.ok(fs.existsSync(artifactPath), `expected artifact to exist: ${artifactPath}`);
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    assert.ok(summary.status === "pass", "summary status should be pass");
    assert.ok(summary.verdict.includes("expected standard artifacts"), "summary verdict should describe helper result");
    assert.ok(summary.artifacts.reportJson === "report.json", "summary should point to standard report.json");
    assert.ok(summary.artifacts.progressJson === "progress.json", "summary should point to standard progress.json");

    const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
    assert.ok(run.status === "pass", "run.json status should be pass");
    assert.ok(run.summaryJson === "summary.json", "run.json should point to summary.json");

    const progressSnapshot = JSON.parse(fs.readFileSync(progressJsonPath, "utf8"));
    assert.ok(progressSnapshot.status === "done", "progress snapshot should be marked done");
    assert.ok(progressSnapshot.currentStep === 3, "progress snapshot should finish at total steps");

    console.log("PASS test_formal_test_suite_helper");
}

main();
