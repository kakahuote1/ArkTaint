import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import {
    buildEngineForCase,
    engineOptionsFromLoadedRuleSet,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/logging_sink");
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("src/models/kernel/rules/sinks/logging.rules.json"),
        projectRulePath: path.resolve("tests/rules/source_sink_only.rules.json"),
        allowMissingProject: false,
        autoDiscoverRuleSources: false,
    });

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const entry = resolveCaseMethod(scene, "console_log_unresolved_001_T.ets", "console_log_unresolved_001_T");
    const entryMethod = findCaseMethod(scene, entry);
    assert(entryMethod, "expected fixture entry method");

    const engine = await buildEngineForCase(scene, 1, entryMethod, {
        engineOptions: engineOptionsFromLoadedRuleSet(loaded),
        verbose: false,
    });
    const reachable = engine.computeReachableMethodSignatures();
    engine.setActiveReachableMethodSignatures(reachable);
    const seedInfo = engine.propagateWithSourceRules(loaded.ruleSet.sources || []);
    const flows = engine.detectSinksByRules(loaded.ruleSet.sinks || []);

    assert(seedInfo.seedCount > 0, "expected source seed from entry parameter");
    assert(
        flows.some(flow => flow.sinkRuleId === "sink.harmony.console.log.arg0.unresolved_instance"),
        "expected unresolved console.log sink flow",
    );
    assert(
        flows.some(flow => flow.sinkRuleId === "sink.harmony.console.info.arg0.unresolved_instance"),
        "expected unresolved console.info sink flow",
    );

    console.log("PASS test_logging_console_sink");
    console.log(`flows=${flows.length}`);
}

main().catch(error => {
    console.error("FAIL test_logging_console_sink");
    console.error(error);
    process.exitCode = 1;
});
