import * as fs from "fs";
import * as path from "path";
import { ChildProcess, spawn } from "child_process";
import { discoverArkTsSourceDirs } from "../cli/sourceDiscovery";

type SourceDirMode = "project" | "split" | "auto";

interface Options {
    projectRoot: string;
    outputDir: string;
    projects: string[];
    maxProjects: number;
    projectTimeoutSeconds: number;
    heartbeatSeconds: number;
    autoModel: boolean;
    llmProfile: string;
    llmModel: string;
    llmTimeoutMs: number;
    llmMaxAttempts: number;
    llmMaxFailures: number;
    llmRepairAttempts: number;
    llmSessionCacheDir: string;
    llmSessionCacheMode: string;
    maxLlmItems: number;
    concurrency: number;
    reportMode: string;
    entryModel: string;
    maxEntries: number;
    worklistBudgetMs: number;
    noIncremental: boolean;
    skipExisting: boolean;
    resumeRecorded: boolean;
    sourceDirMode: SourceDirMode;
    splitSourceDirThreshold: number;
    sourceDirTimeoutSeconds: number;
    maxSplitSourceDirs: number;
    projectRetries: number;
}

interface ProjectRecord {
    project: string;
    repo: string;
    sourceDirs: string[];
    status: string;
    exitCode: number | null;
    elapsedMs: number;
    timeoutSeconds: number;
    outputDir: string;
    summaryJson: string;
    sourceRunsJson: string;
    totalEntries: number | null;
    okEntries: number | null;
    totalFlows: number | null;
    analysisExceptionCount: number | null;
    analysisBudgetExceededCount: number | null;
    semanticFlowItems: number | null;
    semanticFlowRuleCandidates: number | null;
    semanticFlowModeledArtifacts: number | null;
    semanticFlowNeedHumanCheck: number | null;
    semanticFlowUnresolved: number | null;
    error: string;
    executionMode?: string;
    completedSourceDirs?: number;
    failedSourceDirs?: number;
}

const DEFAULT_OUTPUT_DIR = path.resolve(
    "tmp",
    "test_runs",
    "real_pipeline_batch",
    new Date().toISOString().replace(/[:.]/g, "-"),
);

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        projectRoot: path.resolve("..", "project"),
        outputDir: DEFAULT_OUTPUT_DIR,
        projects: [],
        maxProjects: 0,
        projectTimeoutSeconds: 480,
        heartbeatSeconds: 30,
        autoModel: false,
        llmProfile: "",
        llmModel: "",
        llmTimeoutMs: 60000,
        llmMaxAttempts: 1,
        llmMaxFailures: 3,
        llmRepairAttempts: 0,
        llmSessionCacheDir: "",
        llmSessionCacheMode: "rw",
        maxLlmItems: 12,
        concurrency: 1,
        reportMode: "light",
        entryModel: "arkMain",
        maxEntries: 9999,
        worklistBudgetMs: 45000,
        noIncremental: true,
        skipExisting: false,
        resumeRecorded: true,
        sourceDirMode: "auto",
        splitSourceDirThreshold: 24,
        sourceDirTimeoutSeconds: 120,
        maxSplitSourceDirs: 0,
        projectRetries: 1,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = (): string => {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error(`missing value for ${arg}`);
            }
            return value;
        };
        switch (arg) {
            case "--projectRoot":
                opts.projectRoot = path.resolve(next());
                break;
            case "--outputDir":
                opts.outputDir = path.resolve(next());
                break;
            case "--projects":
                opts.projects = next().split(",").map(item => item.trim()).filter(Boolean);
                break;
            case "--maxProjects":
                opts.maxProjects = parsePositiveInt(next(), arg);
                break;
            case "--projectTimeoutSeconds":
                opts.projectTimeoutSeconds = parsePositiveInt(next(), arg);
                break;
            case "--heartbeatSeconds":
                opts.heartbeatSeconds = parsePositiveInt(next(), arg);
                break;
            case "--autoModel":
                opts.autoModel = true;
                break;
            case "--llmProfile":
                opts.llmProfile = next();
                break;
            case "--model":
                opts.llmModel = next();
                break;
            case "--llmTimeoutMs":
                opts.llmTimeoutMs = parsePositiveInt(next(), arg);
                break;
            case "--llmMaxAttempts":
                opts.llmMaxAttempts = parsePositiveInt(next(), arg);
                break;
            case "--llmMaxFailures":
                opts.llmMaxFailures = parsePositiveInt(next(), arg);
                break;
            case "--llmRepairAttempts":
                opts.llmRepairAttempts = parseNonNegativeInt(next(), arg);
                break;
            case "--llmSessionCacheDir":
                opts.llmSessionCacheDir = path.resolve(next());
                break;
            case "--llmSessionCacheMode":
                opts.llmSessionCacheMode = next();
                if (!["off", "read", "write", "rw"].includes(opts.llmSessionCacheMode)) {
                    throw new Error(`--llmSessionCacheMode must be off, read, write, or rw, got ${opts.llmSessionCacheMode}`);
                }
                break;
            case "--maxLlmItems":
                opts.maxLlmItems = parsePositiveInt(next(), arg);
                break;
            case "--concurrency":
                opts.concurrency = parsePositiveInt(next(), arg);
                break;
            case "--reportMode":
                opts.reportMode = next();
                break;
            case "--entryModel":
                opts.entryModel = next();
                if (opts.entryModel !== "arkMain" && opts.entryModel !== "explicit") {
                    throw new Error(`--entryModel must be arkMain or explicit, got ${opts.entryModel}`);
                }
                break;
            case "--maxEntries":
                opts.maxEntries = parsePositiveInt(next(), arg);
                break;
            case "--worklistBudgetMs":
            case "--worklist-budget-ms":
                opts.worklistBudgetMs = parseNonNegativeInt(next(), arg);
                break;
            case "--incremental":
                opts.noIncremental = false;
                break;
            case "--skipExisting":
                opts.skipExisting = true;
                break;
            case "--rerunRecorded":
                opts.resumeRecorded = false;
                break;
            case "--sourceDirMode":
                opts.sourceDirMode = next() as SourceDirMode;
                if (!["project", "split", "auto"].includes(opts.sourceDirMode)) {
                    throw new Error(`--sourceDirMode must be project, split, or auto, got ${opts.sourceDirMode}`);
                }
                break;
            case "--splitSourceDirThreshold":
                opts.splitSourceDirThreshold = parsePositiveInt(next(), arg);
                break;
            case "--sourceDirTimeoutSeconds":
                opts.sourceDirTimeoutSeconds = parsePositiveInt(next(), arg);
                break;
            case "--maxSplitSourceDirs":
                opts.maxSplitSourceDirs = parseNonNegativeInt(next(), arg);
                break;
            case "--projectRetries":
                opts.projectRetries = parseNonNegativeInt(next(), arg);
                break;
            case "--help":
            case "-h":
                printHelp();
                process.exit(0);
                break;
            default:
                throw new Error(`unknown argument: ${arg}`);
        }
    }

    return opts;
}

