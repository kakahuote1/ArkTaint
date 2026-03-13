import {
    AnalyzeReport,
    EntryAnalyzeResult,
    emptyRuleHitCounters,
    emptyTransferProfile,
    emptyDetectProfile,
    emptyEntryStageProfile,
} from "../cli/analyzeTypes";
import { CliOptions as AnalyzeCliOptions } from "../cli/analyzeCliOptions";
import { runAnalyze } from "../cli/analyzeRunner";
import {
    CliOptions,
    EntrySmokeResult,
    ProjectSmokeResult,
    SmokeManifest,
    SmokeProjectConfig,
} from "./helpers/SmokeTypes";
import {
    aggregateReport,
    createSourceSummary,
    printConsoleSummary,
    renderMarkdownReport,
} from "./helpers/SmokeReportUtils";
import * as fs from "fs";
import * as path from "path";

function parseArgs(argv: string[]): CliOptions {
    let manifestPath = "tests/manifests/smoke_projects.json";
    let k = 1;
    let maxEntries = 12;
    let outputDir = "tmp/phase43";
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
        entryName: "@dummyMain",
        entryPathHint: sourceDir,
        signature: "@dummyMain",
        score: 100,
        status,
        seedLocalNames: [],
        seedStrategies: [],
        seedCount: 0,
        flowCount: 0,
        sinkFlowByKeyword: {},
        sinkFlowBySignature: {},
        sinkSamples: [],
        error,
        elapsedMs: 0,
    };
}

function mapAnalyzeEntryToSmokeEntry(entry: EntryAnalyzeResult): EntrySmokeResult {
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
        enableCrossFunctionFallback: false,
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
        entryName: "@dummyMain",
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
    let analyzeReport: AnalyzeReport;
    try {
        const analyzeOptions = createAnalyzeOptions(
            repoAbs,
            validSourceDirs,
            projectOutputDir,
            options.k,
            effectiveMaxEntries
        );
        analyzeReport = (await runAnalyze(analyzeOptions)).report;
    } catch (err: any) {
        result.fatalErrors.push(`analyze_failed: ${String(err?.message || err)}`);
        analyzeReport = createFallbackAnalyzeReport(repoAbs, validSourceDirs);
    }

    const mappedEntries = (analyzeReport.entries || []).map(mapAnalyzeEntryToSmokeEntry);
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
        if (entry.flowCount > 0) result.withFlows++;
        result.totalFlows += entry.flowCount;
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

    const projectResults: ProjectSmokeResult[] = [];
    for (const project of projects) {
        console.log(`\n>>> Smoke project: ${project.id}`);
        const result = await runProject(project, options);
        projectResults.push(result);
    }

    const report = aggregateReport(options, projectResults);
    ensureDir(options.outputDir);
    const reportJsonPath = path.resolve(options.outputDir, "smoke_report.json");
    const reportMdPath = path.resolve(options.outputDir, "smoke_report.md");
    fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(reportMdPath, renderMarkdownReport(report), "utf-8");

    printConsoleSummary(report);
    console.log(`\nreport_json=${reportJsonPath}`);
    console.log(`report_md=${reportMdPath}`);

    if (report.fatalProjectCount > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
