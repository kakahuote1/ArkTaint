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

function hasReachableMethodOnClass(reachable: Set<string>, className: string, methodName: string): boolean {
    for (const signature of reachable) {
        if (signature.includes(`: ${className}.${methodName}(`) || signature.includes(`.${className}.${methodName}(`)) {
            return true;
        }
    }
    return false;
}

async function main(): Promise<void> {
    const scene = buildScene(path.resolve("tests/demo/arkmain_registered_observer_callback"));
    const plan = buildArkMainPlan(scene);
    const callbackFacts = plan.facts.filter(fact =>
        fact.kind === "callback"
        && fact.phase === "interaction"
        && fact.sourceMethod?.getName?.() === "onCreate"
        && fact.callbackRecognitionLayer === "sdk_provenance"
    );
    assert(callbackFacts.length >= 8, `expected registered observer/caller callback facts, got ${callbackFacts.length}`);
    assert(
        !callbackFacts.some(fact => String(fact.callbackRegistrationSignature || "").includes("ApplicationContext.off(")),
        "ApplicationContext.off callback must not become an ArkMain callback fact",
    );
    assert(
        !callbackFacts.some(fact => String(fact.callbackRegistrationSignature || "").includes("Caller.off(")),
        "Caller.off callback must not become an ArkMain callback fact",
    );

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const reachable = engine.computeReachableMethodSignatures();

    for (const methodName of [
        "handleNewWant",
        "handleWindowStageCreate",
        "handleWindowStageDestroy",
        "handleWindowStageRestore",
        "handleWindowStageWillDestroy",
        "handleMemoryLevel",
        "handleCallerOnRelease",
        "handleCallerReleaseEvent",
    ]) {
        assert(
            hasReachableMethodOnClass(reachable, "DemoAbility", methodName),
            `ArkMain reachable set missing registered callback method DemoAbility.${methodName}`,
        );
    }

    console.log("PASS test_entry_model_ark_main_registered_observer_callback");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_registered_observer_callback");
    console.error(error);
    process.exit(1);
});
