import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import {
    ArkMainActivationEdge,
    ArkMainActivationEdgeFamily,
    ArkMainActivationEdgeKind,
} from "../../core/entry/arkmain/edges/ArkMainActivationTypes";
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

function methodRef(edgeMethod: any): string {
    const className = edgeMethod?.getDeclaringArkClass?.()?.getName?.() || "@global";
    const methodName = edgeMethod?.getName?.() || "@unknown";
    return `${className}.${methodName}`;
}

function findActivation(
    activations: any[],
    method: string,
    phase?: string,
    edgeFamily?: string,
): any {
    return activations.find(item =>
        methodRef(item.method) === method
        && (phase === undefined || item.phase === phase)
        && (edgeFamily === undefined || item.activationEdgeFamilies.includes(edgeFamily)),
    );
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

function assertNoEdgeKind(
    edges: ArkMainActivationEdge[],
    forbidden: string,
): void {
    const hit = edges.find(edge => String(edge.kind) === forbidden);
    if (hit) {
        throw new Error(`ArkMain activation graph unexpectedly retains edge kind=${forbidden}, example=${methodRef(hit.toMethod)}`);
    }
}

function assertEdgeFamiliesAreFormalOnly(
    edges: ArkMainActivationEdge[],
    allowedFamilies: ReadonlySet<ArkMainActivationEdgeFamily>,
): void {
    for (const edge of edges) {
        if (!allowedFamilies.has(edge.edgeFamily)) {
            throw new Error(`ArkMain activation graph unexpectedly retains edge family=${edge.edgeFamily}`);
        }
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
    assertHasEdge(edges, "lifecycle_progression", "DemoPage.onPageHide", "DemoPage.build");

    assertNoEdgeKind(edges, "callback_registration");
    assertNoEdgeKind(edges, "channel_callback_activation");
    assertNoEdgeKind(edges, "scheduler_activation");
    assertNoEdgeKind(edges, "state_watch_trigger");
    assertNoEdgeKind(edges, "router_channel");
    assertNoEdgeKind(edges, "want_handoff");

    assertEdgeFamiliesAreFormalOnly(edges, new Set([
        "baseline_root",
        "composition_lifecycle",
        "interaction_lifecycle",
        "teardown_lifecycle",
    ]));

    if (plan.activationGraph.rootMethods.length === 0) {
        throw new Error("ArkMain activation graph produced no root methods.");
    }

    const wantActivation = findActivation(plan.schedule.activations, "EntryAbility.onNewWant", "reactive_handoff", "baseline_root");
    const pageHideRoot = findActivation(plan.schedule.activations, "DemoPage.onPageHide", "teardown", "baseline_root");
    const pageHideProgression = findActivation(plan.schedule.activations, "DemoPage.onPageHide", "teardown", "teardown_lifecycle");

    if (!wantActivation || wantActivation.round !== 0) {
        throw new Error(`ArkMain handoff target lifecycle should now be a baseline root activation. actual=${wantActivation?.round}/${wantActivation?.phase}`);
    }
    if (!pageHideRoot || !pageHideProgression) {
        throw new Error("ArkMain should preserve both baseline-root and lifecycle-progression activations for DemoPage.onPageHide.");
    }
    if (!pageHideProgression.activationEdgeKinds.includes("lifecycle_progression")) {
        throw new Error(`ArkMain lifecycle progression explainability missing for DemoPage.onPageHide: ${pageHideProgression.activationEdgeKinds.join(", ")}`);
    }
    if (!pageHideProgression.activationEdgeFamilies.includes("teardown_lifecycle")) {
        throw new Error(`ArkMain lifecycle progression family mismatch for DemoPage.onPageHide: ${pageHideProgression.activationEdgeFamilies.join(", ")}`);
    }
    if (!plan.schedule.convergence.converged || plan.schedule.convergence.truncated) {
        throw new Error(`ArkMain main schedule convergence mismatch: converged=${plan.schedule.convergence.converged}, truncated=${plan.schedule.convergence.truncated}`);
    }
    if (plan.schedule.warnings.length !== 0) {
        throw new Error(`ArkMain main schedule warnings should be empty, got ${plan.schedule.warnings.join(" | ")}`);
    }

    const routerScene = buildScene(path.resolve("tests/demo/harmony_router_bridge"));
    const routerPlan = buildArkMainPlan(routerScene);
    if (routerPlan.facts.some(fact => {
        const kind = String(fact.kind);
        return kind === "router_source" || kind === "router_trigger";
    })) {
        throw new Error("ArkMain should not retain navigation source/trigger facts.");
    }
    if (routerPlan.activationGraph.edges.some(edge => String(edge.kind) === "router_channel")) {
        throw new Error("ArkMain should not retain router_channel edges.");
    }

    console.log("PASS test_entry_model_ark_main_graph");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_graph");
    console.error(error);
    process.exit(1);
});
