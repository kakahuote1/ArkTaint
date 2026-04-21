import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import {
    createTestProgressReporter,
    printTestConsoleSummary,
    resolveTestOutputLayout,
    TestFailureSummary,
    TestOutputMetadata,
    writeTestSummary,
} from "../helpers/TestOutputContract";

interface StepResult {
    name: string;
    command: string;
    exitCode: number;
    success: boolean;
    durationMs: number;
    stdout: string;
    stderr: string;
}

interface StepSpec {
    name: string;
    args: string[];
}

interface ManifestMetrics {
    total?: number;
    passed?: number;
    failed?: number;
    listed?: number;
    skippedNoEntry?: number;
    skippedNoBody?: number;
    skippedNoSeed?: number;
    skippedException?: number;
}

interface MetamorphicMetrics {
    reportPath: string;
    consistentCount?: number;
    inconsistentCount?: number;
    sourceAnalyzeFailures?: number;
    mutatedAnalyzeFailures?: number;
    sourceBaselineMismatchCount?: number;
    pairCount?: number;
}

interface SmokeMetrics {
    reportPath: string;
    totalProjects?: number;
    totalAnalyzedEntries?: number;
    totalEntriesWithSeeds?: number;
    totalEntriesWithFlows?: number;
    totalFlows?: number;
    fatalProjectCount?: number;
    mainNoSeedCount?: number;
    mainTotalEntries?: number;
    mainNoSeedRate?: number;
}

interface GeneralizationReport {
    generatedAt: string;
    dateTag: string;
    overallSuccess: boolean;
    gate: {
        devPassed: boolean;
        holdoutPassed: boolean;
        metamorphicPassed: boolean;
        smokeFatalZero: boolean;
        smokeMainNoSeedLe20: boolean;
    };
    steps: StepResult[];
    metrics: {
        dev: ManifestMetrics;
        holdout: ManifestMetrics;
        metamorphic: Record<string, MetamorphicMetrics>;
        smoke: SmokeMetrics;
    };
    artifacts: {
        json: string;
        markdown: string;
    };
}

function toDateTag(): string {
    return new Date().toISOString().slice(0, 10);
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function readJson<T>(filePath: string): T | undefined {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) return undefined;
    const raw = fs.readFileSync(abs, "utf-8").replace(/^\uFEFF/, "");
    return JSON.parse(raw) as T;
}

function runNodeStep(step: StepSpec): StepResult {
    const executable = process.execPath;
    const fullArgs = step.args;
    const command = `${executable} ${fullArgs.join(" ")}`;
    const t0 = Date.now();
    const proc = spawnSync(executable, fullArgs, {
        encoding: "utf-8",
        stdio: "pipe",
    });
    const durationMs = Date.now() - t0;
    const stdout = proc.stdout || "";
    const stderr = proc.stderr || "";
    const exitCode = proc.status ?? 1;
    const success = exitCode === 0;

    console.log(`\n===== STEP: ${step.name} =====`);
    console.log(`command: ${command}`);
    console.log(`exitCode: ${exitCode}, durationMs: ${durationMs}`);
    if (stdout.trim()) {
        console.log(stdout.trimEnd());
    }
    if (stderr.trim()) {
        console.log(stderr.trimEnd());
    }
    if (proc.error) {
        console.log(String(proc.error));
    }

    return {
        name: step.name,
        command,
        exitCode,
        success,
        durationMs,
        stdout,
        stderr,
    };
}

function pickNumber(output: string, pattern: RegExp): number | undefined {
    const m = output.match(pattern);
    if (!m || !m[1]) return undefined;
    const value = Number(m[1]);
    return Number.isFinite(value) ? value : undefined;
}

function parseManifestMetrics(output: string): ManifestMetrics {
    return {
        total: pickNumber(output, /TOTAL\s+\|\s+Total:\s+(\d+)/m),
        passed: pickNumber(output, /TOTAL\s+\|\s+Total:\s+\d+\s+\|\s+Passed:\s+(\d+)/m),
        failed: pickNumber(output, /TOTAL\s+\|\s+Total:\s+\d+\s+\|\s+Passed:\s+\d+\s+\|\s+Failed:\s+(\d+)/m),
        listed: pickNumber(output, /listed cases:\s+(\d+)/m),
        skippedNoEntry: pickNumber(output, /skipped\(no entry\):\s+(\d+)/m),
        skippedNoBody: pickNumber(output, /skipped\(no body\):\s+(\d+)/m),
        skippedNoSeed: pickNumber(output, /skipped\(no seed\):\s+(\d+)/m),
        skippedException: pickNumber(output, /skipped\(exception\):\s+(\d+)/m),
    };
}