function parsePositiveInt(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer, got ${value}`);
    }
    return parsed;
}

function parseNonNegativeInt(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative integer, got ${value}`);
    }
    return parsed;
}

function printHelp(): void {
    console.log([
        "Usage: node out/tools/real_project_batch_analyze.js [options]",
        "",
        "Options:",
        "  --projectRoot <path>              Root directory containing real projects",
        "  --outputDir <path>                Output directory for batch records",
        "  --projects <a,b,c>                Project names to run",
        "  --maxProjects <n>                 Limit projects after filtering",
        "  --projectTimeoutSeconds <n>       Hard timeout per project",
        "  --heartbeatSeconds <n>            Progress heartbeat interval",
        "  --autoModel                       Run SemanticFlow before final analyze",
        "  --llmProfile <name>               LLM profile for --autoModel",
        "  --model <name>                    Override LLM model while keeping profile credentials",
        "  --llmTimeoutMs <n>                Per LLM request timeout",
        "  --llmMaxAttempts <n>              Per LLM item attempts",
        "  --llmMaxFailures <n>              Open LLM circuit after consecutive failures",
        "  --llmRepairAttempts <n>           Attempts to repair invalid LLM JSON",
        "  --llmSessionCacheDir <path>       Reuse SemanticFlow LLM item/decision cache",
        "  --llmSessionCacheMode <mode>      Cache mode: off, read, write, rw",
        "  --maxLlmItems <n>                 Max SemanticFlow LLM items per source directory",
        "  --concurrency <n>                 SemanticFlow LLM concurrency",
        "  --reportMode <full|light>         Analyze report mode",
        "  --entryModel <arkMain|explicit>   Entry model for final analyze",
        "  --maxEntries <n>                  Analyze max entries",
        "  --worklistBudgetMs <n>            Per-entry propagation budget in ms; 0 disables",
        "  --incremental                     Keep incremental mode enabled",
        "  --skipExisting                    Skip project if summary already exists",
        "  --rerunRecorded                  Re-run projects already present in batch_runs.jsonl",
        "  --sourceDirMode <project|split|auto>  Split large multi-source repos when needed",
        "  --splitSourceDirThreshold <n>      Auto-split when discovered source dirs exceed n",
        "  --sourceDirTimeoutSeconds <n>      Hard timeout per source-dir shard",
        "  --maxSplitSourceDirs <n>           Limit shards for probing; 0 means all",
        "  --projectRetries <n>               Retry no-diagnostic project crashes; default 1",
    ].join("\n"));
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    fs.mkdirSync(opts.outputDir, { recursive: true });
    const jsonlPath = path.join(opts.outputDir, "batch_runs.jsonl");
    const csvPath = path.join(opts.outputDir, "batch_summary.csv");
    const manifestPath = path.join(opts.outputDir, "batch_manifest.json");
    if (!fs.existsSync(csvPath)) {
        fs.writeFileSync(csvPath, csvHeader(), "utf-8");
    }
    const recordedProjects = readRecordedProjects(jsonlPath);
    fs.writeFileSync(manifestPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        options: opts,
        recordedProjectCount: recordedProjects.size,
    }, null, 2), "utf-8");

    const projects = listProjects(opts);
    console.log(`batch_start projects=${projects.length} outputDir=${opts.outputDir} timeout_s=${opts.projectTimeoutSeconds} autoModel=${opts.autoModel} resumeRecorded=${opts.resumeRecorded}`);

    for (let i = 0; i < projects.length; i++) {
        const project = projects[i];
        const recorded = recordedProjects.get(project);
        if (opts.resumeRecorded && recorded) {
            console.log(`[${i + 1}/${projects.length}] project=${project} skip_recorded status=${recorded.status} elapsed_ms=${recorded.elapsedMs} outputDir=${recorded.outputDir}`);
            continue;
        }
        console.log(`[${i + 1}/${projects.length}] project=${project} start`);
        const record = await runProject(project, opts);
        appendRecord(jsonlPath, csvPath, record);
        recordedProjects.set(project, record);
        console.log(`[${i + 1}/${projects.length}] project=${project} status=${record.status} elapsed_ms=${record.elapsedMs} flows=${record.totalFlows ?? ""} source_dirs=${record.sourceDirs.length}`);
    }
    console.log(`batch_done records=${jsonlPath} summary=${csvPath}`);
}

