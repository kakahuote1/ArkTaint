import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
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
    assert(entryPlan.sourceRules.length > 0, "ArkMain source rules should not be empty.");
    assert(hasContract(entryPlan, "onCreate", "lifecycle", "root"), "Missing lifecycle/root contract for onCreate.");
    assert(hasContract(entryPlan, "cbOnClick", "callback", "callback"), "Missing callback contract for cbOnClick.");
    assert(hasContract(entryPlan, "onTokenWatch", "watch", "state_watch"), "Missing watch contract for onTokenWatch.");
    assert(hasContract(entryPlan, "hydrateFromRoute", "router", "navigation_channel"), "Missing router contract for hydrateFromRoute.");
    assert(hasContract(entryPlan, "onNewWant", "handoff", "ability_handoff"), "Missing handoff contract for onNewWant.");

    const sourceSchemaCount = entryPlan.contracts.reduce((sum, contract) => sum + contract.sourceSchemas.length, 0);
    assert(sourceSchemaCount === entryPlan.sourceRules.length, `ArkMain source rules should be derived solely from contract source schemas. contracts=${sourceSchemaCount}, rules=${entryPlan.sourceRules.length}`);

    const lifecycleScene = buildScene(path.resolve("tests/demo/harmony_lifecycle"));
    const lifecyclePlan = buildArkMainPlan(lifecycleScene);
    const lifecycleSourceIds = new Set(lifecyclePlan.sourceRules.map(rule => rule.id));
    assert(
        [...lifecycleSourceIds].some(id => id.startsWith("source.arkmain.contract.lifecycle.param.")),
        "Lifecycle contract sources should be present in plan.sourceRules.",
    );
    assert(
        [...lifecycleSourceIds].some(id => id.startsWith("source.arkmain.contract.router.trigger.")),
        "Router contract sources should be present in plan.sourceRules.",
    );

    const externalScene = buildScene(path.resolve("tests/demo/sdk_structural_fallback_realworld"));
    const externalPlan = buildArkMainPlan(externalScene);
    assert(
        externalPlan.sourceRules.some(rule => rule.family === "arkmain_unknown_callback_hint"),
        "Unknown callback hint should be materialized as plan source rule.",
    );

    const engine = new TaintPropagationEngine(entryScene, 1);
    await engine.buildPAG({ entryModel: "arkMain" });
    const runtimeRuleIds = new Set(engine.getAutoSourceHintRules().map(rule => rule.id));
    const planRuleIds = new Set(entryPlan.sourceRules.map(rule => rule.id));
    assert(runtimeRuleIds.size === planRuleIds.size, `Engine should consume ArkMain plan source rules directly. runtime=${runtimeRuleIds.size}, plan=${planRuleIds.size}`);
    for (const ruleId of planRuleIds) {
        assert(runtimeRuleIds.has(ruleId), `Engine auto source rules drifted from ArkMain plan: missing ${ruleId}`);
    }

    console.log("PASS test_entry_model_contract_core");
}

main().catch(error => {
    console.error("FAIL test_entry_model_contract_core");
    console.error(error);
    process.exit(1);
});
