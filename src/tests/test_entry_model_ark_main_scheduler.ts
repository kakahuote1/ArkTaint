import * as path from "path";
import { Scene } from "../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";
import { buildArkMainPlan } from "../core/entry/arkmain/ArkMainPlanner";
import { registerMockSdkFiles } from "./helpers/TestSceneBuilder";

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);
    return scene;
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

function hasNamedMethod(methodNames: string[], expected: string): boolean {
    return methodNames.some(name => name === expected || name.includes(expected));
}

function main(): void | Promise<void> {
    const projectDir = path.resolve("tests/demo/arkmain_scheduler_entry");
    const scene = buildScene(projectDir);
    const plan = buildArkMainPlan(scene);

    const schedulerFacts = plan.facts.filter(f => f.kind === "scheduler_callback");
    const schedulerFactNames = schedulerFacts.map(f => f.method.getName()).sort();
    for (const methodName of ["onTimeoutCb", "onMicrotaskCb", "FactoryTimeoutCb"]) {
        if (!hasNamedMethod(schedulerFactNames, methodName)) {
            throw new Error(`ArkMain missing scheduler_callback fact for ${methodName}. actual=${schedulerFactNames.join(", ")}`);
        }
    }
    if (hasNamedMethod(schedulerFactNames, "onPromiseThenCb")) {
        throw new Error(`ArkMain should not treat Promise.then continuation as scheduler entry. actual=${schedulerFactNames.join(", ")}`);
    }
    const timeoutFact = schedulerFacts.find(f => hasNamedMethod([f.method.getName()], "onTimeoutCb"));
    if (!timeoutFact) {
        throw new Error("ArkMain missing scheduler fact metadata probe for onTimeoutCb.");
    }
    if (
        timeoutFact.callbackShape !== "direct_callback_slot"
        || timeoutFact.callbackSlotFamily !== "scheduler_slot"
        || timeoutFact.entryShape !== "direct_callback_slot"
        || timeoutFact.callbackRecognitionLayer !== "owner_qualified_fallback"
    ) {
        throw new Error(`ArkMain scheduler fact metadata mismatch: shape=${timeoutFact.callbackShape}, slotFamily=${timeoutFact.callbackSlotFamily}, entryShape=${timeoutFact.entryShape}, layer=${timeoutFact.callbackRecognitionLayer}`);
    }

    const schedulerEdges = plan.activationGraph.edges.filter(edge => edge.kind === "scheduler_activation");
    const edgeTargets = schedulerEdges.map(edge => edge.toMethod.getName()).sort();
    for (const methodName of ["onTimeoutCb", "onMicrotaskCb", "FactoryTimeoutCb"]) {
        if (!hasNamedMethod(edgeTargets, methodName)) {
            throw new Error(`ArkMain missing scheduler_activation edge for ${methodName}. actual=${edgeTargets.join(", ")}`);
        }
    }
    if (hasNamedMethod(edgeTargets, "onPromiseThenCb")) {
        throw new Error(`ArkMain should not create scheduler_activation edge for Promise.then continuation. actual=${edgeTargets.join(", ")}`);
    }
    if (schedulerEdges.some(edge => edge.phaseHint !== "interaction")) {
        throw new Error("ArkMain scheduler_activation edges must land in interaction phase.");
    }

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    return engine.buildPAG({ entryModel: "arkMain" }).then(() => {
        const reachable = engine.computeReachableMethodSignatures();
        for (const methodName of ["onTimeoutCb", "onMicrotaskCb", "FactoryTimeoutCb"]) {
            if (!hasReachableMethod(reachable, methodName)) {
                throw new Error(`ArkMain reachable set missing scheduler callback ${methodName}.`);
            }
        }
        if (hasReachableMethod(reachable, "onPromiseThenCb")) {
            throw new Error("ArkMain should not mark Promise.then continuation callback as reachable entry.");
        }
        console.log("PASS test_entry_model_ark_main_scheduler");
    });
}

Promise.resolve(main()).catch(error => {
    console.error("FAIL test_entry_model_ark_main_scheduler");
    console.error(error);
    process.exit(1);
});

