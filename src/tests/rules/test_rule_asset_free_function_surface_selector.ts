import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import type { AssetDocumentBase } from "../../core/assets/schema";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import type { SinkRule } from "../../core/rules/RuleSchema";
import { validateRuleSet } from "../../core/rules/RuleValidator";
import { makeRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import { exactRuleRuntimeFromAssets, type ExactRuleRuntime } from "./ExactRuleTestUtils";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function freeFunctionSinkAsset(functionName = "sendApi", signatureId?: string): AssetDocumentBase {
    const arkanalyzerSignature = signatureId || `@rule_asset_free_function_surface/free_function_surface.ets: %dflt.${functionName}(string)`;
    const methodKeyEvidence = methodKeyEvidenceFromSyntheticSignature(arkanalyzerSignature, functionName);
    return makeRuleAssetFixture({
        id: `asset.project.${functionName}.sink`,
        status: "official",
        sinks: [
            {
                id: `${functionName}.arg0.sink`,
                target: "arg0",
                metadata: { family: "project-network" },
                surface: {
                    kind: "invoke",
                    modulePath: "rule_asset_free_function_surface/free_function_surface.ets",
                    ownerName: "%dflt",
                    ownerKind: "namespace",
                    invokeKind: "free-function",
                    argCount: 1,
                    parameterTypes: ["string"],
                    returnType: "void",
                    functionName,
                    arkanalyzerDeclaringFileName: methodKeyEvidence.arkanalyzerDeclaringFileName as string,
                    arkanalyzerDeclaringClassName: methodKeyEvidence.arkanalyzerDeclaringClassName as string,
                    arkanalyzerMethodName: methodKeyEvidence.arkanalyzerMethodName as string,
                    arkanalyzerStaticFlag: methodKeyEvidence.arkanalyzerStaticFlag as boolean,
                },
            },
        ],
    });
}

function methodKeyEvidenceFromSyntheticSignature(signature: string, functionName: string): Record<string, unknown> {
    const file = signature.slice(0, signature.indexOf(":")).replace(/^@/, "");
    const ownerMatch = /:\s*([^.\s]+)\./.exec(signature);
    const methodMatch = /\.([^.(]+)\(/.exec(signature);
    return {
        arkanalyzerDeclaringFileName: file,
        arkanalyzerDeclaringClassName: ownerMatch?.[1] || "%dflt",
        arkanalyzerMethodName: methodMatch?.[1] || functionName,
        arkanalyzerStaticFlag: !(methodMatch?.[1] || functionName).startsWith("%AM"),
    };
}

function findSeedNodes(engine: TaintPropagationEngine, scene: Scene, methodName: string, localName: string): PagNode[] {
    const method = scene.getMethods().find(m => m.getName() === methodName);
    assert(method, `method not found: ${methodName}`);
    const cfg = method.getCfg();
    assert(cfg, `cfg not found: ${methodName}`);
    for (const stmt of cfg.getStmts()) {
        const left = (stmt as any).getLeftOp?.();
        if (!left || left.getName?.() !== localName) continue;
        const nodeIds = engine.pag.getNodesByValue(left);
        return nodeIds ? [...nodeIds.values()].map(id => engine.pag.getNode(id) as PagNode) : [];
    }
    return [];
}

async function runCase(
    scene: Scene,
    caseMethodName: string,
    sinkRules: SinkRule[],
    exactRuntime: ExactRuleRuntime,
): Promise<boolean> {
    const caseMethod = scene.getMethods().find(method => method.getName() === caseMethodName);
    assert(caseMethod, `case method not found: ${caseMethodName}`);
    const engine = new TaintPropagationEngine(scene, 1, {
        ...exactRuntime,
    });
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "explicit", syntheticEntryMethods: [caseMethod] });
    const seedNodes = findSeedNodes(engine, scene, caseMethodName, "taint_src");
    assert(seedNodes.length > 0, `${caseMethodName}: expected taint_src seed nodes`);
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules);
    const detected = flows.some(flow => {
        const stmt: any = flow.sink;
        const owner = stmt?.getCfg?.()?.getDeclaringMethod?.();
        return owner?.getName?.() === caseMethodName;
    });
    return detected;
}

async function main(): Promise<void> {
    const sendApiRuntimeSignature = "@rule_asset_free_function_surface/free_function_surface.ets: %dflt.%AM0(string)";
    const sendApiAsset = freeFunctionSinkAsset("sendApi", sendApiRuntimeSignature);
    const lowered = lowerRuleAssetsToRuleSet([sendApiAsset]);
    assert(lowered.diagnostics.length === 0, `unexpected diagnostics: ${lowered.diagnostics.join("; ")}`);
    assert(lowered.ruleSet.sinks.length === 1, "free-function sink should lower");
    const loweredSink = lowered.ruleSet.sinks[0];
    assert(loweredSink.match.kind === "canonical_api_id_equals", "analyzer-backed free-function surface should use canonical identity gate");
    assert(loweredSink.match.value === loweredSink.apiEffect?.canonicalApiId, "free-function surface gate should use apiEffect canonicalApiId");
    assert(!("typeHint" in (loweredSink.match as any)), "free-function surface gate must not keep legacy typeHint selector");

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(path.resolve("tests/demo/rule_asset_free_function_surface"));
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const validation = validateRuleSet({
        sources: [],
        sinks: lowered.ruleSet.sinks,
        transfers: [],
    });
    assert(validation.valid, `rules invalid: ${validation.errors.join("; ")}`);

    const positive = await runCase(
        scene,
        "free_function_surface_send_001_T",
        lowered.ruleSet.sinks,
        exactRuleRuntimeFromAssets([sendApiAsset]),
    );
    const negative = await runCase(
        scene,
        "free_function_surface_sibling_002_F",
        lowered.ruleSet.sinks,
        exactRuleRuntimeFromAssets([sendApiAsset]),
    );

    assert(positive, "sendApi exported const arrow sink should be detected through its canonical surface gate");
    assert(!negative, "sibling exported const arrow function must not match sendApi canonical surface gate");

    const namedAsset = freeFunctionSinkAsset("sendNamedApi");
    const namedLowered = lowerRuleAssetsToRuleSet([namedAsset]);
    assert(namedLowered.diagnostics.length === 0, `unexpected named diagnostics: ${namedLowered.diagnostics.join("; ")}`);
    assert(namedLowered.ruleSet.sinks.length === 1, "named free-function sink should lower");
    assert(namedLowered.ruleSet.sinks[0].match.kind === "canonical_api_id_equals", "named free-function should use canonical identity gate");
    assert(
        namedLowered.ruleSet.sinks[0].match.value === namedLowered.ruleSet.sinks[0].apiEffect?.canonicalApiId,
        "named free-function should use apiEffect canonicalApiId",
    );
    const namedValidation = validateRuleSet({
        sources: [],
        sinks: namedLowered.ruleSet.sinks,
        transfers: [],
    });
    assert(namedValidation.valid, `named rules invalid: ${namedValidation.errors.join("; ")}`);
    const namedPositive = await runCase(
        scene,
        "free_function_surface_named_003_T",
        namedLowered.ruleSet.sinks,
        exactRuleRuntimeFromAssets([namedAsset]),
    );
    const namedNegative = await runCase(
        scene,
        "free_function_surface_named_sibling_004_F",
        namedLowered.ruleSet.sinks,
        exactRuleRuntimeFromAssets([namedAsset]),
    );
    assert(namedPositive, "top-level exported function sink should be detected through its canonical surface gate");
    assert(!namedNegative, "sibling top-level exported function must not match named free-function gate");
    console.log("PASS test_rule_asset_free_function_surface_selector");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
