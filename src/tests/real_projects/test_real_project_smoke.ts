import {
    AnalyzeReport,
    EntryAnalyzeResult,
    emptyAnalyzeErrorDiagnostics,
    emptyRuleHitCounters,
    emptyTransferProfile,
    emptyDetectProfile,
    emptyExecutionHandoffAudit,
    emptyEnginePluginAuditSnapshot,
    emptyEntryStageProfile,
} from "../../cli/analyzeTypes";
import { emptyModuleAuditSnapshot } from "../../core/kernel/contracts/ModuleContract";
import { emptyPagNodeResolutionAuditSnapshot } from "../../core/kernel/contracts/PagNodeResolution";
import { CliOptions as AnalyzeCliOptions } from "../../cli/analyzeCliOptions";
import { runAnalyze } from "../../cli/analyzeRunner";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import {
    CliOptions,
    EntrySmokeResult,
    ProjectSmokeResult,
    SmokeManifest,
    SmokeProjectConfig,
} from "../helpers/SmokeTypes";
import {
    aggregateReport,
    createSourceSummary,
    printConsoleSummary,
    renderMarkdownReport,
} from "../helpers/SmokeReportUtils";
import * as fs from "fs";
import * as path from "path";
import {
    createTestProgressReporter,
    printTestConsoleSummary,
    resolveTestOutputLayout,
    TestFailureSummary,
    TestOutputMetadata,
    writeTestSummary,
} from "../helpers/TestOutputContract";

function sumCounts(counts: Record<string, number>): number {
    return Object.values(counts || {}).reduce((sum, value) => sum + value, 0);
}

function buildSinkEndpointHits(flowRuleTraces: EntryAnalyzeResult["flowRuleTraces"]): Record<string, number> {
    const hits: Record<string, number> = {};
    for (const trace of flowRuleTraces || []) {
        const endpoint = String(trace.sinkEndpoint || "").trim();
        if (!endpoint) continue;
        hits[endpoint] = (hits[endpoint] || 0) + 1;
    }
    return hits;
}

function buildSinkFamilyHits(
    flowRuleTraces: EntryAnalyzeResult["flowRuleTraces"],
    sinkFamilyById: Map<string, string>,
): Record<string, number> {
    const hits: Record<string, number> = {};
    for (const trace of flowRuleTraces || []) {
        const sinkRuleId = String(trace.sinkRuleId || "").trim();
        if (!sinkRuleId) continue;
        const family = String(sinkFamilyById.get(sinkRuleId) || "").trim();
        if (!family) continue;
        hits[family] = (hits[family] || 0) + 1;
    }
    return hits;
}

