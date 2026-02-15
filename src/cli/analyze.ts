import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { loadRuleSet, LoadedRuleSet, RuleLoaderOptions } from "../core/rules/RuleLoader";
import {
    collectSeedNodes,
    detectFlows,
    EntryCandidate,
    findEntryMethod,
    getSourcePattern,
    getSourceRules,
    selectEntryCandidates,
} from "./analyzeUtils";
import * as fs from "fs";
import * as path from "path";

type AnalyzeProfile = "default" | "strict" | "fast";

interface CliOptions {
    repo: string;
    sourceDirs: string[];
    profile: AnalyzeProfile;
    k: number;
    maxEntries: number;
    outputDir: string;
    entryHints: string[];
    includePaths: string[];
    excludePaths: string[];
    ruleOptions: RuleLoaderOptions;
}

interface EntryAnalyzeResult {
    sourceDir: string;
    entryName: string;
    entryPathHint?: string;
    score: number;
    status: "ok" | "no_entry" | "no_body" | "no_seed" | "exception";
    seedCount: number;
    seedLocalNames: string[];
    seedStrategies: string[];
    flowCount: number;
    sinkSamples: string[];
    elapsedMs: number;
    error?: string;
}

interface AnalyzeReport {
    generatedAt: string;
    repo: string;
    sourceDirs: string[];
    profile: AnalyzeProfile;
    k: number;
    maxEntries: number;
    ruleLayers: string[];
    ruleLayerStatus: Array<{ name: string; path: string; applied: boolean; exists: boolean; source: string }>;
    summary: {
        totalEntries: number;
        okEntries: number;
        withSeeds: number;
        withFlows: number;
        totalFlows: number;
        statusCount: Record<string, number>;
    };
    entries: EntryAnalyzeResult[];
}

function splitCsv(value?: string): string[] {
    if (!value) return [];
    return value.split(",").map(v => v.trim()).filter(Boolean);
}

function parseArgs(argv: string[]): CliOptions {
    let repo = "";
    let sourceDirs: string[] = [];
    let profile: AnalyzeProfile = "default";
    let kRaw: number | undefined;
    let maxEntriesRaw: number | undefined;
    let outputDir = "";
    const entryHints: string[] = [];
    const includePaths: string[] = [];
    const excludePaths: string[] = [];
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
    }

    if (!repo) throw new Error("missing required --repo <path>");
    const normalizedRepo = path.isAbsolute(repo) ? repo : path.resolve(repo);
    if (!fs.existsSync(normalizedRepo)) throw new Error(`repo path not found: ${normalizedRepo}`);

    if (sourceDirs.length === 0) {
        const auto = ["entry/src/main/ets", "src/main/ets", "."];
        sourceDirs = auto.filter(rel => fs.existsSync(path.resolve(normalizedRepo, rel)));
    }
    if (sourceDirs.length === 0) throw new Error("no sourceDir found. pass --sourceDir");
    sourceDirs = sourceDirs.map(d => d.replace(/\\/g, "/"));

    const profileDefaults = profile === "fast"
        ? { k: 0, maxEntries: 8 }
        : profile === "strict"
            ? { k: 1, maxEntries: 20 }
            : { k: 1, maxEntries: 12 };
    const k = kRaw !== undefined ? kRaw : profileDefaults.k;
    const maxEntries = maxEntriesRaw !== undefined ? maxEntriesRaw : profileDefaults.maxEntries;
    if (k !== 0 && k !== 1) throw new Error(`invalid --k: ${k}`);
    if (!Number.isFinite(maxEntries) || maxEntries <= 0) throw new Error(`invalid --maxEntries: ${maxEntries}`);

    if (!outputDir) {
        const repoName = path.basename(normalizedRepo);
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        outputDir = path.resolve("tmp", "analyze", `${repoName}_${ts}`);
    } else {
        outputDir = path.isAbsolute(outputDir) ? outputDir : path.resolve(outputDir);
    }

    ruleOptions.autoDiscoverLayers = true;
    return {
        repo: normalizedRepo,
        sourceDirs,
        profile,
        k,
        maxEntries: Math.floor(maxEntries),
        outputDir,
        entryHints,
        includePaths,
        excludePaths,
        ruleOptions,
    };
}

