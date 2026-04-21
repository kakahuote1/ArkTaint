import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { buildArkMainPlan } from "../../core/entry/arkmain/ArkMainPlanner";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function isLegacyCompatSourceId(id: string): boolean {
    return id.startsWith("source.harmony.lifecycle.")
        || id.startsWith("source.harmony.extension.")
        || id.startsWith("source.harmony.router.getParams")
        || id === "source.harmony.abilitystage.context_call";
}

async function main(): Promise<void> {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
    });

    const frameworkSourceIds = new Set((loaded.ruleSet.sources || []).map(rule => String(rule.id || "")));
    for (const id of frameworkSourceIds) {
        assert(!isLegacyCompatSourceId(id), `framework rule inventory should not contain legacy ArkMain compat source: ${id}`);
    }

    const scene = buildScene(path.resolve("tests/demo/harmony_lifecycle"));
    const plan = buildArkMainPlan(scene);
    const planSourceIds = new Set((plan.sourceRules || []).map(rule => String(rule.id || "")));
    assert(
        [...planSourceIds].some(id => id.startsWith("source.arkmain.contract.lifecycle.param.")),
        "ArkMain plan should export lifecycle contract source rules.",
    );
    assert(
        ![...planSourceIds].some(id => id.startsWith("source.arkmain.contract.router.trigger.")),
        "ArkMain plan should not export router contract source rules.",
    );
    assert(
        ![...planSourceIds].some(id => id.startsWith("source.arkmain.contract.stage.context.")),
        "ArkMain plan should not export stage context contract source rules.",
    );

    const engine = new TaintPropagationEngine(scene, 1);
    await engine.buildPAG({ entryModel: "arkMain" });
    const runtimeSourceIds = new Set(engine.getAutoEntrySourceRules().map(rule => String(rule.id || "")));
    for (const id of runtimeSourceIds) {
        assert(!isLegacyCompatSourceId(id), `ArkMain runtime auto sources should not contain legacy compat source: ${id}`);
    }
    for (const id of planSourceIds) {
        assert(runtimeSourceIds.has(id), `ArkMain runtime should consume contract source directly: missing ${id}`);
    }

    console.log("PASS test_framework_source_ownership");
}

main().catch(error => {
    console.error("FAIL test_framework_source_ownership");
    console.error(error);
    process.exit(1);
});

