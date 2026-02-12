
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import * as path from 'path';

async function runTest() {
    let projectDir = "d:/cursor/workplace/ArkTaint/tests/demo";

    let config = new SceneConfig();
    config.buildFromProjectDir(projectDir);

    let scene = new Scene();
    scene.buildSceneFromProjectDir(config);

    scene.inferTypes();

    let engine = new TaintPropagationEngine(scene);

    console.log("Building PAG for benchmark_field_001...");
    await engine.buildPAG('benchmark_field_001');
    console.log("PAG Built.");

    console.log("Propagating Taint...");
    engine.propagate("source");

    console.log("Detecting Flows...");
    let flows = engine.detectSinks("sink");

    if (flows.length > 0) {
        console.log("✅ SUCCESS: Detected Taint Flows:");
        flows.forEach(f => console.log(f.toString()));
    } else {
        console.log("❌ FAILURE: No flows detected (benchmark_field_001 failed).");
    }
}

runTest().catch(console.error);