function listProjects(opts: Options): string[] {
    if (!fs.existsSync(opts.projectRoot)) {
        throw new Error(`projectRoot does not exist: ${opts.projectRoot}`);
    }
    const requested = opts.projects.length > 0
        ? opts.projects
        : fs.readdirSync(opts.projectRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort((a, b) => a.localeCompare(b));
    const existing = requested.filter(name => {
        const repo = path.join(opts.projectRoot, name);
        return fs.existsSync(repo) && fs.statSync(repo).isDirectory();
    });
    if (opts.projects.length > 0) {
        return opts.maxProjects > 0 ? existing.slice(0, opts.maxProjects) : existing;
    }
    const withSources = existing.filter(name => discoverArkTsSourceDirs(path.join(opts.projectRoot, name)).length > 0);
    return opts.maxProjects > 0 ? withSources.slice(0, opts.maxProjects) : withSources;
}

function readRecordedProjects(jsonlPath: string): Map<string, ProjectRecord> {
    const records = new Map<string, ProjectRecord>();
    if (!fs.existsSync(jsonlPath)) {
        return records;
    }
    const text = fs.readFileSync(jsonlPath, "utf-8");
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const record = JSON.parse(trimmed) as ProjectRecord;
            if (record && typeof record.project === "string" && record.project.length > 0) {
                records.set(record.project, record);
            }
        } catch {
            // Keep resume robust even if the previous run was interrupted mid-write.
        }
    }
    return records;
}

async function runProject(project: string, opts: Options): Promise<ProjectRecord> {
    let lastRecord: ProjectRecord | undefined;
    for (let attempt = 0; attempt <= opts.projectRetries; attempt++) {
        if (attempt > 0) {
            console.log(`project_retry project=${project} attempt=${attempt + 1}/${opts.projectRetries + 1} previous_status=${lastRecord?.status} previous_exit=${lastRecord?.exitCode ?? ""}`);
        }
        const record = await runProjectOnce(project, opts);
        lastRecord = record;
        if (!isRetryableProjectFailure(record)) {
            return record;
        }
    }
    return lastRecord!;
}

