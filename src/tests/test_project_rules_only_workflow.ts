import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { generateProjectRuleScaffold } from "../cli/generate_project_rules";

interface CliOptions {
    repo: string;
    sourceDir: string;
    defaultRulePath: string;
    projectRulePath: string;
    outputDir: string;
    k: number;
    maxEntries: number;
    threshold: number;
}

interface AnalyzeReport {
    summary: {
        totalEntries: number;
        withFlows: number;
    };
    entries: Array<{
        flowCount: number;
    }>;
}

function parseArgs(argv: string[]): CliOptions {
    let repo = "tmp/phase43/repos/wanharmony";
    let sourceDir = "entry/src/main/ets";
    let defaultRulePath = "rules/default.rules.json";
    let projectRulePath = "tests/rules/real_project/wanharmony.project.rules.json";
    let outputDir = "tmp/phase54d/project_rules_only_workflow";
    let k = 1;
    let maxEntries = 12;
    let threshold = 0.2;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--repo" && i + 1 < argv.length) {
            repo = argv[++i];
            continue;
        }
        if (arg.startsWith("--repo=")) {
            repo = arg.slice("--repo=".length);
            continue;
        }
        if (arg === "--sourceDir" && i + 1 < argv.length) {
            sourceDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--sourceDir=")) {
            sourceDir = arg.slice("--sourceDir=".length);
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
        if (arg === "--project" && i + 1 < argv.length) {
            projectRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--project=")) {
            projectRulePath = arg.slice("--project=".length);
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
        if (arg === "--threshold" && i + 1 < argv.length) {
            threshold = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--threshold=")) {
            threshold = Number(arg.slice("--threshold=".length));
            continue;
        }
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}`);
    }
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
        throw new Error(`Invalid --maxEntries value: ${maxEntries}`);
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error(`Invalid --threshold value: ${threshold}`);
    }

    return {
        repo: path.resolve(repo),
        sourceDir,
        defaultRulePath: path.resolve(defaultRulePath),
        projectRulePath: path.resolve(projectRulePath),
        outputDir: path.resolve(outputDir),
        k,
        maxEntries: Math.floor(maxEntries),
        threshold,
    };
}

function runAnalyze(options: CliOptions, outputDir: string, projectRulePath?: string): string {
    const analyzeCli = path.resolve("out/cli/analyze.js");
    const args = [
        analyzeCli,
        "--repo", options.repo,
        "--sourceDir", options.sourceDir,
        "--default", options.defaultRulePath,
        "--profile", "default",
        "--k", String(options.k),
        "--maxEntries", String(options.maxEntries),
        "--outputDir", outputDir,
    ];
    if (projectRulePath) {
        args.push("--project", projectRulePath);
    }

    const proc = spawnSync(process.execPath, args, { stdio: "pipe", encoding: "utf-8" });
    if (proc.status !== 0) {
        throw new Error(
            `Analyze failed (status=${proc.status}): ${proc.stderr || proc.stdout || "no output"}`
        );
    }
    return path.resolve(outputDir, "summary.json");
}

function readAnalyzeReport(summaryPath: string): AnalyzeReport {
    if (!fs.existsSync(summaryPath)) {
        throw new Error(`summary file not found: ${summaryPath}`);
    }
    return JSON.parse(fs.readFileSync(summaryPath, "utf-8")) as AnalyzeReport;
}

function countUnknown(entries: Array<{ flowCount: number }>): number {
    return entries.filter(e => (e.flowCount || 0) <= 0).length;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.repo)) {
        throw new Error(`repo path not found: ${options.repo}`);
    }
    if (!fs.existsSync(options.defaultRulePath)) {
        throw new Error(`default rule path not found: ${options.defaultRulePath}`);
    }
    if (!fs.existsSync(options.projectRulePath)) {
        throw new Error(`project rule path not found: ${options.projectRulePath}`);
    }

    const baselineDir = path.join(options.outputDir, "baseline");
    const withProjectDir = path.join(options.outputDir, "with_project");
    const generatedRulePath = path.join(options.outputDir, "generated.project.rules.json");
    const manualRulePath = path.join(options.outputDir, "manual.project.rules.json");
    fs.mkdirSync(options.outputDir, { recursive: true });

    // Step 1: Auto-generate candidate project rules.
    const generated = generateProjectRuleScaffold({
        repo: options.repo,
        sourceDirs: [options.sourceDir],
        output: generatedRulePath,
        maxEntries: 12,
        maxSinks: 20,
        maxTransfers: 24,
        entryHints: [],
        includePaths: [],
        excludePaths: [],
        enableCandidates: false,
    });

    // Step 2: Simulate manual rule refinement by replacing generated candidate with curated project rules.
    fs.copyFileSync(options.projectRulePath, manualRulePath);

    // Step 3: Run analyze with and without project rules and compare effect.
    const baselineSummaryPath = runAnalyze(options, baselineDir);
    const withProjectSummaryPath = runAnalyze(options, withProjectDir, manualRulePath);
    const baseline = readAnalyzeReport(baselineSummaryPath);
    const withProject = readAnalyzeReport(withProjectSummaryPath);

    const baselineUnknown = countUnknown(baseline.entries || []);
    const withProjectUnknown = countUnknown(withProject.entries || []);
    const unknownDelta = baselineUnknown - withProjectUnknown;
    const unknownReduction = baselineUnknown > 0 ? unknownDelta / baselineUnknown : 0;
    const baselineFlows = baseline.summary?.withFlows || 0;
    const withProjectFlows = withProject.summary?.withFlows || 0;
    const flowDelta = withProjectFlows - baselineFlows;

    console.log("====== Project Rules Only Workflow Test ======");
    console.log("workflow_steps=3");
    console.log("step1=generate_project_rules_candidate");
    console.log("step2=manual_edit_rules_only");
    console.log("step3=analyze_with_project_rules");
    console.log(`generated_sources=${generated.stats.sourceCandidates}`);
    console.log(`generated_sinks=${generated.stats.sinkCandidates}`);
    console.log(`generated_transfers=${generated.stats.transferCandidates}`);
    console.log(`baseline_with_flows=${baselineFlows}`);
    console.log(`with_project_with_flows=${withProjectFlows}`);
    console.log(`flow_delta=${flowDelta}`);
    console.log(`baseline_unknown=${baselineUnknown}`);
    console.log(`with_project_unknown=${withProjectUnknown}`);
    console.log(`unknown_relative_reduction=${unknownReduction.toFixed(4)}`);
    console.log(`threshold=${options.threshold}`);
    console.log(`baseline_summary=${baselineSummaryPath}`);
    console.log(`with_project_summary=${withProjectSummaryPath}`);

    if (flowDelta <= 0) {
        throw new Error(`Expected with_project flow count improvement, got flow_delta=${flowDelta}`);
    }
    if (unknownReduction < options.threshold) {
        throw new Error(
            `Expected unknown reduction >= ${options.threshold}, got ${unknownReduction.toFixed(4)}`
        );
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