function readMetamorphicMetrics(reportPath: string): MetamorphicMetrics {
    const report = readJson<any>(reportPath);
    return {
        reportPath: path.resolve(reportPath),
        consistentCount: report?.consistentCount,
        inconsistentCount: report?.inconsistentCount,
        sourceAnalyzeFailures: report?.sourceAnalyzeFailures,
        mutatedAnalyzeFailures: report?.mutatedAnalyzeFailures,
        sourceBaselineMismatchCount: report?.sourceBaselineMismatchCount,
        pairCount: report?.pairCount,
    };
}

function readSmokeMetrics(reportPath: string): SmokeMetrics {
    const report = readJson<any>(reportPath);
    if (!report) {
        return { reportPath: path.resolve(reportPath) };
    }

    const mainProjects = (report.projects || []).filter((p: any) => p.priority === "main");
    let mainTotalEntries = 0;
    let mainNoSeedCount = 0;
    for (const project of mainProjects) {
        const entries = project.entries || [];
        mainTotalEntries += entries.length;
        mainNoSeedCount += entries.filter((e: any) => e.status === "no_seed").length;
    }
    const mainNoSeedRate = mainTotalEntries > 0 ? mainNoSeedCount / mainTotalEntries : undefined;

    return {
        reportPath: path.resolve(reportPath),
        totalProjects: report.totalProjects,
        totalAnalyzedEntries: report.totalAnalyzedEntries,
        totalEntriesWithSeeds: report.totalEntriesWithSeeds,
        totalEntriesWithFlows: report.totalEntriesWithFlows,
        totalFlows: report.totalFlows,
        fatalProjectCount: report.fatalProjectCount,
        mainNoSeedCount,
        mainTotalEntries,
        mainNoSeedRate,
    };
}

