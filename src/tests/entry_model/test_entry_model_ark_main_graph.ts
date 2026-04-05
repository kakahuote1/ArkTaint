import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import {
    ArkMainActivationEdge,
    ArkMainActivationEdgeFamily,
    ArkMainActivationEdgeKind,
} from "../../core/entry/arkmain/edges/ArkMainActivationTypes";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { buildArkMainSchedule } from "../../core/entry/arkmain/scheduling/ArkMainScheduler";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
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

function methodRef(edgeMethod: any): string {
    const className = edgeMethod?.getDeclaringArkClass?.()?.getName?.() || "@global";
    const methodName = edgeMethod?.getName?.() || "@unknown";
    return `${className}.${methodName}`;
}

function findEdge(
    edges: ArkMainActivationEdge[],
    kind: ArkMainActivationEdgeKind,
    toRef: string,
    fromRef?: string,
): ArkMainActivationEdge | undefined {
    return edges.find(edge =>
        edge.kind === kind
        && methodRef(edge.toMethod) === toRef
        && (fromRef === undefined || methodRef(edge.fromMethod) === fromRef),
    );
}

function assertHasEdge(
    edges: ArkMainActivationEdge[],
    kind: ArkMainActivationEdgeKind,
    toRef: string,
    fromRef?: string,
): void {
    const matched = findEdge(edges, kind, toRef, fromRef);
    if (!matched) {
        throw new Error(`ArkMain activation graph missing edge kind=${kind}, from=${fromRef || "@root"}, to=${toRef}`);
    }
}

function assertEdgeFamily(
    edges: ArkMainActivationEdge[],
    kind: ArkMainActivationEdgeKind,
    expectedFamily: ArkMainActivationEdgeFamily,
    toRef: string,
    fromRef?: string,
): void {
    const matched = findEdge(edges, kind, toRef, fromRef);
    if (!matched) {
        throw new Error(`ArkMain activation graph missing edge for family probe kind=${kind}, from=${fromRef || "@root"}, to=${toRef}`);
    }
    if (matched.edgeFamily !== expectedFamily) {
        throw new Error(`ArkMain activation edge family mismatch kind=${kind}, expected=${expectedFamily}, actual=${matched.edgeFamily}`);
    }
}

