import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import {
    ARK_MAIN_ROOT_ENTRY_FACT_KINDS,
    classifyArkMainFactOwnership,
    isArkMainEntryLayerFact,
} from "../../core/entry/arkmain/ArkMainTypes";
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

function assert(condition: unknown, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function findFact(
    plan: ReturnType<typeof buildArkMainPlan>,
    kind: string,
    className: string,
    methodName: string,
) {
    return plan.facts.find(f =>
        f.kind === kind
        && f.method.getName() === methodName
        && f.method.getDeclaringArkClass?.().getName?.() === className,
    );
}

function findFactByMethod(
    plan: ReturnType<typeof buildArkMainPlan>,
    kind: string,
    methodName: string,
) {
    return plan.facts.find(f => f.kind === kind && f.method.getName() === methodName);
}

async function main(): Promise<void> {
    const entryScene = buildScene(path.resolve("tests/demo/arkmain_entry_phases"));
    const entryPlan = buildArkMainPlan(entryScene);

    const expectedRootKinds = [
        "ability_lifecycle",
        "stage_lifecycle",
        "extension_lifecycle",
        "page_build",
        "page_lifecycle",
    ];
    for (const kind of expectedRootKinds) {
        assert(ARK_MAIN_ROOT_ENTRY_FACT_KINDS.has(kind as any), `missing root-entry kind guard for ${kind}`);
    }

    const stateFact = findFact(entryPlan, "state_trigger", "DemoPage", "build");
    assert(!stateFact, "state_trigger must not remain in ArkMain planner facts");

    const propFact = findFact(entryPlan, "prop_channel", "ChildPropCard", "build");
    assert(!propFact, "prop_channel must not remain in ArkMain planner facts");

    const linkFact = findFact(entryPlan, "link_channel", "ChildLinkCard", "build");
    assert(!linkFact, "link_channel must not remain in ArkMain planner facts");

    const storageFact = findFact(entryPlan, "storage_trigger", "DemoPage", "hydrateFromRoute");
    assert(!storageFact, "storage_trigger must not remain in ArkMain planner facts");

    const watchSourceFact = findFact(entryPlan, "watch_source", "DemoPage", "hydrateFromRoute");
    assert(!watchSourceFact, "watch_source must not remain in ArkMain planner facts");

    const watchHandlerFact = findFact(entryPlan, "watch_handler", "DemoPage", "onTokenWatch");
    assert(!watchHandlerFact, "watch_handler must not remain in ArkMain planner facts");

    const callbackFact = findFactByMethod(entryPlan, "callback", "cbOnClick");
    assert(!callbackFact, "callback must not remain in ArkMain planner facts");

    const handoffFact = findFact(entryPlan, "ability_lifecycle", "EntryAbility", "onNewWant");
    assert(handoffFact, "missing EntryAbility.onNewWant ability_lifecycle fact");
    assert(classifyArkMainFactOwnership(handoffFact!) === "root_entry", "ability_lifecycle must remain root entry");
    assert(isArkMainEntryLayerFact(handoffFact!), "ability_lifecycle must remain inside ArkMain entry layer");

    const routerScene = buildScene(path.resolve("tests/demo/harmony_router_bridge"));
    const routerPlan = buildArkMainPlan(routerScene);

    const routerSourceFact = findFact(routerPlan, "router_source", "%dflt", "router_replaceUrl_005_T");
    assert(!routerSourceFact, "navigation router_source must not remain in ArkMain");

    const routerTriggerFact = findFact(routerPlan, "router_trigger", "ReplacePage", "render");
    assert(!routerTriggerFact, "navigation router_trigger must not remain in ArkMain");

    for (const fact of entryPlan.facts) {
        const ownership = classifyArkMainFactOwnership(fact);
        assert(ownership === "root_entry", `unexpected fact ownership for ${fact.kind}`);
        assert(isArkMainEntryLayerFact(fact), `fact should remain in ArkMain entry layer: ${fact.kind}`);
    }

    console.log("PASS test_entry_model_ark_main_fact_boundary");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_fact_boundary");
    console.error(error);
    process.exit(1);
});
