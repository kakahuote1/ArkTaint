import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import {
    resolveOfficialLifecycleContract,
} from "../../core/entry/arkmain/facts/ArkMainLifecycleContracts";
import {
    loadArkMainOfficialLifecycleDeclarations,
    resolveArkMainOfficialLifecycleDeclarationsByClassNameAndMethod,
    resolveArkMainOfficialLifecycleDeclarationsByOwnerKindAndMethod,
} from "../../core/entry/arkmain/catalog/ArkMainOfficialDeclarationCatalog";
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
    const findContract = (className: string, methodName: string) => {
        const declaration = resolveArkMainOfficialLifecycleDeclarationsByClassNameAndMethod(className, methodName)[0];
        assert(!!declaration, `missing official declaration class=${className}, method=${methodName}`);
        return resolveOfficialLifecycleContract(declaration);
    };

    assert(loadArkMainOfficialLifecycleDeclarations().length > 0, "official ArkMain declaration catalog should load.");

    const onCreateContract = findContract("UIAbility", "onCreate");
    assert(onCreateContract?.phase === "bootstrap", "onCreate should be bootstrap lifecycle contract.");
    assert(onCreateContract?.kind === "ability_lifecycle", "onCreate kind mismatch.");

    const onNewWantContract = findContract("UIAbility", "onNewWant");
    assert(onNewWantContract?.phase === "reactive_handoff", "onNewWant should be reactive_handoff lifecycle contract.");
    assert(onNewWantContract?.kind === "ability_lifecycle", "onNewWant kind mismatch.");

    const stageCreateContract = findContract("AbilityStage", "onCreate");
    assert(stageCreateContract?.phase === "bootstrap", "AbilityStage.onCreate should be bootstrap lifecycle contract.");
    assert(stageCreateContract?.kind === "stage_lifecycle", "AbilityStage.onCreate kind mismatch.");

    const stageAcceptWantContract = findContract("AbilityStage", "onAcceptWant");
    assert(stageAcceptWantContract?.phase === "bootstrap", "AbilityStage.onAcceptWant should be bootstrap lifecycle contract.");
    assert(stageAcceptWantContract?.kind === "stage_lifecycle", "AbilityStage.onAcceptWant kind mismatch.");

    const extensionCreateContract = findContract("ServiceExtensionAbility", "onCreate");
    assert(extensionCreateContract?.phase === "bootstrap", "Extension onCreate should be bootstrap lifecycle contract.");
    assert(extensionCreateContract?.kind === "extension_lifecycle", "Extension onCreate kind mismatch.");

    const onUpdateFormContract = findContract("FormExtensionAbility", "onUpdateForm");
    assert(onUpdateFormContract?.phase === "interaction", "onUpdateForm should be interaction lifecycle contract.");

    const onDestroyContract = findContract("UIAbility", "onDestroy");
    assert(onDestroyContract?.phase === "teardown", "onDestroy should be teardown lifecycle contract.");

    const buildContract = findContract("BaseCustomComponent", "build");
    assert(buildContract?.kind === "page_build", "build should be page_build contract.");
    assert(buildContract?.phase === "composition", "build should be composition contract.");

    const hideContract = findContract("CustomComponent", "onPageHide");
    assert(hideContract?.kind === "page_lifecycle", "onPageHide should be page_lifecycle contract.");
    assert(hideContract?.phase === "teardown", "onPageHide should be teardown contract.");

    const childProcessContract = findContract("ChildProcess", "onStart");
    assert(childProcessContract?.kind === "process_lifecycle", "ChildProcess.onStart should be process_lifecycle contract.");
    assert(childProcessContract?.phase === "bootstrap", "ChildProcess.onStart should be bootstrap contract.");
    assert(childProcessContract?.ownerKind === "child_process_owner", "ChildProcess.onStart owner kind mismatch.");

    for (const methodName of [
        "onNewWant",
        "onWindowStageCreate",
        "onWindowStageDestroy",
        "onWindowStageRestore",
        "onWindowStageWillDestroy",
    ]) {
        assert(
            resolveArkMainOfficialLifecycleDeclarationsByClassNameAndMethod("AbilityLifecycleCallback", methodName).length === 0,
            `AbilityLifecycleCallback.${methodName} is an observer callback and must not be a root lifecycle declaration.`,
        );
    }
    assert(
        resolveArkMainOfficialLifecycleDeclarationsByClassNameAndMethod("EnvironmentCallback", "onMemoryLevel").length === 0,
        "EnvironmentCallback.onMemoryLevel is an observer callback and must not be a root lifecycle declaration.",
    );
    assert(
        resolveArkMainOfficialLifecycleDeclarationsByClassNameAndMethod("Caller", "onRelease").length === 0,
        "Caller.onRelease is a callback registration API and must not be a root lifecycle declaration.",
    );
    assert(
        resolveArkMainOfficialLifecycleDeclarationsByClassNameAndMethod("BuilderNode", "build").length === 0,
        "BuilderNode.build invokes WrappedBuilder.builder and must not be a root lifecycle declaration.",
    );

    assert(
        resolveArkMainOfficialLifecycleDeclarationsByOwnerKindAndMethod("extension_owner", "onAddForms").length === 0,
        "onAddForms should not be an official lifecycle declaration.",
    );
    assert(
        resolveArkMainOfficialLifecycleDeclarationsByOwnerKindAndMethod("component_owner", "render").length === 0,
        "render should not be an official lifecycle declaration.",
    );

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
