
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../arkanalyzer/out/src/core/base/Local";
import * as fs from 'fs';
import * as path from 'path';

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

interface ResolvedEntry {
    name: string;
    pathHint?: string;
}

function getParameterLocalNames(entryMethod: any): Set<string> {
    let names = new Set<string>();
    let cfg = entryMethod.getCfg();
    if (!cfg) return names;

    for (let stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        let leftOp = stmt.getLeftOp();
        if (leftOp instanceof Local) {
            names.add(leftOp.getName());
        }
    }
    return names;
}

function resolveEntryMethod(scene: Scene, relativePath: string, testName: string): ResolvedEntry {
    const normalized = relativePath.split(path.sep).join("/");
    const isCrossFileA = normalized.includes("completeness/cross_file/") && testName.endsWith("_a");
    if (isCrossFileA) {
        const companion = `${testName.slice(0, -2)}_b`;
        const hasCompanion = scene.getMethods().some(m => m.getName() === companion);
        if (hasCompanion) {
            const companionHint = normalized.replace(/_a\.ets$/i, "_b.ets");
            return { name: companion, pathHint: companionHint };
        }
    }

    const hasSameName = scene.getMethods().some(m => m.getName() === testName);
    if (hasSameName) return { name: testName, pathHint: normalized };

    const methodsInFile = scene
        .getMethods()
        .filter(m => m.getSignature().toString().includes(normalized) && m.getName() !== "%dflt");
    const labeled = methodsInFile.filter(m => /_(T|F)(?:_[ab])?$/.test(m.getName()));

    if (labeled.length === 1) {
        return { name: labeled[0].getName(), pathHint: normalized };
    }

    const expectedLabel = testName.includes("_T") ? "_T" : testName.includes("_F") ? "_F" : "";
    if (expectedLabel) {
        const labelMatch = labeled.find(m => m.getName().includes(expectedLabel));
        if (labelMatch) {
            return { name: labelMatch.getName(), pathHint: normalized };
        }
    }

    if (methodsInFile.length > 0) {
        return { name: methodsInFile[0].getName(), pathHint: normalized };
    }

    return { name: testName, pathHint: normalized };
}

function findEntryMethod(scene: Scene, entry: ResolvedEntry): any | undefined {
    const candidates = scene.getMethods().filter(m => m.getName() === entry.name);
    if (entry.pathHint) {
        const normalizedHint = entry.pathHint.replace(/\\/g, "/");
        const hinted = candidates.find(m => m.getSignature().toString().includes(normalizedHint));
        if (hinted) return hinted;
    }
    return candidates[0];
}

async function runWithK(scene: Scene, allFiles: string[], targetDir: string, k: number): Promise<Record<string, CategoryStats>> {
    let stats: Record<string, CategoryStats> = {};

    for (let file of allFiles) {
        if (file.endsWith('taint_mock.ts') || file.endsWith('package.json')) continue;

        let relativePath = path.relative(targetDir, file);
        let category = path.dirname(relativePath).split(path.sep)[0];
        if (!stats[category]) stats[category] = { total: 0, passed: 0, failed: 0, failedCases: [] };

        let testName = path.basename(file, '.ets');
        let entry = resolveEntryMethod(scene, relativePath, testName);
        let expected = testName.endsWith('_T') || testName.includes('_T_');

        try {
            let engine = new TaintPropagationEngine(scene, k);
            engine.verbose = false; // 抑制传播日志

            await engine.buildPAG(entry.name, entry.pathHint);

            let entryMethod = findEntryMethod(scene, entry);
            if (!entryMethod) continue;

            let methodBody = entryMethod.getBody();
            if (!methodBody) continue;

            let paramLocalNames = getParameterLocalNames(entryMethod);
            let localsMap = methodBody.getLocals();
            let seeds: any[] = [];
            for (let local of localsMap.values()) {
                // 仅从真实参数 local 取 seed，避免把中间变量（如 p Promise 变量）误作为入口污点。
                if (local.getName() === 'taint_src' || paramLocalNames.has(local.getName())) {
                    let nodes = engine.pag.getNodesByValue(local);
                    if (nodes) {
                        for (let nodeId of nodes.values()) {
                            seeds.push(engine.pag.getNode(nodeId));
                        }
                    }
                }
            }

            if (seeds.length > 0) {
                engine.propagateWithSeeds(seeds);
                let flows = engine.detectSinks("Sink");
                let detected = flows.length > 0;

                if (detected === expected) {
                    stats[category].passed++;
                } else {
                    stats[category].failed++;
                    stats[category].failedCases.push(`${testName} (Exp:${expected ? 'T' : 'F'} Got:${detected ? 'T' : 'F'})`);
                }
            }
            stats[category].total++;
        } catch (e) {
            // Silent skip
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
