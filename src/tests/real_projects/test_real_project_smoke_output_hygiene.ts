import * as assert from "assert";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { aggregateReport, projectFatalReasons } from "../helpers/SmokeReportUtils";
import { CliOptions, ProjectSmokeResult } from "../helpers/SmokeTypes";

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath: string, value: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function readJson(filePath: string): any {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function assertDoesNotContain(filePath: string, needle: string): void {
    if (!fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, "utf-8");
    assert.ok(!text.includes(needle), `${filePath} still contains stale marker ${needle}`);
}

function assertEntryExceptionIsFatal(): void {
    const options: CliOptions = {
        manifestPath: "entry_exception_probe.json",
        k: 1,
        maxEntries: 1,
        outputDir: "tmp/test_runs/real_projects/output_hygiene_probe/entry_exception",
    };
    const project: ProjectSmokeResult = {
        id: "entry_exception_project",
        repoPath: "tmp/test_runs/real_projects/output_hygiene_probe/repo",
        tags: [],
        sourceDirs: ["entry/src/main/ets"],
        sourceSummaries: [],
        entries: [{
            sourceDir: "entry/src/main/ets",
            entryName: "MainAbility",
            entryPathHint: "entry/src/main/ets/MainAbility.ets",
            signature: "MainAbility",
            score: 100,
            status: "exception",
            seedLocalNames: [],
            seedStrategies: [],
            seedCount: 0,
            flowCount: 0,
            flowRuleTraces: [],
            sinkRuleHits: {},
            sinkFamilyHits: {},
            sinkEndpointHits: {},
            sinkFlowByKeyword: {},
            sinkFlowBySignature: {},
            sinkSamples: [],
            error: "receiver_field_bridge_map exceeded 5000ms",
            elapsedMs: 5000,
        }],
        sinkSignatures: [],
        analyzed: 1,
        withSeeds: 0,
        withFlows: 0,
        totalFlows: 0,
        sinkRuleHits: {},
        sinkFamilyHits: {},
        sinkEndpointHits: {},
        sinkFlowByKeyword: {},
        sinkFlowBySignature: {},
        fatalErrors: [],
    };

    const report = aggregateReport(options, [project]);
    const fatalReasons = projectFatalReasons(project);
    assert.strictEqual(report.fatalProjectCount, 1, "entry exception must make the project fatal");
    assert.ok(fatalReasons.some(reason => reason.includes("receiver_field_bridge_map")), "fatal reason should preserve entry error detail");
}

function main(): void {
    assertEntryExceptionIsFatal();

    const outputDir = path.resolve("tmp/test_runs/real_projects/output_hygiene_probe/latest");
    const manifestPath = path.resolve("tmp/test_runs/real_projects/output_hygiene_probe/manifest.json");
    const staleMarker = "STALE_SUCCESS_MARKER";

    fs.rmSync(path.resolve("tmp/test_runs/real_projects/output_hygiene_probe"), { recursive: true, force: true });
    ensureDir(outputDir);
    writeJson(path.join(outputDir, "summary.json"), { status: "pass", staleMarker });
    writeJson(path.join(outputDir, "report.json"), { totalProjects: 1, fatalProjectCount: 0, staleMarker });
    fs.writeFileSync(path.join(outputDir, "summary.md"), staleMarker, "utf-8");
    fs.writeFileSync(path.join(outputDir, "report.md"), staleMarker, "utf-8");
    writeJson(path.join(outputDir, "old_project", "summary", "summary.json"), { status: "pass", staleMarker });

    writeJson(manifestPath, {
        projects: [
            {
                id: "missing_repo_project",
                enabled: true,
                repoPath: "tmp/test_runs/real_projects/output_hygiene_probe/does_not_exist",
                sourceDirs: ["entry/src/main/ets"],
                llmTimeoutMs: 2222,
                llmConnectTimeoutMs: 333,
            },
        ],
    });

    const scriptPath = path.resolve("out/tests/real_projects/test_real_project_smoke.js");
    const child = spawnSync(process.execPath, [
        scriptPath,
        "--manifest",
        manifestPath,
        "--outputDir",
        outputDir,
        "--k",
        "1",
        "--maxEntries",
        "1",
        "--autoModelProject",
        "missing_repo_project",
        "--llmTimeoutMs",
        "1111",
        "--llmConnectTimeoutMs=222",
    ], {
        cwd: path.resolve("."),
        encoding: "utf-8",
    });

    assert.notStrictEqual(child.status, 0, "missing repo smoke run should fail");
    assert.ok(fs.existsSync(path.join(outputDir, "progress.json")), "progress.json should be written by current run");
    assert.ok(fs.existsSync(path.join(outputDir, "summary.json")), "summary.json should be written by current run");
    assert.ok(fs.existsSync(path.join(outputDir, "report.json")), "report.json should be written by current run");
    assert.ok(!fs.existsSync(path.join(outputDir, "old_project")), "managed output cleanup should remove stale project directories");

    const summary = readJson(path.join(outputDir, "summary.json"));
    const report = readJson(path.join(outputDir, "report.json"));
    assert.strictEqual(summary.status, "fail", "current failing run must not leave stale pass summary");
    assert.strictEqual(report.fatalProjectCount, 1, "current report should describe the current missing repo failure");
    assert.strictEqual(report.projects?.[0]?.autoModel, true, "autoModelProject option should be represented in smoke report without invoking LLM for missing repos");
    assert.strictEqual(report.options?.llmTimeoutMs, 1111, "smoke CLI should parse the global LLM timeout bound");
    assert.strictEqual(report.options?.llmConnectTimeoutMs, 222, "smoke CLI should parse the global LLM connect-timeout bound");
    assert.strictEqual(report.projects?.[0]?.effectiveLlmTimeoutMs, 2222, "project manifest should override the global LLM timeout bound");
    assert.strictEqual(report.projects?.[0]?.effectiveLlmConnectTimeoutMs, 333, "project manifest should override the global LLM connect-timeout bound");
    assert.strictEqual(report.projects?.[0]?.effectiveWorklistBudgetMs, 45000, "real-project smoke should expose the bounded default worklist budget");
    assert.strictEqual(report.projects?.[0]?.effectiveModuleSetupBudgetMs, 30000, "real-project smoke should expose the bounded default module setup budget");
    assert.strictEqual(report.projects?.[0]?.effectiveExecutionHandoffBudgetMs, 30000, "real-project smoke should expose the bounded default execution handoff budget");
    assert.strictEqual(report.projects?.[0]?.effectivePagIndexBudgetMs, 30000, "real-project smoke should expose the bounded default PAG index budget");
    assert.strictEqual(report.projects?.[0]?.effectiveLazyMaterializerBudgetMs, 30000, "real-project smoke should expose the bounded default lazy materializer budget");
    assert.strictEqual(report.projects?.[0]?.effectiveReachableBudgetMs, 30000, "real-project smoke should expose the bounded default reachable budget");

    for (const artifact of [
        "summary.json",
        "report.json",
        "summary.md",
        "report.md",
        "smoke_report.json",
        "smoke_report.md",
    ]) {
        assertDoesNotContain(path.join(outputDir, artifact), staleMarker);
    }

    console.log("[real_project_smoke_output_hygiene] ok");
}

main();
