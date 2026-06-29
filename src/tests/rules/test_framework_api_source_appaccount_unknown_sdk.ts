import * as path from "path";
import { SinkRule } from "../../core/rules/RuleSchema";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import { projectApiEffectAssetFromMethod } from "../helpers/ApiEffectTestAssets";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

const SOURCE_DIR = path.resolve("tests/demo/framework_api_source_appaccount_unknown_sdk");

function findMethod(scene: ReturnType<typeof buildTestScene>, methodName: string): any {
    return scene.getMethods().find(method => method.getName() === methodName);
}

function buildSinkRules(scene: ReturnType<typeof buildTestScene>): {
    rules: SinkRule[];
    assets: ReturnType<typeof projectApiEffectAssetFromMethod>["asset"][];
} {
    const sinkMethod = findMethod(scene, "Sink");
    assert(sinkMethod, "sink method not found: Sink");
    const sinkEffect = projectApiEffectAssetFromMethod({
        id: "sink.framework.api.appaccount.unknown_sdk.arg0",
        role: "sink",
        method: sinkMethod,
        endpoint: { base: { kind: "arg", index: 0 } },
        sinkKind: "test",
    });
    return {
        assets: [sinkEffect.asset],
        rules: [{
        id: "sink.framework.api.appaccount.unknown_sdk.arg0",
        match: { kind: "canonical_api_id_equals", value: sinkEffect.canonicalApiDescriptor.canonicalApiId },
        apiEffect: sinkEffect.apiEffect,
        target: { endpoint: "arg0" },
        }],
    };
}

function flowSinkInCaseMethod(scene: ReturnType<typeof buildTestScene>, sinkStmt: any, caseMethodName: string): boolean {
    const method = findMethod(scene, caseMethodName);
    const cfg = method?.getCfg();
    return !!cfg && cfg.getStmts().includes(sinkStmt);
}

async function runCase(scene: ReturnType<typeof buildTestScene>, caseName: string): Promise<{ detected: boolean; hits: number }> {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
    });
    const sourceRules = (loaded.ruleSet.sources || []).filter(
        rule => rule.family === "source.harmony.appAccount"
    );
    assert(sourceRules.length > 0, "expected appAccount API source rules");

    const sinkRules = buildSinkRules(scene);
    const entryMethod = findMethod(scene, caseName);
    assert(entryMethod, `entry method not found: ${caseName}`);
    const engine = new TaintPropagationEngine(scene, 1, {
        apiAssets: [...loaded.assets, ...sinkRules.assets],
    });
    engine.verbose = false;
    await engine.buildPAG({
        entryModel: "explicit",
        syntheticEntryMethods: [entryMethod],
    });
    engine.setActiveReachableMethodSignatures(new Set([entryMethod.getSignature().toString()]));
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules.rules);
    return {
        detected: flows.some(flow => flowSinkInCaseMethod(scene, flow.sink, caseName)),
        hits: seedInfo.sourceRuleHits["source.harmony.appAccount.getCredential.result"] || 0,
    };
}

async function main(): Promise<void> {
    const scene = buildTestScene(SOURCE_DIR);
    const positive = await runCase(scene, "appaccount_unknown_sdk_getCredential_001_T");
    const negative = await runCase(scene, "appaccount_unknown_sdk_getCredential_002_F");

    assert(positive.detected, "expected SDK appAccount.getCredential result to reach sink");
    assert(positive.hits > 0, "expected SDK appAccount source rule hit");
    assert(!negative.detected, "expected local appAccount-shaped helper to be rejected");
    assert(negative.hits === 0, "expected local helper to have no appAccount source hit");

    console.log("====== Framework API Source AppAccount Unknown SDK ======");
    console.log(`positive_detected=${positive.detected} positive_hits=${positive.hits}`);
    console.log(`negative_detected=${negative.detected} negative_hits=${negative.hits}`);
}

main().catch(error => {
    console.error("FAIL test_framework_api_source_appaccount_unknown_sdk");
    console.error(error);
    process.exit(1);
});
