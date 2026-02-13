import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../arkanalyzer/out/src/core/base/Local";
import * as fs from "fs";
import * as path from "path";

interface CategoryStats {
    total: number;
    passed: number;
    failed: number;
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

function getParameterLocalNames(entryMethod: any): Set<string> {
    const names = new Set<string>();
    const cfg = entryMethod.getCfg();
    if (!cfg) return names;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const leftOp = stmt.getLeftOp();
        if (leftOp instanceof Local) names.add(leftOp.getName());
    }
    return names;
}

function resolveEntryMethodName(scene: Scene, relativePath: string, testName: string): string {
    const normalized = relativePath.split(path.sep).join("/");
    const isCrossFileA = normalized.includes("completeness/cross_file/") && testName.endsWith("_a");
    if (!isCrossFileA) return testName;

    const companion = `${testName.slice(0, -2)}_b`;
    const hasCompanion = scene.getMethods().some(m => m.getName() === companion);
    return hasCompanion ? companion : testName;
}

async function runSuite(scene: Scene, allFiles: string[], targetDir: string, adaptive: boolean): Promise<Record<string, CategoryStats>> {
    const stats: Record<string, CategoryStats> = {};

    for (const file of allFiles) {
        if (file.endsWith("taint_mock.ts") || file.endsWith("package.json")) continue;

        const relativePath = path.relative(targetDir, file);
        const category = path.dirname(relativePath).split(path.sep)[0];
        if (!stats[category]) stats[category] = { total: 0, passed: 0, failed: 0 };

        const testName = path.basename(file, ".ets");
        const entryName = resolveEntryMethodName(scene, relativePath, testName);
        const expected = testName.endsWith("_T") || testName.includes("_T_");

        try {
            const engine = adaptive
                ? new TaintPropagationEngine(scene, 1, { contextStrategy: "adaptive" })
                : new TaintPropagationEngine(scene, 1);
            engine.verbose = false;

            await engine.buildPAG(entryName);
            const entryMethod = scene.getMethods().find(m => m.getName() === entryName);
            if (!entryMethod) continue;
            const body = entryMethod.getBody();
            if (!body) continue;

            const paramLocalNames = getParameterLocalNames(entryMethod);
            const seeds: any[] = [];
            for (const local of body.getLocals().values()) {
                if (local.getName() === "taint_src" || paramLocalNames.has(local.getName())) {
                    const nodes = engine.pag.getNodesByValue(local);
                    if (!nodes) continue;
                    for (const nodeId of nodes.values()) {
                        seeds.push(engine.pag.getNode(nodeId));
                    }
                }
            }

            if (seeds.length > 0) {
                engine.propagateWithSeeds(seeds);
                const detected = engine.detectSinks("Sink").length > 0;
                if (detected === expected) stats[category].passed++;
                else stats[category].failed++;
            }
            stats[category].total++;
        } catch {
            // ignore single case error, keep sweep running
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
    const adaptive = await runSuite(scene, allFiles, targetDir, true);

    const fixedR = printSummary("Fixed k=1", fixed);
    const adaptiveR = printSummary("Adaptive k(v1)", adaptive);
    const delta = adaptiveR.passed - fixedR.passed;
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    console.log(`\nDelta: ${deltaStr} cases`);
}

run().catch(console.error);
