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

interface CaseResult {
    name: string;
    expected: boolean;
    detected: boolean;
    pass: boolean;
}

async function detectCase(scene: Scene, caseFile: string, caseName: string): Promise<boolean> {
    const entry = resolveCaseMethod(scene, caseFile, caseName);
    const entryMethod = findCaseMethod(scene, entry);
    if (!entryMethod) {
        throw new Error(`entry method not found: ${caseName}`);
    }

    const engine = await buildEngineForCase(scene, 1, entryMethod, { verbose: false });
    const seeds = collectCaseSeedNodes(engine, entryMethod, {
        sourceLocalNames: ["taint_src"],
        includeParameterLocals: true,
    });
    if (seeds.length === 0) {
        throw new Error(`no taint_src seeds found: ${caseName}`);
    }

    engine.propagateWithSeeds(seeds);
    return engine.detectSinks("Sink").length > 0;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/nested_capture");
    const config = new SceneConfig();
    config.buildFromProjectDir(sourceDir);

    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();

    const caseFiles = fs.readdirSync(sourceDir)
        .filter(name => name.endsWith(".ets"))
        .sort();

    const results: CaseResult[] = [];
    let passCount = 0;
    for (const caseFile of caseFiles) {
        const caseName = path.basename(caseFile, ".ets");
        const expected = caseName.endsWith("_T");
        const detected = await detectCase(scene, caseFile, caseName);
        const pass = detected === expected;
        if (pass) passCount++;
        results.push({ name: caseName, expected, detected, pass });
    }

    console.log("====== Nested Capture Propagation Test ======");
    console.log(`total_cases=${results.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${results.length - passCount}`);
    for (const result of results) {
        console.log(
            `${result.pass ? "PASS" : "FAIL"} ${result.name} `
            + `expected=${result.expected ? "T" : "F"} detected=${result.detected}`
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
