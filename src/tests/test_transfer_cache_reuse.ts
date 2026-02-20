import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { loadRuleSet } from "../core/rules/RuleLoader";
import { ConfigBasedTransferExecutor } from "../core/engine/ConfigBasedTransferExecutor";
import * as fs from "fs";
import * as path from "path";

interface CliOptions {
    sourceDir: string;
    defaultRulePath: string;
    projectRulePath: string;
    k: number;
    maxCases: number;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/rule_transfer_variants";
    let defaultRulePath = "tests/rules/minimal.rules.json";
    let projectRulePath = "tests/rules/transfer_variants.rules.json";
    let k = 1;
    let maxCases = 4;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
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
        if (arg === "--k" && i + 1 < argv.length) {
            k = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--k=")) {
            k = Number(arg.slice("--k=".length));
            continue;
        }
        if (arg === "--maxCases" && i + 1 < argv.length) {
            maxCases = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--maxCases=")) {
            maxCases = Number(arg.slice("--maxCases=".length));
            continue;
        }
    }

    if (!Number.isFinite(k) || (k !== 0 && k !== 1)) {
        throw new Error(`invalid --k: ${k}`);
    }
    if (!Number.isFinite(maxCases) || maxCases <= 0) {
        throw new Error(`invalid --maxCases: ${maxCases}`);
    }

    return {
        sourceDir: path.resolve(sourceDir),
        defaultRulePath: path.resolve(defaultRulePath),
        projectRulePath: path.resolve(projectRulePath),
        k,
        maxCases: Math.floor(maxCases),
    };
}

function buildScene(sourceDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function listCaseNames(sourceDir: string): string[] {
    return fs.readdirSync(sourceDir)
        .filter(f => f.endsWith(".ets"))
        .map(f => path.basename(f, ".ets"))
        .filter(name => name !== "taint_mock")
        .sort();
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.sourceDir)) {
        throw new Error(`sourceDir not found: ${options.sourceDir}`);
    }
    if (!fs.existsSync(options.defaultRulePath)) {
        throw new Error(`default rules not found: ${options.defaultRulePath}`);
    }
    if (!fs.existsSync(options.projectRulePath)) {
        throw new Error(`project rules not found: ${options.projectRulePath}`);
    }

    const scene = buildScene(options.sourceDir);
    const loaded = loadRuleSet({
        defaultRulePath: options.defaultRulePath,
        projectRulePath: options.projectRulePath,
        autoDiscoverLayers: false,
    });
    const sourceRules = loaded.ruleSet.sources || [];
    const sinkRules = loaded.ruleSet.sinks || [];
    const transferRules = loaded.ruleSet.transfers || [];
    const caseNames = listCaseNames(options.sourceDir).slice(0, options.maxCases);
    if (caseNames.length < 2) {
        throw new Error(`need at least 2 cases to verify cache reuse, got ${caseNames.length}`);
    }

    ConfigBasedTransferExecutor.clearSceneRuleCache();
    ConfigBasedTransferExecutor.resetSceneRuleCacheStats();

    for (const caseName of caseNames) {
        const engine = new TaintPropagationEngine(scene, options.k, { transferRules });
        engine.verbose = false;
        await engine.buildPAG(caseName);
        engine.propagateWithSourceRules(sourceRules, { entryMethodName: caseName });
        engine.detectSinksByRules(sinkRules);
    }

    const cacheStats = ConfigBasedTransferExecutor.getSceneRuleCacheStats();
    const pass = cacheStats.hitCount >= 1 && cacheStats.missCount >= 1;

    console.log("====== Transfer Scene Cache Reuse ======");
    console.log(`cases=${caseNames.join(",")}`);
    console.log(`scene_cache_hit=${cacheStats.hitCount}`);
    console.log(`scene_cache_miss=${cacheStats.missCount}`);
    console.log(`scene_cache_disabled=${cacheStats.disabledCount}`);
    console.log(`pass=${pass}`);

    if (!pass) {
        throw new Error(`cache reuse check failed: ${JSON.stringify(cacheStats)}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

