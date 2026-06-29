import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ChildProcess, spawn, spawnSync } from "child_process";

type ConfigName = "base" | "ude" | "oclfs" | "ude_oclfs";
type OrderMode = "ranked" | "small-first" | "large-first";

interface Options {
    command: "prepare" | "run" | "merge" | "smoke" | "help";
    inventoryCsv: string;
    projectRoot: string;
    outputRoot: string;
    runId: string;
    maxProjects: number;
    project: string;
    order: OrderMode;
    shards: number;
    parallel: number;
    configs: ConfigName[];
    projectTimeoutSeconds: number;
    heartbeatSeconds: number;
    worklistMaxVisited: number;
    worklistBudgetMs: number;
    maxEntries: number;
    sourceDirMode: "project" | "split" | "auto";
    splitSourceDirThreshold: number;
    sourceDirTimeoutSeconds: number;
    flowMode: "raw" | "candidate" | "postsolve";
    reportMode: "light" | "full";
    executionMode: "subprocess" | "in-process";
    skipExisting: boolean;
    dryRun: boolean;
    workerTimeoutMinutes: number;
}

interface InventoryProject {
    project: string;
    inventoryName: string;
    localPath: string;
    sourceUrl: string;
    etsFiles: number;
    productionEtsFiles: number;
    harmonyConfigFiles: string;
    contentStatus: string;
    contentReason: string;
    originalIndex: number;
    inventoryRowCount: number;
    duplicateInventoryRows: number;
    inventoryOriginalIndexes: string;
    inventoryNames: string;
    sourceUrls: string;
    sizeTier: "small" | "medium" | "large" | "xlarge";
    shard: number;
}

interface ExperimentLayout {
    root: string;
    datasetsDir: string;
    shardsDir: string;
    registryDir: string;
    realProjectsDir: string;
    summaryDir: string;
    performanceDir: string;
}

interface Task {
    config: ConfigName;
    shard: number;
    shardName: string;
    projectsFile: string;
    outputDir: string;
    stdoutLog: string;
    stderrLog: string;
    args: string[];
}

interface ProjectRunRecord {
    config: string;
    shard: string;
    project: string;
    status: string;
    elapsedMs: number | null;
    timeoutSeconds: number | null;
    exitCode: number | null;
    totalEntries: number | null;
    okEntries: number | null;
    totalFlows: number | null;
    partialFlows: number | null;
    observedFlows: number | null;
    analysisExceptionCount: number | null;
    analysisBudgetExceededCount: number | null;
    stageTotalMs: number | null;
    ruleLoadMs: number | null;
    sceneBuildMs: number | null;
    entryAnalyzeMs: number | null;
    reportWriteMs: number | null;
    peakRssMiB: number | null;
    peakHeapUsedMiB: number | null;
    outputDir: string;
    summaryJson: string;
    error: string;
}

interface ExperimentSpec {
    projects: InventoryProject[];
    configs: ConfigName[];
    shardCount: number;
    inventoryRowCount: number;
    runnableProjectCount: number;
    duplicateInventoryGroupCount: number;
    duplicateInventoryRowCount: number;
}

const CONFIGS: Record<ConfigName, { executionHandoff: "enabled" | "disabled"; currentness: "enabled" | "disabled"; label: string }> = {
    base: { executionHandoff: "disabled", currentness: "disabled", label: "基础静态分析配置" },
    ude: { executionHandoff: "enabled", currentness: "disabled", label: "基础+UDE配置" },
    oclfs: { executionHandoff: "disabled", currentness: "enabled", label: "基础+OCLFS配置" },
    ude_oclfs: { executionHandoff: "enabled", currentness: "enabled", label: "基础+UDE+OCLFS配置" },
};

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.command === "help") {
        printHelp();
        return;
    }
    const layout = layoutFor(opts);
    if (opts.command === "merge") {
        mergeResults(opts, layout);
        return;
    }
    if (opts.command === "smoke") {
        opts.maxProjects = opts.maxProjects || 1;
        opts.shards = 1;
        opts.parallel = opts.parallel || 2;
        opts.order = opts.order === "ranked" ? "small-first" : opts.order;
    }
    const projects = prepareExperiment(opts, layout);
    if (opts.command === "prepare") {
        console.log(`prepare_done run_id=${opts.runId} projects=${projects.length} root=${layout.root}`);
        return;
    }
    await runExperiment(opts, layout);
    mergeResults(opts, layout);
}

