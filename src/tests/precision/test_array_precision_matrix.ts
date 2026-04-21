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
    family: "variable_index" | "exact_slot" | "wildcard_view" | "reindex" | "destructive_readback" | "nested_view";
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
        filePath: "tests/adhoc/array_variable_index/array_var_index_same_local_001_T.ets",
        expected: true,
        family: "variable_index",
    },
    {
        filePath: "tests/adhoc/array_variable_index/array_var_index_diff_local_002_F.ets",
        expected: false,
        family: "variable_index",
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/array_003_T.ets",
        expected: true,
        family: "exact_slot",
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/array_004_F.ets",
        expected: false,
        family: "exact_slot",
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_from_001_T.ets",
        expected: true,
        family: "wildcard_view",
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_from_002_F.ets",
        expected: false,
        family: "wildcard_view",
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_flat_001_T.ets",
        expected: true,
        family: "wildcard_view",
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_flat_002_F.ets",
        expected: false,
        family: "wildcard_view",
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_splice_insert_001_T.ets",
        expected: true,
        family: "reindex",
    },
    {
        filePath: "tests/demo/library_semantic_regression/array_splice_insert_002_F.ets",
        expected: false,
        family: "reindex",
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/library_function/array_lib_func_003_T.ets",
        expected: true,
        family: "destructive_readback",
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/library_function/array_lib_func_004_F.ets",
        expected: false,
        family: "destructive_readback",
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/library_function/array_lib_func_007_T.ets",
        expected: true,
        family: "destructive_readback",
    },
    {
        filePath: "tests/demo/senior_full/completeness/function_call/library_function/array_lib_func_008_F.ets",
        expected: false,
        family: "destructive_readback",
    },
    {
        filePath: "tests/adhoc/array_variable_index/array_nested_row_stringify_005_T.ets",
        expected: true,
        family: "nested_view",
    },
    {
        filePath: "tests/adhoc/array_variable_index/array_nested_row_stringify_006_F.ets",
        expected: false,
        family: "nested_view",
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

    console.log("====== Array Precision Matrix ======");
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