function assertNoEdge(
    edges: ArkMainActivationEdge[],
    kind: ArkMainActivationEdgeKind,
    toRef: string,
    fromRef?: string,
): void {
    const matched = findEdge(edges, kind, toRef, fromRef);
    if (matched) {
        throw new Error(`ArkMain activation graph unexpectedly contains edge kind=${kind}, from=${fromRef || "@root"}, to=${toRef}`);
    }
}

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/arkmain_entry_phases");
    const scene = buildScene(projectDir);
    const plan = buildArkMainPlan(scene);
    const edges = plan.activationGraph.edges;

    assertHasEdge(edges, "baseline_root", "EntryAbility.onCreate");
    assertHasEdge(edges, "baseline_root", "DemoPage.build");
    assertHasEdge(edges, "baseline_root", "EntryAbility.onNewWant");

    assertHasEdge(edges, "callback_registration", "%dflt.cbOnClick", "DemoPage.build");
    assertHasEdge(edges, "callback_registration", "%dflt.cbOnChange", "DemoPage.build");
    assertEdgeFamily(edges, "callback_registration", "ui_callback", "%dflt.cbOnClick", "DemoPage.build");

    assertHasEdge(edges, "state_watch_trigger", "DemoPage.onTokenWatch", "DemoPage.hydrateFromRoute");
    assertEdgeFamily(edges, "state_watch_trigger", "state_watch", "DemoPage.onTokenWatch", "DemoPage.hydrateFromRoute");
    assertHasEdge(edges, "state_watch_trigger", "ReactiveWatchPage.onPhaseWatch", "DemoPage.hydrateFromRoute");
    assertHasEdge(edges, "router_channel", "DemoPage.hydrateFromRoute", "DemoPage.build");
    assertEdgeFamily(edges, "router_channel", "navigation_channel", "DemoPage.hydrateFromRoute", "DemoPage.build");
    assertHasEdge(edges, "want_handoff", "EntryAbility.onNewWant", "EntryAbility.onCreate");
    assertEdgeFamily(edges, "want_handoff", "ability_handoff", "EntryAbility.onNewWant", "EntryAbility.onCreate");

    if (plan.activationGraph.rootMethods.length === 0) {
        throw new Error("ArkMain activation graph produced no root methods.");
    }

    const cbOnClickActivation = plan.schedule.activations.find(item => methodRef(item.method) === "%dflt.cbOnClick");
    const watchActivation = plan.schedule.activations.find(item => methodRef(item.method) === "DemoPage.onTokenWatch");
    const routeActivation = plan.schedule.activations.find(item => methodRef(item.method) === "DemoPage.hydrateFromRoute");
    const wantActivation = plan.schedule.activations.find(item => methodRef(item.method) === "EntryAbility.onNewWant");
    const phaseWatchActivation = plan.schedule.activations.find(item => methodRef(item.method) === "ReactiveWatchPage.onPhaseWatch");

    if (!cbOnClickActivation || cbOnClickActivation.round !== 1 || cbOnClickActivation.phase !== "interaction") {
        throw new Error(`ArkMain callback activation round mismatch: ${cbOnClickActivation?.round}/${cbOnClickActivation?.phase}`);
    }
    if (!cbOnClickActivation.activationEdgeFamilies.includes("ui_callback")) {
        throw new Error(`ArkMain callback activation family mismatch: ${cbOnClickActivation?.activationEdgeFamilies.join(", ")}`);
    }
    if (!watchActivation || watchActivation.round !== 2 || watchActivation.phase !== "reactive_handoff") {
        throw new Error(`ArkMain watch activation round mismatch: ${watchActivation?.round}/${watchActivation?.phase}`);
    }
    if (!phaseWatchActivation || phaseWatchActivation.round !== 2 || phaseWatchActivation.phase !== "reactive_handoff") {
        throw new Error(`ArkMain phase watch activation round mismatch: ${phaseWatchActivation?.round}/${phaseWatchActivation?.phase}`);
    }
    if (!routeActivation || routeActivation.round !== 1 || routeActivation.phase !== "reactive_handoff") {
        throw new Error(`ArkMain route activation round mismatch: ${routeActivation?.round}/${routeActivation?.phase}`);
    }
    if (!routeActivation.activationEdgeFamilies.includes("navigation_channel")) {
        throw new Error(`ArkMain route activation family mismatch: ${routeActivation?.activationEdgeFamilies.join(", ")}`);
    }
    if (!wantActivation) {
        throw new Error("ArkMain missing onNewWant activation.");
    }
    if (!wantActivation.activationEdgeKinds.includes("baseline_root") || !wantActivation.activationEdgeKinds.includes("want_handoff")) {
        throw new Error(`ArkMain onNewWant activation reasons incomplete: ${wantActivation.activationEdgeKinds.join(", ")}`);
    }
    if (!wantActivation.activationEdgeFamilies.includes("baseline_root") || !wantActivation.activationEdgeFamilies.includes("ability_handoff")) {
        throw new Error(`ArkMain onNewWant activation families incomplete: ${wantActivation.activationEdgeFamilies.join(", ")}`);
    }
    if (!plan.schedule.convergence.converged || plan.schedule.convergence.truncated) {
        throw new Error(`ArkMain main schedule convergence mismatch: converged=${plan.schedule.convergence.converged}, truncated=${plan.schedule.convergence.truncated}`);
    }
    if (plan.schedule.warnings.length !== 0) {
        throw new Error(`ArkMain main schedule warnings should be empty, got ${plan.schedule.warnings.join(" | ")}`);
    }

    const watchScene = buildScene(path.resolve("tests/demo/harmony_watch"));
    const watchEntry = resolveCaseMethod(watchScene, "watch_trigger_001_T.ets", "watch_trigger_001_T");
    const watchCaseMethod = findCaseMethod(watchScene, watchEntry);
    if (!watchCaseMethod) {
        throw new Error("ArkMain watch graph test failed to resolve case method.");
    }
    const watchPlan = buildArkMainPlan(watchScene, { seedMethods: [watchCaseMethod] });
    const watchEdges = watchPlan.activationGraph.edges;
    assertHasEdge(watchEdges, "baseline_root", "%dflt.watch_trigger_001_T");
    assertHasEdge(watchEdges, "baseline_root", "WatchComp001.update");
    assertHasEdge(watchEdges, "state_watch_trigger", "WatchComp001.onTokenChanged", "WatchComp001.update");
    const watchHandlerActivation = watchPlan.schedule.activations.find(item => methodRef(item.method) === "WatchComp001.onTokenChanged");
    if (!watchHandlerActivation || watchHandlerActivation.round !== 1 || watchHandlerActivation.phase !== "reactive_handoff") {
        throw new Error(`ArkMain plain-watch activation round mismatch: ${watchHandlerActivation?.round}/${watchHandlerActivation?.phase}`);
    }

    const pureWatchScene = buildScene(path.resolve("tests/demo/pure_entry_watch"));
    const pureWatchPlan = buildArkMainPlan(pureWatchScene);
    const pureWatchEdges = pureWatchPlan.activationGraph.edges;
    assertHasEdge(pureWatchEdges, "state_watch_trigger", "WatchPage001.onTokenChanged", "WatchPage001.build");
    const pureWatchActivation = pureWatchPlan.schedule.activations.find(item => methodRef(item.method) === "WatchPage001.onTokenChanged");
    if (!pureWatchActivation || pureWatchActivation.round !== 1 || pureWatchActivation.phase !== "reactive_handoff") {
        throw new Error(`ArkMain pure-watch activation round mismatch: ${pureWatchActivation?.round}/${pureWatchActivation?.phase}`);
    }
    if (!pureWatchActivation.activationEdgeKinds.includes("state_watch_trigger")) {
        throw new Error(`ArkMain pure-watch activation kind missing: ${pureWatchActivation?.activationEdgeKinds.join(", ")}`);
    }

    const routerScene = buildScene(path.resolve("tests/demo/harmony_router_bridge"));
    const routerPlan = buildArkMainPlan(routerScene);
    const routerEdges = routerPlan.activationGraph.edges;
    assertHasEdge(routerEdges, "router_channel", "ReplacePage.render");
    assertHasEdge(routerEdges, "router_channel", "%dflt.navDetailBuilder010");
    const routerSourceFacts = routerPlan.facts.filter(fact => fact.kind === "router_source");
    const routerTriggerFacts = routerPlan.facts.filter(fact => fact.kind === "router_trigger");
    const routerChannelEdges = routerEdges.filter(edge => edge.kind === "router_channel");
    if (routerSourceFacts.length < 2) {
        throw new Error(`ArkMain router multi-source probe expected at least 2 router_source facts, got ${routerSourceFacts.length}`);
    }
    const expectedRouterChannelEdges = routerSourceFacts.length * routerTriggerFacts.length;
    if (routerChannelEdges.length !== expectedRouterChannelEdges) {
        throw new Error(`ArkMain router multi-source edge count mismatch: expected=${expectedRouterChannelEdges}, actual=${routerChannelEdges.length}`);
    }
    const replaceRenderActivation = routerPlan.schedule.activations.find(item => methodRef(item.method) === "ReplacePage.render");
    const destinationCallbackActivation = routerPlan.schedule.activations.find(item => methodRef(item.method) === "%dflt.navDetailBuilder010");
    if (!replaceRenderActivation || replaceRenderActivation.round !== 1 || replaceRenderActivation.phase !== "reactive_handoff") {
        throw new Error(`ArkMain router render activation round mismatch: ${replaceRenderActivation?.round}/${replaceRenderActivation?.phase}`);
    }
    if (!destinationCallbackActivation || destinationCallbackActivation.round !== 1 || destinationCallbackActivation.phase !== "reactive_handoff") {
        throw new Error(`ArkMain navigation callback activation round mismatch: ${destinationCallbackActivation?.round}/${destinationCallbackActivation?.phase}`);
    }
    const replaceRenderRouterEdges = replaceRenderActivation.supportingEdges.filter(edge => edge.kind === "router_channel");
    if (replaceRenderRouterEdges.length !== routerSourceFacts.length) {
        throw new Error(`ArkMain router render supporting-edge count mismatch: expected=${routerSourceFacts.length}, actual=${replaceRenderRouterEdges.length}`);
    }

    const buildMethod = plan.activationGraph.rootMethods.find(method => methodRef(method) === "DemoPage.build");
    const onCreateMethod = plan.activationGraph.rootMethods.find(method => methodRef(method) === "EntryAbility.onCreate");
    const callbackMethod = plan.activationGraph.edges.find(edge => edge.kind === "callback_registration")?.toMethod;
    if (!buildMethod || !onCreateMethod || !callbackMethod) {
        throw new Error("ArkMain scheduler rule test failed to resolve synthetic methods.");
    }
    const schedulerSanitySchedule = buildArkMainSchedule({
        facts: [],
        rootMethods: [buildMethod, onCreateMethod],
        edges: [
            {
                kind: "baseline_root",
                edgeFamily: "baseline_root",
                phaseHint: "composition",
                toMethod: buildMethod,
                reasons: [{ kind: "baseline_root", summary: "build root", evidenceMethod: buildMethod }],
            },
            {
                kind: "baseline_root",
                edgeFamily: "baseline_root",
                phaseHint: "bootstrap",
                toMethod: onCreateMethod,
                reasons: [{ kind: "baseline_root", summary: "create root", evidenceMethod: onCreateMethod }],
            },
            {
                kind: "callback_registration",
                edgeFamily: "ui_callback",
                phaseHint: "interaction",
                fromMethod: buildMethod,
                toMethod: callbackMethod,
                reasons: [{ kind: "entry_fact", summary: "callback from build", evidenceMethod: buildMethod }],
            },
            {
                kind: "callback_registration",
                edgeFamily: "ui_callback",
                phaseHint: "interaction",
                fromMethod: onCreateMethod,
                toMethod: callbackMethod,
                reasons: [{ kind: "entry_fact", summary: "callback from onCreate", evidenceMethod: onCreateMethod }],
            },
        ],
    });
    const schedulerCallbackActivation = schedulerSanitySchedule.activations.find(item => methodRef(item.method) === methodRef(callbackMethod));
    if (!schedulerCallbackActivation) {
        throw new Error("ArkMain scheduler rule failed to activate callback from composition source.");
    }
    if (schedulerCallbackActivation.supportingEdges.some(edge => methodRef(edge.fromMethod) === "EntryAbility.onCreate")) {
        throw new Error("ArkMain scheduler incorrectly accepted callback activation from bootstrap source.");
    }

    const watchHandlerMethod = watchPlan.schedule.activations.find(item => methodRef(item.method) === "WatchComp001.onTokenChanged")?.method;
    if (!watchHandlerMethod) {
        throw new Error("ArkMain scheduler truncation test failed to resolve watch handler method.");
    }
    const truncatedSchedule = buildArkMainSchedule({
        facts: [],
        rootMethods: [onCreateMethod],
        edges: [
            {
                kind: "baseline_root",
                edgeFamily: "baseline_root",
                phaseHint: "bootstrap",
                toMethod: onCreateMethod,
                reasons: [{ kind: "baseline_root", summary: "create root", evidenceMethod: onCreateMethod }],
            },
            {
                kind: "want_handoff",
                edgeFamily: "ability_handoff",
                phaseHint: "bootstrap",
                fromMethod: onCreateMethod,
                toMethod: callbackMethod,
                reasons: [{ kind: "entry_fact", summary: "handoff from onCreate", evidenceMethod: onCreateMethod }],
            },
            {
                kind: "state_watch_trigger",
                edgeFamily: "state_watch",
                phaseHint: "reactive_handoff",
                fromMethod: callbackMethod,
                toMethod: watchHandlerMethod,
                reasons: [{ kind: "entry_fact", summary: "watch after handoff", evidenceMethod: callbackMethod }],
            },
        ],
    }, { maxRounds: 1 });
    if (truncatedSchedule.convergence.converged || !truncatedSchedule.convergence.truncated) {
        throw new Error(`ArkMain scheduler truncation signal mismatch: converged=${truncatedSchedule.convergence.converged}, truncated=${truncatedSchedule.convergence.truncated}`);
    }
    if (truncatedSchedule.warnings.length === 0) {
        throw new Error("ArkMain scheduler truncation test expected warning signal.");
    }
    if (truncatedSchedule.activations.some(item => methodRef(item.method) === methodRef(watchHandlerMethod))) {
        throw new Error("ArkMain scheduler truncation test should not activate second-hop watch handler within maxRounds=1.");
    }

    const workerScene = buildScene(path.resolve("tests/demo/harmony_worker"));
    const workerEntry = resolveCaseMethod(workerScene, "worker_postmessage_001_T.ets", "worker_postmessage_001_T");
    const workerCaseMethod = findCaseMethod(workerScene, workerEntry);
    if (!workerCaseMethod) {
        throw new Error("ArkMain channel callback test failed to resolve worker case method.");
    }
    const workerPlan = buildArkMainPlan(workerScene, { seedMethods: [workerCaseMethod] });
    const workerChannelEdge = workerPlan.activationGraph.edges.find(edge =>
        edge.kind === "channel_callback_activation"
        && methodRef(edge.fromMethod) === "%dflt.worker_postmessage_001_T",
    );
    if (!workerChannelEdge) {
        throw new Error("ArkMain channel callback test failed to find worker channel_callback_activation edge.");
    }
    if (workerChannelEdge.edgeFamily !== "channel_callback") {
        throw new Error(`ArkMain worker channel edge family mismatch: ${workerChannelEdge.edgeFamily}`);
    }
    const workerCallbackActivation = workerPlan.schedule.activations.find(item => methodRef(item.method) === methodRef(workerChannelEdge.toMethod));
    if (!workerCallbackActivation || workerCallbackActivation.phase !== "interaction" || workerCallbackActivation.round !== 1) {
        throw new Error(`ArkMain channel callback activation mismatch: ${workerCallbackActivation?.round}/${workerCallbackActivation?.phase}`);
    }
    if (!workerCallbackActivation.activationEdgeKinds.includes("channel_callback_activation")) {
        throw new Error(`ArkMain channel callback activation kind missing: ${workerCallbackActivation?.activationEdgeKinds.join(", ")}`);
    }
    if (!workerCallbackActivation.activationEdgeFamilies.includes("channel_callback")) {
        throw new Error(`ArkMain channel callback activation family missing: ${workerCallbackActivation?.activationEdgeFamilies.join(", ")}`);
    }

    const pureWorkerScene = buildScene(path.resolve("tests/demo/pure_entry_worker"));
    const pureWorkerBuild = pureWorkerScene.getMethods().find(method =>
        methodRef(method) === "WorkerPage002.build",
    );
    if (!pureWorkerBuild) {
        throw new Error("ArkMain taskpool graph test failed to resolve WorkerPage002.build.");
    }
    const pureWorkerPlan = buildArkMainPlan(pureWorkerScene, { seedMethods: [pureWorkerBuild] });
    const pureWorkerEdges = pureWorkerPlan.activationGraph.edges;
    assertHasEdge(pureWorkerEdges, "scheduler_activation", "%dflt.taskJob", "WorkerPage002.build");
    const taskPoolActivation = pureWorkerPlan.schedule.activations.find(item => methodRef(item.method) === "%dflt.taskJob");
    if (!taskPoolActivation || taskPoolActivation.phase !== "interaction" || taskPoolActivation.round !== 1) {
        throw new Error(`ArkMain taskpool activation mismatch: ${taskPoolActivation?.round}/${taskPoolActivation?.phase}`);
    }
    if (!taskPoolActivation.activationEdgeKinds.includes("scheduler_activation")) {
        throw new Error(`ArkMain taskpool activation kind missing: ${taskPoolActivation?.activationEdgeKinds.join(", ")}`);
    }
    if (!taskPoolActivation.activationEdgeFamilies.includes("scheduler_callback")) {
        throw new Error(`ArkMain taskpool activation family missing: ${taskPoolActivation?.activationEdgeFamilies.join(", ")}`);
    }

    console.log("PASS test_entry_model_ark_main_graph");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_graph");
    console.error(error);
    process.exit(1);
});