function parseArgs(argv: string[]): Options {
    const command = (argv[0] || "help") as Options["command"];
    const opts: Options = {
        command,
        inventoryCsv: path.resolve("tmp", "repo_metrics_experiment", "real_project_inventory.repo_ranked.full.arkts_nondemo.content_filtered.csv"),
        projectRoot: path.resolve("..", "project"),
        outputRoot: path.resolve("tmp", "test_runs", "chapter3"),
        runId: `chapter3_budget_${timestampForPath()}`,
        maxProjects: 0,
        project: "",
        order: "ranked",
        shards: 8,
        parallel: 4,
        configs: ["base", "ude", "oclfs", "ude_oclfs"],
        projectTimeoutSeconds: 240,
        heartbeatSeconds: 30,
        worklistMaxVisited: 5000,
        worklistBudgetMs: 0,
        maxEntries: 9999,
        sourceDirMode: "auto",
        splitSourceDirThreshold: 24,
        sourceDirTimeoutSeconds: 120,
        flowMode: "raw",
        reportMode: "light",
        executionMode: "subprocess",
        skipExisting: true,
        dryRun: false,
        workerTimeoutMinutes: 0,
    };
    let i = command === "prepare" || command === "run" || command === "merge" || command === "smoke" || command === "help" ? 1 : 0;
    let runIdProvided = false;
    if (i === 0) opts.command = "help";
    const next = (arg: string): string => {
        const value = argv[++i];
        if (value === undefined) throw new Error(`missing value for ${arg}`);
        return value;
    };
    for (; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--inventoryCsv":
                opts.inventoryCsv = path.resolve(next(arg));
                break;
            case "--projectRoot":
                opts.projectRoot = path.resolve(next(arg));
                break;
            case "--outputRoot":
                opts.outputRoot = path.resolve(next(arg));
                break;
            case "--runId":
                opts.runId = next(arg);
                runIdProvided = true;
                break;
            case "--maxProjects":
                opts.maxProjects = parseNonNegativeInt(next(arg), arg);
                break;
            case "--project":
                opts.project = next(arg);
                break;
            case "--order":
                opts.order = parseOrder(next(arg));
                break;
            case "--shards":
                opts.shards = parsePositiveInt(next(arg), arg);
                break;
            case "--parallel":
                opts.parallel = parsePositiveInt(next(arg), arg);
                break;
            case "--configs":
                opts.configs = parseConfigs(next(arg));
                break;
            case "--projectTimeoutSeconds":
                opts.projectTimeoutSeconds = parsePositiveInt(next(arg), arg);
                break;
            case "--heartbeatSeconds":
                opts.heartbeatSeconds = parsePositiveInt(next(arg), arg);
                break;
            case "--worklistMaxVisited":
                opts.worklistMaxVisited = parseNonNegativeInt(next(arg), arg);
                break;
            case "--worklistBudgetMs":
                opts.worklistBudgetMs = parseNonNegativeInt(next(arg), arg);
                break;
            case "--maxEntries":
                opts.maxEntries = parsePositiveInt(next(arg), arg);
                break;
            case "--sourceDirMode":
                opts.sourceDirMode = parseSourceDirMode(next(arg));
                break;
            case "--splitSourceDirThreshold":
                opts.splitSourceDirThreshold = parsePositiveInt(next(arg), arg);
                break;
            case "--sourceDirTimeoutSeconds":
                opts.sourceDirTimeoutSeconds = parsePositiveInt(next(arg), arg);
                break;
            case "--flowMode":
                opts.flowMode = parseFlowMode(next(arg));
                break;
            case "--reportMode":
                opts.reportMode = parseReportMode(next(arg));
                break;
            case "--executionMode":
                opts.executionMode = parseExecutionMode(next(arg));
                break;
            case "--no-skipExisting":
                opts.skipExisting = false;
                break;
            case "--skipExisting":
                opts.skipExisting = true;
                break;
            case "--dryRun":
                opts.dryRun = true;
                break;
            case "--workerTimeoutMinutes":
                opts.workerTimeoutMinutes = parseNonNegativeInt(next(arg), arg);
                break;
            default:
                throw new Error(`unknown option: ${arg}`);
        }
    }
    if (opts.command === "smoke" && !runIdProvided && opts.runId.startsWith("chapter3_budget_")) {
        opts.runId = `chapter3_budget_smoke_${timestampForPath()}`;
    }
    return opts;
}

function layoutFor(opts: Options): ExperimentLayout {
    const root = path.resolve(opts.outputRoot, opts.runId);
    return {
        root,
        datasetsDir: path.join(root, "datasets"),
        shardsDir: path.join(root, "datasets", "shards"),
        registryDir: path.join(root, "registry"),
        realProjectsDir: path.join(root, "real_projects"),
        summaryDir: path.join(root, "summary"),
        performanceDir: path.join(root, "performance"),
    };
}

function prepareExperiment(opts: Options, layout: ExperimentLayout): InventoryProject[] {
    mkdirs(layout);
    const all = readInventory(opts.inventoryCsv);
    const selected = selectProjects(all, opts);
    assignBalancedShards(selected, opts.shards);
    writeProjectManifests(selected, opts, layout);
    writeEnvironmentAndRunManifest(selected, opts, layout);
    writeExpectedMatrix(selected, opts, layout);
    writeDatasetIntegrity(selected, opts, layout);
    return selected;
}

async function runExperiment(opts: Options, layout: ExperimentLayout): Promise<void> {
    const tasks = buildTasks(opts, layout);
    const registryPath = path.join(layout.registryDir, "worker_runs.jsonl");
    console.log(`experiment_run_start run_id=${opts.runId} tasks=${tasks.length} parallel=${opts.parallel} dryRun=${opts.dryRun}`);
    if (opts.dryRun) {
        for (const task of tasks) {
            console.log(`dry_run config=${task.config} shard=${task.shardName} command=node ${task.args.join(" ")}`);
        }
        return;
    }
    await runTasks(tasks, opts.parallel, registryPath, opts.workerTimeoutMinutes);
    console.log(`experiment_run_done registry=${registryPath}`);
}

function buildTasks(opts: Options, layout: ExperimentLayout): Task[] {
    const tasks: Task[] = [];
    for (const config of opts.configs) {
        for (let shard = 0; shard < opts.shards; shard++) {
            const shardName = `shard_${String(shard).padStart(3, "0")}`;
            const projectsFile = path.join(layout.shardsDir, `${shardName}.txt`);
            if (!fs.existsSync(projectsFile) || fs.readFileSync(projectsFile, "utf-8").trim().length === 0) {
                continue;
            }
            const outputDir = path.join(layout.realProjectsDir, config, shardName);
            const workerDir = path.join(layout.registryDir, "workers");
            fs.mkdirSync(workerDir, { recursive: true });
            const args = buildBatchArgs(opts, config, projectsFile, outputDir);
            tasks.push({
                config,
                shard,
                shardName,
                projectsFile,
                outputDir,
                stdoutLog: path.join(workerDir, `${config}_${shardName}.stdout.log`),
                stderrLog: path.join(workerDir, `${config}_${shardName}.stderr.log`),
                args,
            });
        }
    }
    return tasks;
}

function buildBatchArgs(opts: Options, config: ConfigName, projectsFile: string, outputDir: string): string[] {
    const flags = CONFIGS[config];
    const args = [
        "out/tools/real_project_batch_analyze.js",
        "--projectRoot", opts.projectRoot,
        "--projectsFile", projectsFile,
        "--outputDir", outputDir,
        "--projectTimeoutSeconds", String(opts.projectTimeoutSeconds),
        "--heartbeatSeconds", String(opts.heartbeatSeconds),
        "--executionHandoff", flags.executionHandoff,
        "--currentness", flags.currentness,
        "--reportMode", opts.reportMode,
        "--entryModel", "arkMain",
        "--maxEntries", String(opts.maxEntries),
        "--worklistBudgetMs", String(opts.worklistBudgetMs),
        "--worklistMaxVisited", String(opts.worklistMaxVisited),
        "--sourceDirMode", opts.sourceDirMode,
        "--splitSourceDirThreshold", String(opts.splitSourceDirThreshold),
        "--sourceDirTimeoutSeconds", String(opts.sourceDirTimeoutSeconds),
        "--flowMode", opts.flowMode,
        "--executionMode", opts.executionMode,
        "--projectRetries", "0",
    ];
    if (opts.skipExisting) args.push("--skipExisting");
    return args;
}