async function runProjectOnce(project: string, opts: Options): Promise<ProjectRecord> {
    const repo = path.join(opts.projectRoot, project);
    const sourceDirs = discoverArkTsSourceDirs(repo);
    const projectOut = path.join(opts.outputDir, "runs", safeName(project));
    const stdoutLog = path.join(projectOut, "stdout.log");
    const stderrLog = path.join(projectOut, "stderr.log");
    const summaryJson = path.join(projectOut, "summary", "summary.json");
    const sourceRunsJson = path.join(projectOut, "source_runs.json");
    fs.mkdirSync(projectOut, { recursive: true });

    if (opts.skipExisting && fs.existsSync(summaryJson)) {
        return {
            project,
            repo,
            sourceDirs,
            status: "skipped_existing",
            exitCode: 0,
            elapsedMs: 0,
            timeoutSeconds: opts.projectTimeoutSeconds,
            outputDir: projectOut,
            summaryJson,
            sourceRunsJson,
            ...readSummaryFields(summaryJson, sourceRunsJson, projectOut),
            error: "",
        };
    }

    if (sourceDirs.length === 0) {
        return {
            project,
            repo,
            sourceDirs,
            status: "skipped_no_sources",
            exitCode: null,
            elapsedMs: 0,
            timeoutSeconds: opts.projectTimeoutSeconds,
            outputDir: projectOut,
            summaryJson,
            sourceRunsJson,
            totalEntries: null,
            okEntries: null,
            totalFlows: null,
            analysisExceptionCount: null,
            analysisBudgetExceededCount: null,
            semanticFlowItems: null,
            semanticFlowRuleCandidates: null,
            semanticFlowModeledArtifacts: null,
            semanticFlowNeedHumanCheck: null,
            semanticFlowUnresolved: null,
            error: "no ArkTS source directories discovered",
        };
    }

    if (shouldSplitSourceDirs(sourceDirs, opts)) {
        console.log(`project_split_mode project=${project} source_dirs=${sourceDirs.length} threshold=${opts.splitSourceDirThreshold} shard_timeout_s=${opts.sourceDirTimeoutSeconds}`);
        return runProjectBySourceDir(project, repo, sourceDirs, projectOut, opts);
    }

    const args = buildAnalyzeArgs(repo, projectOut, opts);
    const started = Date.now();
    const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });
    const stdout = fs.createWriteStream(stdoutLog, { flags: "w" });
    const stderr = fs.createWriteStream(stderrLog, { flags: "w" });
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);

    const result = await waitForChild(child, opts.projectTimeoutSeconds * 1000, {
        heartbeatMs: opts.heartbeatSeconds * 1000,
        label: project,
        stdoutLog,
        stderrLog,
    });
    stdout.end();
    stderr.end();
    const elapsedMs = Date.now() - started;
    const summaryFields = readSummaryFields(summaryJson, sourceRunsJson, projectOut);
    const status = resolveProjectStatus(result.timedOut, result.exitCode, opts, summaryFields);
    return {
        project,
        repo,
        sourceDirs,
        status,
        exitCode: result.exitCode,
        elapsedMs,
        timeoutSeconds: opts.projectTimeoutSeconds,
        outputDir: projectOut,
        summaryJson,
        sourceRunsJson,
        ...summaryFields,
        error: result.error,
    };
}

function isRetryableProjectFailure(record: ProjectRecord): boolean {
    if (record.status !== "failed") {
        return false;
    }
    const noSummary = !fs.existsSync(record.summaryJson);
    const windowsKilledExit = record.exitCode === 4294967295 || record.exitCode === -1;
    return noSummary || windowsKilledExit;
}

function shouldSplitSourceDirs(sourceDirs: string[], opts: Options): boolean {
    if (opts.sourceDirMode === "project") {
        return false;
    }
    if (opts.sourceDirMode === "split") {
        return sourceDirs.length > 1;
    }
    return sourceDirs.length > opts.splitSourceDirThreshold;
}