function renderMarkdown(report: GeneralizationReport): string {
    const lines: string[] = [];
    lines.push("# Generalization Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- overallSuccess: ${report.overallSuccess}`);
    lines.push("");
    lines.push("## Gate");
    lines.push("");
    lines.push(`- devPassed: ${report.gate.devPassed}`);
    lines.push(`- holdoutPassed: ${report.gate.holdoutPassed}`);
    lines.push(`- metamorphicPassed: ${report.gate.metamorphicPassed}`);
    lines.push(`- smokeFatalZero: ${report.gate.smokeFatalZero}`);
    lines.push(`- smokeMainNoSeedLe20: ${report.gate.smokeMainNoSeedLe20}`);
    lines.push("");
    lines.push("## Metrics");
    lines.push("");
    lines.push(`- dev: ${JSON.stringify(report.metrics.dev)}`);
    lines.push(`- holdout: ${JSON.stringify(report.metrics.holdout)}`);
    lines.push(`- metamorphic: ${JSON.stringify(report.metrics.metamorphic)}`);
    lines.push(`- smoke: ${JSON.stringify(report.metrics.smoke)}`);
    lines.push("");
    lines.push("## Steps");
    lines.push("");
    for (const step of report.steps) {
        lines.push(`- ${step.name}: success=${step.success}, exitCode=${step.exitCode}, durationMs=${step.durationMs}`);
    }
    lines.push("");
    return lines.join("\n");
}

function passedByManifest(metrics: ManifestMetrics): boolean {
    return (metrics.failed ?? 1) === 0;
}

function passedByMetamorphic(metrics: Record<string, MetamorphicMetrics>): boolean {
    const keys = Object.keys(metrics);
    if (keys.length === 0) return false;
    return keys.every(key => (metrics[key].inconsistentCount ?? 1) === 0);
}

async function main(): Promise<void> {
    const dateTag = toDateTag();
    const outputDir = path.resolve("tmp/test_runs/generalization/verify_generalization/latest");
    ensureDir(outputDir);
    const outputLayout = resolveTestOutputLayout(outputDir);
    ensureDir(outputLayout.rootDir);
    const metadata: TestOutputMetadata = {
        suite: "verify_generalization",
        domain: "compare",
        title: "Generalization Verification",
        purpose: "Run the dev, holdout, metamorphic, and smoke lanes together as a generalization gate.",
    };

    const stepSpecs: StepSpec[] = [
        {
            name: "test:dev",
            args: ["out/tests/datasets/test_dataset_by_manifest.js", "--manifest", "tests/manifests/datasets/dev.list", "--k", "1"],
        },
        {
            name: "test:holdout",
            args: ["out/tests/datasets/test_dataset_by_manifest.js", "--manifest", "tests/manifests/datasets/holdout.list", "--k", "1"],
        },
        {
            name: "test:metamorphic",
            args: ["out/tests/metamorphic/test_metamorphic.js", "--manifest", "tests/manifests/metamorphic/metamorphic_seed.list", "--k", "1"],
        },
        {
            name: "test:metamorphic:v2",
            args: [
                "out/tests/metamorphic/test_metamorphic_v2.js",
                "--manifest",
                "tests/manifests/metamorphic/metamorphic_seed_v2.list",
                "--sourceDir",
                "tests/demo/metamorphic_seed_v2",
                "--k",
                "1",
            ],
        },
        {
            name: "test:metamorphic:v3",
            args: [
                "out/tests/metamorphic/test_metamorphic_v3.js",
                "--manifest",
                "tests/manifests/metamorphic/metamorphic_seed_v3.list",
                "--sourceDir",
                "tests/demo/metamorphic_seed_v2",
                "--k",
                "1",
            ],
        },
        {
            name: "test:smoke",
            args: [
                "out/tests/real_projects/test_real_project_smoke.js",
                "--manifest",
                "tests/manifests/real_projects/smoke_projects.json",
                "--k",
                "1",
                "--maxEntries",
                "12",
            ],
        },
    ];

    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const progressReporter = createTestProgressReporter(outputLayout, metadata, stepSpecs.length, {
        logEveryCount: 1,
        logEveryPercent: 10,
    });
    const steps: StepResult[] = [];
    for (let index = 0; index < stepSpecs.length; index++) {
        const step = stepSpecs[index];
        progressReporter.update(index, step.name, "stage=start");
        steps.push(runNodeStep(step));
        progressReporter.update(index + 1, step.name, "stage=done");
    }

    const stepByName = new Map(steps.map(s => [s.name, s]));
    const devMetrics = parseManifestMetrics(stepByName.get("test:dev")?.stdout || "");
    const holdoutMetrics = parseManifestMetrics(stepByName.get("test:holdout")?.stdout || "");
    const metamorphicMetrics: Record<string, MetamorphicMetrics> = {
        v1: readMetamorphicMetrics("tmp/test_runs/metamorphic/seed_v1/latest/metamorphic_report.json"),
        v2: readMetamorphicMetrics("tmp/test_runs/metamorphic/seed_v2/latest/metamorphic_report.json"),
        v3: readMetamorphicMetrics("tmp/test_runs/metamorphic/seed_v3/latest/metamorphic_report.json"),
    };
    const smokeMetrics = readSmokeMetrics("tmp/test_runs/real_projects/smoke/latest/smoke_report.json");

    const gate = {
        devPassed: stepByName.get("test:dev")?.success === true && passedByManifest(devMetrics),
        holdoutPassed: stepByName.get("test:holdout")?.success === true && passedByManifest(holdoutMetrics),
        metamorphicPassed:
            stepByName.get("test:metamorphic")?.success === true
            && stepByName.get("test:metamorphic:v2")?.success === true
            && stepByName.get("test:metamorphic:v3")?.success === true
            && passedByMetamorphic(metamorphicMetrics),
        smokeFatalZero:
            stepByName.get("test:smoke")?.success === true
            && (smokeMetrics.fatalProjectCount ?? 1) === 0,
        smokeMainNoSeedLe20:
            stepByName.get("test:smoke")?.success === true
            && (smokeMetrics.mainNoSeedRate ?? 1) <= 0.2,
    };

    const overallSuccess = gate.devPassed
        && gate.holdoutPassed
        && gate.metamorphicPassed
        && gate.smokeFatalZero
        && gate.smokeMainNoSeedLe20;

    const jsonPath = path.resolve(outputDir, `generalization_report_${dateTag}.json`);
    const mdPath = path.resolve(outputDir, `generalization_report_${dateTag}.md`);
    const report: GeneralizationReport = {
        generatedAt: new Date().toISOString(),
        dateTag,
        overallSuccess,
        gate,
        steps,
        metrics: {
            dev: devMetrics,
            holdout: holdoutMetrics,
            metamorphic: metamorphicMetrics,
            smoke: smokeMetrics,
        },
        artifacts: {
            json: jsonPath,
            markdown: mdPath,
        },
    };

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderMarkdown(report), "utf-8");
    fs.writeFileSync(outputLayout.reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(outputLayout.reportMarkdownPath, renderMarkdown(report), "utf-8");
    progressReporter.finish("DONE", "stage=all_steps");

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;
    const failureItems: TestFailureSummary[] = [];
    if (!gate.devPassed) {
        failureItems.push({
            name: "dev_gate",
            expected: "pass",
            actual: "fail",
            reason: "Development dataset gate did not pass.",
            severity: "high",
        });
    }
    if (!gate.holdoutPassed) {
        failureItems.push({
            name: "holdout_gate",
            expected: "pass",
            actual: "fail",
            reason: "Holdout dataset gate did not pass.",
            severity: "high",
        });
    }
    if (!gate.metamorphicPassed) {
        failureItems.push({
            name: "metamorphic_gate",
            expected: "pass",
            actual: "fail",
            reason: "At least one metamorphic lane reported inconsistencies or execution failure.",
            severity: "high",
        });
    }
    if (!gate.smokeFatalZero) {
        failureItems.push({
            name: "smoke_fatal_zero",
            expected: "fatal_projects=0",
            actual: `fatal_projects=${smokeMetrics.fatalProjectCount ?? "unknown"}`,
            reason: "Real-project smoke reported fatal project failures.",
            severity: "medium",
        });
    }
    if (!gate.smokeMainNoSeedLe20) {
        failureItems.push({
            name: "smoke_main_no_seed_le20",
            expected: "main_no_seed_rate<=0.2",
            actual: `main_no_seed_rate=${smokeMetrics.mainNoSeedRate ?? "unknown"}`,
            reason: "Real-project smoke main-project no-seed rate exceeded the configured threshold.",
            severity: "medium",
        });
    }
    writeTestSummary(outputLayout, metadata, {
        status: overallSuccess ? "pass" : "fail",
        verdict: overallSuccess
            ? "Generalization gate passed across all tracked lanes."
            : "Generalization gate failed; inspect gate fields and step reports.",
        startedAt,
        finishedAt,
        durationMs,
        totals: {
            overall_success: overallSuccess,
            gate_dev: gate.devPassed,
            gate_holdout: gate.holdoutPassed,
            gate_metamorphic: gate.metamorphicPassed,
            gate_smoke_fatal_zero: gate.smokeFatalZero,
            gate_smoke_main_no_seed_le20: gate.smokeMainNoSeedLe20,
            step_count: steps.length,
        },
        highlights: steps.map(step => `${step.name}: success=${step.success}, exitCode=${step.exitCode}, durationMs=${step.durationMs}`),
        failures: failureItems,
        notes: [
            `dated_json=${jsonPath}`,
            `dated_md=${mdPath}`,
        ],
    });
    printTestConsoleSummary(metadata, outputLayout, {
        status: overallSuccess ? "pass" : "fail",
        verdict: overallSuccess
            ? "Generalization gate passed across all tracked lanes."
            : "Generalization gate failed; inspect summary/report artifacts.",
        startedAt,
        finishedAt,
        durationMs,
        totals: {
            overall_success: overallSuccess,
            gate_dev: gate.devPassed,
            gate_holdout: gate.holdoutPassed,
            gate_metamorphic: gate.metamorphicPassed,
            gate_smoke_fatal_zero: gate.smokeFatalZero,
            gate_smoke_main_no_seed_le20: gate.smokeMainNoSeedLe20,
        },
        highlights: [],
        failures: failureItems,
    });

    if (!overallSuccess) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});


