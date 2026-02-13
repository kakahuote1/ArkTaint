import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { ArkAssignStmt } from "../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../arkanalyzer/out/src/core/base/Local";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import * as path from "path";

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

async function run(): Promise<void> {
    const projectDir = "d:/cursor/workplace/ArkTaint/tests/demo/senior_full";
    const entryName = "for_005_T";

    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();

    const engine = new TaintPropagationEngine(scene, 1, {
        debug: {
            enableWorklistProfile: true,
            enablePropagationTrace: true,
            propagationTraceMaxEdges: 20000,
        },
    });
    engine.verbose = false;

    await engine.buildPAG(entryName);

    const entryMethod = scene.getMethods().find(m => m.getName() === entryName);
    if (!entryMethod || !entryMethod.getBody()) {
        throw new Error(`Entry method ${entryName} not found.`);
    }

    const paramLocalNames = getParameterLocalNames(entryMethod);
    const seeds: any[] = [];
    for (const local of entryMethod.getBody()!.getLocals().values()) {
        if (!paramLocalNames.has(local.getName()) && local.getName() !== "taint_src") continue;
        const nodes = engine.pag.getNodesByValue(local);
        if (!nodes) continue;
        for (const nodeId of nodes.values()) {
            seeds.push(engine.pag.getNode(nodeId));
        }
    }
    if (seeds.length === 0) {
        throw new Error("No taint seeds collected.");
    }

    engine.propagateWithSeeds(seeds);
    const flows = engine.detectSinks("Sink");

    const tag = `${entryName}_k1`;
    const outputDir = path.join("tmp", "phase35");
    const artifacts = engine.dumpDebugArtifacts(tag, outputDir);
    const profile = engine.getWorklistProfile();
    const topReasons = (profile?.byReason ?? []).slice(0, 10);

    console.log(`flows=${flows.length}`);
    console.log(`profile=${artifacts.profilePath ?? "disabled"}`);
    console.log(`trace=${artifacts.dotPath ?? "disabled"}`);
    console.log("top_enqueue_reasons:");
    for (const reason of topReasons) {
        console.log(`  ${reason.reason}: attempts=${reason.attempts}, success=${reason.successes}, dedup=${reason.dedupDrops}`);
    }
}

run().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
