import * as fs from "fs";
import * as path from "path";
import { RuleLoaderOptions } from "../core/rules/RuleLoader";

export type AnalyzeProfile = "default" | "strict" | "fast";
export type ReportMode = "light" | "full";

export interface CliOptions {
    repo: string;
    sourceDirs: string[];
    autoModel?: boolean;
    publishModel?: string;
    llmConfigPath?: string;
    llmProfile?: string;
    llmModel?: string;
    arkMainMaxCandidates?: number;
    listModules?: boolean;
    listModels?: boolean;
    explainModuleId?: string;
    traceModuleId?: string;
    listPlugins?: boolean;
    explainPluginName?: string;
    tracePluginName?: string;
    modelRoots?: string[];
    moduleSpecFiles?: string[];
    disabledModuleIds?: string[];
    arkMainSpecFiles?: string[];
    enabledModels?: string[];
    disabledModels?: string[];
    pluginPaths?: string[];
    disabledPluginNames?: string[];
    pluginIsolate?: string[];
    pluginDryRun?: boolean;
    pluginAudit?: boolean;
    profile: AnalyzeProfile;
    k: number;
    maxEntries: number;
    reportMode: ReportMode;
    outputDir: string;
    concurrency: number;
    incremental: boolean;
    incrementalCachePath?: string;
    stopOnFirstFlow: boolean;
    maxFlowsPerEntry?: number;
    enableSecondarySinkSweep: boolean;
    showLoadWarnings?: boolean;
    ruleOptions: RuleLoaderOptions;
}

function splitCsv(value?: string): string[] {
    if (!value) return [];
    return value.split(",").map(v => v.trim()).filter(Boolean);
}