async function analyzeEntry(
    scene: Scene,
    sourceDir: string,
    candidate: EntryCandidate,
    options: CliOptions,
    loadedRules: LoadedRuleSet
): Promise<EntryAnalyzeResult> {
    const t0 = Date.now();
    try {
        const engine = new TaintPropagationEngine(scene, options.k, {
            transferRules: loadedRules.ruleSet.transfers || [],
        });
        engine.verbose = false;
        await engine.buildPAG(candidate.name, candidate.pathHint);

        const entryMethod = findEntryMethod(scene, candidate);
        if (!entryMethod) {
            return { sourceDir, entryName: candidate.name, entryPathHint: candidate.pathHint, score: candidate.score, status: "no_entry", seedCount: 0, seedLocalNames: [], seedStrategies: [], flowCount: 0, sinkSamples: [], elapsedMs: Date.now() - t0 };
        }
        if (!entryMethod.getBody()) {
            return { sourceDir, entryName: candidate.name, entryPathHint: candidate.pathHint, score: candidate.score, status: "no_body", seedCount: 0, seedLocalNames: [], seedStrategies: [], flowCount: 0, sinkSamples: [], elapsedMs: Date.now() - t0 };
        }

        let seedCount = 0;
        const seedLocalNames = new Set<string>();
        const seedStrategies = new Set<string>();
        const sourceRuleResult = engine.propagateWithSourceRules(getSourceRules(loadedRules), {
            entryMethodName: candidate.name,
            entryMethodPathHint: candidate.pathHint,
        });
        seedCount += sourceRuleResult.seedCount;
        for (const x of sourceRuleResult.seededLocals) seedLocalNames.add(x);
        if (sourceRuleResult.seedCount > 0) seedStrategies.add("rule:source");

        const heuristic = collectSeedNodes(scene, engine, entryMethod, getSourcePattern(loadedRules));
        if (heuristic.nodes.length > 0) {
            engine.propagateWithSeeds(heuristic.nodes);
            seedCount += heuristic.nodes.length;
            for (const x of heuristic.localNames) seedLocalNames.add(x);
            for (const x of heuristic.strategies) seedStrategies.add(x);
        }

        if (seedCount === 0) {
            return { sourceDir, entryName: candidate.name, entryPathHint: candidate.pathHint, score: candidate.score, status: "no_seed", seedCount: 0, seedLocalNames: [], seedStrategies: [], flowCount: 0, sinkSamples: [], elapsedMs: Date.now() - t0 };
        }

        const detected = detectFlows(engine, loadedRules);
        return {
            sourceDir,
            entryName: candidate.name,
            entryPathHint: candidate.pathHint,
            score: candidate.score,
            status: "ok",
            seedCount,
            seedLocalNames: [...seedLocalNames].sort(),
            seedStrategies: [...seedStrategies].sort(),
            flowCount: detected.totalFlowCount,
            sinkSamples: detected.sinkSamples,
            elapsedMs: Date.now() - t0,
        };
    } catch (err: any) {
        return {
            sourceDir,
            entryName: candidate.name,
            entryPathHint: candidate.pathHint,
            score: candidate.score,
            status: "exception",
            seedCount: 0,
            seedLocalNames: [],
            seedStrategies: [],
            flowCount: 0,
            sinkSamples: [],
            elapsedMs: Date.now() - t0,
            error: String(err?.message || err),
        };
    }
}

