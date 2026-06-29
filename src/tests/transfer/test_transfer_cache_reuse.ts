import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { ConfigBasedTransferExecutor } from "../../core/kernel/rules/ConfigBasedTransferExecutor";
import { buildExactTransferScenario } from "./ExactTransferScenarioFactory";
import { findLocalSeedNodes } from "./ExactTransferTestUtils";
import * as fs from "fs";
import * as path from "path";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

interface CliOptions {
    sourceDir: string;
    k: number;
    maxCases: number;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/rule_transfer_variants";
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
    registerMockSdkFiles(scene);
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

    const scene = buildScene(options.sourceDir);
    const caseNames = listCaseNames(options.sourceDir).slice(0, options.maxCases);
    if (caseNames.length < 2) {
        throw new Error(`need at least 2 cases to verify cache reuse, got ${caseNames.length}`);
    }
    const scenario = buildExactTransferScenario({
        scene,
        scenarioId: "rule_transfer_variants",
        caseNames,
    });
    const sourceRules = scenario.sourceRules;
    const sinkRules = scenario.sinkRules;
    const transferRules = scenario.transferRules;
    const exactRuntime = scenario.exactRuntime;

    ConfigBasedTransferExecutor.clearSceneRuleCache();
    ConfigBasedTransferExecutor.resetSceneRuleCacheStats();
    new ConfigBasedTransferExecutor(transferRules, scene);
    new ConfigBasedTransferExecutor(transferRules, scene);

    for (const caseName of caseNames) {
        const entryMethod = scene.getMethods().find(method => method.getName() === caseName);
        if (!entryMethod) {
            throw new Error(`entry method not found: ${caseName}`);
        }
        const engine = new TaintPropagationEngine(scene, options.k, { ...exactRuntime, transferRules, includeBuiltinModules: false });
        engine.verbose = false;
        await engine.buildPAG({
            entryModel: "explicit",
            syntheticEntryMethods: [entryMethod],
        });
        engine.setActiveReachableMethodSignatures(undefined, { mergeExplicitEntryScope: false });
        const seedNodes = findLocalSeedNodes(engine, scene, caseName, "taint_src");
        if (seedNodes.length === 0) {
            throw new Error(`${caseName}: expected taint_src seed nodes`);
        }
        engine.propagateWithSeeds(seedNodes);
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

