import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
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

async function main(): Promise<void> {
    const projectDir = path.resolve("tests/demo/arkmain_route_decorator");
    const scene = buildScene(projectDir);
    const plan = buildArkMainPlan(scene);
    const ordered = new Set(plan.orderedMethods.map(method => method.getSignature?.()?.toString?.() || ""));

    assert(
        [...ordered].some(signature => signature.includes("LoginPage.build()")),
        `route-decorated page build should be scheduled. ordered=${[...ordered].join(", ")}`,
    );
    assert(
        ![...ordered].some(signature => signature.includes("PlainPanel.build()")),
        `plain component build must not be scheduled as a root. ordered=${[...ordered].join(", ")}`,
    );

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const reachable = engine.getActiveReachableMethodSignatures() || new Set<string>();
    assert(
        [...reachable].some(signature => signature.includes("LoginPage.build()")),
        "route-decorated page build should be reachable under arkMain",
    );
    assert(
        [...reachable].some(signature => signature.includes("LoginForm.build()")),
        "child component build should become reachable from the route-decorated page",
    );
    assert(
        ![...reachable].some(signature => signature.includes("PlainPanel.build()")),
        "plain unrelated component build must remain unreachable",
    );

    console.log("PASS test_entry_model_route_decorator_page");
}

main().catch(error => {
    console.error("FAIL test_entry_model_route_decorator_page");
    console.error(error);
    process.exit(1);
});
