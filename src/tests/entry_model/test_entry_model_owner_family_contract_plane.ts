import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { collectFrameworkManagedOwners } from "../../core/entry/arkmain/facts/ArkMainOwnerDiscovery";
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

function findClass(scene: Scene, className: string) {
    const cls = scene.getClasses().find(item => item.getName() === className);
    assert(cls, `missing class ${className}`);
    return cls!;
}

function assertFactOnClass(
    plan: ReturnType<typeof buildArkMainPlan>,
    kind: string,
    className: string,
    methodName: string,
): void {
    const matched = plan.facts.some(fact =>
        fact.kind === kind
        && fact.method.getDeclaringArkClass?.().getName?.() === className
        && fact.method.getName?.() === methodName,
    );
    assert(matched, `missing fact kind=${kind}, class=${className}, method=${methodName}`);
}

async function main(): Promise<void> {
    const lifecycleScene = buildScene(path.resolve("tests/demo/harmony_lifecycle"));
    const lifecycleOwners = collectFrameworkManagedOwners(lifecycleScene);
    const abilityStage = findClass(lifecycleScene, "DemoAbilityStage015");
    const formExtension = findClass(lifecycleScene, "DemoFormExtension011");

    assert(lifecycleOwners.isStageOwner(abilityStage), "DemoAbilityStage015 should be recognized as stage owner.");
    assert(!lifecycleOwners.isAbilityOwner(abilityStage), "DemoAbilityStage015 should not fall back to ability owner.");
    assert(!lifecycleOwners.isExtensionOwner(abilityStage), "DemoAbilityStage015 should not be recognized as extension owner.");

    assert(lifecycleOwners.isExtensionOwner(formExtension), "DemoFormExtension011 should be recognized as extension owner.");
    assert(!lifecycleOwners.isAbilityOwner(formExtension), "DemoFormExtension011 should not fall back to ability owner.");
    assert(!lifecycleOwners.isStageOwner(formExtension), "DemoFormExtension011 should not be recognized as stage owner.");

    const lifecyclePlan = buildArkMainPlan(lifecycleScene);
    assertFactOnClass(lifecyclePlan, "stage_lifecycle", "DemoAbilityStage015", "onCreate");
    assertFactOnClass(lifecyclePlan, "extension_lifecycle", "DemoFormExtension011", "onAddForm");
    assertFactOnClass(lifecyclePlan, "extension_lifecycle", "DemoFormExtension013", "onUpdateForm");

    const entryScene = buildScene(path.resolve("tests/demo/arkmain_entry_phases"));
    const entryOwners = collectFrameworkManagedOwners(entryScene);
    const abilityOwner = findClass(entryScene, "EntryAbility");
    const componentOwner = findClass(entryScene, "DemoPage");
    assert(entryOwners.isAbilityOwner(abilityOwner), "EntryAbility should be recognized as ability owner.");
    assert(!entryOwners.isStageOwner(abilityOwner), "EntryAbility should not be recognized as stage owner.");
    assert(!entryOwners.isExtensionOwner(abilityOwner), "EntryAbility should not be recognized as extension owner.");
    assert(entryOwners.isComponentOwner(componentOwner), "DemoPage should be recognized as component owner.");

    const entryPlan = buildArkMainPlan(entryScene);
    assertFactOnClass(entryPlan, "ability_lifecycle", "EntryAbility", "onCreate");
    assertFactOnClass(entryPlan, "page_build", "DemoPage", "build");
    assertFactOnClass(entryPlan, "page_lifecycle", "DemoPage", "aboutToAppear");

    const extensionScene = buildScene(path.resolve("tests/demo/harmony_extension_composition"));
    const extensionOwners = collectFrameworkManagedOwners(extensionScene);
    const workScheduler = findClass(extensionScene, "ProbeWorkScheduler004");
    assert(extensionOwners.isExtensionOwner(workScheduler), "ProbeWorkScheduler004 should be recognized as extension owner.");
    assert(!extensionOwners.isAbilityOwner(workScheduler), "ProbeWorkScheduler004 should not be recognized as ability owner.");
    const extensionPlan = buildArkMainPlan(extensionScene);
    assertFactOnClass(extensionPlan, "extension_lifecycle", "ProbeWorkScheduler004", "onWorkStop");

    console.log("PASS test_entry_model_owner_family_contract_plane");
}

main().catch(error => {
    console.error("FAIL test_entry_model_owner_family_contract_plane");
    console.error(error);
    process.exit(1);
});
