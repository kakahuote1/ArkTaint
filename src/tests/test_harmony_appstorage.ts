import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../core/rules/RuleLoader";
import { SinkRule, SourceRule } from "../core/rules/RuleSchema";
import { buildEngineForCase, findCaseMethod, resolveCaseMethod } from "./helpers/SyntheticCaseHarness";
import * as fs from "fs";
import * as path from "path";

interface CaseResult {
    name: string;
    expected: boolean;
    detected: boolean;
    seedCount: number;
    pass: boolean;
}

interface CliOptions {
    sourceDir: string;
    defaultRulePath: string;
    projectRulePath: string;
    k: number;
    disableModeling: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/harmony_appstorage";
    let defaultRulePath = "tests/rules/minimal.rules.json";
    let projectRulePath = "tests/rules/harmony_appstorage.rules.json";
    let k = 1;
    let disableModeling = false;

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
        if (arg === "--disableModeling") {
            disableModeling = true;
            continue;
        }
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}. Expected 0 or 1.`);
    }

    return {
        sourceDir: path.resolve(sourceDir),
        defaultRulePath: path.resolve(defaultRulePath),
        projectRulePath: path.resolve(projectRulePath),
        k,
        disableModeling,
    };
}

function listCases(sourceDir: string): string[] {
    return fs.readdirSync(sourceDir)
        .filter(f => f.endsWith(".ets"))
        .map(f => path.basename(f, ".ets"))
        .sort();
}

async function runCase(
    scene: Scene,
    caseName: string,
    relativePath: string,
    options: CliOptions,
    sourceRules: SourceRule[],
    sinkRules: SinkRule[]
): Promise<CaseResult> {
    const expected = caseName.endsWith("_T");
    const entry = resolveCaseMethod(scene, relativePath, caseName);
    const entryMethod = findCaseMethod(scene, entry);
    if (!entryMethod) {
        return {
            name: caseName,
            expected,
            detected: false,
            seedCount: 0,
            pass: !expected,
        };
    }
    const engine = await buildEngineForCase(scene, options.k, entryMethod, {
        engineOptions: {
        enableHarmonyAppStorageModeling: !options.disableModeling,
        },
        verbose: false,
    });
    try {
        const reachable = engine.computeReachableMethodSignatures();
        engine.setActiveReachableMethodSignatures(reachable);
    } catch {
        engine.setActiveReachableMethodSignatures(undefined);
    }

    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const detected = flows.length > 0;
    const pass = detected === expected;

    return {
        name: caseName,
        expected,
        detected,
        seedCount: seedInfo.seedCount,
        pass,
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.sourceDir)) {
        throw new Error(`sourceDir not found: ${options.sourceDir}`);
    }
    if (!fs.existsSync(options.defaultRulePath)) {
        throw new Error(`defaultRulePath not found: ${options.defaultRulePath}`);
    }
    if (!fs.existsSync(options.projectRulePath)) {
        throw new Error(`projectRulePath not found: ${options.projectRulePath}`);
    }

    const loaded = loadRuleSet({
        defaultRulePath: options.defaultRulePath,
        projectRulePath: options.projectRulePath,
        allowMissingProject: false,
        autoDiscoverLayers: false,
    });
    const sourceRules: SourceRule[] = loaded.ruleSet.sources || [];
    const sinkRules: SinkRule[] = loaded.ruleSet.sinks || [];
    console.log(`source_rules_loaded=${sourceRules.length}`);
    console.log(`sink_rules_loaded=${sinkRules.length}`);

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(options.sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const cases = listCases(options.sourceDir)
        .filter(name => name !== "taint_mock");
    const results: CaseResult[] = [];
    let passCount = 0;

    for (const caseName of cases) {
        const result = await runCase(scene, caseName, `${caseName}.ets`, options, sourceRules, sinkRules);
        if (result.pass) passCount++;
        results.push(result);
    }

    console.log("====== Harmony AppStorage Test ======");
    console.log(`k=${options.k}`);
    console.log(`modeling_enabled=${options.disableModeling ? "false" : "true"}`);
    console.log(`total_cases=${results.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${results.length - passCount}`);
    for (const r of results) {
        console.log(
            `${r.pass ? "PASS" : "FAIL"} ${r.name} expected=${r.expected ? "T" : "F"} `
            + `detected=${r.detected} seeds=${r.seedCount}`
        );
    }

    if (passCount !== results.length) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

