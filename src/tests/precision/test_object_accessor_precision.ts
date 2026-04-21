import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";

interface CaseSpec {
    filePath: string;
    expected: boolean;
    family:
        | "local_accessor"
        | "ability_accessor"
        | "deep_field_relay"
        | "stringify_accessor"
        | "crossfile_accessor";
}

interface CaseResult {
    name: string;
    expected: boolean;
    detected: boolean;
    family: CaseSpec["family"];
    pass: boolean;
}

const CASES: CaseSpec[] = [
    {
        filePath: "tests/adhoc/object_accessor_language/local_accessor_same_method_001_T.ets",
        expected: true,
        family: "local_accessor",
    },
    {
        filePath: "tests/adhoc/object_accessor_language/local_accessor_same_method_002_F.ets",
        expected: false,
        family: "local_accessor",
    },
    {
        filePath: "tests/adhoc/object_accessor_language/ability_accessor_relay_003_T.ets",
        expected: true,
        family: "ability_accessor",
    },
    {
        filePath: "tests/adhoc/object_accessor_language/ability_accessor_relay_004_F.ets",
        expected: false,
        family: "ability_accessor",
    },
    {
        filePath: "tests/adhoc/object_accessor_language/ability_deep_field_relay_005_T.ets",
        expected: true,
        family: "deep_field_relay",
    },
    {
        filePath: "tests/adhoc/object_accessor_language/ability_deep_field_relay_006_F.ets",
        expected: false,
        family: "deep_field_relay",
    },
    {
        filePath: "tests/adhoc/object_accessor_language/stringify_accessor_local_007_T.ets",
        expected: true,
        family: "stringify_accessor",
    },
    {
        filePath: "tests/adhoc/object_accessor_language/stringify_accessor_local_008_F.ets",
        expected: false,
        family: "stringify_accessor",
    },
    {
        filePath: "tests/adhoc/object_accessor_language/stringify_deep_field_009_T.ets",
        expected: true,
        family: "stringify_accessor",
    },
    {
        filePath: "tests/adhoc/object_accessor_language/stringify_deep_field_010_F.ets",
        expected: false,
        family: "stringify_accessor",
    },
    {
        filePath: "tests/adhoc/object_accessor_language/crossfile_accessor_011_T.ets",
        expected: true,
        family: "crossfile_accessor",
    },
    {
        filePath: "tests/adhoc/object_accessor_language/crossfile_accessor_012_F.ets",
        expected: false,
        family: "crossfile_accessor",
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

async function runCase(scene: Scene, testCase: CaseSpec): Promise<CaseResult> {
    const absoluteFile = path.resolve(testCase.filePath);
    const sourceDir = path.dirname(absoluteFile);
    const relativePath = path.relative(sourceDir, absoluteFile);
    const testName = path.basename(absoluteFile, ".ets");
    const entry = resolveCaseMethod(scene, relativePath, testName);
    const entryMethod = findCaseMethod(scene, entry);
    if (!entryMethod) {
        throw new Error(`Entry method not found for ${testCase.filePath}`);
    }

    const engine = await buildEngineForCase(scene, 1, entryMethod, { verbose: false });
    const seeds = collectCaseSeedNodes(engine, entryMethod);
    if (seeds.length === 0) {
        return {
            name: testName,
            expected: testCase.expected,
            detected: false,
            family: testCase.family,
            pass: false,
        };
    }

    engine.propagateWithSeeds(seeds);
    const flows = engine.detectSinks("Sink");
    const detected = flows.length > 0;
    return {
        name: testName,
        expected: testCase.expected,
        detected,
        family: testCase.family,
        pass: detected === testCase.expected,
    };
}

async function main(): Promise<void> {
    const results: CaseResult[] = [];

    for (const testCase of CASES) {
        const sourceDir = path.resolve(path.dirname(testCase.filePath));
        const scene = buildScene(sourceDir);
        results.push(await runCase(scene, testCase));
    }

    const passCount = results.filter(r => r.pass).length;
    const familyCounts = new Map<CaseSpec["family"], { total: number; pass: number }>();
    for (const result of results) {
        const current = familyCounts.get(result.family) || { total: 0, pass: 0 };
        current.total += 1;
        if (result.pass) current.pass += 1;
        familyCounts.set(result.family, current);
    }

    console.log("====== Object Accessor Precision ======");
    console.log(`total_cases=${results.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${results.length - passCount}`);
    for (const [family, summary] of familyCounts.entries()) {
        console.log(`family.${family}=${summary.pass}/${summary.total}`);
    }
    for (const result of results) {
        console.log(
            `${result.pass ? "PASS" : "FAIL"} ${result.name} `
            + `family=${result.family} `
            + `expected=${result.expected ? "T" : "F"} `
            + `detected=${result.detected}`,
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
