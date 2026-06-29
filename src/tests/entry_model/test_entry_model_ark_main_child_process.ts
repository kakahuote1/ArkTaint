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

function methodRef(method: any): string {
    return `${method?.getDeclaringArkClass?.()?.getName?.() || "@global"}.${method?.getName?.() || "@unknown"}`;
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
    const scene = buildScene(path.resolve("tests/demo/arkmain_child_process"));
    const plan = buildArkMainPlan(scene);

    const childFact = plan.facts.find(fact =>
        fact.kind === "process_lifecycle"
        && fact.phase === "bootstrap"
        && fact.ownerKind === "child_process_owner"
        && methodRef(fact.method) === "DemoChildProcess.onStart"
    );
    assert(childFact, "missing process_lifecycle fact for DemoChildProcess.onStart");
    assert(childFact?.entryFamily === "process_lifecycle", `unexpected child process entryFamily=${childFact?.entryFamily}`);
    assert(childFact?.entryShape === "override_slot", `unexpected child process entryShape=${childFact?.entryShape}`);
    assert(childFact?.semanticGate === "exact_arkanalyzer_method_key", "child process fact must be exact official declaration gated");

    const plainFact = plan.facts.find(fact => methodRef(fact.method) === "PlainOnStartCarrier.onStart");
    assert(!plainFact, "plain onStart method must not become an ArkMain entry");

    const rootEdge = plan.activationGraph.edges.find(edge =>
        edge.kind === "baseline_root"
        && methodRef(edge.toMethod) === "DemoChildProcess.onStart"
    );
    assert(rootEdge, "DemoChildProcess.onStart must be a baseline ArkMain root");
    assert(rootEdge?.phaseHint === "bootstrap", `unexpected child process root phase=${rootEdge?.phaseHint}`);

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const reachable = engine.computeReachableMethodSignatures();
    assert(
        hasReachableMethodOnClass(reachable, "DemoChildProcess", "onStart"),
        "ArkMain reachable set missing DemoChildProcess.onStart",
    );
    assert(
        !hasReachableMethodOnClass(reachable, "PlainOnStartCarrier", "onStart"),
        "ArkMain reachable set unexpectedly contains PlainOnStartCarrier.onStart",
    );

    console.log("PASS test_entry_model_ark_main_child_process");
}

main().catch(error => {
    console.error("FAIL test_entry_model_ark_main_child_process");
    console.error(error);
    process.exit(1);
});
