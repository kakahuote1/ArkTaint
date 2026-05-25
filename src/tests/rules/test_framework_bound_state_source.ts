import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { createIsolatedCaseView, ensureDir } from "../helpers/ExecutionHandoffContractSupport";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

const SINK_RULES: SinkRule[] = [
    {
        id: "sink.fixture.bound_state.arg0",
        match: { kind: "method_name_equals", value: "Sink" },
        target: { endpoint: "arg0" },
    },
];

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function findEntry(scene: Scene, name: string): any {
    return scene.getMethods().find(method => method.getName?.() === name);
}

async function detectFlow(sourceDir: string, caseName: string, entryName: string, sourceRules: SourceRule[]): Promise<{ seedCount: number; flowCount: number }> {
    const caseViewRoot = path.resolve("tmp/test_runs/security/framework_bound_state_source/latest/case_views");
    ensureDir(caseViewRoot);
    const caseDir = createIsolatedCaseView(sourceDir, caseName, caseViewRoot);
    const scene = buildScene(caseDir);
    const entryMethod = findEntry(scene, entryName);
    assert(entryMethod, `entry not found: ${entryName}`);
    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    engine.setActiveReachableMethodSignatures(undefined, { mergeExplicitEntryScope: false });
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(SINK_RULES);
    return { seedCount: seedInfo.seedCount, flowCount: flows.length };
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/harmony_bound_state_input");
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
    });
    const boundStateRules = (loaded.ruleSet.sources || [])
        .filter(rule => rule.sourceKind === "bound_state");
    assert(boundStateRules.some(rule => rule.id === "source.harmony.input.textinput.text_binding"),
        "loaded rules missing TextInput bound-state source");

    const positive = await detectFlow(
        sourceDir,
        "textinput_bound_state_001_T",
        "textinput_bound_state_001_T",
        boundStateRules,
    );
    assert(positive.seedCount > 0, `expected bound-state seed, got ${positive.seedCount}`);
    assert(positive.flowCount > 0, `expected bound-state flow, got ${positive.flowCount}`);

    const negative = await detectFlow(
        sourceDir,
        "textinput_plain_value_002_F",
        "textinput_plain_value_002_F",
        boundStateRules,
    );
    assert(negative.seedCount === 0, `plain value should not seed bound-state source, got ${negative.seedCount}`);
    assert(negative.flowCount === 0, `plain value should not produce flow, got ${negative.flowCount}`);

    console.log("PASS test_framework_bound_state_source");
    console.log(`bound_state_rules=${boundStateRules.length}`);
    console.log(`positive_seeds=${positive.seedCount}`);
    console.log(`positive_flows=${positive.flowCount}`);
}

main().catch(error => {
    console.error("FAIL test_framework_bound_state_source");
    console.error(error);
    process.exit(1);
});
