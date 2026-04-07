import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { ARK_MAIN_PHASE_ORDER, buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
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

function hasLeakedForeignSyntheticArtifacts(scene: Scene): boolean {
    return scene.getMethods().some(method => {
        const name = method.getName?.() || "";
        const sig = method.getSignature?.().toString?.() || "";
        return name === "@harmonyMain"
            || name === "@harmonyCompatMain"
            || sig.includes("@harmonyMainFile")
            || sig.includes("@harmonyCompatFile");
    });
}

function phaseMethodNames(plan: ReturnType<typeof buildArkMainPlan>, phase: typeof ARK_MAIN_PHASE_ORDER[number]): string[] {
    return (plan.phases.find(p => p.phase === phase)?.methods || []).map(method => method.getName());
}

function assertIncludes(actual: string[], expected: string[], label: string): void {
    for (const item of expected) {
        if (!actual.includes(item)) {
            throw new Error(`${label} missing method "${item}". actual=${actual.join(", ")}`);
        }
    }
}

function assertHasFact(plan: ReturnType<typeof buildArkMainPlan>, kind: string, methodName: string): void {
    const matched = plan.facts.some(f => f.kind === kind && f.method.getName() === methodName);
    if (!matched) {
        throw new Error(`ArkMain missing fact kind=${kind}, method=${methodName}`);
    }
}

function assertFactMetadata(
    plan: ReturnType<typeof buildArkMainPlan>,
    kind: string,
    methodName: string,
    expected: Partial<{
        entryFamily: string;
        entryShape: string;
        recognitionLayer: string;
    }>,
): void {
    const fact = plan.facts.find(f => f.kind === kind && f.method.getName() === methodName);
    if (!fact) {
        throw new Error(`ArkMain missing fact kind=${kind}, method=${methodName}`);
    }
    for (const [key, value] of Object.entries(expected)) {
        const actual = (fact as any)[key];
        if (actual !== value) {
            throw new Error(`ArkMain fact metadata mismatch kind=${kind}, method=${methodName}, field=${key}, expected=${value}, actual=${actual}`);
        }
    }
}

function assertNoFact(plan: ReturnType<typeof buildArkMainPlan>, kind: string): void {
    const fact = plan.facts.find(item => item.kind === kind);
    if (fact) {
        throw new Error(`ArkMain should not retain fact kind=${kind}. first=${fact.method.getName()}`);
    }
}

function hasReachableMethod(reachable: Set<string>, methodName: string): boolean {
    for (const signature of reachable) {
        if (signature.includes(`.${methodName}(`) || signature.endsWith(`${methodName}()`)) {
            return true;
        }
    }
    return false;
}

function hasReachableMethodOnClass(reachable: Set<string>, className: string, methodName: string): boolean {
    for (const signature of reachable) {
        if (
            signature.includes(`: ${className}.${methodName}(`)
            || signature.includes(`.${className}.${methodName}(`)
            || signature.includes(`: ${className}.[static]${methodName}(`)
            || signature.includes(`.${className}.[static]${methodName}(`)
        ) {
            return true;
        }
    }
    return false;
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/arkmain_entry_phases");
    const scene = buildScene(projectDir);

    const plan = buildArkMainPlan(scene);
    const phases = plan.phases.map(p => p.phase);
    const expectedPhases = [...ARK_MAIN_PHASE_ORDER];
    if (JSON.stringify(phases) !== JSON.stringify(expectedPhases)) {
        throw new Error(`ArkMain phase order mismatch. actual=${phases.join(" -> ")}`);
    }

    assertIncludes(phaseMethodNames(plan, "bootstrap"), ["onCreate", "onWindowStageCreate", "onForeground"], "bootstrap");
    assertIncludes(phaseMethodNames(plan, "composition"), ["build", "aboutToAppear", "onPageShow"], "composition");
    assertIncludes(phaseMethodNames(plan, "reactive_handoff"), ["onNewWant"], "reactive_handoff");
    assertIncludes(phaseMethodNames(plan, "teardown"), ["onPageHide", "onBackground", "onWindowStageDestroy", "onDestroy"], "teardown");

    assertHasFact(plan, "ability_lifecycle", "onNewWant");
    assertFactMetadata(plan, "ability_lifecycle", "onNewWant", {
        entryFamily: "ability_lifecycle",
        entryShape: "override_slot",
        recognitionLayer: "owner_qualified_inheritance",
    });

    assertNoFact(plan, "router_source");
    assertNoFact(plan, "router_trigger");
    assertNoFact(plan, "watch_source");
    assertNoFact(plan, "watch_handler");
    assertNoFact(plan, "callback");
    assertNoFact(plan, "scheduler_callback");

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });

    const syntheticRootId = engine.cg.getDummyMainFuncID();
    if (syntheticRootId === undefined) {
        throw new Error("ArkMain mode did not register a synthetic root in call graph.");
    }
    const syntheticRoot = engine.cg.getMethodByFuncID(syntheticRootId);
    const syntheticRootName = syntheticRoot?.getMethodSubSignature?.().getMethodName?.();
    if (!syntheticRoot || syntheticRootName !== "@arkMain") {
        throw new Error(`ArkMain synthetic root mismatch. actual=${syntheticRootName || "undefined"}`);
    }
    if (hasLeakedForeignSyntheticArtifacts(scene)) {
        throw new Error("ArkMain build leaked foreign synthetic artifacts into shared scene.");
    }

    const routerScene = buildScene(path.resolve("tests/demo/harmony_router_bridge"));
    const routerPlan = buildArkMainPlan(routerScene);
    assertNoFact(routerPlan, "router_source");
    assertNoFact(routerPlan, "router_trigger");

    const reachable = engine.computeReachableMethodSignatures();
    for (const methodName of [
        "onCreate",
        "onWindowStageCreate",
        "onForeground",
        "build",
        "aboutToAppear",
        "onPageShow",
        "onNewWant",
        "onPageHide",
        "onBackground",
        "onWindowStageDestroy",
        "onDestroy",
    ]) {
        if (!hasReachableMethod(reachable, methodName)) {
            throw new Error(`ArkMain reachable set missing "${methodName}".`);
        }
    }

    const extensionScene = buildScene(path.resolve("tests/demo/harmony_extension_composition"));
    const extensionPlan = buildArkMainPlan(extensionScene);
    assertHasFact(extensionPlan, "extension_lifecycle", "onWorkStop");
    const extensionEngine = new TaintPropagationEngine(extensionScene, 1);
    extensionEngine.verbose = false;
    await extensionEngine.buildPAG({ entryModel: "arkMain" });
    const extensionReachable = extensionEngine.computeReachableMethodSignatures();
    if (!hasReachableMethodOnClass(extensionReachable, "ProbeWorkScheduler004", "onWorkStop")) {
        throw new Error("ArkMain reachable set missing ProbeWorkScheduler004.onWorkStop.");
    }

    console.log("PASS test_entry_model_ark_main");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main");
    console.error(error);
    process.exit(1);
});