async function runTasks(tasks: Task[], parallel: number, registryPath: string, workerTimeoutMinutes: number): Promise<void> {
    const queue = [...tasks];
    let completed = 0;
    let failed = 0;
    async function worker(workerId: number): Promise<void> {
        while (queue.length > 0) {
            const task = queue.shift();
            if (!task) return;
            try {
                const exitCode = await runOneTask(task, registryPath, workerTimeoutMinutes);
                if (exitCode !== 0) failed++;
            } catch (error: any) {
                failed++;
                appendJsonl(registryPath, {
                    event: "worker_exception",
                    workerId,
                    config: task.config,
                    shard: task.shardName,
                    error: error?.stack || error?.message || String(error),
                    at: new Date().toISOString(),
                });
            } finally {
                completed++;
                console.log(`worker_progress completed=${completed}/${tasks.length} failed=${failed}`);
            }
        }
    }
    const workerCount = Math.min(Math.max(1, parallel), tasks.length || 1);
    await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));
}

function runOneTask(task: Task, registryPath: string, workerTimeoutMinutes: number): Promise<number | null> {
    return new Promise(resolve => {
        fs.mkdirSync(task.outputDir, { recursive: true });
        fs.writeFileSync(task.stdoutLog, "", "utf-8");
        fs.writeFileSync(task.stderrLog, "", "utf-8");
        const startedAt = new Date().toISOString();
        const child = spawn(process.execPath, task.args, {
            cwd: process.cwd(),
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        appendJsonl(registryPath, {
            event: "start",
            startedAt,
            pid: child.pid ?? null,
            config: task.config,
            shard: task.shardName,
            outputDir: task.outputDir,
            command: [process.execPath, ...task.args].join(" "),
        });
        console.log(`worker_start config=${task.config} shard=${task.shardName} pid=${child.pid ?? ""}`);
        const stdout = fs.createWriteStream(task.stdoutLog, { flags: "a" });
        const stderr = fs.createWriteStream(task.stderrLog, { flags: "a" });
        child.stdout?.on("data", chunk => stdout.write(chunk));
        child.stderr?.on("data", chunk => stderr.write(chunk));
        let timeoutTriggered = false;
        const timeoutMs = workerTimeoutMinutes > 0 ? workerTimeoutMinutes * 60 * 1000 : 0;
        const timer = timeoutMs > 0
            ? setTimeout(() => {
                timeoutTriggered = true;
                killTree(child);
            }, timeoutMs)
            : undefined;
        child.on("close", code => {
            if (timer) clearTimeout(timer);
            stdout.end();
            stderr.end();
            const completedAt = new Date().toISOString();
            appendJsonl(registryPath, {
                event: "done",
                startedAt,
                completedAt,
                pid: child.pid ?? null,
                config: task.config,
                shard: task.shardName,
                outputDir: task.outputDir,
                exitCode: code,
                timedOut: timeoutTriggered,
                stdoutLog: task.stdoutLog,
                stderrLog: task.stderrLog,
            });
            console.log(`worker_done config=${task.config} shard=${task.shardName} exit=${code} timedOut=${timeoutTriggered}`);
            resolve(timeoutTriggered ? null : code);
        });
        child.on("error", error => {
            if (timer) clearTimeout(timer);
            stdout.end();
            stderr.end();
            appendJsonl(registryPath, {
                event: "error",
                startedAt,
                completedAt: new Date().toISOString(),
                config: task.config,
                shard: task.shardName,
                error: error?.message || String(error),
            });
            resolve(1);
        });
    });
}

function killTree(child: ChildProcess): void {
    if (!child.pid) return;
    if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        return;
    }
    try {
        child.kill("SIGKILL");
    } catch {
        // best effort
    }
}

function mergeResults(opts: Options, layout: ExperimentLayout): void {
    fs.mkdirSync(layout.summaryDir, { recursive: true });
    fs.mkdirSync(layout.performanceDir, { recursive: true });
    const spec = readExperimentSpec(opts, layout);
    const records = readAllProjectRecords(spec.configs, spec.shardCount, layout);
    writeCsv(path.join(layout.summaryDir, "real_project_flow_delta_by_project.csv"), records, [
        "config", "shard", "project", "status", "observedFlows", "totalFlows", "partialFlows",
        "analysisBudgetExceededCount", "elapsedMs", "peakRssMiB", "summaryJson", "error",
    ]);
    writeCsv(path.join(layout.performanceDir, "project_records_with_perf.csv"), records, [
        "config", "shard", "project", "status", "elapsedMs", "timeoutSeconds", "stageTotalMs",
        "ruleLoadMs", "sceneBuildMs", "entryAnalyzeMs", "reportWriteMs",
        "peakRssMiB", "peakHeapUsedMiB", "observedFlows", "outputDir",
    ]);
    writeFlowMatrix(spec, records, layout);
    writePerformanceMatrix(spec, records, layout);
    writeConfigSummary(records, spec.configs, layout);
    writeStatusDistribution(records, spec.configs, layout);
    writeBudgetExceeded(records, layout);
    const integrity = writeIntegrityReports(spec, records, layout);
    console.log(`merge_done records=${records.length} expected=${integrity.expectedRecords} missing=${integrity.missingRecords} duplicate_extra=${integrity.duplicateExtraRecords} unexpected=${integrity.unexpectedRecords} complete=${integrity.complete} summary=${layout.summaryDir}`);
}

function readAllProjectRecords(configs: ConfigName[], shardCount: number, layout: ExperimentLayout): ProjectRunRecord[] {
    const out: ProjectRunRecord[] = [];
    for (const config of configs) {
        for (let shard = 0; shard < shardCount; shard++) {
            const shardName = `shard_${String(shard).padStart(3, "0")}`;
            const jsonlPath = path.join(layout.realProjectsDir, config, shardName, "batch_runs.jsonl");
            if (!fs.existsSync(jsonlPath)) continue;
            for (const line of fs.readFileSync(jsonlPath, "utf-8").split(/\r?\n/)) {
                if (!line.trim()) continue;
                try {
                    const raw = JSON.parse(line);
                    out.push(normalizeRunRecord(config, shardName, raw));
                } catch {
                    // Skip malformed partial line.
                }
            }
        }
    }
    return out;
}

function normalizeRunRecord(config: ConfigName, shard: string, raw: any): ProjectRunRecord {
    const summary = readAnalyzeSummary(raw.summaryJson);
    const totalFlows = numberOrNull(summary?.summary?.totalFlows) ?? numberOrNull(raw.totalFlows);
    const partialFlows = numberOrNull(summary?.summary?.partialFlows) ?? 0;
    const observedFlows = (totalFlows ?? 0) + partialFlows;
    const stage = summary?.summary?.stageProfile || {};
    const memory = summary?.summary?.memoryProfile || {};
    return {
        config,
        shard,
        project: String(raw.project ?? ""),
        status: String(raw.status ?? ""),
        elapsedMs: numberOrNull(raw.elapsedMs),
        timeoutSeconds: numberOrNull(raw.timeoutSeconds),
        exitCode: numberOrNull(raw.exitCode),
        totalEntries: numberOrNull(raw.totalEntries),
        okEntries: numberOrNull(raw.okEntries),
        totalFlows,
        partialFlows,
        observedFlows,
        analysisExceptionCount: numberOrNull(raw.analysisExceptionCount),
        analysisBudgetExceededCount: numberOrNull(raw.analysisBudgetExceededCount),
        stageTotalMs: numberOrNull(stage.totalMs),
        ruleLoadMs: numberOrNull(stage.ruleLoadMs),
        sceneBuildMs: numberOrNull(stage.sceneBuildMs),
        entryAnalyzeMs: numberOrNull(stage.entryAnalyzeMs),
        reportWriteMs: numberOrNull(stage.reportWriteMs),
        peakRssMiB: numberOrNull(memory.peakRssMiB),
        peakHeapUsedMiB: numberOrNull(memory.peakHeapUsedMiB),
        outputDir: String(raw.outputDir ?? ""),
        summaryJson: String(raw.summaryJson ?? ""),
        error: String(raw.error ?? ""),
    };
}

function readAnalyzeSummary(file: string): any | null {
    if (!file || !fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
        return null;
    }
}

function writeConfigSummary(records: ProjectRunRecord[], configs: ConfigName[], layout: ExperimentLayout): void {
    const rows = [];
    for (const config of configs) {
        const rs = records.filter(r => r.config === config);
        if (rs.length === 0) continue;
        const elapsed = rs.map(r => r.elapsedMs).filter(isNumber);
        const rss = rs.map(r => r.peakRssMiB).filter(isNumber);
        rows.push({
            config,
            configLabel: CONFIGS[config].label,
            projects: rs.length,
            done: countStatus(rs, "done"),
            doneAnalysisIncomplete: countStatus(rs, "done_analysis_incomplete"),
            timeout: countStatus(rs, "timeout"),
            failed: countStatus(rs, "failed"),
            skippedNoSources: countStatus(rs, "skipped_no_sources"),
            observedFlows: sum(rs.map(r => r.observedFlows)),
            totalFlows: sum(rs.map(r => r.totalFlows)),
            partialFlows: sum(rs.map(r => r.partialFlows)),
            budgetExceededProjects: rs.filter(r => (r.analysisBudgetExceededCount || 0) > 0 || r.status === "done_analysis_incomplete").length,
            medianElapsedMs: percentile(elapsed, 0.5),
            p90ElapsedMs: percentile(elapsed, 0.9),
            p95ElapsedMs: percentile(elapsed, 0.95),
            medianPeakRssMiB: percentile(rss, 0.5),
            p90PeakRssMiB: percentile(rss, 0.9),
        });
    }
    writeCsv(path.join(layout.summaryDir, "real_project_batch_summary_by_config.csv"), rows);
    writeCsv(path.join(layout.performanceDir, "runtime_by_config.csv"), rows, [
        "config", "configLabel", "projects", "medianElapsedMs", "p90ElapsedMs", "p95ElapsedMs",
        "medianPeakRssMiB", "p90PeakRssMiB", "timeout", "failed", "doneAnalysisIncomplete",
    ]);
}

function writeStatusDistribution(records: ProjectRunRecord[], configs: ConfigName[], layout: ExperimentLayout): void {
    const rows: Array<Record<string, unknown>> = [];
    for (const config of configs) {
        const rs = records.filter(r => r.config === config);
        const statuses = [...new Set(rs.map(r => r.status))].sort();
        for (const status of statuses) {
            rows.push({ config, status, count: countStatus(rs, status) });
        }
    }
    writeCsv(path.join(layout.performanceDir, "project_status_distribution.csv"), rows);
}

function writeBudgetExceeded(records: ProjectRunRecord[], layout: ExperimentLayout): void {
    const rows = records.filter(r => (r.analysisBudgetExceededCount || 0) > 0 || r.status === "done_analysis_incomplete");
    writeCsv(path.join(layout.performanceDir, "budget_exceeded_projects.csv"), rows, [
        "config", "shard", "project", "status", "observedFlows", "partialFlows", "elapsedMs", "peakRssMiB", "summaryJson",
    ]);
}

function readExperimentSpec(opts: Options, layout: ExperimentLayout): ExperimentSpec {
    const projectManifest = path.join(layout.datasetsDir, "project_manifest.csv");
    const runManifestPath = path.join(layout.root, "run_manifest.json");
    const projects = fs.existsSync(projectManifest)
        ? readProjectManifest(projectManifest)
        : prepareExperiment(opts, layout);
    let configs = opts.configs;
    let shardCount = opts.shards;
    if (fs.existsSync(runManifestPath)) {
        try {
            const manifest = JSON.parse(fs.readFileSync(runManifestPath, "utf-8"));
            const manifestConfigs = Array.isArray(manifest.configs)
                ? manifest.configs.map((item: any) => item?.config).filter((value: string) => CONFIGS[value as ConfigName]) as ConfigName[]
                : [];
            if (manifestConfigs.length > 0) configs = manifestConfigs;
            if (Number.isInteger(manifest.shardCount) && manifest.shardCount > 0) shardCount = manifest.shardCount;
        } catch {
            // Fall back to command-line options if the manifest is corrupt.
        }
    }
    return {
        projects,
        configs,
        shardCount,
        inventoryRowCount: sum(projects.map(p => p.inventoryRowCount)),
        runnableProjectCount: projects.length,
        duplicateInventoryGroupCount: projects.filter(p => p.duplicateInventoryRows > 0).length,
        duplicateInventoryRowCount: sum(projects.map(p => p.duplicateInventoryRows)),
    };
}

function readProjectManifest(file: string): InventoryProject[] {
    const text = fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];
    const header = parseCsvLine(lines[0]);
    return lines.slice(1).map((line, index) => {
        const values = parseCsvLine(line);
        const row: Record<string, string> = {};
        for (let i = 0; i < header.length; i++) row[header[i]] = values[i] ?? "";
        const etsFiles = parseIntSafe(row.etsFiles);
        const productionEtsFiles = parseIntSafe(row.productionEtsFiles);
        return {
            project: row.project || "",
            inventoryName: row.inventoryName || "",
            localPath: row.localPath || "",
            sourceUrl: row.sourceUrl || "",
            etsFiles,
            productionEtsFiles,
            harmonyConfigFiles: row.harmonyConfigFiles || "",
            contentStatus: row.contentStatus || "",
            contentReason: row.contentReason || "",
            originalIndex: index,
            inventoryRowCount: parseIntSafe(row.inventoryRowCount) || 1,
            duplicateInventoryRows: parseIntSafe(row.duplicateInventoryRows),
            inventoryOriginalIndexes: row.inventoryOriginalIndexes || String(index),
            inventoryNames: row.inventoryNames || row.inventoryName || "",
            sourceUrls: row.sourceUrls || row.sourceUrl || "",
            sizeTier: parseSizeTier(row.sizeTier, productionEtsFiles || etsFiles),
            shard: parseShard(row.shard),
        };
    }).filter(item => item.project.length > 0);
}