export function parseArgs(argv: string[]): CliOptions {
    let repo = "";
    let sourceDirs: string[] = [];
    let autoModel = false;
    let publishModel: string | undefined;
    let llmConfigPath: string | undefined;
    let llmProfile: string | undefined;
    let llmModel: string | undefined;
    let arkMainMaxCandidates: number | undefined;
    let listModules = false;
    let listModels = false;
    let explainModuleId: string | undefined;
    let traceModuleId: string | undefined;
    let listPlugins = false;
    let explainPluginName: string | undefined;
    let tracePluginName: string | undefined;
    let modelRoots: string[] = [];
    let moduleSpecFiles: string[] = [];
    let disabledModuleIds: string[] = [];
    let arkMainSpecFiles: string[] = [];
    let enabledModels: string[] = [];
    let disabledModels: string[] = [];
    let pluginPaths: string[] = [];
    let disabledPluginNames: string[] = [];
    let pluginIsolate: string[] = [];
    let pluginDryRun = false;
    let pluginAudit = false;
    let profile: AnalyzeProfile = "default";
    let reportMode: ReportMode = "light";
    let kRaw: number | undefined;
    let maxEntriesRaw: number | undefined;
    let outputDir = "";
    let concurrencyRaw: number | undefined;
    let incremental = true;
    let incrementalCachePath: string | undefined;
    let stopOnFirstFlow = false;
    let maxFlowsPerEntryRaw: number | undefined;
    let secondarySinkSweepRaw: boolean | undefined;
    const ruleOptions: RuleLoaderOptions = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = i + 1 < argv.length ? argv[i + 1] : undefined;
        const readValue = (prefix: string): string | undefined => {
            if (arg === prefix) return next;
            if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1);
            return undefined;
        };

        if (arg === "--autoModel") {
            autoModel = true;
            continue;
        }
        const publishModelArg = readValue("--publish-model");
        if (publishModelArg !== undefined) {
            publishModel = publishModelArg.trim();
            if (arg === "--publish-model") i++;
            continue;
        }
        const repoArg = readValue("--repo");
        if (repoArg !== undefined) {
            repo = repoArg;
            if (arg === "--repo") i++;
            continue;
        }
        const sourceDirArg = readValue("--sourceDir");
        if (sourceDirArg !== undefined) {
            sourceDirs.push(...splitCsv(sourceDirArg));
            if (arg === "--sourceDir") i++;
            continue;
        }
        const llmConfigArg = readValue("--llmConfig");
        if (llmConfigArg !== undefined) {
            llmConfigPath = llmConfigArg.trim();
            if (arg === "--llmConfig") i++;
            continue;
        }
        const llmProfileArg = readValue("--llmProfile");
        if (llmProfileArg !== undefined) {
            llmProfile = llmProfileArg.trim();
            if (arg === "--llmProfile") i++;
            continue;
        }
        const llmModelArg = readValue("--model");
        if (llmModelArg !== undefined) {
            llmModel = llmModelArg.trim();
            if (arg === "--model") i++;
            continue;
        }
        const arkMainMaxCandidatesArg = readValue("--arkMainMaxCandidates");
        if (arkMainMaxCandidatesArg !== undefined) {
            arkMainMaxCandidates = Number(arkMainMaxCandidatesArg);
            if (arg === "--arkMainMaxCandidates") i++;
            continue;
        }
        if (arg === "--list-modules") {
            listModules = true;
            continue;
        }
        if (arg === "--list-plugins") {
            listPlugins = true;
            continue;
        }
        if (arg === "--list-models") {
            listModels = true;
            continue;
        }
        const explainModuleArg = readValue("--explain-module");
        if (explainModuleArg !== undefined) {
            explainModuleId = explainModuleArg.trim();
            if (arg === "--explain-module") i++;
            continue;
        }
        const traceModuleArg = readValue("--trace-module");
        if (traceModuleArg !== undefined) {
            traceModuleId = traceModuleArg.trim();
            if (arg === "--trace-module") i++;
            continue;
        }
        const explainPluginArg = readValue("--explain-plugin");
        if (explainPluginArg !== undefined) {
            explainPluginName = explainPluginArg.trim();
            if (arg === "--explain-plugin") i++;
            continue;
        }
        const tracePluginArg = readValue("--trace-plugin");
        if (tracePluginArg !== undefined) {
            tracePluginName = tracePluginArg.trim();
            if (arg === "--trace-plugin") i++;
            continue;
        }
        const moduleSpecArg = readValue("--module-spec");
        if (moduleSpecArg !== undefined) {
            moduleSpecFiles.push(...splitCsv(moduleSpecArg));
            if (arg === "--module-spec") i++;
            continue;
        }
        const arkMainSpecArg = readValue("--arkmain-spec");
        if (arkMainSpecArg !== undefined) {
            arkMainSpecFiles.push(...splitCsv(arkMainSpecArg));
            if (arg === "--arkmain-spec") i++;
            continue;
        }
        const disabledModuleArg = readValue("--disable-module");
        if (disabledModuleArg !== undefined) {
            disabledModuleIds.push(...splitCsv(disabledModuleArg));
            if (arg === "--disable-module") i++;
            continue;
        }
        const modelRootArg = readValue("--model-root");
        if (modelRootArg !== undefined) {
            modelRoots.push(...splitCsv(modelRootArg));
            if (arg === "--model-root") i++;
            continue;
        }
        const enableModelArg = readValue("--enable-model");
        if (enableModelArg !== undefined) {
            enabledModels.push(...splitCsv(enableModelArg));
            if (arg === "--enable-model") i++;
            continue;
        }
        const disableModelArg = readValue("--disable-model");
        if (disableModelArg !== undefined) {
            disabledModels.push(...splitCsv(disableModelArg));
            if (arg === "--disable-model") i++;
            continue;
        }
        const pluginsArg = readValue("--plugins");
        if (pluginsArg !== undefined) {
            pluginPaths.push(...splitCsv(pluginsArg));
            if (arg === "--plugins") i++;
            continue;
        }
        const disabledPluginsArg = readValue("--disable-plugins");
        if (disabledPluginsArg !== undefined) {
            disabledPluginNames.push(...splitCsv(disabledPluginsArg));
            if (arg === "--disable-plugins") i++;
            continue;
        }
        const pluginIsolateArg = readValue("--plugin-isolate");
        if (pluginIsolateArg !== undefined) {
            pluginIsolate.push(...splitCsv(pluginIsolateArg));
            if (arg === "--plugin-isolate") i++;
            continue;
        }
        if (arg === "--plugin-dry-run") {
            pluginDryRun = true;
            continue;
        }
        if (arg === "--plugin-audit") {
            pluginAudit = true;
            continue;
        }
        const profileArg = readValue("--profile");
        if (profileArg !== undefined) {
            if (profileArg === "default" || profileArg === "strict" || profileArg === "fast") {
                profile = profileArg;
            } else {
                throw new Error(`invalid --profile: ${profileArg}`);
            }
            if (arg === "--profile") i++;
            continue;
        }
        const reportModeArg = readValue("--reportMode") ?? readValue("--report");
        if (reportModeArg !== undefined) {
            if (reportModeArg === "light" || reportModeArg === "full") {
                reportMode = reportModeArg;
            } else {
                throw new Error(`invalid --reportMode: ${reportModeArg}`);
            }
            if (arg === "--reportMode" || arg === "--report") i++;
            continue;
        }
        const kArg = readValue("--k");
        if (kArg !== undefined) {
            kRaw = Number(kArg);
            if (arg === "--k") i++;
            continue;
        }
        const maxArg = readValue("--maxEntries");
        if (maxArg !== undefined) {
            maxEntriesRaw = Number(maxArg);
            if (arg === "--maxEntries") i++;
            continue;
        }
        const outArg = readValue("--outputDir");
        if (outArg !== undefined) {
            outputDir = outArg;
            if (arg === "--outputDir") i++;
            continue;
        }
        const concurrencyArg = readValue("--concurrency");
        if (concurrencyArg !== undefined) {
            concurrencyRaw = Number(concurrencyArg);
            if (arg === "--concurrency") i++;
            continue;
        }
        const kernelRuleArg = readValue("--kernelRule");
        if (kernelRuleArg !== undefined) {
            ruleOptions.kernelRulePath = kernelRuleArg;
            if (arg === "--kernelRule") i++;
            continue;
        }
        const projectRuleArg = readValue("--project");
        if (projectRuleArg !== undefined) {
            ruleOptions.projectRulePath = projectRuleArg;
            if (arg === "--project") i++;
            continue;
        }
        const candidateRuleArg = readValue("--candidate");
        if (candidateRuleArg !== undefined) {
            ruleOptions.candidateRulePath = candidateRuleArg;
            if (arg === "--candidate") i++;
            continue;
        }
        if (arg === "--incremental") {
            incremental = true;
            continue;
        }
        if (arg === "--no-incremental") {
            incremental = false;
            continue;
        }
        const cachePathArg = readValue("--incrementalCache");
        if (cachePathArg !== undefined) {
            incrementalCachePath = cachePathArg;
            if (arg === "--incrementalCache") i++;
            continue;
        }
        if (arg === "--stopOnFirstFlow") {
            stopOnFirstFlow = true;
            continue;
        }
        if (arg === "--no-stopOnFirstFlow") {
            stopOnFirstFlow = false;
            continue;
        }
        const maxFlowsPerEntryArg = readValue("--maxFlowsPerEntry");
        if (maxFlowsPerEntryArg !== undefined) {
            maxFlowsPerEntryRaw = Number(maxFlowsPerEntryArg);
            if (arg === "--maxFlowsPerEntry") i++;
            continue;
        }
        if (arg === "--secondarySinkSweep") {
            secondarySinkSweepRaw = true;
            continue;
        }
        if (arg === "--no-secondarySinkSweep") {
            secondarySinkSweepRaw = false;
            continue;
        }
        if (arg.startsWith("--")) {
            throw new Error(`unknown option: ${arg}`);
        }
    }

    const inspectionModeCount = [
        listModules,
        listModels,
        !!explainModuleId,
        !!traceModuleId,
        listPlugins,
        !!explainPluginName,
        !!tracePluginName,
    ].filter(Boolean).length;
    if (inspectionModeCount > 1) {
        throw new Error("only one inspection mode may be used at a time: --list-modules, --list-models, --explain-module, --trace-module, --list-plugins, --explain-plugin, --trace-plugin");
    }
    if (publishModel && !autoModel) {
        throw new Error("--publish-model requires --autoModel");
    }
    if (!repo) throw new Error("missing required --repo <path>");
    const normalizedRepo = path.isAbsolute(repo) ? repo : path.resolve(repo);
    if (!fs.existsSync(normalizedRepo)) throw new Error(`repo path not found: ${normalizedRepo}`);

    if (sourceDirs.length === 0) {
        const auto = ["entry/src/main/ets", "src/main/ets", "."];
        sourceDirs = auto.filter(rel => fs.existsSync(path.resolve(normalizedRepo, rel)));
    }
    if (sourceDirs.length === 0) throw new Error("no sourceDir found. pass --sourceDir");
    sourceDirs = [...new Set(sourceDirs.map(d => d.replace(/\\/g, "/")))];
    modelRoots = [...new Set(modelRoots.map(d => path.isAbsolute(d) ? d : path.resolve(d)))];
    moduleSpecFiles = [...new Set(moduleSpecFiles.map(d => path.isAbsolute(d) ? d : path.resolve(d)))];
    disabledModuleIds = [...new Set(disabledModuleIds.map(id => id.trim()).filter(Boolean))];
    arkMainSpecFiles = [...new Set(arkMainSpecFiles.map(d => path.isAbsolute(d) ? d : path.resolve(d)))];
    enabledModels = [...new Set(enabledModels.map(id => id.trim()).filter(Boolean))];
    disabledModels = [...new Set(disabledModels.map(id => id.trim()).filter(Boolean))];
    pluginPaths = [...new Set(pluginPaths.map(d => path.isAbsolute(d) ? d : path.resolve(d)))];
    disabledPluginNames = [...new Set(disabledPluginNames.map(name => name.trim()).filter(Boolean))];
    pluginIsolate = [...new Set(pluginIsolate.map(name => name.trim()).filter(Boolean))];

    const profileDefaults = profile === "fast"
        ? { k: 0, maxEntries: 8, concurrency: 6 }
        : profile === "strict"
            ? { k: 1, maxEntries: 20, concurrency: 2 }
            : { k: 1, maxEntries: 12, concurrency: 4 };
    const k = kRaw !== undefined ? kRaw : profileDefaults.k;
    const maxEntries = maxEntriesRaw !== undefined ? maxEntriesRaw : profileDefaults.maxEntries;
    const concurrency = concurrencyRaw !== undefined ? concurrencyRaw : profileDefaults.concurrency;
    if (k !== 0 && k !== 1) throw new Error(`invalid --k: ${k}`);
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) throw new Error(`invalid --maxEntries: ${maxEntries}`);
    if (!Number.isFinite(concurrency) || concurrency <= 0) throw new Error(`invalid --concurrency: ${concurrency}`);
    const maxFlowsPerEntry = maxFlowsPerEntryRaw === undefined
        ? undefined
        : Math.floor(maxFlowsPerEntryRaw);
    if (maxFlowsPerEntry !== undefined && (!Number.isFinite(maxFlowsPerEntry) || maxFlowsPerEntry <= 0)) {
        throw new Error(`invalid --maxFlowsPerEntry: ${maxFlowsPerEntryRaw}`);
    }

    const enableSecondarySinkSweep = secondarySinkSweepRaw !== undefined
        ? secondarySinkSweepRaw
        : profile === "fast";
    if (
        arkMainMaxCandidates !== undefined
        && (!Number.isFinite(arkMainMaxCandidates) || arkMainMaxCandidates <= 0)
    ) {
        throw new Error(`invalid --arkMainMaxCandidates: ${arkMainMaxCandidates}`);
    }

    if (!outputDir) {
        const repoName = path.basename(normalizedRepo);
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        outputDir = path.resolve("output", "runs", "analyze", repoName, ts);
    } else {
        outputDir = path.isAbsolute(outputDir) ? outputDir : path.resolve(outputDir);
    }

    if (modelRoots.length > 0) {
        ruleOptions.ruleCatalogPaths = [...modelRoots];
        ruleOptions.ruleCatalogPath = modelRoots[0];
    }
    ruleOptions.autoDiscoverLayers = true;
    if (ruleOptions.enabledRulePacks) {
        ruleOptions.enabledRulePacks = [...new Set(ruleOptions.enabledRulePacks.map(item => item.trim()).filter(Boolean))];
    }
    if (ruleOptions.disabledRulePacks) {
        ruleOptions.disabledRulePacks = [...new Set(ruleOptions.disabledRulePacks.map(item => item.trim()).filter(Boolean))];
    }
    if (incrementalCachePath) {
        incrementalCachePath = path.isAbsolute(incrementalCachePath)
            ? incrementalCachePath
            : path.resolve(incrementalCachePath);
    }
    return {
        repo: normalizedRepo,
        sourceDirs,
        autoModel,
        publishModel: publishModel || undefined,
        llmConfigPath: llmConfigPath
            ? (path.isAbsolute(llmConfigPath) ? llmConfigPath : path.resolve(llmConfigPath))
            : undefined,
        llmProfile,
        llmModel,
        arkMainMaxCandidates: arkMainMaxCandidates !== undefined ? Math.floor(arkMainMaxCandidates) : undefined,
        listModules,
        listModels,
        explainModuleId,
        traceModuleId,
        listPlugins,
        explainPluginName,
        tracePluginName,
        modelRoots,
        moduleSpecFiles,
        disabledModuleIds,
        arkMainSpecFiles,
        enabledModels,
        disabledModels,
        pluginPaths,
        disabledPluginNames,
        pluginIsolate,
        pluginDryRun,
        pluginAudit,
        profile,
        reportMode,
        k,
        maxEntries: Math.floor(maxEntries),
        outputDir,
        concurrency: Math.floor(concurrency),
        incremental,
        incrementalCachePath,
        stopOnFirstFlow,
        maxFlowsPerEntry,
        enableSecondarySinkSweep,
        showLoadWarnings: true,
        ruleOptions,
    };
}
