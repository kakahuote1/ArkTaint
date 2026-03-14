
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import * as path from 'path';

async function runTest() {
    // 1. Set up scene
    let projectDir = "d:/cursor/workplace/ArkTaint/tests/demo";

    let config = new SceneConfig();
    config.buildFromProjectDir(projectDir);

    let scene = new Scene();
    scene.buildSceneFromProjectDir(config);

    scene.inferTypes();

    // 2. Initialize Engine
    let engine = new TaintPropagationEngine(scene);

    // 3. Build PAG (Phase 1)
    console.log("Building PAG...");
    await engine.buildPAG();
    console.log("PAG Built.");

    // 4. Propagate (Phase 2)
    console.log("Propagating Taint...");
    engine.propagate("source"); // Matches any method containing "source"

    // 5. Detect Sinks
    console.log("Detecting Flows...");
    let flows = engine.detectSinks("sink"); // Matches any method containing "sink"

    // 6. Report
    if (flows.length > 0) {
        console.log("✅ SUCCESS: Detected Taint Flows:");
        flows.forEach(f => console.log(f.toString()));
    } else {
        console.log("❌ FAILURE: No flows detected.");
    }
}

runTest().catch(console.error);
