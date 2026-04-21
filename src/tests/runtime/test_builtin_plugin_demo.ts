import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildTestScene } from "../helpers/TestSceneBuilder";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function hasReachableMethod(scene: Scene, reachable: Set<string>, methodName: string): boolean {
    const method = scene.getMethods().find(candidate => candidate.getName?.() === methodName);
    const signature = method?.getSignature?.()?.toString?.();
    return signature ? reachable.has(signature) : false;
}

async function runAnalysis(disabledPluginNames: string[]): Promise<{
    reachable: Set<string>;
    seedCount: number;
    findingCount: number;
    loadedPlugins: string[];
}> {
    const projectDir = path.resolve("tests/fixtures/builtin_plugin_demo/project");
    const scene = buildTestScene(projectDir);
    const engine = new TaintPropagationEngine(scene, 1, {
        disabledEnginePluginNames: disabledPluginNames,
    });
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const reachable = engine.computeReachableMethodSignatures();
    engine.setActiveReachableMethodSignatures(reachable);
    const seeds = engine.propagateWithSourceRules([]);
    const findings = engine.detectSinksByRules([]);
    return {
        reachable,
        seedCount: seeds.seedCount,
        findingCount: findings.length,
        loadedPlugins: engine.getLoadedEnginePluginNames(),
    };
}

async function main(): Promise<void> {
    const pluginName = "demo.builtin_entry_and_rules";
    const disabled = await runAnalysis([pluginName]);
    const enabled = await runAnalysis([]);

    const scene = buildTestScene(path.resolve("tests/fixtures/builtin_plugin_demo/project"));
    const disabledReachableEntry = hasReachableMethod(scene, disabled.reachable, "builtinPluginDemoEntry");
    const enabledReachableEntry = hasReachableMethod(scene, enabled.reachable, "builtinPluginDemoEntry");

    assert(!disabled.loadedPlugins.includes(pluginName), "plugin should be absent when disabled");
    assert(enabled.loadedPlugins.includes(pluginName), "plugin should be loaded by default from src/plugins");
    assert(!disabledReachableEntry, "builtinPluginDemoEntry should not be reachable when plugin is disabled");
    assert(enabledReachableEntry, "builtinPluginDemoEntry should be reachable when plugin is enabled");
    assert(disabled.seedCount === 0, "disabled plugin should not inject demo source rules");
    assert(disabled.findingCount === 0, "disabled plugin should not produce demo findings");
    assert(enabled.seedCount > 0, "enabled plugin should inject demo source rules");
    assert(enabled.findingCount > 0, "enabled plugin should produce demo findings");

    console.log("PASS test_builtin_plugin_demo");
    console.log(`plugin=${pluginName}`);
    console.log(`disabled: reachableEntry=${disabledReachableEntry}, seeds=${disabled.seedCount}, findings=${disabled.findingCount}`);
    console.log(`enabled: reachableEntry=${enabledReachableEntry}, seeds=${enabled.seedCount}, findings=${enabled.findingCount}`);
}

main().catch((error) => {
    console.error("FAIL test_builtin_plugin_demo");
    console.error(error);
    process.exit(1);
});