function renderMarkdownReport(report: AnalyzeReport): string {
    const lines: string[] = [];
    lines.push("# ArkTaint Analyze Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- repo: ${report.repo}`);
    lines.push(`- sourceDirs: ${report.sourceDirs.join(", ")}`);
    lines.push(`- profile: ${report.profile}`);
    lines.push(`- k: ${report.k}`);
    lines.push(`- maxEntries: ${report.maxEntries}`);
    lines.push(`- ruleLayers: ${report.ruleLayers.join(" -> ")}`);
    lines.push(`- totalEntries: ${report.summary.totalEntries}`);
    lines.push(`- okEntries: ${report.summary.okEntries}`);
    lines.push(`- withSeeds: ${report.summary.withSeeds}`);
    lines.push(`- withFlows: ${report.summary.withFlows}`);
    lines.push(`- totalFlows: ${report.summary.totalFlows}`);
    lines.push(`- statusCount: ${JSON.stringify(report.summary.statusCount)}`);
    lines.push("");
    lines.push("## Top Entries");
    lines.push("");
    const top = [...report.entries].sort((a, b) => b.flowCount - a.flowCount || b.seedCount - a.seedCount || b.score - a.score).slice(0, 20);
    for (const e of top) {
        lines.push(`- ${e.entryName} @ ${e.entryPathHint || "N/A"} | status=${e.status} | flows=${e.flowCount} | seeds=${e.seedCount} | seedBy=${e.seedStrategies.join(",") || "N/A"} | score=${e.score}`);
        for (const sample of e.sinkSamples.slice(0, 3)) {
            lines.push(`  - ${sample}`);
        }
    }
    return lines.join("\n");
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const loadedRules = loadRuleSet(options.ruleOptions);
    const perSourceMax = Math.max(1, Math.floor(options.maxEntries / Math.max(1, options.sourceDirs.length)));
    const entries: EntryAnalyzeResult[] = [];

    for (const sourceDir of options.sourceDirs) {
        const sourceAbs = path.resolve(options.repo, sourceDir);
        if (!fs.existsSync(sourceAbs)) continue;
        const config = new SceneConfig();
        config.buildFromProjectDir(sourceAbs);
        const scene = new Scene();
        scene.buildSceneFromProjectDir(config);
        scene.inferTypes();

        const selected = selectEntryCandidates(scene, {
            maxEntries: perSourceMax,
            entryHints: options.entryHints,
            includePaths: options.includePaths,
            excludePaths: options.excludePaths,
        }, getSourcePattern(loadedRules));

        for (const candidate of selected.selected) {
            entries.push(await analyzeEntry(scene, sourceDir, candidate, options, loadedRules));
        }
        if (selected.selected.length === 0) {
            entries.push({
                sourceDir,
                entryName: "<none>",
                score: 0,
                status: "no_entry",
                seedCount: 0,
                seedLocalNames: [],
                seedStrategies: [],
                flowCount: 0,
                sinkSamples: [],
                elapsedMs: 0,
            });
        }
    }

    const statusCount: Record<string, number> = {};
    let okEntries = 0;
    let withSeeds = 0;
    let withFlows = 0;
    let totalFlows = 0;
    for (const e of entries) {
        statusCount[e.status] = (statusCount[e.status] || 0) + 1;
        if (e.status === "ok") okEntries++;
        if (e.seedCount > 0) withSeeds++;
        if (e.flowCount > 0) withFlows++;
        totalFlows += e.flowCount;
    }

    const report: AnalyzeReport = {
        generatedAt: new Date().toISOString(),
        repo: options.repo,
        sourceDirs: options.sourceDirs,
        profile: options.profile,
        k: options.k,
        maxEntries: options.maxEntries,
        ruleLayers: loadedRules.appliedLayerOrder,
        ruleLayerStatus: loadedRules.layerStatus.map(s => ({ name: s.name, path: s.path, applied: s.applied, exists: s.exists, source: s.source })),
        summary: {
            totalEntries: entries.length,
            okEntries,
            withSeeds,
            withFlows,
            totalFlows,
            statusCount,
        },
        entries,
    };

    fs.mkdirSync(options.outputDir, { recursive: true });
    const jsonPath = path.resolve(options.outputDir, "summary.json");
    const mdPath = path.resolve(options.outputDir, "summary.md");
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
    fs.writeFileSync(mdPath, renderMarkdownReport(report), "utf-8");

    console.log("====== ArkTaint Analyze Summary ======");
    console.log(`repo=${report.repo}`);
    console.log(`source_dirs=${report.sourceDirs.join(",")}`);
    console.log(`entries=${report.summary.totalEntries}`);
    console.log(`ok_entries=${report.summary.okEntries}`);
    console.log(`with_seeds=${report.summary.withSeeds}`);
    console.log(`with_flows=${report.summary.withFlows}`);
    console.log(`total_flows=${report.summary.totalFlows}`);
    console.log(`status_count=${JSON.stringify(report.summary.statusCount)}`);
    console.log(`rule_layers=${report.ruleLayers.join(" -> ")}`);
    console.log(`summary_json=${jsonPath}`);
    console.log(`summary_md=${mdPath}`);
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
