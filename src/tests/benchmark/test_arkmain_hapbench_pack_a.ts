import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";
import * as fs from "fs";
import * as path from "path";

interface CaseResult {
    name: string;
    expected: boolean;
    detected: boolean;
    seedCount: number;
    pass: boolean;
}

const KNOWN_BOUNDARY_CASES = new Set<string>();

function listCases(sourceDir: string): string[] {
    return fs.readdirSync(sourceDir)
        .filter(file => file.endsWith(".ets"))
        .map(file => path.basename(file, ".ets"))
        .filter(name => /_(T|F)$/.test(name))
        .filter(name => !KNOWN_BOUNDARY_CASES.has(name))
        .sort();
}

function buildScene(projectDir: string): Scene {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function makeCaseSandbox(sourceDir: string, caseName: string): string {
    const sandboxRoot = fs.mkdtempSync(path.join(path.resolve("tmp"), "arkmain_hapbench_pack_a_"));
    fs.copyFileSync(path.join(sourceDir, `${caseName}.ets`), path.join(sandboxRoot, `${caseName}.ets`));
    for (const sibling of fs.readdirSync(sourceDir)) {
        if (sibling === `${caseName}.ets`) continue;
        const fullPath = path.join(sourceDir, sibling);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;
        if (!(sibling.endsWith(".ets") || sibling.endsWith(".ts"))) continue;
        if (/_(T|F)\.ets$/.test(sibling)) continue;
        fs.copyFileSync(fullPath, path.join(sandboxRoot, sibling));
    }
    return sandboxRoot;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/arkmain_hapbench_pack_a");
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        projectRulePath: path.resolve("tests/rules/harmony_lifecycle_sink_only.rules.json"),
        allowMissingProject: false,
        autoDiscoverLayers: false,
    });
    const sourceRules: SourceRule[] = loaded.ruleSet.sources || [];
    const sinkRules: SinkRule[] = loaded.ruleSet.sinks || [];

    const cases = listCases(sourceDir);
    const results: CaseResult[] = [];
    let passCount = 0;

    for (const caseName of cases) {
        const expected = caseName.endsWith("_T");
        const sandbox = makeCaseSandbox(sourceDir, caseName);
        try {
            const scene = buildScene(sandbox);
            const engine = new TaintPropagationEngine(scene, 1, {
                transferRules: loaded.ruleSet.transfers || [],
            });
            await engine.buildPAG({ entryModel: "arkMain" });
            try {
                const reachable = engine.computeReachableMethodSignatures();
                engine.setActiveReachableMethodSignatures(reachable);
            } catch {
                engine.setActiveReachableMethodSignatures(undefined);
            }

            const seedInfo = engine.propagateWithSourceRules(sourceRules);
            const flows = engine.detectSinksByRules(sinkRules);
            const detected = flows.length > 0;
            const pass = detected === expected;
            if (pass) passCount += 1;
            results.push({ name: caseName, expected, detected, seedCount: seedInfo.seedCount, pass });
        } finally {
            fs.rmSync(sandbox, { recursive: true, force: true });
        }
    }

    console.log("====== ArkMain HapBench Pack A ======");
    console.log(`total_cases=${results.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${results.length - passCount}`);
    for (const result of results) {
        console.log(
            `${result.pass ? "PASS" : "FAIL"} ${result.name} `
            + `expected=${result.expected ? "T" : "F"} `
            + `detected=${result.detected} seeds=${result.seedCount}`,
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

