
import { Scene } from "../arkanalyzer/src/Scene";
import { SceneConfig } from "../arkanalyzer/src/Config";
import { TaintPropagationEngine } from "./core/TaintPropagationEngine";
import * as path from 'path';

async function runTest() {
    // 1. Set up scene
    let projectDir = path.join(__dirname, "../../tests/resources/demo"); // Adjust path as needed
    // Create a dummy config
    let config = new SceneConfig();
    config.buildConfig("demo", projectDir, []);

    let scene = new Scene();
    scene.buildSceneFromProjectDir(config);

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
