import * as fs from "fs";
import * as path from "path";
import { RuleLoaderOptions } from "../core/rules/RuleLoader";

export type AnalyzeProfile = "default" | "strict" | "fast";
export type ReportMode = "light" | "full";

export interface CliOptions {
    repo: string;
    sourceDirs: string[];
    profile: AnalyzeProfile;
    k: number;
    maxEntries: number;
    reportMode: ReportMode;
    outputDir: string;
    entryHints: string[];
    includePaths: string[];
    excludePaths: string[];
    concurrency: number;
    incremental: boolean;
    incrementalCachePath?: string;
    stopOnFirstFlow: boolean;
    maxFlowsPerEntry?: number;
    ruleOptions: RuleLoaderOptions;
}

function splitCsv(value?: string): string[] {
    if (!value) return [];
    return value.split(",").map(v => v.trim()).filter(Boolean);
}

export function parseArgs(argv: string[]): CliOptions {
    let repo = "";
    let sourceDirs: string[] = [];
    let profile: AnalyzeProfile = "default";
    let reportMode: ReportMode = "light";
    let kRaw: number | undefined;
    let maxEntriesRaw: number | undefined;
    let outputDir = "";
    let concurrencyRaw: number | undefined;
    const entryHints: string[] = [];
    const includePaths: string[] = [];
    const excludePaths: string[] = [];
    let incremental = true;
    let incrementalCachePath: string | undefined;
    let stopOnFirstFlow = false;
    let maxFlowsPerEntryRaw: number | undefined;
    const ruleOptions: RuleLoaderOptions = {};

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = i + 1 < argv.length ? argv[i + 1] : undefined;
        const readValue = (prefix: string): string | undefined => {
            if (arg === prefix) return next;
            if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1);
            return undefined;
        };

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
        const hintsArg = readValue("--entryHint");
        if (hintsArg !== undefined) {
            entryHints.push(...splitCsv(hintsArg));
            if (arg === "--entryHint") i++;
            continue;
        }
        const includeArg = readValue("--include");
        if (includeArg !== undefined) {
            includePaths.push(...splitCsv(includeArg));
            if (arg === "--include") i++;
            continue;
        }
        const excludeArg = readValue("--exclude");
        if (excludeArg !== undefined) {
            excludePaths.push(...splitCsv(excludeArg));
            if (arg === "--exclude") i++;
            continue;
        }

        const defaultRuleArg = readValue("--default");
        if (defaultRuleArg !== undefined) {
            ruleOptions.defaultRulePath = defaultRuleArg;
            if (arg === "--default") i++;
            continue;
        }
        const frameworkRuleArg = readValue("--framework");
        if (frameworkRuleArg !== undefined) {
            ruleOptions.frameworkRulePath = frameworkRuleArg;
            if (arg === "--framework") i++;
            continue;
        }
        const projectRuleArg = readValue("--project");
        if (projectRuleArg !== undefined) {
            ruleOptions.projectRulePath = projectRuleArg;
            if (arg === "--project") i++;
            continue;
        }
        const llmRuleArg = readValue("--llm");
        if (llmRuleArg !== undefined) {
            ruleOptions.llmCandidateRulePath = llmRuleArg;
            if (arg === "--llm") i++;
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

    if (!outputDir) {
        const repoName = path.basename(normalizedRepo);
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        outputDir = path.resolve("tmp", "analyze", `${repoName}_${ts}`);
    } else {
        outputDir = path.isAbsolute(outputDir) ? outputDir : path.resolve(outputDir);
    }

    ruleOptions.autoDiscoverLayers = true;
    if (incrementalCachePath) {
        incrementalCachePath = path.isAbsolute(incrementalCachePath)
            ? incrementalCachePath
            : path.resolve(incrementalCachePath);
    }
    return {
        repo: normalizedRepo,
        sourceDirs,
        profile,
        reportMode,
        k,
        maxEntries: Math.floor(maxEntries),
        outputDir,
        entryHints,
        includePaths,
        excludePaths,
        concurrency: Math.floor(concurrency),
        incremental,
        incrementalCachePath,
        stopOnFirstFlow,
        maxFlowsPerEntry,
        ruleOptions,
    };
}
