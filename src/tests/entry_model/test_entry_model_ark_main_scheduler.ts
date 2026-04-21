import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
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

function main(): void | Promise<void> {
    const projectDir = path.resolve("tests/demo/arkmain_scheduler_entry");
    const scene = buildScene(projectDir);
    const plan = buildArkMainPlan(scene);

    const schedulerFacts = plan.facts.filter(f =>
        ["onTimeoutCb", "onMicrotaskCb", "FactoryTimeoutCb", "onPromiseThenCb"].includes(f.method.getName?.() || ""),
    );
    if (schedulerFacts.length !== 0) {
        throw new Error(`ArkMain must not retain scheduler_callback facts. actual=${schedulerFacts.map(f => f.method.getName()).join(", ")}`);
    }

    const schedulerEdges = plan.activationGraph.edges.filter(edge => String(edge.kind) === "scheduler_activation");
    if (schedulerEdges.length !== 0) {
        throw new Error(`ArkMain should not retain scheduler_activation edges. actual=${schedulerEdges.map(edge => edge.toMethod.getName()).join(", ")}`);
    }

    if (plan.schedule.activations.some(item =>
        ["onTimeoutCb", "onMicrotaskCb", "FactoryTimeoutCb"].includes(item.method.getName?.() || ""),
    )) {
        throw new Error("ArkMain must not schedule timer/scheduler callbacks.");
    }
    console.log("PASS test_entry_model_ark_main_scheduler");
}

Promise.resolve(main()).catch(error => {
    console.error("FAIL test_entry_model_ark_main_scheduler");
    console.error(error);
    process.exit(1);
});
