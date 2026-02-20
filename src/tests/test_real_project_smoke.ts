import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { buildSmokeRuleConfig, tryLoadRuleSet } from "../core/rules/RuleLoader";
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
import {
    selectEntryCandidates,
    SmokeEntrySelectionConfig,
} from "./helpers/SmokeEntrySelector";
import {
    analyzeEntry,
    SmokeEntryAnalyzerConfig,
} from "./helpers/SmokeEntryAnalyzer";
import * as fs from "fs";
import * as path from "path";

const LOADED_RULES = tryLoadRuleSet();
const SMOKE_RULE_CONFIG = buildSmokeRuleConfig(LOADED_RULES);

const SOURCE_NAME_PATTERN = SMOKE_RULE_CONFIG.sourceLocalNamePattern;
const INIT_NAME_PATTERN = /(data|state|model|info|result|resp|response|record|entity|item|user|token|msg|payload|query|param|url|uri|path|text|content|name|id)/i;
const INIT_CALLEE_PATTERN = /(get|fetch|load|query|request|read|find|resolve|parse|decode|open|from)/i;
const CALLBACK_INVOKE_HINTS = new Set([
    "onclick",
    "onchange",
    "onsubmit",
    "then",
    "catch",
    "finally",
    "foreach",
    "map",
    "filter",
    "reduce",
    "subscribe",
    "emit",
    "register",
    "listen",
    "addlistener",
    "settimeout",
    "setinterval",
]);
const SINK_KEYWORDS = SMOKE_RULE_CONFIG.sinkKeywords;

const DEFAULT_SINK_SIGNATURE_PATTERNS = SMOKE_RULE_CONFIG.sinkSignatures;

const ENTRY_METHOD_HINTS = new Set([
    "build",
    "onwindowstagecreate",
    "oncreate",
    "onforeground",
    "abouttoappear",
    "onclick",
    "pushurl",
]);
const ENTRY_SELECTOR_CONFIG: SmokeEntrySelectionConfig = {
    sourceNamePattern: SOURCE_NAME_PATTERN,
    sinkKeywords: SINK_KEYWORDS,
    entryMethodHints: ENTRY_METHOD_HINTS,
};
const ENTRY_ANALYZER_CONFIG: SmokeEntryAnalyzerConfig = {
    sourceNamePattern: SOURCE_NAME_PATTERN,
    initNamePattern: INIT_NAME_PATTERN,
    initCalleePattern: INIT_CALLEE_PATTERN,
    callbackInvokeHints: CALLBACK_INVOKE_HINTS,
    sinkKeywords: SINK_KEYWORDS,
};


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

function normalizeSignatureList(values: string[] | undefined): string[] {
    if (!values) return [];
    const dedup = new Set<string>();
    for (const v of values) {
        const s = String(v || "").trim();
        if (!s) continue;
        dedup.add(s);
    }
    return [...dedup];
}

function resolveProjectSinkSignatures(project: SmokeProjectConfig): string[] {
    const custom = normalizeSignatureList(project.sinkSignatures);
    if (custom.length > 0) return custom;
    return normalizeSignatureList(DEFAULT_SINK_SIGNATURE_PATTERNS);
}

async function runProject(project: SmokeProjectConfig, options: CliOptions): Promise<ProjectSmokeResult> {
    const repoAbs = path.isAbsolute(project.repoPath) ? project.repoPath : path.resolve(project.repoPath);
    const sourceDirs = project.sourceDirs || [];
    const sinkSignatures = resolveProjectSinkSignatures(project);
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
        sinkSignatures,
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

    const perSourceMax = Math.max(1, Math.floor(options.maxEntries / Math.max(1, sourceDirs.length)));

    for (const sourceDir of sourceDirs) {
        const sourceAbs = path.resolve(repoAbs, sourceDir);
        if (!fs.existsSync(sourceAbs)) {
            result.fatalErrors.push(`source_dir_missing: ${sourceAbs}`);
            continue;
        }

        let scene: Scene;
        try {
            const config = new SceneConfig();
            config.buildFromProjectDir(sourceAbs);
            scene = new Scene();
            scene.buildSceneFromProjectDir(config);
            scene.inferTypes();
        } catch (err: any) {
            result.fatalErrors.push(`build_scene_failed(${sourceDir}): ${String(err?.message || err)}`);
            continue;
        }

        const selection = selectEntryCandidates(scene, sourceDir, perSourceMax, {
            includePaths: project.includePaths || [],
            excludePaths: project.excludePaths || [],
            entryHints: project.entryHints || [],
        }, ENTRY_SELECTOR_CONFIG);
        const sourceResults: EntrySmokeResult[] = [];
        for (const candidate of selection.selected) {
            const r = await analyzeEntry(scene, candidate, options.k, sinkSignatures, ENTRY_ANALYZER_CONFIG);
            sourceResults.push(r);
            result.entries.push(r);
        }

        const summary = createSourceSummary(sourceDir, sourceResults, selection);
        result.sourceSummaries.push(summary);
    }

    for (const entry of result.entries) {
        result.analyzed++;
        if (entry.seedCount > 0) result.withSeeds++;
        if (entry.flowCount > 0) result.withFlows++;
        result.totalFlows += entry.flowCount;
        for (const keyword of Object.keys(entry.sinkFlowByKeyword)) {
            result.sinkFlowByKeyword[keyword] = (result.sinkFlowByKeyword[keyword] || 0) + entry.sinkFlowByKeyword[keyword];
        }
        for (const signature of Object.keys(entry.sinkFlowBySignature)) {
            result.sinkFlowBySignature[signature] = (result.sinkFlowBySignature[signature] || 0) + entry.sinkFlowBySignature[signature];
        }
    }

    return result;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (LOADED_RULES) {
        console.log(`[rules] loaded: ${LOADED_RULES.defaultRulePath}`);
        console.log(`[rules] applied_layers: ${LOADED_RULES.appliedLayerOrder.join(" -> ")}`);
        if (LOADED_RULES.frameworkRulePath) {
            console.log(`[rules] framework: ${LOADED_RULES.frameworkRulePath}`);
        }
        if (LOADED_RULES.projectRulePath) {
            console.log(`[rules] project: ${LOADED_RULES.projectRulePath}`);
        }
        if (LOADED_RULES.llmCandidateRulePath) {
            console.log(`[rules] llm_candidate: ${LOADED_RULES.llmCandidateRulePath}`);
        }
        for (const warning of LOADED_RULES.warnings) {
            console.log(`[rules][warn] ${warning}`);
        }
    } else {
        console.log("[rules] default rules unavailable, fallback to built-in smoke defaults.");
    }
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
