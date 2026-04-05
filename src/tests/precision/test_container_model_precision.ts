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
        | "generic_map"
        | "generic_set"
        | "generic_weakmap"
        | "generic_list"
        | "generic_queue"
        | "util_vector"
        | "util_deque"
        | "util_stack"
        | "util_plainarray"
        | "util_hashmap"
        | "util_hashset"
        | "named_maplike"
        | "map_stringify_bridge";
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
        filePath: "tests/demo/senior_full/field_sensitive/container/map_field_sensitive_001_T.ets",
        expected: true,
        family: "generic_map",
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/map_field_sensitive_002_F.ets",
        expected: false,
        family: "generic_map",
    },
    {
        filePath: "tests/demo/library_semantic_regression/set_values_001_T.ets",
        expected: true,
        family: "generic_set",
    },
    {
        filePath: "tests/demo/library_semantic_regression/set_values_002_F.ets",
        expected: false,
        family: "generic_set",
    },
    {
        filePath: "tests/demo/library_semantic_regression/weakmap_get_001_T.ets",
        expected: true,
        family: "generic_weakmap",
    },
    {
        filePath: "tests/demo/library_semantic_regression/weakmap_get_002_F.ets",
        expected: false,
        family: "generic_weakmap",
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/list_field_sensitive_001_T.ets",
        expected: true,
        family: "generic_list",
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/list_field_sensitive_002_F.ets",
        expected: false,
        family: "generic_list",
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/queue_field_sensitive_001_T.ets",
        expected: true,
        family: "generic_queue",
    },
    {
        filePath: "tests/demo/senior_full/field_sensitive/container/queue_field_sensitive_002_F.ets",
        expected: false,
        family: "generic_queue",
    },
    {
        filePath: "tests/adhoc/container_model_language/vector_add_get_001_T.ets",
        expected: true,
        family: "util_vector",
    },
    {
        filePath: "tests/adhoc/container_model_language/vector_add_get_002_F.ets",
        expected: false,
        family: "util_vector",
    },
    {
        filePath: "tests/adhoc/container_model_language/deque_insert_end_003_T.ets",
        expected: true,
        family: "util_deque",
    },
    {
        filePath: "tests/adhoc/container_model_language/deque_insert_end_004_F.ets",
        expected: false,
        family: "util_deque",
    },
    {
        filePath: "tests/adhoc/container_model_language/stack_push_peek_005_T.ets",
        expected: true,
        family: "util_stack",
    },
    {
        filePath: "tests/adhoc/container_model_language/stack_push_peek_006_F.ets",
        expected: false,
        family: "util_stack",
    },
    {
        filePath: "tests/adhoc/container_model_language/plainarray_add_get_007_T.ets",
        expected: true,
        family: "util_plainarray",
    },
    {
        filePath: "tests/adhoc/container_model_language/plainarray_add_get_008_F.ets",
        expected: false,
        family: "util_plainarray",
    },
    {
        filePath: "tests/adhoc/container_model_language/hashmap_set_get_009_T.ets",
        expected: true,
        family: "util_hashmap",
    },
    {
        filePath: "tests/adhoc/container_model_language/hashmap_set_get_010_F.ets",
        expected: false,
        family: "util_hashmap",
    },
    {
        filePath: "tests/adhoc/container_model_language/hashset_values_011_T.ets",
        expected: true,
        family: "util_hashset",
    },
    {
        filePath: "tests/adhoc/container_model_language/hashset_values_012_F.ets",
        expected: false,
        family: "util_hashset",
    },
    {
        filePath: "tests/adhoc/container_model_language/preferences_put_get_013_T.ets",
        expected: true,
        family: "named_maplike",
    },
    {
        filePath: "tests/adhoc/container_model_language/preferences_put_get_014_F.ets",
        expected: false,
        family: "named_maplike",
    },
    {
        filePath: "tests/adhoc/container_model_language/preferences_putsync_getsync_019_T.ets",
        expected: true,
        family: "named_maplike",
    },
    {
        filePath: "tests/adhoc/container_model_language/preferences_putsync_getsync_020_F.ets",
        expected: false,
        family: "named_maplike",
    },
    {
        filePath: "tests/adhoc/container_model_language/globalcontext_getobject_015_T.ets",
        expected: true,
        family: "named_maplike",
    },
    {
        filePath: "tests/adhoc/container_model_language/globalcontext_getobject_016_F.ets",
        expected: false,
        family: "named_maplike",
    },
    {
        filePath: "tests/adhoc/container_model_language/distributedkv_put_get_017_T.ets",
        expected: true,
        family: "named_maplike",
    },
    {
        filePath: "tests/adhoc/container_model_language/distributedkv_put_get_018_F.ets",
        expected: false,
        family: "named_maplike",
    },
    {
        filePath: "tests/adhoc/container_model_language/map_stringify_get_021_T.ets",
        expected: true,
        family: "map_stringify_bridge",
    },
    {
        filePath: "tests/adhoc/container_model_language/map_stringify_get_022_F.ets",
        expected: false,
        family: "map_stringify_bridge",
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

    console.log("====== Container Model Precision ======");
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
