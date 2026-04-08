import * as path from "path";
import { Scene } from "../../../arkanalyzer/lib/Scene";
import { SceneConfig } from "../../../arkanalyzer/lib/Config";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { classifyArkMainFactOwnership, isArkMainEntryLayerFact } from "../../core/entry/arkmain/ArkMainTypes";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
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

function hasReachableMethod(reachable: Set<string>, methodName: string): boolean {
    for (const signature of reachable) {
        if (
            signature.includes(`.${methodName}(`)
            || signature.endsWith(`${methodName}()`)
            || signature.includes(methodName)
        ) {
            return true;
        }
    }
    return false;
}

async function main(): Promise<void> {
    const uiScene = buildScene(path.resolve("tests/demo/arkmain_entry_phases"));
    const uiPlan = buildArkMainPlan(uiScene);
    const uiFacts = uiPlan.facts.filter(fact =>
        fact.kind === "callback"
        && (fact.method.getName?.() === "cbOnClick" || fact.method.getName?.() === "cbOnChange"),
    );
    assert(uiFacts.length === 2, `ArkMain should preserve UI callback facts. actual=${uiFacts.map(fact => fact.method.getName()).join(", ")}`);
    for (const fact of uiFacts) {
        assert(fact.entryFamily === "ui_direct_slot", `UI callback fact must stay ui_direct_slot. actual=${fact.entryFamily}`);
        assert(classifyArkMainFactOwnership(fact) === "root_entry", `UI callback fact must remain root_entry. actual=${classifyArkMainFactOwnership(fact)}`);
        assert(isArkMainEntryLayerFact(fact), "UI callback fact must remain inside ArkMain entry layer.");
    }

    const externalScene = buildScene(path.resolve("tests/demo/arkmain_external_callback"));
    const externalSeedMethods = externalScene.getMethods().filter(method =>
        /^opaque_external_callback(_nested)?_\d+_T$/.test(method.getName?.() || ""),
    );
    const externalPlan = buildArkMainPlan(externalScene, { seedMethods: externalSeedMethods });
    const externalFacts = externalPlan.facts.filter(fact =>
        fact.kind === "callback"
        && fact.entryFamily === "unknown_external_callback",
    );
    const externalMethodNames = externalFacts.map(fact => fact.method.getName?.() || "");
    assert(hasNamedMethod(externalMethodNames, "directLeaf001"), `unknown_external_callback should keep direct leaf. actual=${externalMethodNames.join(", ")}`);
    assert(hasNamedMethod(externalMethodNames, "nestedLeaf001"), `unknown_external_callback should keep nested leaf. actual=${externalMethodNames.join(", ")}`);
    for (const fact of externalFacts) {
        assert(classifyArkMainFactOwnership(fact) === "root_entry", `unknown_external_callback must remain root_entry. actual=${classifyArkMainFactOwnership(fact)}`);
        assert(isArkMainEntryLayerFact(fact), "unknown_external_callback must remain inside ArkMain entry layer.");
    }

    const schedulerScene = buildScene(path.resolve("tests/demo/arkmain_scheduler_entry"));
    const schedulerPlan = buildArkMainPlan(schedulerScene);
    const schedulerFacts = schedulerPlan.facts.filter(fact => fact.kind === "scheduler_callback");
    const schedulerFactNames = schedulerFacts.map(fact => fact.method.getName());
    for (const methodName of ["onTimeoutCb", "onMicrotaskCb", "FactoryTimeoutCb"]) {
        assert(
            hasNamedMethod(schedulerFactNames, methodName),
            `ArkMain should keep scheduler callback ${methodName}. actual=${schedulerFactNames.join(", ")}`,
        );
    }
    const continuationFacts = schedulerPlan.facts.filter(fact =>
        (fact.kind === "callback" || fact.kind === "scheduler_callback")
        && fact.method.getName?.() === "onPromiseThenCb",
    );
    assert(
        continuationFacts.length === 0,
        `Promise continuation must stay outside ArkMain callback boundary. actual=${continuationFacts.map(fact => `${fact.kind}:${fact.reason}`).join(", ")}`,
    );

    const engine = new TaintPropagationEngine(schedulerScene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const reachable = engine.computeReachableMethodSignatures();
    assert(hasReachableMethod(reachable, "onTimeoutCb"), "ArkMain reachable set must include onTimeoutCb.");
    assert(hasReachableMethod(reachable, "onMicrotaskCb"), "ArkMain reachable set must include onMicrotaskCb.");
    assert(
        !hasReachableMethod(reachable, "onPromiseThenCb"),
        "Promise.then continuation must stay outside ArkMain reachable entry surface.",
    );

    console.log("PASS test_entry_model_framework_callback_boundary");
}

main().catch(error => {
    console.error("FAIL test_entry_model_framework_callback_boundary");
    console.error(error);
    process.exit(1);
});
