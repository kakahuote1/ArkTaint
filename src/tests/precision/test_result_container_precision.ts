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
        | "map_key_view"
        | "map_value_view"
        | "from_entries"
        | "promise_aggregate"
        | "resultset_scalar_view"
        | "resultset_rows_view"
        | "datashare_scalar_view"
        | "datashare_rows_view";
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
        filePath: "tests/demo/library_semantic_regression/map_keys_001_T.ets",
        expected: true,
        family: "map_key_view",
    },
    {
        filePath: "tests/demo/library_semantic_regression/map_keys_002_F.ets",
        expected: false,
        family: "map_key_view",
    },
    {
        filePath: "tests/demo/library_semantic_regression/map_values_001_T.ets",
        expected: true,
        family: "map_value_view",
    },
    {
        filePath: "tests/demo/library_semantic_regression/map_values_002_F.ets",
        expected: false,
        family: "map_value_view",
    },
    {
        filePath: "tests/demo/library_semantic_regression/object_fromEntries_001_T.ets",
        expected: true,
        family: "from_entries",
    },
    {
        filePath: "tests/demo/library_semantic_regression/object_fromEntries_002_F.ets",
        expected: false,
        family: "from_entries",
    },
    {
        filePath: "tests/demo/library_semantic_regression/promise_all_001_T.ets",
        expected: true,
        family: "promise_aggregate",
    },
    {
        filePath: "tests/demo/library_semantic_regression/promise_all_002_F.ets",
        expected: false,
        family: "promise_aggregate",
    },
    {
        filePath: "tests/adhoc/result_container_language/resultset_query_getstring_001_T.ets",
        expected: true,
        family: "resultset_scalar_view",
    },
    {
        filePath: "tests/adhoc/result_container_language/resultset_query_getstring_002_F.ets",
        expected: false,
        family: "resultset_scalar_view",
    },
    {
        filePath: "tests/adhoc/result_container_language/resultset_query_rows_003_T.ets",
        expected: true,
        family: "resultset_rows_view",
    },
    {
        filePath: "tests/adhoc/result_container_language/resultset_query_rows_004_F.ets",
        expected: false,
        family: "resultset_rows_view",
    },
    {
        filePath: "tests/adhoc/result_container_language/datashare_query_getstring_005_T.ets",
        expected: true,
        family: "datashare_scalar_view",
    },
    {
        filePath: "tests/adhoc/result_container_language/datashare_query_getstring_006_F.ets",
        expected: false,
        family: "datashare_scalar_view",
    },
    {
        filePath: "tests/adhoc/result_container_language/datashare_query_rows_007_T.ets",
        expected: true,
        family: "datashare_rows_view",
    },
    {
        filePath: "tests/adhoc/result_container_language/datashare_query_rows_008_F.ets",
        expected: false,
        family: "datashare_rows_view",
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

    console.log("====== Result Container Precision ======");
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