async function runProjectBySourceDir(
    project: string,
    repo: string,
    sourceDirs: string[],
    projectOut: string,
    opts: Options,
): Promise<ProjectRecord> {
    const started = Date.now();
    const summaryJson = path.join(projectOut, "summary", "summary.json");
    const sourceRunsJson = path.join(projectOut, "source_runs.json");
    const limit = opts.maxSplitSourceDirs > 0 ? Math.min(opts.maxSplitSourceDirs, sourceDirs.length) : sourceDirs.length;
    const selectedSourceDirs = sourceDirs.slice(0, limit);
    const projectTimeoutMs = Math.max(1, opts.projectTimeoutSeconds) * 1000;
    const sourceDirTimeoutMs = Math.max(1, opts.sourceDirTimeoutSeconds) * 1000;
    let projectTimedOut = false;
    const shardRecords: Array<{
        sourceDir: string;
        status: string;
        elapsedMs: number;
        timeoutSeconds: number;
        outputDir: string;
        totalEntries: number | null;
        okEntries: number | null;
        totalFlows: number | null;
        analysisExceptionCount: number | null;
        analysisBudgetExceededCount: number | null;
        semanticFlowItems: number | null;
        semanticFlowRuleCandidates: number | null;
        semanticFlowModeledArtifacts: number | null;
        semanticFlowNeedHumanCheck: number | null;
        semanticFlowUnresolved: number | null;
        error: string;
    }> = [];

    for (let index = 0; index < selectedSourceDirs.length; index++) {
        const remainingProjectMs = projectTimeoutMs - (Date.now() - started);
        if (remainingProjectMs <= 0) {
            projectTimedOut = true;
            console.log(`[split_stop] project=${project} reason=project_timeout completed=${shardRecords.length}/${selectedSourceDirs.length} elapsed_ms=${Date.now() - started}`);
            break;
        }
        const sourceDir = selectedSourceDirs[index];
        const shardOut = path.join(projectOut, "shards", `${String(index + 1).padStart(3, "0")}-${safeName(sourceDir)}`);
        const stdoutLog = path.join(shardOut, "stdout.log");
        const stderrLog = path.join(shardOut, "stderr.log");
        fs.mkdirSync(shardOut, { recursive: true });
        const shardStarted = Date.now();
        console.log(`[split ${index + 1}/${selectedSourceDirs.length}] project=${project} source_dir=${sourceDir} start`);
        const args = buildAnalyzeArgs(repo, shardOut, opts, [sourceDir]);
        const child = spawn(process.execPath, args, {
            cwd: process.cwd(),
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        const stdout = fs.createWriteStream(stdoutLog, { flags: "w" });
        const stderr = fs.createWriteStream(stderrLog, { flags: "w" });
        child.stdout.pipe(stdout);
        child.stderr.pipe(stderr);
        const shardTimeoutMs = Math.min(sourceDirTimeoutMs, remainingProjectMs);
        const result = await waitForChild(child, shardTimeoutMs, {
            heartbeatMs: opts.heartbeatSeconds * 1000,
            label: `${project}:${sourceDir}`,
            stdoutLog,
            stderrLog,
        });
        stdout.end();
        stderr.end();
        const shardSummaryJson = path.join(shardOut, "summary", "summary.json");
        const shardSourceRunsJson = path.join(shardOut, "source_runs.json");
        const fields = readSummaryFields(shardSummaryJson, shardSourceRunsJson, shardOut);
        const status = result.timedOut ? "timeout" : result.exitCode === 0 ? "done" : "failed";
        const timedOutByProjectBudget = result.timedOut && shardTimeoutMs < sourceDirTimeoutMs;
        shardRecords.push({
            sourceDir,
            status,
            elapsedMs: Date.now() - shardStarted,
            timeoutSeconds: opts.sourceDirTimeoutSeconds,
            outputDir: shardOut,
            ...fields,
            error: result.error,
        });
        console.log(`[split ${index + 1}/${selectedSourceDirs.length}] project=${project} source_dir=${sourceDir} status=${status} elapsed_ms=${Date.now() - shardStarted} flows=${fields.totalFlows ?? ""}`);
        if (timedOutByProjectBudget) {
            projectTimedOut = true;
            console.log(`[split_stop] project=${project} reason=project_timeout completed=${shardRecords.length}/${selectedSourceDirs.length} elapsed_ms=${Date.now() - started}`);
            break;
        }
    }

    fs.mkdirSync(path.dirname(summaryJson), { recursive: true });
    fs.writeFileSync(sourceRunsJson, JSON.stringify(shardRecords, null, 2), "utf-8");
    const totalEntries = sumNullable(shardRecords.map(item => item.totalEntries));
    const okEntries = sumNullable(shardRecords.map(item => item.okEntries));
    const totalFlows = sumNullable(shardRecords.map(item => item.totalFlows));
    const analysisExceptionCount = sumNullable(shardRecords.map(item => item.analysisExceptionCount));
    const analysisBudgetExceededCount = sumNullable(shardRecords.map(item => item.analysisBudgetExceededCount));
    const semanticFlowItems = sumNullable(shardRecords.map(item => item.semanticFlowItems));
    const semanticFlowRuleCandidates = sumNullable(shardRecords.map(item => item.semanticFlowRuleCandidates));
    const semanticFlowModeledArtifacts = sumNullable(shardRecords.map(item => item.semanticFlowModeledArtifacts));
    const semanticFlowNeedHumanCheck = sumNullable(shardRecords.map(item => item.semanticFlowNeedHumanCheck));
    const semanticFlowUnresolved = sumNullable(shardRecords.map(item => item.semanticFlowUnresolved));
    const failed = shardRecords.filter(item => item.status !== "done");
    const limited = selectedSourceDirs.length < sourceDirs.length;
    const modelingIssueCount = (semanticFlowNeedHumanCheck || 0) + (semanticFlowUnresolved || 0);
    const status = projectTimedOut
        ? "timeout"
        : failed.length > 0
        ? "partial_failed"
        : modelingIssueCount > 0
            ? "partial_modeling_incomplete"
            : limited
                ? "partial_limited"
                : "done";
    const aggregate = {
        generatedAt: new Date().toISOString(),
        repo,
        sourceDirs: selectedSourceDirs,
        sourceDirMode: "split",
        sourceDirCount: sourceDirs.length,
        selectedSourceDirCount: selectedSourceDirs.length,
        summary: {
            totalEntries,
            okEntries,
            totalFlows,
            analysisExceptionCount,
            analysisBudgetExceededCount,
            shardStatusCount: countBy(shardRecords.map(item => item.status)),
            diagnosticItems: [],
        },
        shards: shardRecords,
    };
    fs.writeFileSync(summaryJson, JSON.stringify(aggregate, null, 2), "utf-8");

    return {
        project,
        repo,
        sourceDirs,
        status,
        exitCode: projectTimedOut ? null : (failed.length === 0 ? 0 : null),
        elapsedMs: Date.now() - started,
        timeoutSeconds: opts.projectTimeoutSeconds,
        outputDir: projectOut,
        summaryJson,
        sourceRunsJson,
        totalEntries,
        okEntries,
        totalFlows,
        analysisExceptionCount,
        analysisBudgetExceededCount,
        semanticFlowItems,
        semanticFlowRuleCandidates,
        semanticFlowModeledArtifacts,
        semanticFlowNeedHumanCheck,
        semanticFlowUnresolved,
        error: projectTimedOut
            ? `project split timeout after ${opts.projectTimeoutSeconds}s; completed ${shardRecords.length}/${selectedSourceDirs.length} source dirs`
            : failed.length > 0 ? `${failed.length} source-dir shard(s) failed or timed out` : limited ? `limited to ${selectedSourceDirs.length}/${sourceDirs.length} source dirs` : "",
        executionMode: "split",
        completedSourceDirs: shardRecords.filter(item => item.status === "done").length,
        failedSourceDirs: failed.length,
    };
}

function sumNullable(values: Array<number | null>): number | null {
    let sum = 0;
    let seen = false;
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            sum += value;
            seen = true;
        }
    }
    return seen ? sum : null;
}

