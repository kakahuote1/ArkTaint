import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
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

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function hasReachableMethodOnClass(reachable: Set<string>, className: string, methodName: string): boolean {
    for (const signature of reachable) {
        if (signature.includes(`: ${className}.${methodName}(`) || signature.includes(`.${className}.${methodName}(`)) {
            return true;
        }
    }
    return false;
}

async function main(): Promise<void> {
    const scene = buildScene(path.resolve("tests/demo/arkmain_buildernode_build_callback"));
    const plan = buildArkMainPlan(scene);
    const builderFacts = plan.facts.filter(fact =>
        fact.kind === "callback"
        && fact.phase === "composition"
        && fact.callbackRecognitionLayer === "sdk_provenance"
        && fact.callbackSlotFamily === "builder_node_build_slot"
    );

    assert(builderFacts.length >= 3, `expected BuilderNode.build builder callback facts, got ${builderFacts.length}`);
    assert(
        builderFacts.every(fact => String(fact.callbackRegistrationSignature || "").includes("BuilderNode.build(")),
        "BuilderNode build callback facts must come from exact SDK BuilderNode.build registrations.",
    );
    assert(
        !builderFacts.some(fact => fact.method.getName?.().includes("handlePlainBuild")),
        "non-SDK PlainBuilderNode.build must not become an ArkMain callback fact.",
    );
    for (const fact of builderFacts) {
        const factSignature = fact.method.getSignature?.()?.toString?.();
        const scheduled = plan.schedule.activations.find(item =>
            item.method.getSignature?.()?.toString?.() === factSignature,
        );
        assert(
            scheduled?.phase === "composition",
            `BuilderNode builder callback ${factSignature} should be scheduled in composition.`,
        );
    }

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const reachable = engine.computeReachableMethodSignatures();

    for (const methodName of [
        "handleWrappedBuilder",
        "handleInlineWrappedBuilder",
        "handleConstructedWrappedBuilder",
    ]) {
        assert(
            hasReachableMethodOnClass(reachable, "DemoAbility", methodName),
            `ArkMain reachable set missing BuilderNode builder method DemoAbility.${methodName}`,
        );
    }

    console.log("PASS test_entry_model_ark_main_buildernode_build_callback");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_buildernode_build_callback");
    console.error(error);
    process.exit(1);
});
