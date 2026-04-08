
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import * as fs from 'fs';
import * as path from 'path';
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";

function getFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            getFiles(filePath, fileList);
        } else if (file.endsWith('.ets')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

interface CategoryStats {
    total: number;
    passed: number;
    failed: number;
    failedCases: string[];
}

async function runWithK(
    scene: Scene,
    allFiles: string[],
    targetDir: string,
    k: number
): Promise<Record<string, CategoryStats>> {
    let stats: Record<string, CategoryStats> = {};

    for (let file of allFiles) {
        if (file.endsWith('taint_mock.ts') || file.endsWith('package.json')) continue;

        let relativePath = path.relative(targetDir, file);
        let category = path.dirname(relativePath).split(path.sep)[0];
        if (!stats[category]) stats[category] = { total: 0, passed: 0, failed: 0, failedCases: [] };

        let testName = path.basename(file, '.ets');
        let entry = resolveCaseMethod(scene, relativePath, testName);
        let expected = testName.endsWith('_T') || testName.includes('_T_');

        try {
            let entryMethod = findCaseMethod(scene, entry);
            if (!entryMethod) {
                stats[category].failed++;
                stats[category].failedCases.push(`${testName} (reason:no_entry)`);
                stats[category].total++;
                continue;
            }

            let methodBody = entryMethod.getBody();
            if (!methodBody) {
                stats[category].failed++;
                stats[category].failedCases.push(`${testName} (reason:no_body)`);
                stats[category].total++;
                continue;
            }

            let engine = await buildEngineForCase(scene, k, entryMethod, {
                verbose: false,
            });
            let seeds = collectCaseSeedNodes(engine, entryMethod);
            if (seeds.length === 0) {
                stats[category].failed++;
                stats[category].failedCases.push(`${testName} (reason:no_seed)`);
                stats[category].total++;
                continue;
            }

            engine.propagateWithSeeds(seeds);
            let flows = engine.detectSinks("Sink");
            let detected = flows.length > 0;

            if (detected === expected) {
                stats[category].passed++;
            } else {
                stats[category].failed++;
                stats[category].failedCases.push(`${testName} (Exp:${expected ? 'T' : 'F'} Got:${detected ? 'T' : 'F'})`);
            }
            stats[category].total++;
        } catch (e) {
            stats[category].failed++;
            stats[category].failedCases.push(`${testName} (reason:exception ${String(e)})`);
            stats[category].total++;
        }
    }
    return stats;
}

function printResults(stats: Record<string, CategoryStats>, label: string): { total: number, passed: number } {
    console.log(`\n====== ${label} ======`);
    let grandTotal = 0, grandPassed = 0, grandFailed = 0;
    let cats = Object.keys(stats).sort();
    for (let cat of cats) {
        let s = stats[cat];
        let rate = s.total > 0 ? ((s.passed / s.total) * 100).toFixed(1) : "0.0";
        console.log(`  ${cat.padEnd(25)} | Total: ${s.total.toString().padEnd(3)} | Passed: ${s.passed.toString().padEnd(3)} | Failed: ${s.failed.toString().padEnd(3)} | Rate: ${rate}%`);
        grandTotal += s.total;
        grandPassed += s.passed;
        grandFailed += s.failed;
    }
    let overallRate = grandTotal > 0 ? ((grandPassed / grandTotal) * 100).toFixed(1) : "0.0";
    console.log(`  ${'TOTAL'.padEnd(25)} | Total: ${grandTotal.toString().padEnd(3)} | Passed: ${grandPassed.toString().padEnd(3)} | Failed: ${grandFailed.toString().padEnd(3)} | Rate: ${overallRate}%`);
    return { total: grandTotal, passed: grandPassed };
}

async function runTest() {
    let targetDir = "d:/cursor/workplace/ArkTaint/tests/demo/senior_full";
    if (!fs.existsSync(targetDir)) {
        console.error(`Target directory ${targetDir} does not exist!`);
        return;
    }

    let config = new SceneConfig();
    config.buildFromProjectDir(targetDir);
    let scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();

    let allFiles = getFiles(targetDir);
    console.log(`Found ${allFiles.length} test files in ${targetDir}`);

    // Run k=0
    console.log("\n>>> Running with k=0 (context-insensitive)...");
    let stats0 = await runWithK(scene, allFiles, targetDir, 0);
    let r0 = printResults(stats0, "k=0 RESULTS");

    // Run k=1
    console.log("\n>>> Running with k=1 (context-sensitive)...");
    let stats1 = await runWithK(scene, allFiles, targetDir, 1);
    let r1 = printResults(stats1, "k=1 RESULTS");

    // Diff
    console.log("\n====== DIFF (k=1 vs k=0) ======");
    let allCats = new Set([...Object.keys(stats0), ...Object.keys(stats1)]);
    let anyDiff = false;
    for (let cat of [...allCats].sort()) {
        let s0 = stats0[cat] || { total: 0, passed: 0, failed: 0, failedCases: [] };
        let s1 = stats1[cat] || { total: 0, passed: 0, failed: 0, failedCases: [] };
        let diff = s1.passed - s0.passed;
        if (diff !== 0) {
            console.log(`  ${cat.padEnd(25)} | k=0: ${s0.passed}/${s0.total} -> k=1: ${s1.passed}/${s1.total} (${diff > 0 ? '+' : ''}${diff})`);
            anyDiff = true;
        }
    }
    if (!anyDiff) console.log("  No difference.");

    // Summary
    console.log(`\n====== SUMMARY ======`);
    console.log(`  k=0: ${r0.passed}/${r0.total} (${(r0.passed / r0.total * 100).toFixed(1)}%)`);
    console.log(`  k=1: ${r1.passed}/${r1.total} (${(r1.passed / r1.total * 100).toFixed(1)}%)`);
    console.log(`  Improvement: ${r1.passed - r0.passed > 0 ? '+' : ''}${r1.passed - r0.passed} cases`);

    // Failed cases for k=1
    console.log("\n====== k=1 FAILED CASES ======");
    for (let cat of [...allCats].sort()) {
        let s1 = stats1[cat];
        if (s1 && s1.failedCases.length > 0) {
            console.log(`  [${cat}]`);
            for (let fc of s1.failedCases) {
                console.log(`    - ${fc}`);
            }
        }
    }
}

runTest().catch(console.error);


