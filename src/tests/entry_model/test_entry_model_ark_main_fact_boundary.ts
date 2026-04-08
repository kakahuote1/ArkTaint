import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import {
    ARK_MAIN_ACTIVATION_SUPPORT_FACT_KINDS,
    ARK_MAIN_PROPAGATION_MODELING_FACT_KINDS,
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
        "callback",
        "scheduler_callback",
        "watch_handler",
        "want_handoff",
    ];
    for (const kind of expectedRootKinds) {
        assert(ARK_MAIN_ROOT_ENTRY_FACT_KINDS.has(kind as any), `missing root-entry kind guard for ${kind}`);
    }

    assert(
        ARK_MAIN_PROPAGATION_MODELING_FACT_KINDS.size === 0,
        "ArkMain should no longer retain propagation-modeling fact kinds in its planner contract",
    );

    const expectedActivationKinds = [
        "watch_source",
        "router_source",
        "router_trigger",
    ];
    for (const kind of expectedActivationKinds) {
        assert(ARK_MAIN_ACTIVATION_SUPPORT_FACT_KINDS.has(kind as any), `missing activation-support kind guard for ${kind}`);
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
    assert(watchSourceFact, "missing DemoPage.hydrateFromRoute watch_source fact");
    assert(classifyArkMainFactOwnership(watchSourceFact!) === "activation_support", "watch_source must be activation support");
    assert(isArkMainEntryLayerFact(watchSourceFact!), "watch_source must remain inside ArkMain entry layer");

    const watchHandlerFact = findFact(entryPlan, "watch_handler", "DemoPage", "onTokenWatch");
    assert(watchHandlerFact, "missing DemoPage.onTokenWatch watch_handler fact");
    assert(classifyArkMainFactOwnership(watchHandlerFact!) === "root_entry", "watch_handler must be root entry");

    const callbackFact = findFactByMethod(entryPlan, "callback", "cbOnClick");
    assert(callbackFact, "missing DemoPage.cbOnClick callback fact");
    assert(classifyArkMainFactOwnership(callbackFact!) === "root_entry", "callback must be root entry");

    const handoffFact = findFact(entryPlan, "want_handoff", "EntryAbility", "onNewWant");
    assert(handoffFact, "missing EntryAbility.onNewWant want_handoff fact");
    assert(classifyArkMainFactOwnership(handoffFact!) === "root_entry", "want_handoff must remain root entry");

    const routerScene = buildScene(path.resolve("tests/demo/harmony_router_bridge"));
    const routerPlan = buildArkMainPlan(routerScene);

    const routerSourceFact = findFact(routerPlan, "router_source", "%dflt", "router_replaceUrl_005_T");
    assert(routerSourceFact, "missing router_source fact in router bridge fixture");
    assert(classifyArkMainFactOwnership(routerSourceFact!) === "activation_support", "navigation router_source must remain activation support");

    const routerTriggerFact = findFact(routerPlan, "router_trigger", "ReplacePage", "render");
    assert(routerTriggerFact, "missing ReplacePage.render router_trigger fact");
    assert(classifyArkMainFactOwnership(routerTriggerFact!) === "activation_support", "navigation router_trigger must remain activation support");

    for (const fact of entryPlan.facts) {
        const ownership = classifyArkMainFactOwnership(fact);
        assert(
            ownership === "root_entry" || ownership === "activation_support" || ownership === "propagation_modeling",
            `unexpected fact ownership for ${fact.kind}`,
        );
    }

    console.log("PASS test_entry_model_ark_main_fact_boundary");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_fact_boundary");
    console.error(error);
    process.exit(1);
});