function writeFlowMatrix(spec: ExperimentSpec, records: ProjectRunRecord[], layout: ExperimentLayout): void {
    const byKey = firstRecordByProjectConfig(records);
    const rows = spec.projects.map(project => {
        const row: Record<string, unknown> = {
            project: project.project,
            shard: shardName(project.shard),
            inventoryRowCount: project.inventoryRowCount,
            duplicateInventoryRows: project.duplicateInventoryRows,
            localPath: project.localPath,
        };
        for (const config of spec.configs) {
            const record = byKey.get(projectConfigKey(config, project.project));
            row[`${config}Status`] = record?.status ?? "missing";
            row[`${config}ObservedFlows`] = record?.observedFlows ?? null;
            row[`${config}TotalFlows`] = record?.totalFlows ?? null;
            row[`${config}PartialFlows`] = record?.partialFlows ?? null;
        }
        const base = byKey.get(projectConfigKey("base", project.project))?.observedFlows ?? null;
        for (const config of spec.configs) {
            const value = byKey.get(projectConfigKey(config, project.project))?.observedFlows ?? null;
            row[`${config}DeltaVsBase`] = isNumber(base) && isNumber(value) ? value - base : null;
        }
        return row;
    });
    writeCsv(path.join(layout.summaryDir, "real_project_flow_matrix_by_project.csv"), rows);
}

