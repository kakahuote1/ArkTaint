import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { detectSinksByExactMethodsForTest, resolveUniqueMethodByExactNameForTest, resolveUniqueMethodByExactSignatureForTest } from "../helpers/ExactSinkDetectionTestUtils";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";

interface CaseSpec {
    filePath: string;
    expected: boolean;
}

const CASES: CaseSpec[] = [
    {
        filePath: "tests/adhoc/ordinary_callable_language/returned_object_field_callable_017_T.ets",
        expected: true,
    },
    {
        filePath: "tests/adhoc/ordinary_callable_language/returned_object_field_callable_018_F.ets",
        expected: false,
    },
];

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

async function runCase(testCase: CaseSpec): Promise<boolean> {
    const absoluteFile = path.resolve(testCase.filePath);
    const sourceDir = path.dirname(absoluteFile);
    const relativePath = path.relative(sourceDir, absoluteFile);
    const testName = path.basename(absoluteFile, ".ets");
    const scene = buildScene(sourceDir);
    const entry = resolveCaseMethod(scene, relativePath, testName);
    const entryMethod = findCaseMethod(scene, entry);
    if (!entryMethod) {
        throw new Error(`Entry method not found for ${testCase.filePath}`);
    }

    const engine = await buildEngineForCase(scene, 1, entryMethod, { verbose: false });
    const seeds = collectCaseSeedNodes(engine, entryMethod);
    engine.propagateWithSeeds(seeds);
    const flows = detectSinksByExactMethodsForTest(engine, resolveUniqueMethodByExactNameForTest(engine, "Sink"));
    const detected = flows.length > 0;
    const pass = detected === testCase.expected;
    console.log(
        `${pass ? "PASS" : "FAIL"} ${testName} `
        + `expected=${testCase.expected ? "T" : "F"} detected=${detected} `
        + `seeds=${seeds.length} flows=${flows.length}`,
    );
    return pass;
}

async function main(): Promise<void> {
    let allPass = true;
    for (const testCase of CASES) {
        const pass = await runCase(testCase);
        allPass = allPass && pass;
    }
    if (!allPass) {
        process.exitCode = 1;
        return;
    }
    console.log("PASS: returned object field callable resolution is precise.");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
