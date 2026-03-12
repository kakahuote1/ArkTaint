import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/TaintPropagationEngine";

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function hasLeakedDummyArtifacts(scene: Scene): boolean {
    return scene.getMethods().some(method => {
        const name = method.getName?.() || "";
        const sig = method.getSignature?.().toString?.() || "";
        return name === "@dummyMain" || sig.includes("@dummyFile");
    });
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/harmony_event_activation");
    const actualEntryName = "event_onchange_build_001_T";
    const requestedEntryNames = ["event_onchange_build_001_T", "main"];
    const scene = buildScene(projectDir);

    for (let round = 0; round < requestedEntryNames.length; round++) {
        const engine = new TaintPropagationEngine(scene, 1);
        engine.verbose = false;
        await engine.buildPAG();

        if (engine.cg.getDummyMainFuncID() === undefined) {
            throw new Error(`dummyMain build did not register a dummy main function ID (round=${round})`);
        }
        if (hasLeakedDummyArtifacts(scene)) {
            throw new Error(`dummyMain artifacts leaked into the shared scene after buildPAG (round=${round})`);
        }
        const reachable = engine.computeReachableMethodSignatures();
        if (reachable.size === 0) {
            throw new Error(`reachable method computation returned an empty set in dummyMain mode (round=${round})`);
        }
    }

    console.log("PASS test_entry_model_dummy_main");
}

main().catch(error => {
    console.error("FAIL test_entry_model_dummy_main");
    console.error(error);
    process.exit(1);
});
