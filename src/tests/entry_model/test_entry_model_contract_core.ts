import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
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

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function hasContract(plan: ReturnType<typeof buildArkMainPlan>, methodName: string, surface: string, trigger: string): boolean {
    return plan.contracts.some(contract =>
        contract.method.getName?.() === methodName
        && contract.surface === surface
        && contract.trigger === trigger,
    );
}

async function main(): Promise<void> {
    const entryScene = buildScene(path.resolve("tests/demo/arkmain_entry_phases"));
    const entryPlan = buildArkMainPlan(entryScene);

    assert(entryPlan.contracts.length > 0, "ArkMain contracts should not be empty.");
    assert(hasContract(entryPlan, "onCreate", "lifecycle", "root"), "Missing lifecycle/root contract for onCreate.");
    assert(hasContract(entryPlan, "onNewWant", "lifecycle", "root"), "Missing lifecycle/root contract for onNewWant.");

    const lifecycleScene = buildScene(path.resolve("tests/demo/harmony_lifecycle"));
    const lifecyclePlan = buildArkMainPlan(lifecycleScene);
    const lifecycleKinds = new Set(lifecyclePlan.facts.map(fact => fact.kind));
    assert(
        lifecycleKinds.has("ability_lifecycle") || lifecycleKinds.has("extension_lifecycle"),
        "Lifecycle official declaration facts should be present in ArkMain plan.",
    );
    assert(
        lifecycleKinds.has("want_handoff"),
        "Want-like official declaration facts should be present in ArkMain plan.",
    );

    const externalScene = buildScene(path.resolve("tests/demo/sdk_unknown_callback_boundary_realworld"));
    const externalPlan = buildArkMainPlan(externalScene);
    assert(
        !externalPlan.facts.some(fact => String(fact.entryFamily || "") === "arkmain_unknown_callback_hint"),
        "Official-declaration ArkMain must not materialize unknown callback entry facts.",
    );

    const engine = new TaintPropagationEngine(entryScene, 1);
    await engine.buildPAG({ entryModel: "arkMain" });
    const runtimeRules = engine.getAutoEntrySourceRules();
    assert(runtimeRules.length > 0, "Engine should lower ArkMain contracts into auto entry source rules.");
    assert(
        runtimeRules.every(rule => rule.match.kind === "canonical_api_id_equals" && rule.apiEffect?.canonicalApiId === rule.match.value),
        "Engine ArkMain auto entry source rules must bind exact canonical apiEffect identities.",
    );

    console.log("PASS test_entry_model_contract_core");
}

main().catch(error => {
    console.error("FAIL test_entry_model_contract_core");
    console.error(error);
    process.exit(1);
});
