import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../arkanalyzer/out/src/core/base/Local";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import * as fs from "fs";
import * as path from "path";

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

function collectSeedNodes(engine: TaintPropagationEngine, entryMethod: any): any[] {
    const seeds: any[] = [];
    const seen = new Set<number>();
    const cfg = entryMethod.getCfg();
    if (!cfg) return seeds;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkParameterRef)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        if (left.getName() !== "taint_src") continue;

        const nodes = engine.pag.getNodesByValue(left);
        if (!nodes) continue;
        for (const nodeId of nodes.values()) {
            if (seen.has(nodeId)) continue;
            seen.add(nodeId);
            seeds.push(engine.pag.getNode(nodeId));
        }
    }
    return seeds;
}

async function runCase(scene: Scene, caseName: string, k: number): Promise<boolean> {
    const engine = new TaintPropagationEngine(scene, k);
    engine.verbose = false;
    await engine.buildPAG(caseName);

    const entryMethod = scene.getMethods().find(m => m.getName() === caseName);
    if (!entryMethod) {
        throw new Error(`entry method not found: ${caseName}`);
    }

    const seeds = collectSeedNodes(engine, entryMethod);
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

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(options.sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const cases = listCases(options.sourceDir);
    if (cases.length === 0) {
        throw new Error(`no .ets cases found under ${options.sourceDir}`);
    }

    const results: CaseResult[] = [];
    for (const caseName of cases) {
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
