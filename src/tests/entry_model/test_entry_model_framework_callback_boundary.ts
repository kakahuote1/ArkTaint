import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
}

function hasNamedMethod(methodNames: string[], expected: string): boolean {
    return methodNames.some(name => name === expected || name.includes(expected));
}

async function main(): Promise<void> {
    const uiScene = buildScene(path.resolve("tests/demo/arkmain_entry_phases"));
    const uiPlan = buildArkMainPlan(uiScene);
    const uiFacts = uiPlan.facts.filter(fact =>
        fact.method.getName?.() === "cbOnClick" || fact.method.getName?.() === "cbOnChange",
    );
    assert(uiFacts.length === 0, `ArkMain must not preserve UI callback facts. actual=${uiFacts.map(fact => fact.method.getName()).join(", ")}`);

    const externalScene = buildScene(path.resolve("tests/demo/arkmain_external_callback"));
    const externalSeedMethods = externalScene.getMethods().filter(method =>
        /^opaque_external_callback(_nested)?_\d+_T$/.test(method.getName?.() || ""),
    );
    const externalPlan = buildArkMainPlan(externalScene, { seedMethods: externalSeedMethods });
    const externalFacts = externalPlan.facts.filter(fact =>
        ["directLeaf001", "nestedLeaf001"].includes(fact.method.getName?.() || ""),
    );
    const externalMethodNames = externalFacts.map(fact => fact.method.getName?.() || "");
    assert(!hasNamedMethod(externalMethodNames, "directLeaf001"), `ArkMain must not promote direct external callback leafs without official declaration. actual=${externalMethodNames.join(", ")}`);
    assert(!hasNamedMethod(externalMethodNames, "nestedLeaf001"), `ArkMain must not promote nested external callback leafs without official declaration. actual=${externalMethodNames.join(", ")}`);

    const schedulerScene = buildScene(path.resolve("tests/demo/arkmain_scheduler_entry"));
    const schedulerPlan = buildArkMainPlan(schedulerScene);
    const schedulerFacts = schedulerPlan.facts.filter(fact =>
        ["onTimeoutCb", "onMicrotaskCb", "FactoryTimeoutCb", "onPromiseThenCb"].includes(fact.method.getName?.() || ""),
    );
    assert(schedulerFacts.length === 0, `ArkMain must not keep scheduler callbacks. actual=${schedulerFacts.map(fact => fact.method.getName()).join(", ")}`);

    console.log("PASS test_entry_model_framework_callback_boundary");
}

main().catch(error => {
    console.error("FAIL test_entry_model_framework_callback_boundary");
    console.error(error);
    process.exit(1);
});
