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
        callbackShape: string;
        callbackSlotFamily: string;
        callbackRecognitionLayer: string;
        callbackFlavor: string;
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

function assertBridgeHasMethod(
    plan: ReturnType<typeof buildArkMainPlan>,
    group: "triggers" | "channels" | "handoffs",
    kind: string,
    methodName: string,
): void {
    const bridge = (plan.bridgePlan[group] || []).find((item: any) => item.kind === kind);
    if (!bridge) {
        throw new Error(`ArkMain missing bridge group=${group}, kind=${kind}`);
    }
    const names = bridge.methods.map((method: any) => method.getName());
    if (!names.includes(methodName)) {
        throw new Error(`ArkMain bridge group=${group}, kind=${kind} missing method=${methodName}. actual=${names.join(", ")}`);
    }
}

function assertHasFactOnClass(
    plan: ReturnType<typeof buildArkMainPlan>,
    kind: string,
    className: string,
    methodName: string,
): void {
    const matched = plan.facts.some(f =>
        f.kind === kind
        && f.method.getName() === methodName
        && f.method.getDeclaringArkClass?.().getName?.() === className,
    );
    if (!matched) {
        throw new Error(`ArkMain missing fact kind=${kind}, class=${className}, method=${methodName}`);
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
    assertIncludes(phaseMethodNames(plan, "interaction"), ["cbOnClick", "cbOnChange"], "interaction");
    assertIncludes(phaseMethodNames(plan, "reactive_handoff"), ["onNewWant", "onTokenWatch", "hydrateFromRoute"], "reactive_handoff");
    assertIncludes(phaseMethodNames(plan, "teardown"), ["onPageHide", "onBackground", "onWindowStageDestroy", "onDestroy"], "teardown");
    assertFactMetadata(plan, "callback", "cbOnClick", {
        callbackFlavor: "ui_event",
        callbackShape: "direct_callback_slot",
        callbackSlotFamily: "ui_direct_slot",
        callbackRecognitionLayer: "sdk_provenance",
        entryFamily: "ui_direct_slot",
        entryShape: "direct_callback_slot",
    });
    assertHasFact(plan, "want_handoff", "onNewWant");
    assertFactMetadata(plan, "want_handoff", "onNewWant", {
        entryFamily: "ability_handoff",
        entryShape: "lifecycle_slot",
        recognitionLayer: "owner_qualified_inheritance",
    });
    assertHasFact(plan, "watch_handler", "onTokenWatch");
    assertHasFact(plan, "router_trigger", "hydrateFromRoute");
    assertFactMetadata(plan, "router_trigger", "hydrateFromRoute", {
        entryFamily: "navigation_trigger",
        entryShape: "direct_trigger_call",
        recognitionLayer: "sdk_provenance_first_layer",
    });
    assertBridgeHasMethod(plan, "triggers", "watch", "onTokenWatch");
    assertBridgeHasMethod(plan, "channels", "router", "hydrateFromRoute");
    assertBridgeHasMethod(plan, "handoffs", "want", "onCreate");
    assertBridgeHasMethod(plan, "handoffs", "want", "onNewWant");
    const wantHandoff = plan.bridgePlan.handoffs.find(item => item.kind === "want");
    if (!wantHandoff) {
        throw new Error("ArkMain missing want handoff plan.");
    }
    if (wantHandoff.boundary.kind !== "serialized_copy" || wantHandoff.boundary.preservesObjectIdentity) {
        throw new Error(`ArkMain want handoff boundary mismatch: ${JSON.stringify(wantHandoff.boundary)}`);
    }
    if (!wantHandoff.boundary.preservesFieldPath) {
        throw new Error("ArkMain want handoff boundary should preserve field path across serialized copy.");
    }
    const wantSourceNames = wantHandoff.sourceMethods.map(method => method.getName());
    const wantTargetNames = wantHandoff.targetMethods.map(method => method.getName());
    if (!wantSourceNames.includes("onCreate") || !wantTargetNames.includes("onNewWant")) {
        throw new Error(`ArkMain want handoff source/target mismatch: source=${wantSourceNames.join(", ")}, target=${wantTargetNames.join(", ")}`);
    }

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
    assertHasFact(routerPlan, "router_source", "router_replaceUrl_005_T");
    assertFactMetadata(routerPlan, "router_source", "router_replaceUrl_005_T", {
        entryFamily: "navigation_source",
        entryShape: "direct_source_call",
        recognitionLayer: "sdk_provenance_first_layer",
    });
    assertHasFactOnClass(routerPlan, "router_trigger", "ReplacePage", "render");
    assertHasFactOnClass(routerPlan, "router_trigger", "%dflt", "navDetailBuilder010");

    const reachable = engine.computeReachableMethodSignatures();
    for (const methodName of [
        "onCreate",
        "onWindowStageCreate",
        "onForeground",
        "build",
        "aboutToAppear",
        "onPageShow",
        "cbOnClick",
        "cbOnChange",
        "build",
        "onNewWant",
        "onTokenWatch",
        "onPhaseWatch",
        "hydrateFromRoute",
        "onPageHide",
        "onBackground",
        "onWindowStageDestroy",
        "onDestroy",
    ]) {
        if (!hasReachableMethod(reachable, methodName)) {
            throw new Error(`ArkMain reachable set missing "${methodName}".`);
        }
    }
    const routerEngine = new TaintPropagationEngine(routerScene, 1);
    routerEngine.verbose = false;
    await routerEngine.buildPAG({ entryModel: "arkMain" });
    const routerReachable = routerEngine.computeReachableMethodSignatures();
    if (!hasReachableMethodOnClass(routerReachable, "ReplacePage", "render")) {
        throw new Error("ArkMain reachable set missing ReplacePage.render under navigation activation.");
    }
    if (!hasReachableMethodOnClass(routerReachable, "%dflt", "navDetailBuilder010")) {
        throw new Error("ArkMain reachable set missing navDetailBuilder010 under navigation activation.");
    }

    const extensionScene = buildScene(path.resolve("tests/demo/harmony_extension_composition"));
    const extensionPlan = buildArkMainPlan(extensionScene);
    assertHasFactOnClass(extensionPlan, "extension_lifecycle", "ProbeWorkScheduler004", "onWorkStop");
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

