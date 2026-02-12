
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";
import * as path from 'path';

async function runTest() {
    // 1. Set up scene
    // Note: Arkanalyzer reads all files in the directory.
    // field_flow.ts is in the same dir as simple_flow.ts.
    // Ideally we'd separate them, but for now they coexist.
    // The engine iterates ALL methods in the scene.
    // So it will run both main() from simple_flow and main() from field_flow?
    // Wait, ts-node compiles them? No, Arkanalyzer parses source.
    // If they define 'main', they might conflict if they are in the same scope?
    // Each file is a module in ArkTS usually.
    // Arkanalyzer models them as separate files.

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
    await engine.buildPAG('main_field');
    console.log("PAG Built.");

    // 4. Propagate (Phase 2)
    console.log("Propagating Taint...");
    engine.propagate("source");

    // 5. Detect Sinks
    console.log("Detecting Flows...");
    let flows = engine.detectSinks("sink");

    // 6. Report
    if (flows.length > 0) {
        console.log("✅ SUCCESS: Detected Taint Flows:");
        flows.forEach(f => console.log(f.toString()));
    } else {
        console.log("❌ FAILURE: No flows detected.");
    }
}

runTest().catch(console.error);
