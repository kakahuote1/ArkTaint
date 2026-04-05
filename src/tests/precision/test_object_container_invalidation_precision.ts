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
        | "object_delete"
        | "map_delete"
        | "map_clear"
        | "list_clear"
        | "queue_clear";
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
        filePath: "tests/adhoc/object_container_invalidation_language/object_delete_001_F.ets",
        expected: false,
        family: "object_delete",
    },
    {
        filePath: "tests/adhoc/object_container_invalidation_language/object_delete_002_T.ets",
        expected: true,
        family: "object_delete",
    },
    {
        filePath: "tests/adhoc/object_container_invalidation_language/map_delete_003_F.ets",
        expected: false,
        family: "map_delete",
    },
    {
        filePath: "tests/adhoc/object_container_invalidation_language/map_delete_004_T.ets",
        expected: true,
        family: "map_delete",
    },
    {
        filePath: "tests/adhoc/object_container_invalidation_language/map_clear_005_F.ets",
        expected: false,
        family: "map_clear",
    },
    {
        filePath: "tests/adhoc/object_container_invalidation_language/map_clear_006_T.ets",
        expected: true,
        family: "map_clear",
    },
    {
        filePath: "tests/adhoc/object_container_invalidation_language/list_clear_007_F.ets",
        expected: false,
        family: "list_clear",
    },
    {
        filePath: "tests/adhoc/object_container_invalidation_language/list_clear_008_T.ets",
        expected: true,
        family: "list_clear",
    },
    {
        filePath: "tests/adhoc/object_container_invalidation_language/queue_clear_009_F.ets",
        expected: false,
        family: "queue_clear",
    },
    {
        filePath: "tests/adhoc/object_container_invalidation_language/queue_clear_010_T.ets",
        expected: true,
        family: "queue_clear",
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

    console.log("====== Object and Container Invalidation Precision ======");
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
