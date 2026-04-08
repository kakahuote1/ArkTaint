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
    family: "nested_field" | "deep_field" | "object_alias" | "extracted_alias" | "object_relay";
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
        filePath: "tests/adhoc/ordinary_object_field_chain/nested_field_store_001_T.ets",
        expected: true,
        family: "nested_field",
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/nested_field_store_002_F.ets",
        expected: false,
        family: "nested_field",
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/deep_field_chain_005_T.ets",
        expected: true,
        family: "deep_field",
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/deep_field_chain_006_F.ets",
        expected: false,
        family: "deep_field",
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/object_alias_load_007_T.ets",
        expected: true,
        family: "object_alias",
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/object_alias_load_008_F.ets",
        expected: false,
        family: "object_alias",
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/extracted_nested_alias_009_T.ets",
        expected: true,
        family: "extracted_alias",
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/extracted_nested_alias_010_F.ets",
        expected: false,
        family: "extracted_alias",
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/nested_object_relay_011_T.ets",
        expected: true,
        family: "object_relay",
    },
    {
        filePath: "tests/adhoc/ordinary_object_field_chain/nested_object_relay_012_F.ets",
        expected: false,
        family: "object_relay",
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

    console.log("====== Object Path Precision Matrix ======");
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
