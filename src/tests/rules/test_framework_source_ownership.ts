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
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
    });

    const frameworkSourceIds = new Set((loaded.ruleSet.sources || []).map(rule => String(rule.id || "")));
    for (const id of frameworkSourceIds) {
        assert(!isLegacyCompatSourceId(id), `framework rule inventory should not contain legacy ArkMain compat source: ${id}`);
    }

    const scene = buildScene(path.resolve("tests/demo/harmony_lifecycle"));
    const plan = buildArkMainPlan(scene);
    assert(
        plan.facts.some(fact => fact.kind === "ability_lifecycle" || fact.kind === "extension_lifecycle"),
        "ArkMain plan should own lifecycle official declaration facts.",
    );
    assert(
        !plan.facts.some(fact => fact.kind === "router_trigger" || fact.kind === "router_source"),
        "ArkMain plan should not own router source/trigger facts.",
    );
    assert(
        !plan.facts.some(fact => String(fact.entryFamily || "").includes("stage.context")),
        "ArkMain plan should not own stage context compat facts.",
    );

    const engine = new TaintPropagationEngine(scene, 1);
    await engine.buildPAG({ entryModel: "arkMain" });
    const runtimeSourceIds = new Set(engine.getAutoEntrySourceRules().map(rule => String(rule.id || "")));
    for (const id of runtimeSourceIds) {
        assert(!isLegacyCompatSourceId(id), `ArkMain runtime auto sources should not contain legacy compat source: ${id}`);
    }
    assert(runtimeSourceIds.size > 0, "ArkMain runtime should lower official declaration facts into auto source rules");

    console.log("PASS test_framework_source_ownership");
}

main().catch(error => {
    console.error("FAIL test_framework_source_ownership");
    console.error(error);
    process.exit(1);
});

