import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import * as fs from "fs";
import * as path from "path";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "./helpers/SyntheticCaseHarness";

interface CliOptions {
    sourceDir: string;
    k: number;
}

interface CaseResult {
    caseName: string;
    expectedFlow: boolean;
    detectedFlow: boolean;
    pass: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/complex_calls";
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
        if (arg === "--k" && i + 1 < argv.length) {
            k = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--k=")) {
            k = Number(arg.slice("--k=".length));
            continue;
        }
    }

    if (!Number.isFinite(k) || k < 0) {
        throw new Error(`invalid --k: ${k}`);
    }
    return {
        sourceDir: path.resolve(sourceDir),
        k,
    };
}

function listCases(sourceDir: string): string[] {
    return fs.readdirSync(sourceDir)
        .filter(f => f.endsWith(".ets"))
        .map(f => path.basename(f, ".ets"))
        .sort();
}

async function runCase(scene: Scene, caseName: string, k: number): Promise<boolean> {
    const relativePath = `${caseName}.ets`;
    const entry = resolveCaseMethod(scene, relativePath, caseName);
    const entryMethod = findCaseMethod(scene, entry);
    if (!entryMethod) {
        throw new Error(`entry method not found: ${caseName}`);
    }

    const engine = await buildEngineForCase(scene, k, entryMethod, { verbose: false });
    const seeds = collectCaseSeedNodes(engine, entryMethod, {
        sourceLocalNames: ["taint_src"],
        includeParameterLocals: true,
    });
    if (seeds.length === 0) {
        throw new Error(`no taint_src seeds found: ${caseName}`);
    }

    engine.propagateWithSeeds(seeds);
    const flows = engine.detectSinks("Sink");
    return flows.length > 0;
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.sourceDir)) {
        throw new Error(`source dir not found: ${options.sourceDir}`);
    }

    const cases = listCases(options.sourceDir);
    if (cases.length === 0) {
        throw new Error(`no .ets cases found under ${options.sourceDir}`);
    }

    const results: CaseResult[] = [];
    for (const caseName of cases) {
        const sceneConfig = new SceneConfig();
        sceneConfig.buildFromProjectDir(options.sourceDir);
        const scene = new Scene();
        scene.buildSceneFromProjectDir(sceneConfig);
        scene.inferTypes();

        const expectedFlow = caseName.endsWith("_T");
        const detectedFlow = await runCase(scene, caseName, options.k);
        results.push({
            caseName,
            expectedFlow,
            detectedFlow,
            pass: expectedFlow === detectedFlow,
        });
    }

    const total = results.length;
    const passed = results.filter(r => r.pass).length;
    const failed = total - passed;

    console.log("====== Complex Calls Test ======");
    console.log(`k=${options.k}`);
    console.log(`total=${total}`);
    console.log(`passed=${passed}`);
    console.log(`failed=${failed}`);
    for (const r of results) {
        console.log(
            `${r.pass ? "PASS" : "FAIL"} ${r.caseName} expected=${r.expectedFlow} detected=${r.detectedFlow}`
        );
    }

    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