function parseArgs(argv: string[]): CliOptions {
    let manifestPath = "tests/manifests/real_projects/smoke_projects.json";
    let k = 1;
    let maxEntries = 12;
    let outputDir = "tmp/test_runs/real_projects/smoke/latest";
    let projectFilter: string | undefined;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--manifest" && i + 1 < argv.length) {
            manifestPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--manifest=")) {
            manifestPath = arg.slice("--manifest=".length);
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
        if (arg === "--outputDir" && i + 1 < argv.length) {
            outputDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--outputDir=")) {
            outputDir = arg.slice("--outputDir=".length);
            continue;
        }
        if (arg === "--project" && i + 1 < argv.length) {
            projectFilter = argv[++i];
            continue;
        }
        if (arg.startsWith("--project=")) {
            projectFilter = arg.slice("--project=".length);
            continue;
        }
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}. Expected 0 or 1.`);
    }
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) {
        throw new Error(`Invalid --maxEntries value: ${maxEntries}. Expected positive integer.`);
    }

    return {
        manifestPath,
        k,
        maxEntries: Math.floor(maxEntries),
        outputDir,
        projectFilter,
    };
}

function ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
}

function readManifest(manifestPath: string): SmokeManifest {
    const abs = path.isAbsolute(manifestPath) ? manifestPath : path.resolve(manifestPath);
    if (!fs.existsSync(abs)) {
        throw new Error(`Manifest file not found: ${abs}`);
    }
    const parsed = JSON.parse(fs.readFileSync(abs, "utf-8")) as SmokeManifest;
    if (!parsed.projects || !Array.isArray(parsed.projects)) {
        throw new Error(`Invalid manifest format: missing projects[] in ${abs}`);
    }
    return parsed;
}

function sanitizeProjectId(raw: string): string {
    const normalized = String(raw || "")
        .replace(/[^A-Za-z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return normalized.length > 0 ? normalized : "project";
}

function createSyntheticEntryResult(
    sourceDir: string,
    status: EntrySmokeResult["status"],
    error?: string
): EntrySmokeResult {
    return {
        sourceDir,
        entryName: "@arkMain",
        entryPathHint: sourceDir,
        signature: "@arkMain",
        score: 100,
        status,
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
        error,
        elapsedMs: 0,
    };
}

function mapAnalyzeEntryToSmokeEntry(
    entry: EntryAnalyzeResult,
    sinkFamilyById: Map<string, string>,
): EntrySmokeResult {
    const flowRuleTraces = entry.flowRuleTraces || [];
    const sinkRuleHits = { ...(entry.ruleHits?.sink || {}) };
    const sinkEndpointHits = buildSinkEndpointHits(flowRuleTraces);
    const sinkFamilyHits = buildSinkFamilyHits(flowRuleTraces, sinkFamilyById);

    return {
        sourceDir: entry.sourceDir,
        entryName: entry.entryName,
        entryPathHint: entry.entryPathHint,
        signature: entry.entryName,
        score: entry.score,
        status: entry.status,
        seedLocalNames: entry.seedLocalNames || [],
        seedStrategies: entry.seedStrategies || [],
        seedCount: entry.seedCount || 0,
        flowCount: entry.flowCount || 0,
        flowRuleTraces,
        sinkRuleHits,
        sinkFamilyHits,
        sinkEndpointHits,
        sinkFlowByKeyword: {},
        sinkFlowBySignature: {},
        sinkSamples: entry.sinkSamples || [],
        error: entry.error,
        elapsedMs: entry.elapsedMs || 0,
    };
}

function createAnalyzeOptions(
    repoAbs: string,
    validSourceDirs: string[],
    outputDir: string,
    k: number,
    maxEntries: number
): AnalyzeCliOptions {
    return {
        repo: repoAbs,
        sourceDirs: validSourceDirs,
        profile: "default",
        k,
        maxEntries,
        reportMode: "full",
        outputDir,
        concurrency: Math.max(1, Math.min(2, validSourceDirs.length)),
        incremental: false,
        incrementalCachePath: undefined,
        stopOnFirstFlow: false,
        maxFlowsPerEntry: undefined,
        enableSecondarySinkSweep: false,
        ruleOptions: {
            autoDiscoverLayers: true,
        },
    };
}

function buildSourceDirEntries(
    sourceDirs: string[],
    mappedEntries: EntrySmokeResult[],
    fatalErrors: string[]
): EntrySmokeResult[] {
    const bySourceDir = new Map<string, EntrySmokeResult>();
    for (const entry of mappedEntries) {
        bySourceDir.set(entry.sourceDir, entry);
    }

    const out: EntrySmokeResult[] = [];
    for (const sourceDir of sourceDirs) {
        const hit = bySourceDir.get(sourceDir);
        if (hit) {
            out.push(hit);
            continue;
        }
        const missing = fatalErrors.find(err => err.includes(sourceDir));
        out.push(createSyntheticEntryResult(sourceDir, "exception", missing || "source_dir_not_analyzed"));
    }
    return out;
}

function createFallbackAnalyzeReport(repoAbs: string, sourceDirs: string[]): AnalyzeReport {
    const entries = sourceDirs.map(sourceDir => ({
        sourceDir,
        entryName: "@arkMain",
        entryPathHint: sourceDir,
        score: 100,
        status: "exception" as const,
        seedCount: 0,
        seedLocalNames: [],
        seedStrategies: [],
        flowCount: 0,
        sinkSamples: [],
        flowRuleTraces: [],
        ruleHits: emptyRuleHitCounters(),
        ruleHitEndpoints: emptyRuleHitCounters(),
        transferProfile: emptyTransferProfile(),
        detectProfile: emptyDetectProfile(),
        stageProfile: emptyEntryStageProfile(),
        transferNoHitReasons: ["analyze_exception"],
        pagNodeResolutionAudit: emptyPagNodeResolutionAuditSnapshot(),
        executionHandoffAudit: emptyExecutionHandoffAudit(),
        moduleAudit: emptyModuleAuditSnapshot(),
        enginePluginAudit: emptyEnginePluginAuditSnapshot(),
        elapsedMs: 0,
        error: "analyze_failed",
    }));

    return {
        generatedAt: new Date().toISOString(),
        repo: repoAbs,
        sourceDirs,
        profile: "default",
        reportMode: "full",
        k: 1,
        maxEntries: sourceDirs.length,
        ruleLayers: [],
        ruleLayerStatus: [],
        summary: {
            totalEntries: entries.length,
            okEntries: 0,
            withSeeds: 0,
            withFlows: 0,
            totalFlows: 0,
            statusCount: { exception: entries.length },
            ruleHits: emptyRuleHitCounters(),
            ruleHitEndpoints: emptyRuleHitCounters(),
            transferProfile: {
                ...emptyTransferProfile(),
                elapsedShareAvg: 0,
            },
            detectProfile: emptyDetectProfile(),
            memoryProfile: {
                sampleIntervalMs: 0,
                sampleCount: 0,
                rssMiB: 0,
                heapUsedMiB: 0,
                heapTotalMiB: 0,
                externalMiB: 0,
                arrayBuffersMiB: 0,
                peakRssMiB: 0,
                peakHeapUsedMiB: 0,
                peakHeapTotalMiB: 0,
                peakExternalMiB: 0,
                peakArrayBuffersMiB: 0,
            },
            pagNodeResolutionAudit: emptyPagNodeResolutionAuditSnapshot(),
            executionHandoffAudit: emptyExecutionHandoffAudit(),
            diagnostics: emptyAnalyzeErrorDiagnostics(),
            diagnosticItems: [],
            moduleAudit: {
                loadedModuleIds: [],
                failedModuleIds: [],
                discoveredModuleProjects: [],
                enabledModuleProjects: [],
                modules: {},
            },
            pluginAudit: {
                loadedPluginNames: [],
                failedPluginNames: [],
                plugins: {},
            },
            stageProfile: {
                ruleLoadMs: 0,
                sceneBuildMs: 0,
                entrySelectMs: 0,
                entryAnalyzeMs: 0,
                reportWriteMs: 0,
                sceneCacheHitCount: 0,
                sceneCacheMissCount: 0,
                transferSceneRuleCacheHitCount: 0,
                transferSceneRuleCacheMissCount: 0,
                transferSceneRuleCacheDisabledCount: 0,
                incrementalCacheHitCount: 0,
                incrementalCacheMissCount: 0,
                incrementalCacheWriteCount: 0,
                entryConcurrency: 0,
                entryParallelTaskCount: 0,
                totalMs: 0,
            },
            transferNoHitReasons: {},
            ruleFeedback: {
                zeroHitRules: emptyRuleHitCounters(),
                ruleHitRanking: {
                    source: [],
                    sink: [],
                    transfer: [],
                },
                uncoveredHighFrequencyInvokes: [],
                noCandidateCallsites: [],
            },
        },
        entries,
    };
}

async function runProject(project: SmokeProjectConfig, options: CliOptions): Promise<ProjectSmokeResult> {
    const repoAbs = path.isAbsolute(project.repoPath) ? project.repoPath : path.resolve(project.repoPath);
    const sourceDirs = project.sourceDirs || [];
    let effectiveMaxEntries = options.maxEntries;
    if (typeof project.maxEntriesCap === "number" && Number.isFinite(project.maxEntriesCap) && project.maxEntriesCap > 0) {
        effectiveMaxEntries = Math.min(options.maxEntries, Math.floor(project.maxEntriesCap));
    }
    const result: ProjectSmokeResult = {
        id: project.id,
        repoPath: repoAbs,
        repoUrl: project.repoUrl,
        license: project.license,
        sourceMode: project.sourceMode,
        priority: project.priority,
        commit: project.commit,
        tags: project.tags || [],
        sourceDirs,
        sourceSummaries: [],
        entries: [],
        sinkSignatures: project.sinkSignatures || [],
        effectiveMaxEntries,
        analyzed: 0,
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

    if (!fs.existsSync(repoAbs)) {
        result.fatalErrors.push(`repo_path_missing: ${repoAbs}`);
        return result;
    }

    const validSourceDirs: string[] = [];
    for (const sourceDir of sourceDirs) {
        const sourceAbs = path.resolve(repoAbs, sourceDir);
        if (!fs.existsSync(sourceAbs)) {
            result.fatalErrors.push(`source_dir_missing: ${sourceAbs}`);
            continue;
        }
        validSourceDirs.push(sourceDir);
    }
    if (validSourceDirs.length === 0) {
        return result;
    }

    if (effectiveMaxEntries !== options.maxEntries) {
        console.log(`[smoke][project_cap] ${project.id}: cli_maxEntries=${options.maxEntries}, cap=${effectiveMaxEntries}`);
    }

    const projectOutputDir = path.resolve(options.outputDir, sanitizeProjectId(project.id));
    ensureDir(projectOutputDir);
    const analyzeOptions = createAnalyzeOptions(
        repoAbs,
        validSourceDirs,
        projectOutputDir,
        options.k,
        effectiveMaxEntries
    );
    const activeRules = loadRuleSet({
        ...analyzeOptions.ruleOptions,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const sinkFamilyById = new Map<string, string>(
        (activeRules.ruleSet.sinks || []).map(rule => [String(rule.id || ""), String(rule.family || "")]),
    );
    let analyzeReport: AnalyzeReport;
    try {
        analyzeReport = (await runAnalyze(analyzeOptions)).report;
    } catch (err: any) {
        result.fatalErrors.push(`analyze_failed: ${String(err?.message || err)}`);
        analyzeReport = createFallbackAnalyzeReport(repoAbs, validSourceDirs);
    }

    const mappedEntries = (analyzeReport.entries || []).map(entry => mapAnalyzeEntryToSmokeEntry(entry, sinkFamilyById));
    result.entries = buildSourceDirEntries(validSourceDirs, mappedEntries, result.fatalErrors);

    for (const sourceDir of validSourceDirs) {
        const sourceEntries = result.entries.filter(entry => entry.sourceDir === sourceDir);
        const hasAnalysis = sourceEntries.length > 0;
        const summary = createSourceSummary(sourceDir, sourceEntries, {
            selected: sourceEntries.map(entry => ({
                name: entry.entryName,
                pathHint: entry.entryPathHint,
                signature: entry.signature,
                score: entry.score,
                sourceDir: entry.sourceDir,
                sourceFile: entry.entryPathHint,
            })),
            poolTotal: 1,
            filteredTotal: 1,
            poolFileCount: 1,
            filteredFileCount: 1,
            selectedFileCount: hasAnalysis ? 1 : 0,
        });
        result.sourceSummaries.push(summary);
    }

    for (const entry of result.entries) {
        result.analyzed++;
        if (entry.seedCount > 0) result.withSeeds++;
        const inventoryFlowCount = (entry.flowRuleTraces?.length || 0) > 0
            ? entry.flowRuleTraces.length
            : Math.max(entry.flowCount, sumCounts(entry.sinkRuleHits));
        if (inventoryFlowCount > 0) result.withFlows++;
        result.totalFlows += inventoryFlowCount;
        for (const [sinkRuleId, count] of Object.entries(entry.sinkRuleHits)) {
            result.sinkRuleHits[sinkRuleId] = (result.sinkRuleHits[sinkRuleId] || 0) + count;
        }
        for (const [family, count] of Object.entries(entry.sinkFamilyHits)) {
            result.sinkFamilyHits[family] = (result.sinkFamilyHits[family] || 0) + count;
        }
        for (const [endpoint, count] of Object.entries(entry.sinkEndpointHits)) {
            result.sinkEndpointHits[endpoint] = (result.sinkEndpointHits[endpoint] || 0) + count;
        }
    }

    return result;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const manifest = readManifest(options.manifestPath);
    let projects = manifest.projects.filter(p => p.enabled !== false);
    if (options.projectFilter) {
        projects = projects.filter(p => p.id === options.projectFilter);
    }
    if (projects.length === 0) {
        throw new Error("No projects selected. Check manifest or --project filter.");
    }
    const outputLayout = resolveTestOutputLayout(options.outputDir);
    ensureDir(outputLayout.rootDir);
    const metadata: TestOutputMetadata = {
        suite: "real_project_smoke",
        domain: "real_projects",
        title: "Real Project Smoke",
        purpose: "Run bounded real-project analysis smoke checks and summarize entry coverage, seed recovery, flow recovery, and fatal project failures.",
    };
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const progressReporter = createTestProgressReporter(outputLayout, metadata, projects.length, {
        logEveryCount: 1,
        logEveryPercent: 10,
    });

    const projectResults: ProjectSmokeResult[] = [];
    for (let index = 0; index < projects.length; index++) {
        const project = projects[index];
        progressReporter.update(index, project.id, "stage=project_start");
        console.log(`\n>>> Smoke project: ${project.id}`);
        const result = await runProject(project, options);
        projectResults.push(result);
        progressReporter.update(index + 1, project.id, "stage=project_done");
    }

    const report = aggregateReport(options, projectResults);
    const reportJsonPath = path.resolve(options.outputDir, "smoke_report.json");
    const reportMdPath = path.resolve(options.outputDir, "smoke_report.md");
    fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(reportMdPath, renderMarkdownReport(report), "utf-8");
    fs.writeFileSync(outputLayout.reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(outputLayout.reportMarkdownPath, renderMarkdownReport(report), "utf-8");
    progressReporter.finish("DONE", "stage=all_projects");

    printConsoleSummary(report);
    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAtMs;
    const failureItems: TestFailureSummary[] = report.projects
        .filter(project => project.fatalErrors.length > 0)
        .map(project => ({
            name: project.id,
            expected: "no_fatal_errors",
            actual: `fatal_errors=${project.fatalErrors.length}`,
            reason: project.fatalErrors.join("; "),
            severity: "high",
            nextHint: "Inspect the project section in smoke_report.md for source-dir and analyze failure details.",
        }));
    writeTestSummary(outputLayout, metadata, {
        status: report.fatalProjectCount > 0 ? "fail" : "pass",
        verdict: report.fatalProjectCount > 0
            ? "Real-project smoke completed with fatal project failures; inspect affected project sections."
            : "Real-project smoke completed without fatal project failures.",
        startedAt,
        finishedAt,
        durationMs,
        totals: {
            manifest: options.manifestPath,
            projects: report.totalProjects,
            analyzedEntries: report.totalAnalyzedEntries,
            entriesWithSeeds: report.totalEntriesWithSeeds,
            entriesWithFlows: report.totalEntriesWithFlows,
            totalFlows: report.totalFlows,
            fatalProjects: report.fatalProjectCount,
        },
        highlights: report.projects.slice(0, 5).map(project =>
            `${project.id}: analyzed=${project.analyzed}, withSeeds=${project.withSeeds}, withFlows=${project.withFlows}, fatal=${project.fatalErrors.length}`),
        failures: failureItems,
    });
    printTestConsoleSummary(metadata, outputLayout, {
        status: report.fatalProjectCount > 0 ? "fail" : "pass",
        verdict: report.fatalProjectCount > 0
            ? "Real-project smoke completed with fatal project failures; inspect summary/report artifacts."
            : "Real-project smoke completed without fatal project failures.",
        startedAt,
        finishedAt,
        durationMs,
        totals: {
            manifest: options.manifestPath,
            projects: report.totalProjects,
            analyzed_entries: report.totalAnalyzedEntries,
            entries_with_seeds: report.totalEntriesWithSeeds,
            entries_with_flows: report.totalEntriesWithFlows,
            total_flows: report.totalFlows,
            fatal_projects: report.fatalProjectCount,
        },
        highlights: [],
        failures: failureItems,
    });

    if (report.fatalProjectCount > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});


