import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function buildScene(sourceDir: string): Scene {
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();
    return scene;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/interface_dispatch");
    const scene = buildScene(sourceDir);

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });

    const reachable = engine.computeReachableMethodSignatures();
    const remoteSendReachable = [...reachable].some(signature =>
        signature.includes("RemoteRepository.send(string)")
    );
    assert(remoteSendReachable, "expected interface call Repository.send to dispatch to RemoteRepository.send");

    const sourceRules: SourceRule[] = [
        {
            id: "source.fixture.input",
            enabled: true,
            match: { kind: "method_name_equals", value: "input" },
            sourceKind: "call_return",
            target: "result",
        },
    ];
    const sinkRules: SinkRule[] = [
        {
            id: "sink.fixture.sink",
            enabled: true,
            match: { kind: "method_name_equals", value: "sink" },
            target: { endpoint: "arg0" },
        },
    ];

    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);

    assert(seedInfo.seedCount > 0, "expected input() source seed");
    assert(flows.length > 0, "expected source to reach sink through interface dispatch implementation");

    console.log("PASS test_entry_model_interface_dispatch");
    console.log(`reachable=${reachable.size}`);
    console.log(`flows=${flows.length}`);
}

main().catch(error => {
    console.error("FAIL test_entry_model_interface_dispatch");
    console.error(error);
    process.exitCode = 1;
});
