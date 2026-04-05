import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
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
    kernelRulePath: string;
    projectRulePath: string;
    k: number;
    disableModule: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/harmony_state_mgmt";
    let kernelRulePath = "tests/rules/minimal.rules.json";
    let projectRulePath = "tests/rules/harmony_state_mgmt.rules.json";
    let k = 1;
    let disableModule = false;

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
        if (arg === "--kernelRule" && i + 1 < argv.length) {
            kernelRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--kernelRule=")) {
            kernelRulePath = arg.slice("--kernelRule=".length);
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
        if (arg === "--disable-module") {
            disableModule = true;
            continue;
        }
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}. Expected 0 or 1.`);
    }

    return {
        sourceDir: path.resolve(sourceDir),
        kernelRulePath: path.resolve(kernelRulePath),
        projectRulePath: path.resolve(projectRulePath),
        k,
        disableModule,
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
    options: CliOptions,
    sourceRules: SourceRule[],
    sinkRules: SinkRule[]
): Promise<CaseResult> {
    const expected = caseName.endsWith("_T");
    const engine = new TaintPropagationEngine(scene, options.k, {
        disabledModuleIds: options.disableModule ? ["harmony.state"] : [],
    });
    engine.verbose = false;
    await engine.buildPAG();
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
    if (!fs.existsSync(options.kernelRulePath)) {
        throw new Error(`kernelRulePath not found: ${options.kernelRulePath}`);
    }
    if (!fs.existsSync(options.projectRulePath)) {
        throw new Error(`projectRulePath not found: ${options.projectRulePath}`);
    }

    const loaded = loadRuleSet({
        kernelRulePath: options.kernelRulePath,
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
        const result = await runCase(scene, caseName, options, sourceRules, sinkRules);
        if (result.pass) passCount++;
        results.push(result);
    }

    console.log("====== Harmony State Management Test ======");
    console.log(`k=${options.k}`);
    console.log(`module_enabled=${options.disableModule ? "false" : "true"}`);
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