function writePerformanceMatrix(spec: ExperimentSpec, records: ProjectRunRecord[], layout: ExperimentLayout): void {
    const byKey = firstRecordByProjectConfig(records);
    const rows = spec.projects.map(project => {
        const row: Record<string, unknown> = {
            project: project.project,
            shard: shardName(project.shard),
            sizeTier: project.sizeTier,
            productionEtsFiles: project.productionEtsFiles,
            etsFiles: project.etsFiles,
        };
        for (const config of spec.configs) {
            const record = byKey.get(projectConfigKey(config, project.project));
            row[`${config}Status`] = record?.status ?? "missing";
            row[`${config}ElapsedMs`] = record?.elapsedMs ?? null;
            row[`${config}PeakRssMiB`] = record?.peakRssMiB ?? null;
            row[`${config}PeakHeapUsedMiB`] = record?.peakHeapUsedMiB ?? null;
            row[`${config}StageTotalMs`] = record?.stageTotalMs ?? null;
        }
        return row;
    });
    writeCsv(path.join(layout.performanceDir, "performance_matrix_by_project.csv"), rows);
}

function writeIntegrityReports(spec: ExperimentSpec, records: ProjectRunRecord[], layout: ExperimentLayout): Record<string, unknown> {
    const expected = new Map<string, InventoryProject>();
    for (const project of spec.projects) {
        for (const config of spec.configs) {
            expected.set(projectConfigKey(config, project.project), project);
        }
    }

    const grouped = new Map<string, ProjectRunRecord[]>();
    for (const record of records) {
        const key = projectConfigKey(record.config, record.project);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(record);
    }

    const matrixRows: Array<Record<string, unknown>> = [];
    const missingRows: Array<Record<string, unknown>> = [];
    const duplicateRows: Array<Record<string, unknown>> = [];
    const unexpectedRows: Array<Record<string, unknown>> = [];
    let presentRecords = 0;
    let missingRecords = 0;
    let duplicateExtraRecords = 0;

    for (const config of spec.configs) {
        for (const project of spec.projects) {
            const key = projectConfigKey(config, project.project);
            const matches = grouped.get(key) || [];
            if (matches.length === 0) {
                missingRecords++;
                const row = {
                    config,
                    project: project.project,
                    expectedShard: shardName(project.shard),
                    localPath: project.localPath,
                    reason: "missing_project_config_record",
                };
                missingRows.push(row);
                matrixRows.push({
                    ...row,
                    integrityStatus: "missing",
                    recordCount: 0,
                    runStatus: "missing",
                    observedFlows: null,
                    elapsedMs: null,
                    peakRssMiB: null,
                });
                continue;
            }
            presentRecords++;
            if (matches.length > 1) {
                duplicateExtraRecords += matches.length - 1;
                matches.forEach((record, duplicateIndex) => duplicateRows.push({
                    config,
                    project: project.project,
                    duplicateIndex,
                    shard: record.shard,
                    status: record.status,
                    observedFlows: record.observedFlows,
                    summaryJson: record.summaryJson,
                }));
            }
            const record = matches[0];
            matrixRows.push({
                config,
                project: project.project,
                expectedShard: shardName(project.shard),
                actualShard: record.shard,
                integrityStatus: matches.length === 1 ? "present" : "duplicate",
                recordCount: matches.length,
                runStatus: record.status,
                observedFlows: record.observedFlows,
                elapsedMs: record.elapsedMs,
                peakRssMiB: record.peakRssMiB,
                summaryJson: record.summaryJson,
            });
        }
    }

    for (const [key, matches] of grouped) {
        if (expected.has(key)) continue;
        for (const record of matches) {
            unexpectedRows.push({
                config: record.config,
                project: record.project,
                shard: record.shard,
                status: record.status,
                observedFlows: record.observedFlows,
                summaryJson: record.summaryJson,
                reason: "record_not_in_prepared_expected_matrix",
            });
        }
    }

    const expectedRecords = spec.projects.length * spec.configs.length;
    const summary = {
        generatedAt: new Date().toISOString(),
        complete: missingRecords === 0 && duplicateExtraRecords === 0 && unexpectedRows.length === 0,
        inventoryRows: spec.inventoryRowCount,
        runnableProjects: spec.runnableProjectCount,
        duplicateInventoryGroups: spec.duplicateInventoryGroupCount,
        duplicateInventoryRows: spec.duplicateInventoryRowCount,
        configs: spec.configs,
        configCount: spec.configs.length,
        shardCount: spec.shardCount,
        expectedRecords,
        actualRecords: records.length,
        presentProjectConfigKeys: presentRecords,
        missingRecords,
        duplicateExtraRecords,
        unexpectedRecords: unexpectedRows.length,
    };

    writeCsv(path.join(layout.summaryDir, "experiment_integrity_matrix.csv"), matrixRows);
    writeCsv(path.join(layout.summaryDir, "missing_project_config_records.csv"), missingRows);
    writeCsv(path.join(layout.summaryDir, "duplicate_project_config_records.csv"), duplicateRows);
    writeCsv(path.join(layout.summaryDir, "unexpected_project_config_records.csv"), unexpectedRows);
    fs.writeFileSync(path.join(layout.summaryDir, "experiment_integrity_summary.json"), JSON.stringify(summary, null, 2), "utf-8");
    fs.writeFileSync(path.join(layout.summaryDir, "experiment_integrity_summary.md"), integritySummaryMarkdown(summary), "utf-8");
    return summary;
}