function countBy(values: string[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const value of values) {
        counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
}
function buildAnalyzeArgs(repo: string, outputDir: string, opts: Options, sourceDirs?: string[]): string[] {
    const args = [
        "out/cli/analyze.js",
        "--repo", repo,
        "--maxEntries", String(opts.maxEntries),
        "--worklistBudgetMs", String(opts.worklistBudgetMs),
        "--reportMode", opts.reportMode,
        "--entryModel", opts.entryModel,
        "--outputDir", outputDir,
    ];
    if (sourceDirs && sourceDirs.length > 0) {
        args.push("--sourceDir", sourceDirs.join(","));
    }
    if (opts.noIncremental) {
        args.push("--no-incremental");
    }
    if (opts.autoModel) {
        args.push("--autoModel");
        if (opts.llmProfile) {
            args.push("--llmProfile", opts.llmProfile);
        }
        if (opts.llmModel) {
            args.push("--model", opts.llmModel);
        }
        if (opts.llmSessionCacheDir) {
            args.push(
                "--llmSessionCacheDir", opts.llmSessionCacheDir,
                "--llmSessionCacheMode", opts.llmSessionCacheMode || "rw",
            );
        }
        args.push(
            "--llmTimeoutMs", String(opts.llmTimeoutMs),
            "--llmMaxAttempts", String(opts.llmMaxAttempts),
            "--llmMaxFailures", String(opts.llmMaxFailures),
            "--llmRepairAttempts", String(opts.llmRepairAttempts),
            "--maxLlmItems", String(opts.maxLlmItems),
            "--concurrency", String(opts.concurrency),
        );
    }
    return args;
}

function waitForChild(
    child: ChildProcess,
    timeoutMs: number,
    heartbeat: {
        heartbeatMs: number;
        label: string;
        stdoutLog: string;
        stderrLog: string;
    },
): Promise<{ exitCode: number | null; timedOut: boolean; error: string }> {
    return new Promise(resolve => {
        let settled = false;
        let timeoutTriggered = false;
        const started = Date.now();
        const finish = (result: { exitCode: number | null; timedOut: boolean; error: string }): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearInterval(heartbeatTimer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            if (settled) return;
            timeoutTriggered = true;
            clearInterval(heartbeatTimer);
            terminateChildProcessTree(child).then(terminated => {
                finish({
                    exitCode: null,
                    timedOut: true,
                    error: `timeout after ${timeoutMs} ms${terminated ? "; terminated child process tree" : "; child termination requested"}`,
                });
            });
        }, timeoutMs);
        const heartbeatTimer = setInterval(() => {
            if (settled) return;
            const elapsedSeconds = Math.round((Date.now() - started) / 1000);
            const stdoutLine = readLastNonEmptyLine(heartbeat.stdoutLog);
            const stderrLine = readLastNonEmptyLine(heartbeat.stderrLog);
            const tail = stdoutLine || stderrLine || "no output yet";
            console.log(`[heartbeat] project=${heartbeat.label} elapsed_s=${elapsedSeconds} last=${tail}`);
        }, heartbeat.heartbeatMs);
        child.on("error", err => {
            finish({ exitCode: null, timedOut: timeoutTriggered, error: err.message });
        });
        child.on("close", code => {
            finish({
                exitCode: code,
                timedOut: timeoutTriggered,
                error: timeoutTriggered ? `timeout after ${timeoutMs} ms; child exited with code ${code ?? ""}` : "",
            });
        });
    });
}

