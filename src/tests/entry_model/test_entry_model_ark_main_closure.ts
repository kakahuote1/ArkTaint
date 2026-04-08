import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function hasReachableSignature(reachable: Set<string>, signature: string): boolean {
    return reachable.has(signature);
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/arkmain_closure_callback");
    const scene = buildScene(projectDir);
    const plan = buildArkMainPlan(scene);

    const closureCallbackFact = plan.facts.find(f =>
        f.kind === "callback"
        && f.phase === "interaction"
        && f.method.isAnonymousMethod?.()
        && f.method.getOuterMethod?.()?.getName?.() === "build",
    );
    if (!closureCallbackFact) {
        throw new Error("ArkMain missing anonymous closure callback fact from build().");
    }
    const closureParameters = closureCallbackFact.method.getParameters();
    for (const parameter of closureParameters) {
        const parameterName = parameter.getName?.() || "";
        const parameterType = parameter.getType?.()?.toString?.() || "";
        if (parameterName.includes("token") || parameterType.includes("token")) {
            throw new Error(`ArkMain closure callback leaked state-as-parameter: ${parameterName}:${parameterType}`);
        }
        const looksLikeClosureEnv = parameterName.startsWith("%closures") || parameterType.startsWith("[");
        if (!looksLikeClosureEnv) {
            throw new Error(`ArkMain closure callback parameter is not closure-env shaped: ${parameterName}:${parameterType}`);
        }
    }

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });

    const reachable = engine.computeReachableMethodSignatures();
    const callbackSignature = closureCallbackFact.method.getSignature().toString();
    if (!hasReachableSignature(reachable, callbackSignature)) {
        throw new Error(`ArkMain reachable set missing closure callback: ${callbackSignature}`);
    }

    console.log("PASS test_entry_model_ark_main_closure");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_closure");
    console.error(error);
    process.exit(1);
});

