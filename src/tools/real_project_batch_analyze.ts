import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
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
    maxLlmItems: number;
    concurrency: number;
    reportMode: string;
    entryModel: string;
    maxEntries: number;
    noIncremental: boolean;
    skipExisting: boolean;
    sourceDirMode: SourceDirMode;
    splitSourceDirThreshold: number;
    sourceDirTimeoutSeconds: number;
    maxSplitSourceDirs: number;
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
    semanticFlowItems: number | null;
    semanticFlowRuleCandidates: number | null;
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
        projectTimeoutSeconds: 180,
        heartbeatSeconds: 30,
        autoModel: false,
        llmProfile: "",
        llmModel: "",
        llmTimeoutMs: 60000,
        llmMaxAttempts: 1,
        llmMaxFailures: 3,
        llmRepairAttempts: 0,
        maxLlmItems: 12,
        concurrency: 1,
        reportMode: "light",
        entryModel: "arkMain",
        maxEntries: 9999,
        noIncremental: true,
        skipExisting: false,
        sourceDirMode: "auto",
        splitSourceDirThreshold: 24,
        sourceDirTimeoutSeconds: 120,
        maxSplitSourceDirs: 0,
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
            case "--incremental":
                opts.noIncremental = false;
                break;
            case "--skipExisting":
                opts.skipExisting = true;
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
        "  --maxLlmItems <n>                 Max SemanticFlow LLM items per source directory",
        "  --concurrency <n>                 SemanticFlow LLM concurrency",
        "  --reportMode <full|light>         Analyze report mode",
        "  --entryModel <arkMain|explicit>   Entry model for final analyze",
        "  --maxEntries <n>                  Analyze max entries",
        "  --incremental                     Keep incremental mode enabled",
        "  --skipExisting                    Skip project if summary already exists",
        "  --sourceDirMode <project|split|auto>  Split large multi-source repos when needed",
        "  --splitSourceDirThreshold <n>      Auto-split when discovered source dirs exceed n",
        "  --sourceDirTimeoutSeconds <n>      Hard timeout per source-dir shard",
        "  --maxSplitSourceDirs <n>           Limit shards for probing; 0 means all",
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
    fs.writeFileSync(manifestPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        options: opts,
    }, null, 2), "utf-8");

    const projects = listProjects(opts);
    console.log(`batch_start projects=${projects.length} outputDir=${opts.outputDir} timeout_s=${opts.projectTimeoutSeconds} autoModel=${opts.autoModel}`);

    for (let i = 0; i < projects.length; i++) {
        const project = projects[i];
        console.log(`[${i + 1}/${projects.length}] project=${project} start`);
        const record = await runProject(project, opts);
        appendRecord(jsonlPath, csvPath, record);
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

async function runProject(project: string, opts: Options): Promise<ProjectRecord> {
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
            semanticFlowItems: null,
            semanticFlowRuleCandidates: null,
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
    return {
        project,
        repo,
        sourceDirs,
        status: result.timedOut ? "timeout" : result.exitCode === 0 ? "done" : "failed",
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
    const shardRecords: Array<{
        sourceDir: string;
        status: string;
        elapsedMs: number;
        timeoutSeconds: number;
        outputDir: string;
        totalEntries: number | null;
        okEntries: number | null;
        totalFlows: number | null;
        semanticFlowItems: number | null;
        semanticFlowRuleCandidates: number | null;
        error: string;
    }> = [];

    for (let index = 0; index < selectedSourceDirs.length; index++) {
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
        const result = await waitForChild(child, opts.sourceDirTimeoutSeconds * 1000, {
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
    }

    fs.mkdirSync(path.dirname(summaryJson), { recursive: true });
    fs.writeFileSync(sourceRunsJson, JSON.stringify(shardRecords, null, 2), "utf-8");
    const totalEntries = sumNullable(shardRecords.map(item => item.totalEntries));
    const okEntries = sumNullable(shardRecords.map(item => item.okEntries));
    const totalFlows = sumNullable(shardRecords.map(item => item.totalFlows));
    const semanticFlowItems = sumNullable(shardRecords.map(item => item.semanticFlowItems));
    const semanticFlowRuleCandidates = sumNullable(shardRecords.map(item => item.semanticFlowRuleCandidates));
    const failed = shardRecords.filter(item => item.status !== "done");
    const limited = selectedSourceDirs.length < sourceDirs.length;
    const status = failed.length > 0 ? "partial_failed" : limited ? "partial_limited" : "done";
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
        exitCode: failed.length === 0 ? 0 : null,
        elapsedMs: Date.now() - started,
        timeoutSeconds: opts.projectTimeoutSeconds,
        outputDir: projectOut,
        summaryJson,
        sourceRunsJson,
        totalEntries,
        okEntries,
        totalFlows,
        semanticFlowItems,
        semanticFlowRuleCandidates,
        error: failed.length > 0 ? `${failed.length} source-dir shard(s) failed or timed out` : limited ? `limited to ${selectedSourceDirs.length}/${sourceDirs.length} source dirs` : "",
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
    child: ReturnType<typeof spawn>,
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
        const started = Date.now();
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            clearInterval(heartbeatTimer);
            child.kill();
            resolve({ exitCode: null, timedOut: true, error: `timeout after ${timeoutMs} ms` });
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
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearInterval(heartbeatTimer);
            resolve({ exitCode: null, timedOut: false, error: err.message });
        });
        child.on("exit", code => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            clearInterval(heartbeatTimer);
            resolve({ exitCode: code, timedOut: false, error: "" });
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
    "totalEntries" | "okEntries" | "totalFlows" | "semanticFlowItems" | "semanticFlowRuleCandidates"> {
    const empty = {
        totalEntries: null,
        okEntries: null,
        totalFlows: null,
        semanticFlowItems: null,
        semanticFlowRuleCandidates: null,
    };
    const semanticFlowItems = readSemanticFlowItemCount(sourceRunsJson);
    const semanticFlowRuleCandidates = readSemanticFlowRuleCandidateCount(projectOut);
    if (!fs.existsSync(summaryJson)) {
        return {
            ...empty,
            semanticFlowItems,
            semanticFlowRuleCandidates,
        };
    }
    try {
        const payload = JSON.parse(fs.readFileSync(summaryJson, "utf-8"));
        const summary = payload.summary || {};
        return {
            totalEntries: numberOrNull(summary.totalEntries),
            okEntries: numberOrNull(summary.okEntries),
            totalFlows: numberOrNull(summary.totalFlows),
            semanticFlowItems,
            semanticFlowRuleCandidates,
        };
    } catch {
        return {
            ...empty,
            semanticFlowItems,
            semanticFlowRuleCandidates,
        };
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
        "semanticFlowItems",
        "semanticFlowRuleCandidates",
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
        record.semanticFlowItems ?? "",
        record.semanticFlowRuleCandidates ?? "",
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
