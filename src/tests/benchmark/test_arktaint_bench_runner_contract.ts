import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import {
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
    ResolvedCaseMethod,
} from "../helpers/SyntheticCaseHarness";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

interface SeniorFullManifest {
    targetDir: string;
    explicitEntries?: Record<string, string | { name: string; pathHint?: string }>;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function resolveExplicitEntry(
    manifest: SeniorFullManifest,
    normalizedRelative: string,
): ResolvedCaseMethod | undefined {
    const raw = manifest.explicitEntries?.[normalizedRelative];
    if (!raw) return undefined;
    if (typeof raw === "string") return { name: raw };
    if (typeof raw.name === "string" && raw.name.trim().length > 0) {
        return {
            name: raw.name.trim(),
            pathHint: raw.pathHint,
        };
    }
    return undefined;
}

function collectLeafFiles(root: string, leafDir: string): string[] {
    const fullLeaf = path.join(root, leafDir);
    return fs.readdirSync(fullLeaf, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith(".ets"))
        .map(entry => path.join(fullLeaf, entry.name))
        .sort((a, b) => a.localeCompare(b));
}

async function detectWithFreshEngine(
    scene: Scene,
    entryMethod: any,
    allEntryMethods: any[],
): Promise<boolean> {
    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({
        syntheticEntryMethods: allEntryMethods,
        entryModel: "explicit",
    });
    const seeds = collectCaseSeedNodes(engine, entryMethod);
    if (seeds.length === 0) return false;
    engine.propagateWithSeeds(seeds);
    return engine.detectSinks("Sink").length > 0;
}

async function main(): Promise<void> {
    const manifestPath = path.resolve("tests/manifests/benchmarks/arktaint_bench.json");
    const manifest = readJsonFile<{ seniorFull: SeniorFullManifest }>(manifestPath);
    const root = path.resolve(manifest.seniorFull.targetDir);
    const targetLeafDirs = [
        "completeness/control_flow/conditional_stmt",
        "completeness/function_call/closure_function",
        "completeness/promise_callback",
        "completeness/cross_file/cross_file_001_T",
        "completeness/cross_file/cross_file_002_F",
    ];

    const crossFileAEntries = fs.readdirSync(path.join(root, "completeness/cross_file"), { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .flatMap(entry => collectLeafFiles(root, `completeness/cross_file/${entry.name}`))
        .map(file => path.relative(root, file).replace(/\\/g, "/"))
        .filter(relative => /_a\.ets$/i.test(relative));

    const missingExplicitEntries = crossFileAEntries.filter(relative => !resolveExplicitEntry(manifest.seniorFull, relative));
    assert(
        missingExplicitEntries.length === 0,
        `benchmark manifest still relies on cross_file naming heuristic: ${missingExplicitEntries.join(", ")}`,
    );

    let comparedCases = 0;
    for (const leafDir of targetLeafDirs) {
        const projectDir = path.join(root, leafDir);
        const scene = buildScene(projectDir);
        const files = collectLeafFiles(root, leafDir);
        const prepared = files.map(file => {
            const relativePath = path.relative(projectDir, file).replace(/\\/g, "/");
            const normalizedRelative = path.relative(root, file).replace(/\\/g, "/");
            const testName = path.basename(file, ".ets");
            const explicitEntry = resolveExplicitEntry(manifest.seniorFull, normalizedRelative);
            const entry = resolveCaseMethod(scene, relativePath, testName, { explicitEntry });
            const entryMethod = findCaseMethod(scene, entry);
            assert(entryMethod?.getBody(), `missing entry method for ${normalizedRelative}`);
            return {
                normalizedRelative,
                expectedFlow: testName.endsWith("_T") || testName.includes("_T_"),
                entryMethod,
            };
        });
        const allEntryMethods = prepared.map(item => item.entryMethod);

        const sharedEngine = new TaintPropagationEngine(scene, 1);
        sharedEngine.verbose = false;
        await sharedEngine.buildPAG({
            syntheticEntryMethods: allEntryMethods,
            entryModel: "explicit",
        });

        for (const item of prepared) {
            sharedEngine.resetPropagationState();
            const sharedSeeds = collectCaseSeedNodes(sharedEngine, item.entryMethod);
            const sharedDetected = sharedSeeds.length > 0
                ? (() => {
                    sharedEngine.propagateWithSeeds(sharedSeeds);
                    return sharedEngine.detectSinks("Sink").length > 0;
                })()
                : false;
            const freshDetected = await detectWithFreshEngine(scene, item.entryMethod, allEntryMethods);
            assert(
                sharedDetected === freshDetected,
                `shared/fresh mismatch for ${item.normalizedRelative}: shared=${sharedDetected} fresh=${freshDetected}`,
            );
            assert(
                sharedDetected === item.expectedFlow,
                `unexpected benchmark regression for ${item.normalizedRelative}: expected=${item.expectedFlow} actual=${sharedDetected}`,
            );
            comparedCases += 1;
        }
    }

    console.log(`ArkTaint bench runner contract PASS: compared_cases=${comparedCases}`);
}

main().catch(error => {
    console.error("ArkTaint bench runner contract FAIL");
    console.error(error);
    process.exit(1);
});
