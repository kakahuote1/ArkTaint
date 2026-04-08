import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";

interface CaseSpec {
    filePath: string;
    expected: boolean;
    family: "field_overwrite" | "alias_overwrite" | "nested_rebind" | "instance_isolation";
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
        filePath: "tests/adhoc/ordinary_object_update_language/field_overwrite_safe_001_F.ets",
        expected: false,
        family: "field_overwrite",
    },
    {
        filePath: "tests/adhoc/ordinary_object_update_language/field_overwrite_taint_002_T.ets",
        expected: true,
        family: "field_overwrite",
    },
    {
        filePath: "tests/adhoc/ordinary_object_update_language/alias_overwrite_safe_003_F.ets",
        expected: false,
        family: "alias_overwrite",
    },
    {
        filePath: "tests/adhoc/ordinary_object_update_language/alias_overwrite_taint_004_T.ets",
        expected: true,
        family: "alias_overwrite",
    },
    {
        filePath: "tests/adhoc/ordinary_object_update_language/nested_rebind_safe_005_F.ets",
        expected: false,
        family: "nested_rebind",
    },
    {
        filePath: "tests/adhoc/ordinary_object_update_language/nested_rebind_taint_006_T.ets",
        expected: true,
        family: "nested_rebind",
    },
    {
        filePath: "tests/adhoc/ordinary_object_update_language/instance_rebind_safe_007_F.ets",
        expected: false,
        family: "instance_isolation",
    },
    {
        filePath: "tests/adhoc/ordinary_object_update_language/instance_peer_safe_008_F.ets",
        expected: false,
        family: "instance_isolation",
    },
    {
        filePath: "tests/adhoc/ordinary_object_update_language/instance_alias_taint_009_T.ets",
        expected: true,
        family: "instance_isolation",
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

    console.log("====== Object Strong Update Precision ======");
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