function readInventory(file: string): InventoryProject[] {
    const text = fs.readFileSync(file, "utf-8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];
    const header = parseCsvLine(lines[0]);
    return lines.slice(1).map((line, index) => {
        const values = parseCsvLine(line);
        const row: Record<string, string> = {};
        for (let i = 0; i < header.length; i++) row[header[i]] = values[i] ?? "";
        const localPath = row.local_path || row["local_path"] || "";
        const inventoryName = row["名称"] || row.name || row.repo || path.basename(localPath);
        const project = path.basename(localPath) || inventoryName;
        const sourceUrl = row.html_url || row["来源地址"] || "";
        const productionEtsFiles = parseIntSafe(row.production_ets_files);
        const etsFiles = parseIntSafe(row.ets_files);
        return {
            project,
            inventoryName,
            localPath,
            sourceUrl,
            etsFiles,
            productionEtsFiles,
            harmonyConfigFiles: row.harmony_config_files || "",
            contentStatus: row.content_status || "",
            contentReason: row.content_reason || "",
            originalIndex: index,
            inventoryRowCount: 1,
            duplicateInventoryRows: 0,
            inventoryOriginalIndexes: String(index),
            inventoryNames: inventoryName,
            sourceUrls: sourceUrl,
            sizeTier: sizeTier(productionEtsFiles || etsFiles),
            shard: 0,
        };
    }).filter(item => item.project.length > 0);
}

function selectProjects(projects: InventoryProject[], opts: Options): InventoryProject[] {
    let selected = projects.filter(p => !p.contentStatus || p.contentStatus === "keep");
    if (opts.project) {
        selected = selected.filter(p => p.project === opts.project || p.inventoryName === opts.project);
    }
    if (opts.order === "small-first") {
        selected = [...selected].sort((a, b) => projectSize(a) - projectSize(b) || a.originalIndex - b.originalIndex);
    } else if (opts.order === "large-first") {
        selected = [...selected].sort((a, b) => projectSize(b) - projectSize(a) || a.originalIndex - b.originalIndex);
    } else {
        selected = [...selected].sort((a, b) => a.originalIndex - b.originalIndex);
    }
    const deduped = dedupeRunnableProjects(selected);
    return opts.maxProjects > 0 ? deduped.slice(0, opts.maxProjects) : deduped;
}

function dedupeRunnableProjects(rows: InventoryProject[]): InventoryProject[] {
    const grouped = new Map<string, InventoryProject[]>();
    for (const row of rows) {
        if (!grouped.has(row.project)) grouped.set(row.project, []);
        grouped.get(row.project)!.push(row);
    }
    const out: InventoryProject[] = [];
    for (const group of grouped.values()) {
        const primary = { ...group[0] };
        primary.inventoryRowCount = group.length;
        primary.duplicateInventoryRows = Math.max(0, group.length - 1);
        primary.inventoryOriginalIndexes = group.map(item => item.originalIndex).join(";");
        primary.inventoryNames = uniqueValues(group.map(item => item.inventoryName)).join(";");
        primary.sourceUrls = uniqueValues(group.map(item => item.sourceUrl)).join(";");
        out.push(primary);
    }
    return out;
}

function assignBalancedShards(projects: InventoryProject[], shardCount: number): void {
    const weights = Array.from({ length: shardCount }, () => 0);
    const sorted = [...projects].sort((a, b) => projectSize(b) - projectSize(a) || a.originalIndex - b.originalIndex);
    for (const project of sorted) {
        let best = 0;
        for (let i = 1; i < weights.length; i++) {
            if (weights[i] < weights[best]) best = i;
        }
        const target = projects.find(p => p.project === project.project && p.originalIndex === project.originalIndex);
        if (target) target.shard = best;
        weights[best] += Math.max(1, projectSize(project));
    }
}

function writeProjectManifests(projects: InventoryProject[], opts: Options, layout: ExperimentLayout): void {
    fs.writeFileSync(path.join(layout.datasetsDir, "projects_all.txt"), projects.map(p => p.project).join("\n") + "\n", "utf-8");
    writeCsv(path.join(layout.datasetsDir, "project_manifest.csv"), projects, [
        "project", "inventoryName", "localPath", "etsFiles", "productionEtsFiles",
        "sizeTier", "shard", "inventoryRowCount", "duplicateInventoryRows",
        "inventoryOriginalIndexes", "inventoryNames", "sourceUrls",
        "contentStatus", "contentReason", "harmonyConfigFiles",
    ]);
    writeCsv(path.join(layout.datasetsDir, "duplicate_inventory_rows.csv"), projects.filter(p => p.duplicateInventoryRows > 0), [
        "project", "inventoryRowCount", "duplicateInventoryRows", "inventoryOriginalIndexes",
        "inventoryNames", "sourceUrls", "localPath",
    ]);
    for (let shard = 0; shard < opts.shards; shard++) {
        const shardProjects = projects
            .filter(p => p.shard === shard)
            .sort((a, b) => a.originalIndex - b.originalIndex);
        const shardName = `shard_${String(shard).padStart(3, "0")}`;
        fs.writeFileSync(path.join(layout.shardsDir, `${shardName}.txt`), shardProjects.map(p => p.project).join("\n") + (shardProjects.length ? "\n" : ""), "utf-8");
    }
    writeShardManifest(projects, opts, layout);
}

function writeShardManifest(projects: InventoryProject[], opts: Options, layout: ExperimentLayout): void {
    const rows: Array<Record<string, unknown>> = [];
    for (let shard = 0; shard < opts.shards; shard++) {
        const shardProjects = projects.filter(p => p.shard === shard);
        rows.push({
            shard: shardName(shard),
            projectCount: shardProjects.length,
            inventoryRowCount: sum(shardProjects.map(p => p.inventoryRowCount)),
            weightProductionEtsFiles: sum(shardProjects.map(p => projectSize(p))),
            small: shardProjects.filter(p => p.sizeTier === "small").length,
            medium: shardProjects.filter(p => p.sizeTier === "medium").length,
            large: shardProjects.filter(p => p.sizeTier === "large").length,
            xlarge: shardProjects.filter(p => p.sizeTier === "xlarge").length,
        });
    }
    writeCsv(path.join(layout.datasetsDir, "shard_manifest.csv"), rows);
}

function writeExpectedMatrix(projects: InventoryProject[], opts: Options, layout: ExperimentLayout): void {
    const rows: Array<Record<string, unknown>> = [];
    for (const config of opts.configs) {
        for (const project of projects) {
            rows.push({
                config,
                configLabel: CONFIGS[config].label,
                project: project.project,
                shard: shardName(project.shard),
                localPath: project.localPath,
                inventoryRowCount: project.inventoryRowCount,
                duplicateInventoryRows: project.duplicateInventoryRows,
            });
        }
    }
    writeCsv(path.join(layout.datasetsDir, "expected_project_config_matrix.csv"), rows);
}

function writeDatasetIntegrity(projects: InventoryProject[], opts: Options, layout: ExperimentLayout): void {
    const projectCounts = countBy(projects.map(p => p.project));
    const duplicateRunnableProjects = [...projectCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([project, count]) => ({ project, count }));
    const shardMembership = new Map<string, number>();
    for (let shard = 0; shard < opts.shards; shard++) {
        for (const project of projects.filter(p => p.shard === shard)) {
            shardMembership.set(project.project, (shardMembership.get(project.project) || 0) + 1);
        }
    }
    const badShardMembership = [...shardMembership.entries()]
        .filter(([, count]) => count !== 1)
        .map(([project, count]) => ({ project, count }));
    const summary = {
        generatedAt: new Date().toISOString(),
        inventoryRows: sum(projects.map(p => p.inventoryRowCount)),
        runnableProjects: projects.length,
        duplicateInventoryGroups: projects.filter(p => p.duplicateInventoryRows > 0).length,
        duplicateInventoryRows: sum(projects.map(p => p.duplicateInventoryRows)),
        duplicateRunnableProjects: duplicateRunnableProjects.length,
        badShardMembership: badShardMembership.length,
        configs: opts.configs,
        expectedProjectConfigRecords: projects.length * opts.configs.length,
        complete: duplicateRunnableProjects.length === 0 && badShardMembership.length === 0,
    };
    fs.writeFileSync(path.join(layout.datasetsDir, "dataset_integrity_summary.json"), JSON.stringify(summary, null, 2), "utf-8");
    writeCsv(path.join(layout.datasetsDir, "duplicate_runnable_projects.csv"), duplicateRunnableProjects);
    writeCsv(path.join(layout.datasetsDir, "bad_shard_membership.csv"), badShardMembership);
}

function writeEnvironmentAndRunManifest(projects: InventoryProject[], opts: Options, layout: ExperimentLayout): void {
    const environment = {
        generatedAt: new Date().toISOString(),
        cwd: process.cwd(),
        platform: `${os.type()} ${os.release()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model || "",
        cpuCount: os.cpus().length,
        totalMemoryGiB: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
        node: process.version,
        npm: safeExec("npm", ["--version"]),
        gitCommit: safeExec("git", ["rev-parse", "HEAD"]),
        gitBranch: safeExec("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    };
    fs.writeFileSync(path.join(layout.root, "environment.json"), JSON.stringify(environment, null, 2), "utf-8");
    const runManifest = {
        runId: opts.runId,
        generatedAt: new Date().toISOString(),
        inventoryCsv: opts.inventoryCsv,
        projectRoot: opts.projectRoot,
        inventoryRowCount: sum(projects.map(p => p.inventoryRowCount)),
        runnableProjectCount: projects.length,
        projectCount: projects.length,
        duplicateInventoryGroupCount: projects.filter(p => p.duplicateInventoryRows > 0).length,
        duplicateInventoryRowCount: sum(projects.map(p => p.duplicateInventoryRows)),
        shardCount: opts.shards,
        expectedProjectConfigRecords: projects.length * opts.configs.length,
        configs: opts.configs.map(config => ({ config, ...CONFIGS[config] })),
        mode: {
            flowMode: opts.flowMode,
            reportMode: opts.reportMode,
            executionMode: opts.executionMode,
            projectTimeoutSeconds: opts.projectTimeoutSeconds,
            worklistBudgetMs: opts.worklistBudgetMs,
            worklistMaxVisited: opts.worklistMaxVisited,
            sourceDirMode: opts.sourceDirMode,
            noLlm: true,
            tracePathProvenance: "disabled by raw/light mode",
        },
    };
    fs.writeFileSync(path.join(layout.root, "run_manifest.json"), JSON.stringify(runManifest, null, 2), "utf-8");
}

function mkdirs(layout: ExperimentLayout): void {
    for (const dir of [
        layout.root,
        layout.datasetsDir,
        layout.shardsDir,
        layout.registryDir,
        layout.realProjectsDir,
        layout.summaryDir,
        layout.performanceDir,
    ]) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
            if (ch === "\"") {
                if (line[i + 1] === "\"") {
                    cur += "\"";
                    i++;
                } else {
                    quoted = false;
                }
            } else {
                cur += ch;
            }
        } else if (ch === "\"") {
            quoted = true;
        } else if (ch === ",") {
            out.push(cur);
            cur = "";
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}

function writeCsv(file: string, rows: Array<Record<string, unknown> | any>, fields?: string[]): void {
    const keys = fields || inferFields(rows);
    const lines = [keys.join(",")];
    for (const row of rows) {
        lines.push(keys.map(key => csvEscape(row[key])).join(","));
    }
    fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8");
}

function inferFields(rows: Array<Record<string, unknown> | any>): string[] {
    const keys: string[] = [];
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (!keys.includes(key)) keys.push(key);
        }
    }
    return keys;
}

function csvEscape(value: unknown): string {
    const text = String(value ?? "");
    if (!/[",\r\n]/.test(text)) return text;
    return `"${text.replace(/"/g, "\"\"")}"`;
}

