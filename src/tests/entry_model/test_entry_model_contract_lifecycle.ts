import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import {
    resolveAbilityLifecycleContract,
    resolveComponentLifecycleContract,
    resolveExtensionLifecycleContract,
    resolveStageLifecycleContract,
} from "../../core/entry/arkmain/facts/ArkMainLifecycleContracts";
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
    assert(matched, `Missing contract fact kind=${kind}, class=${className}, method=${methodName}`);
}

function assertNoFactOnClass(
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
    assert(!matched, `Unexpected non-contract fact kind=${kind}, class=${className}, method=${methodName}`);
}

async function main(): Promise<void> {
    const onCreateContract = resolveAbilityLifecycleContract("onCreate");
    assert(onCreateContract?.phase === "bootstrap", "onCreate should be bootstrap lifecycle contract.");
    assert(onCreateContract?.kind === "ability_lifecycle", "onCreate kind mismatch.");

    const onNewWantContract = resolveAbilityLifecycleContract("onNewWant");
    assert(onNewWantContract?.phase === "reactive_handoff", "onNewWant should be reactive_handoff lifecycle contract.");

    const stageCreateContract = resolveStageLifecycleContract("onCreate");
    assert(stageCreateContract?.phase === "bootstrap", "AbilityStage.onCreate should be bootstrap lifecycle contract.");
    assert(stageCreateContract?.kind === "stage_lifecycle", "AbilityStage.onCreate kind mismatch.");

    const stageAcceptWantContract = resolveStageLifecycleContract("onAcceptWant");
    assert(stageAcceptWantContract?.phase === "reactive_handoff", "AbilityStage.onAcceptWant should be reactive_handoff lifecycle contract.");

    const extensionCreateContract = resolveExtensionLifecycleContract("onCreate");
    assert(extensionCreateContract?.phase === "bootstrap", "Extension onCreate should be bootstrap lifecycle contract.");
    assert(extensionCreateContract?.kind === "extension_lifecycle", "Extension onCreate kind mismatch.");

    const onUpdateFormContract = resolveAbilityLifecycleContract("onUpdateForm");
    assert(onUpdateFormContract?.phase === "interaction", "onUpdateForm should be interaction lifecycle contract.");

    const onDestroyContract = resolveAbilityLifecycleContract("onDestroy");
    assert(onDestroyContract?.phase === "teardown", "onDestroy should be teardown lifecycle contract.");

    const buildContract = resolveComponentLifecycleContract("build");
    assert(buildContract?.kind === "page_build", "build should be page_build contract.");
    assert(buildContract?.phase === "composition", "build should be composition contract.");

    const hideContract = resolveComponentLifecycleContract("onPageHide");
    assert(hideContract?.kind === "page_lifecycle", "onPageHide should be page_lifecycle contract.");
    assert(hideContract?.phase === "teardown", "onPageHide should be teardown contract.");

    assert(resolveAbilityLifecycleContract("onAddForms") === null, "onAddForms should not be a lifecycle contract.");
    assert(resolveComponentLifecycleContract("render") === null, "render should not be a lifecycle contract.");

    const lifecycleScene = buildScene(path.resolve("tests/demo/harmony_lifecycle"));
    const lifecyclePlan = buildArkMainPlan(lifecycleScene);
    assertFactOnClass(lifecyclePlan, "extension_lifecycle", "DemoFormExtension011", "onAddForm");
    assertNoFactOnClass(lifecyclePlan, "extension_lifecycle", "DemoFormExtension012", "onAddForms");
    assertFactOnClass(lifecyclePlan, "extension_lifecycle", "DemoFormExtension013", "onUpdateForm");
    assertNoFactOnClass(lifecyclePlan, "extension_lifecycle", "DemoFormExtension014", "onUpdateForms");
    assertFactOnClass(lifecyclePlan, "stage_lifecycle", "DemoAbilityStage015", "onCreate");
    assertNoFactOnClass(lifecyclePlan, "stage_lifecycle", "DemoAbilityStage016", "onStart");

    const paperScene = buildScene(path.resolve("tests/demo/harmony_main_paper"));
    const paperPlan = buildArkMainPlan(paperScene);
    assertFactOnClass(paperPlan, "page_build", "DemoPage", "build");
    assertFactOnClass(paperPlan, "page_lifecycle", "DemoPage", "aboutToAppear");
    assertFactOnClass(paperPlan, "page_lifecycle", "DemoPage", "onPageHide");

    console.log("PASS test_entry_model_contract_lifecycle");
}

main().catch(error => {
    console.error("FAIL test_entry_model_contract_lifecycle");
    console.error(error);
    process.exit(1);
});
