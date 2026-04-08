import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";
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
    ruleCatalogPath: string;
    projectRulePath: string;
    k: number;
}

const KNOWN_BOUNDARY_CASES = new Set<string>();

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/arkmain_stateful_object_precision";
    let kernelRulePath = "tests/rules/minimal.rules.json";
    let ruleCatalogPath = "src/rules";
    let projectRulePath = "tests/rules/harmony_lifecycle_sink_only.rules.json";
    let k = 1;

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
        if (arg === "--ruleCatalog" && i + 1 < argv.length) {
            ruleCatalogPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--ruleCatalog=")) {
            ruleCatalogPath = arg.slice("--ruleCatalog=".length);
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
    }

    return {
        sourceDir: path.resolve(sourceDir),
        kernelRulePath: path.resolve(kernelRulePath),
        ruleCatalogPath: path.resolve(ruleCatalogPath),
        projectRulePath: path.resolve(projectRulePath),
        k,
    };
}

function listCases(sourceDir: string): string[] {
    return fs.readdirSync(sourceDir)
        .filter(file => file.endsWith(".ets"))
        .map(file => path.basename(file, ".ets"))
        .filter(name => /_(T|F)$/.test(name))
        .filter(name => !KNOWN_BOUNDARY_CASES.has(name))
        .sort();
}

function buildScene(projectDir: string): Scene {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function makeCaseSandbox(sourceDir: string, caseName: string): string {
    const sandboxRoot = fs.mkdtempSync(path.join(path.resolve("tmp"), "arkmain_stateful_object_"));
    const sourceFile = path.join(sourceDir, `${caseName}.ets`);
    const targetFile = path.join(sandboxRoot, `${caseName}.ets`);
    fs.copyFileSync(sourceFile, targetFile);
    const taintMock = path.resolve("tests/adhoc/object_accessor_language/taint_mock.ts");
    if (fs.existsSync(taintMock)) {
        fs.copyFileSync(taintMock, path.join(sandboxRoot, "taint_mock.ts"));
    }
    for (const sibling of fs.readdirSync(sourceDir)) {
        if (!sibling.endsWith(".ets")) continue;
        if (sibling === `${caseName}.ets`) continue;
        if (/_(T|F)\.ets$/.test(sibling)) continue;
        fs.copyFileSync(path.join(sourceDir, sibling), path.join(sandboxRoot, sibling));
    }
    return sandboxRoot;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const loaded = loadRuleSet({
        kernelRulePath: options.kernelRulePath,
        ruleCatalogPath: options.ruleCatalogPath,
        projectRulePath: options.projectRulePath,
        allowMissingProject: false,
        autoDiscoverLayers: false,
    });
    const sourceRules: SourceRule[] = loaded.ruleSet.sources || [];
    const sinkRules: SinkRule[] = loaded.ruleSet.sinks || [];

    const cases = listCases(options.sourceDir);
    const results: CaseResult[] = [];
    let passCount = 0;

    for (const caseName of cases) {
        const expected = caseName.endsWith("_T");
        const sandbox = makeCaseSandbox(options.sourceDir, caseName);
        try {
            const scene = buildScene(sandbox);
            const engine = new TaintPropagationEngine(scene, options.k, {
                transferRules: loaded.ruleSet.transfers || [],
            });
            engine.verbose = false;
            await engine.buildPAG({ entryModel: "arkMain" });
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
            if (pass) {
                passCount += 1;
            }

            results.push({
                name: caseName,
                expected,
                detected,
                seedCount: seedInfo.seedCount,
                pass,
            });
        } finally {
            fs.rmSync(sandbox, { recursive: true, force: true });
        }
    }

    console.log("====== ArkMain Stateful Object Precision ======");
    console.log(`total_cases=${results.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${results.length - passCount}`);
    for (const result of results) {
        console.log(
            `${result.pass ? "PASS" : "FAIL"} ${result.name} `
            + `expected=${result.expected ? "T" : "F"} `
            + `detected=${result.detected} seeds=${result.seedCount}`,
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