function appendJsonl(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf-8");
}

function firstRecordByProjectConfig(records: ProjectRunRecord[]): Map<string, ProjectRunRecord> {
    const out = new Map<string, ProjectRunRecord>();
    for (const record of records) {
        const key = projectConfigKey(record.config, record.project);
        if (!out.has(key)) out.set(key, record);
    }
    return out;
}

function projectConfigKey(config: string, project: string): string {
    return `${config}\u0000${project}`;
}

function shardName(shard: number): string {
    return `shard_${String(shard).padStart(3, "0")}`;
}

function parseShard(value: string): number {
    const match = /^shard_(\d+)$/.exec(value || "");
    if (match) return parseIntSafe(match[1]);
    return parseIntSafe(value);
}

function parseSizeTier(value: string, size: number): InventoryProject["sizeTier"] {
    if (value === "small" || value === "medium" || value === "large" || value === "xlarge") return value;
    return sizeTier(size);
}

function uniqueValues(values: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        const normalized = value || "";
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

function countBy(values: string[]): Map<string, number> {
    const out = new Map<string, number>();
    for (const value of values) out.set(value, (out.get(value) || 0) + 1);
    return out;
}

function integritySummaryMarkdown(summary: Record<string, unknown>): string {
    return [
        "# Chapter 3 Batch Integrity Summary",
        "",
        `- Generated at: ${summary.generatedAt}`,
        `- Complete: ${summary.complete}`,
        `- Inventory rows: ${summary.inventoryRows}`,
        `- Runnable projects: ${summary.runnableProjects}`,
        `- Duplicate inventory groups: ${summary.duplicateInventoryGroups}`,
        `- Duplicate inventory rows: ${summary.duplicateInventoryRows}`,
        `- Configs: ${Array.isArray(summary.configs) ? summary.configs.join(", ") : ""}`,
        `- Shards: ${summary.shardCount}`,
        `- Expected project-config records: ${summary.expectedRecords}`,
        `- Actual records: ${summary.actualRecords}`,
        `- Present project-config keys: ${summary.presentProjectConfigKeys}`,
        `- Missing records: ${summary.missingRecords}`,
        `- Duplicate extra records: ${summary.duplicateExtraRecords}`,
        `- Unexpected records: ${summary.unexpectedRecords}`,
        "",
        "A run is complete for report aggregation only when missing records, duplicate extra records, and unexpected records are all zero.",
        "",
    ].join("\n");
}

function sizeTier(size: number): InventoryProject["sizeTier"] {
    if (size <= 20) return "small";
    if (size <= 100) return "medium";
    if (size <= 300) return "large";
    return "xlarge";
}

function projectSize(project: InventoryProject): number {
    return project.productionEtsFiles || project.etsFiles || 1;
}

function countStatus(records: ProjectRunRecord[], status: string): number {
    return records.filter(r => r.status === status).length;
}

function percentile(values: number[], q: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return Number(sorted[index].toFixed(3));
}

function sum(values: Array<number | null>): number {
    return values.reduce((acc, value) => acc + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0);
}

function isNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function numberOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseIntSafe(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function parsePositiveInt(value: string, arg: string): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${arg} must be positive, got ${value}`);
    return Math.floor(n);
}

function parseNonNegativeInt(value: string, arg: string): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${arg} must be non-negative, got ${value}`);
    return Math.floor(n);
}