function terminateChildProcessTree(child: ChildProcess): Promise<boolean> {
    if (!child.pid) {
        return Promise.resolve(false);
    }
    if (process.platform !== "win32") {
        return Promise.resolve(child.kill("SIGKILL"));
    }
    return new Promise(resolve => {
        let settled = false;
        const taskkill = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
        });
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try {
                taskkill.kill();
            } catch {
                // best effort
            }
            try {
                child.kill();
            } catch {
                // best effort
            }
            resolve(false);
        }, 5000);
        taskkill.on("error", () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                resolve(child.kill());
            } catch {
                resolve(false);
            }
        });
        taskkill.on("close", code => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(code === 0);
        });
    });
}

function readLastNonEmptyLine(filePath: string): string {
    if (!fs.existsSync(filePath)) {
        return "";
    }
    try {
        const text = fs.readFileSync(filePath, "utf-8");
        const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        return lines.length > 0 ? lines[lines.length - 1].slice(0, 240) : "";
    } catch {
        return "";
    }
}

function readSummaryFields(
    summaryJson: string,
    sourceRunsJson: string,
    projectOut: string,
): Pick<ProjectRecord,
    | "totalEntries"
    | "okEntries"
    | "totalFlows"
    | "analysisExceptionCount"
    | "analysisBudgetExceededCount"
    | "semanticFlowItems"
    | "semanticFlowRuleCandidates"
    | "semanticFlowModeledArtifacts"
    | "semanticFlowNeedHumanCheck"
    | "semanticFlowUnresolved"> {
    const empty = {
        totalEntries: null,
        okEntries: null,
        totalFlows: null,
        analysisExceptionCount: null,
        analysisBudgetExceededCount: null,
        semanticFlowItems: null,
        semanticFlowRuleCandidates: null,
        semanticFlowModeledArtifacts: null,
        semanticFlowNeedHumanCheck: null,
        semanticFlowUnresolved: null,
    };
    const semanticFlowSummary = readSemanticFlowSummary(projectOut);
    const semanticFlowItems = semanticFlowSummary?.itemCount ?? readSemanticFlowItemCount(sourceRunsJson);
    const semanticFlowRuleCandidates = semanticFlowSummary?.ruleCandidateCount ?? readSemanticFlowRuleCandidateCount(projectOut);
    const semanticFlowModeledArtifacts = semanticFlowSummary?.modeledArtifactCount ?? null;
    const semanticFlowNeedHumanCheck = semanticFlowSummary?.needHumanCheckCount ?? null;
    const semanticFlowUnresolved = semanticFlowSummary?.unresolvedCount ?? null;
    if (!fs.existsSync(summaryJson)) {
        return {
            ...empty,
            semanticFlowItems,
            semanticFlowRuleCandidates,
            semanticFlowModeledArtifacts,
            semanticFlowNeedHumanCheck,
            semanticFlowUnresolved,
        };
    }
    try {
        const payload = JSON.parse(fs.readFileSync(summaryJson, "utf-8"));
        const summary = payload.summary || {};
        return {
            totalEntries: numberOrNull(summary.totalEntries),
            okEntries: numberOrNull(summary.okEntries),
            totalFlows: numberOrNull(summary.totalFlows),
            analysisExceptionCount: numberOrNull(summary.statusCount?.exception) || 0,
            analysisBudgetExceededCount: numberOrNull(summary.statusCount?.budget_exceeded) || 0,
            semanticFlowItems,
            semanticFlowRuleCandidates,
            semanticFlowModeledArtifacts,
            semanticFlowNeedHumanCheck,
            semanticFlowUnresolved,
        };
    } catch {
        return {
            ...empty,
            semanticFlowItems,
            semanticFlowRuleCandidates,
            semanticFlowModeledArtifacts,
            semanticFlowNeedHumanCheck,
            semanticFlowUnresolved,
        };
    }
}

function resolveProjectStatus(
    timedOut: boolean,
    exitCode: number | null,
    opts: Options,
    summaryFields: Pick<ProjectRecord,
        | "totalEntries"
        | "okEntries"
        | "analysisExceptionCount"
        | "analysisBudgetExceededCount"
        | "semanticFlowNeedHumanCheck"
        | "semanticFlowUnresolved">,
): string {
    if (timedOut) {
        return "timeout";
    }
    if (exitCode !== 0) {
        return "failed";
    }
    const exceptionCount = summaryFields.analysisExceptionCount || 0;
    const budgetExceededCount = summaryFields.analysisBudgetExceededCount || 0;
    if (exceptionCount > 0 || budgetExceededCount > 0) {
        return "done_analysis_incomplete";
    }
    if (opts.autoModel) {
        const modelingIssueCount = (summaryFields.semanticFlowNeedHumanCheck || 0)
            + (summaryFields.semanticFlowUnresolved || 0);
        if (modelingIssueCount > 0) {
            return "done_modeling_incomplete";
        }
    }
    return "done";
}

