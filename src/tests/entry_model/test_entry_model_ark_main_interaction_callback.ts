import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
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

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function hasReachableSignature(reachable: Set<string>, signature: string): boolean {
    return reachable.has(signature);
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/arkmain_interaction_callback");
    const scene = buildScene(projectDir);
    const plan = buildArkMainPlan(scene);

    const interactionFact = plan.facts.find(fact =>
        fact.kind === "extension_lifecycle"
        && fact.phase === "interaction"
        && fact.method.getName?.() === "onUpdateForm"
        && fact.method.getDeclaringArkClass?.()?.getName?.() === "DemoInteractionFormExtension"
    );
    assert(interactionFact, "missing SDK-backed interaction lifecycle fact for DemoInteractionFormExtension.onUpdateForm");

    const callbackFact = plan.facts.find(fact =>
        fact.kind === "callback"
        && fact.phase === "interaction"
        && fact.method.isAnonymousMethod?.()
        && fact.method.getOuterMethod?.()?.getName?.() === "onUpdateForm"
        && fact.sourceMethod?.getName?.() === "onUpdateForm"
        && fact.callbackRecognitionLayer === "sdk_provenance"
    );
    assert(callbackFact, "missing callback fact registered from interaction lifecycle method onUpdateForm");

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const reachable = engine.computeReachableMethodSignatures();
    const callbackSignature = callbackFact.method.getSignature().toString();
    assert(
        hasReachableSignature(reachable, callbackSignature),
        `ArkMain reachable set missing interaction callback: ${callbackSignature}`,
    );

    console.log("PASS test_entry_model_ark_main_interaction_callback");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_interaction_callback");
    console.error(error);
    process.exit(1);
});
