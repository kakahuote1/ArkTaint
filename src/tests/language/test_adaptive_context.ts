import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { AdaptiveContextSelectorOptions } from "../../core/kernel/context/AdaptiveContextSelector";
import * as fs from "fs";
import * as path from "path";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";

interface CategoryStats {
    total: number;
    passed: number;
    failed: number;
    failedCases: string[];
}

function getFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            getFiles(filePath, fileList);
        } else if (file.endsWith(".ets")) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

async function runSuite(
    scene: Scene,
    allFiles: string[],
    targetDir: string,
    adaptive: boolean,
    adaptiveOptions: AdaptiveContextSelectorOptions = {}
): Promise<Record<string, CategoryStats>> {
    const stats: Record<string, CategoryStats> = {};

    for (const file of allFiles) {
        if (file.endsWith("taint_mock.ts") || file.endsWith("package.json")) continue;

        const relativePath = path.relative(targetDir, file);
        const category = path.dirname(relativePath).split(path.sep)[0];
        if (!stats[category]) stats[category] = { total: 0, passed: 0, failed: 0, failedCases: [] };

        const testName = path.basename(file, ".ets");
        const entry = resolveCaseMethod(scene, relativePath, testName);
        const expected = testName.endsWith("_T") || testName.includes("_T_");

        try {
            const entryMethod = findCaseMethod(scene, entry);
            if (!entryMethod) {
                stats[category].failed++;
                stats[category].failedCases.push(`${testName} (reason:no_entry)`);
                stats[category].total++;
                continue;
            }
            const body = entryMethod.getBody();
            if (!body) {
                stats[category].failed++;
                stats[category].failedCases.push(`${testName} (reason:no_body)`);
                stats[category].total++;
                continue;
            }

            const engineOptions = adaptive
                ? { contextStrategy: "adaptive" as const, adaptiveContext: adaptiveOptions }
                : undefined;
            const engine = await buildEngineForCase(scene, 1, entryMethod, {
                verbose: false,
                engineOptions,
            });
            const seeds = collectCaseSeedNodes(engine, entryMethod);
            if (seeds.length === 0) {
                stats[category].failed++;
                stats[category].failedCases.push(`${testName} (reason:no_seed)`);
                stats[category].total++;
                continue;
            }

            engine.propagateWithSeeds(seeds);
            const detected = engine.detectSinks("Sink").length > 0;
            if (detected === expected) stats[category].passed++;
            else {
                stats[category].failed++;
                stats[category].failedCases.push(testName);
            }
            stats[category].total++;
        } catch (err) {
            stats[category].failed++;
            stats[category].failedCases.push(`${testName} (reason:exception ${String(err)})`);
            stats[category].total++;
        }
    }
    return stats;
}

function printSummary(title: string, stats: Record<string, CategoryStats>): { passed: number; total: number } {
    console.log(`\n====== ${title} ======`);
    let total = 0;
    let passed = 0;

    for (const cat of Object.keys(stats).sort()) {
        const s = stats[cat];
        const rate = s.total > 0 ? (s.passed / s.total * 100).toFixed(1) : "0.0";
        console.log(`  ${cat.padEnd(25)} | ${s.passed}/${s.total} (${rate}%)`);
        total += s.total;
        passed += s.passed;
    }
    console.log(`  ${"TOTAL".padEnd(25)} | ${passed}/${total} (${(passed / total * 100).toFixed(1)}%)`);
    return { passed, total };
}

function collectFailedCases(stats: Record<string, CategoryStats>): string[] {
    const all: string[] = [];
    for (const cat of Object.keys(stats)) {
        all.push(...stats[cat].failedCases);
    }
    return all;
}

async function run(): Promise<void> {
    const targetDir = "d:/cursor/workplace/ArkTaint/tests/demo/senior_full";
    const config = new SceneConfig();
    config.buildFromProjectDir(targetDir);

    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();

    const allFiles = getFiles(targetDir);
    console.log(`Found ${allFiles.length} test files.`);

    const fixed = await runSuite(scene, allFiles, targetDir, false);
    const adaptiveV1 = await runSuite(scene, allFiles, targetDir, true);
    const hotMethods = collectFailedCases(adaptiveV1);
    const adaptiveV2 = await runSuite(scene, allFiles, targetDir, true, {
        allowSafeZeroK: true,
        zeroKFanInThreshold: 1,
        zeroKMaxCallSites: 1,
        conflictHotMethods: hotMethods,
        conflictMinK: 2,
    });

    const fixedR = printSummary("Fixed k=1", fixed);
    const adaptiveV1R = printSummary("Adaptive k(v1)", adaptiveV1);
    const adaptiveV2R = printSummary("Adaptive k(v2)", adaptiveV2);
    const deltaV1 = adaptiveV1R.passed - fixedR.passed;
    const deltaV2 = adaptiveV2R.passed - fixedR.passed;
    console.log(`\nDelta(v1-fixed): ${deltaV1 > 0 ? `+${deltaV1}` : `${deltaV1}`} cases`);
    console.log(`Delta(v2-fixed): ${deltaV2 > 0 ? `+${deltaV2}` : `${deltaV2}`} cases`);
    console.log(`Conflict hotspots from v1 failed cases: ${hotMethods.length}`);
}

run().catch(console.error);

