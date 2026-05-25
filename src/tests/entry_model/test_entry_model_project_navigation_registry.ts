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

function factMethodNames(plan: ReturnType<typeof buildArkMainPlan>): string[] {
    return plan.facts.map(fact => fact.method.getName?.() || "");
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/arkmain_project_navigation_registry");
    const scene = buildScene(projectDir);
    const plan = buildArkMainPlan(scene);
    const names = factMethodNames(plan);

    const loginFact = plan.facts.find(fact =>
        fact.kind === "page_build"
        && fact.method.getName?.() === "LoginNav"
        && fact.entryFamily === "navigation_destination_builder"
        && fact.entryShape === "project_route_registry_builder"
        && fact.recognitionLayer === "project_navigation_registry",
    );
    if (!loginFact) {
        throw new Error(`ArkMain did not promote project route registry builder LoginNav. facts=${names.join(", ")}`);
    }

    if (plan.facts.some(fact => fact.kind === "page_build" && fact.method.getName?.() === "NoiseNav")) {
        throw new Error("ArkMain must not promote non-navigation EventBus.register builders as page entries.");
    }

    const compositionMethods = plan.phases.find(phase => phase.phase === "composition")?.methods || [];
    if (!compositionMethods.some(method => method.getName?.() === "LoginNav")) {
        throw new Error("ArkMain composition phase missing LoginNav builder.");
    }

    console.log("PASS test_entry_model_project_navigation_registry");
}

main().catch(error => {
    console.error("FAIL test_entry_model_project_navigation_registry");
    console.error(error);
    process.exit(1);
});
