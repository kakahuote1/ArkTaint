import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { buildEngineForCase, findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function runCase(scene: Scene, methodName: string): Promise<boolean> {
    const entry = resolveCaseMethod(scene, "entry.ets", methodName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(entryMethod, `entry method not found: ${methodName}`);

    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        projectRulePath: path.resolve("tests/rules/harmony_router_bridge.rules.json"),
        allowMissingProject: false,
        autoDiscoverRuleSources: false,
    });

    const engine = await buildEngineForCase(scene, 1, entryMethod, {
        engineOptions: {
            disabledAutoSourceRuleIdPrefixes: [
                "source.auto.framework.navigation_context.",
            ],
        },
        verbose: false,
    });
    const reachable = engine.computeReachableMethodSignatures();
    engine.setActiveReachableMethodSignatures(reachable);
    engine.propagateWithSourceRules(loaded.ruleSet.sources || []);
    return engine.detectSinksByRules(loaded.ruleSet.sinks || []).length > 0;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/harmony_router_route_scope");
    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const sameRoute = await runCase(scene, "router_route_scope_login_T");
    const mismatch = await runCase(scene, "router_route_scope_mismatch_F");

    assert(sameRoute, "expected same-route router params flow");
    assert(!mismatch, "expected route-mismatched getParams to stay untainted");

    console.log("PASS test_harmony_router_route_scope");
    console.log(`same_route=${sameRoute} mismatch=${mismatch}`);
}

main().catch(error => {
    console.error("FAIL test_harmony_router_route_scope");
    console.error(error);
    process.exitCode = 1;
});