function readSemanticFlowSummary(projectOut: string): {
    itemCount: number | null;
    ruleCandidateCount: number | null;
    modeledArtifactCount: number | null;
    needHumanCheckCount: number | null;
    unresolvedCount: number | null;
} | null {
    const summaryPath = path.join(projectOut, "summary.json");
    if (!fs.existsSync(summaryPath)) {
        return null;
    }
    try {
        const payload = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
        const classifications = payload?.classifications && typeof payload.classifications === "object"
            ? payload.classifications
            : {};
        const modeledArtifactCount = [
            payload.moduleCount,
            payload.sourceRuleCount,
            payload.sinkRuleCount,
            payload.sanitizerRuleCount,
            payload.transferRuleCount,
            payload.arkMainSpecCount,
        ].reduce((sum, value) => sum + (numberOrNull(value) || 0), 0);
        return {
            itemCount: numberOrNull(payload.itemCount),
            ruleCandidateCount: numberOrNull(payload.ruleCandidateCount),
            modeledArtifactCount,
            needHumanCheckCount: numberOrNull(classifications["need-human-check"]) || 0,
            unresolvedCount: numberOrNull(classifications.unresolved) || 0,
        };
    } catch {
        return null;
    }
}

function readSemanticFlowItemCount(sourceRunsJson: string): number | null {
    if (!fs.existsSync(sourceRunsJson)) {
        return null;
    }
    try {
        const runs = JSON.parse(fs.readFileSync(sourceRunsJson, "utf-8"));
        if (!Array.isArray(runs)) {
            return null;
        }
        return runs.reduce((sum, item) => sum + (numberOrNull(item?.itemCount) || 0), 0);
    } catch {
        return null;
    }
}

function readSemanticFlowRuleCandidateCount(projectOut: string): number | null {
    const candidatePath = path.join(projectOut, "phase1", "feedback", "rule_feedback", "no_candidate_project_candidates.json");
    if (!fs.existsSync(candidatePath)) {
        return null;
    }
    try {
        const payload = JSON.parse(fs.readFileSync(candidatePath, "utf-8"));
        return numberOrNull(payload.total);
    } catch {
        return null;
    }
}

function numberOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function appendRecord(jsonlPath: string, csvPath: string, record: ProjectRecord): void {
    fs.appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`, "utf-8");
    fs.appendFileSync(csvPath, csvLine(record), "utf-8");
}

function csvHeader(): string {
    return [
        "project",
        "status",
        "elapsedMs",
        "timeoutSeconds",
        "exitCode",
        "sourceDirs",
        "executionMode",
        "completedSourceDirs",
        "failedSourceDirs",
        "totalEntries",
        "okEntries",
        "totalFlows",
        "analysisExceptionCount",
        "analysisBudgetExceededCount",
        "semanticFlowItems",
        "semanticFlowRuleCandidates",
        "semanticFlowModeledArtifacts",
        "semanticFlowNeedHumanCheck",
        "semanticFlowUnresolved",
        "outputDir",
        "summaryJson",
        "sourceRunsJson",
        "error",
    ].join(",") + "\n";
}

function csvLine(record: ProjectRecord): string {
    return [
        record.project,
        record.status,
        record.elapsedMs,
        record.timeoutSeconds,
        record.exitCode ?? "",
        record.sourceDirs.join(";"),
        record.executionMode ?? "project",
        record.completedSourceDirs ?? "",
        record.failedSourceDirs ?? "",
        record.totalEntries ?? "",
        record.okEntries ?? "",
        record.totalFlows ?? "",
        record.analysisExceptionCount ?? "",
        record.analysisBudgetExceededCount ?? "",
        record.semanticFlowItems ?? "",
        record.semanticFlowRuleCandidates ?? "",
        record.semanticFlowModeledArtifacts ?? "",
        record.semanticFlowNeedHumanCheck ?? "",
        record.semanticFlowUnresolved ?? "",
        record.outputDir,
        record.summaryJson,
        record.sourceRunsJson,
        record.error,
    ].map(csvEscape).join(",") + "\n";
}

function csvEscape(value: unknown): string {
    const text = String(value ?? "");
    if (!/[",\r\n]/.test(text)) {
        return text;
    }
    return `"${text.replace(/"/g, "\"\"")}"`;
}

function safeName(value: string): string {
    return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