function parseOrder(value: string): OrderMode {
    if (value === "ranked" || value === "small-first" || value === "large-first") return value;
    throw new Error(`--order must be ranked, small-first, or large-first`);
}

function parseConfigs(value: string): ConfigName[] {
    const configs = value.split(",").map(item => item.trim()).filter(Boolean) as ConfigName[];
    for (const config of configs) {
        if (!CONFIGS[config]) throw new Error(`unknown config: ${config}`);
    }
    return configs;
}

function parseSourceDirMode(value: string): Options["sourceDirMode"] {
    if (value === "project" || value === "split" || value === "auto") return value;
    throw new Error(`--sourceDirMode must be project, split, or auto`);
}

function parseFlowMode(value: string): Options["flowMode"] {
    if (value === "raw" || value === "candidate" || value === "postsolve") return value;
    throw new Error(`--flowMode must be raw, candidate, or postsolve`);
}

function parseReportMode(value: string): Options["reportMode"] {
    if (value === "light" || value === "full") return value;
    throw new Error(`--reportMode must be light or full`);
}

function parseExecutionMode(value: string): Options["executionMode"] {
    if (value === "subprocess" || value === "in-process") return value;
    throw new Error(`--executionMode must be subprocess or in-process`);
}

function safeExec(command: string, args: string[]): string {
    try {
        const result = spawnSync(command, args, { encoding: "utf-8", windowsHide: true });
        return (result.stdout || result.stderr || "").trim();
    } catch {
        return "";
    }
}

function timestampForPath(): string {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "_");
}

function printHelp(): void {
    console.log([
        "Usage: node out/tools/chapter3_budget_batch_orchestrator.js <prepare|run|merge|smoke> [options]",
        "",
        "Purpose:",
        "  Run the Chapter 3 budget-limited raw batch experiment across four no-LLM configs.",
        "",
        "Common options:",
        "  --inventoryCsv <path>             Default tmp/repo_metrics_experiment/...content_filtered.csv",
        "  --projectRoot <path>              Default ../project",
        "  --outputRoot <path>               Default tmp/test_runs/chapter3",
        "  --runId <name>                    Stable run id under outputRoot",
        "  --maxProjects <n>                 Limit selected projects; 0 means all",
        "  --project <name>                  Run one named project/folder",
        "  --order <ranked|small-first|large-first>",
        "  --shards <n>                      Balanced project shards",
        "  --parallel <n>                    Concurrent batch worker processes",
        "  --configs <a,b,c>                 base,ude,oclfs,ude_oclfs",
        "  --projectTimeoutSeconds <n>       Hard timeout passed to each project",
        "  --worklistMaxVisited <n>          Per-entry visited-fact cap",
        "  --flowMode <raw|candidate|postsolve>",
        "  --reportMode <light|full>",
        "  --executionMode <subprocess|in-process>",
        "  --dryRun                          Print worker commands without running",
        "",
        "Examples:",
        "  node out/tools/chapter3_budget_batch_orchestrator.js smoke --worklistMaxVisited 1000 --projectTimeoutSeconds 90",
        "  node out/tools/chapter3_budget_batch_orchestrator.js run --runId chapter3_budget_formal_20260629 --shards 12 --parallel 8 --worklistMaxVisited 5000 --projectTimeoutSeconds 240",
        "  node out/tools/chapter3_budget_batch_orchestrator.js merge --runId chapter3_budget_formal_20260629",
    ].join("\n"));
}

main().catch(error => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
});
