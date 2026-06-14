import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import type { AssetDocumentBase } from "../../core/assets/schema";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import type { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { validateRuleSet } from "../../core/rules/RuleValidator";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function freeFunctionSinkAsset(functionName = "sendApi"): AssetDocumentBase {
    return {
        id: `asset.project.${functionName}.sink`,
        plane: "rule",
        status: "official",
        surfaces: [
            {
                surfaceId: `surface.${functionName}`,
                kind: "invoke",
                modulePath: "free_function_surface.ets",
                functionName,
                invokeKind: "free-function",
                argCount: 1,
                confidence: "certain",
                provenance: {
                    source: "manual",
                    location: {
                        file: "free_function_surface.ets",
                        line: 1,
                    },
                },
            },
        ],
        bindings: [
            {
                bindingId: `binding.${functionName}.arg0.sink`,
                surfaceId: `surface.${functionName}`,
                assetId: `asset.project.${functionName}.sink`,
                plane: "rule",
                role: "sink",
                endpoint: { base: { kind: "arg", index: 0 } },
                effectTemplateRefs: [`template.${functionName}.arg0.sink`],
                semanticsFamily: "project-network",
                completeness: "complete",
                confidence: "certain",
            },
        ],
        effectTemplates: [
            {
                id: `template.${functionName}.arg0.sink`,
                kind: "rule.sink",
                sinkKind: "http-request",
                value: { base: { kind: "arg", index: 0 } },
                confidence: "certain",
            },
        ],
        provenance: {
            source: "manual",
            evidenceLocations: [
                {
                    file: "free_function_surface.ets",
                    line: 1,
                },
            ],
        },
    };
}

async function runCase(scene: Scene, caseMethodName: string, sourceRules: SourceRule[], sinkRules: SinkRule[]): Promise<boolean> {
    const caseMethod = scene.getMethods().find(method => method.getName() === caseMethodName);
    assert(caseMethod, `case method not found: ${caseMethodName}`);
    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "explicit", syntheticEntryMethods: [caseMethod] });
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    return flows.some(flow => {
        const stmt: any = flow.sink;
        const owner = stmt?.getCfg?.()?.getDeclaringMethod?.();
        return owner?.getName?.() === caseMethodName;
    });
}

async function main(): Promise<void> {
    const lowered = lowerRuleAssetsToRuleSet([freeFunctionSinkAsset()]);
    assert(lowered.diagnostics.length === 0, `unexpected diagnostics: ${lowered.diagnostics.join("; ")}`);
    assert(lowered.ruleSet.sinks.length === 1, "free-function sink should lower");
    const loweredSink = lowered.ruleSet.sinks[0];
    assert(loweredSink.match.kind === "signature_regex", "free-function fallback should use a runtime signature regex");
    assert(loweredSink.match.value.includes("%AM"), "free-function fallback should account for analyzer backing methods");
    assert(loweredSink.match.typeHint === "sendApi", "free-function fallback should keep the source symbol as typeHint");
    assert(loweredSink.calleeScope?.file?.value === "free_function_surface.ets", "free-function fallback should be callee-file anchored");

    const sourceRules: SourceRule[] = [
        {
            id: "source.free_function_surface.entry_param.taint_src",
            sourceKind: "entry_param",
            target: "arg0",
            match: { kind: "local_name_regex", value: "^taint_src$" },
        },
    ];
    const validation = validateRuleSet({
        sources: sourceRules,
        sinks: lowered.ruleSet.sinks,
        transfers: [],
    });
    assert(validation.valid, `rules invalid: ${validation.errors.join("; ")}`);

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(path.resolve("tests/demo/rule_asset_free_function_surface"));
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const positive = await runCase(
        scene,
        "free_function_surface_send_001_T",
        sourceRules,
        lowered.ruleSet.sinks,
    );
    const negative = await runCase(
        scene,
        "free_function_surface_sibling_002_F",
        sourceRules,
        lowered.ruleSet.sinks,
    );

    assert(positive, "sendApi exported const arrow sink should be detected through fallback selector");
    assert(!negative, "sibling exported const arrow function must not match sendApi fallback selector");

    const namedLowered = lowerRuleAssetsToRuleSet([freeFunctionSinkAsset("sendNamedApi")]);
    assert(namedLowered.diagnostics.length === 0, `unexpected named diagnostics: ${namedLowered.diagnostics.join("; ")}`);
    assert(namedLowered.ruleSet.sinks.length === 1, "named free-function sink should lower");
    assert(namedLowered.ruleSet.sinks[0].match.kind === "signature_regex", "named free-function should use a runtime signature regex");
    const namedValidation = validateRuleSet({
        sources: sourceRules,
        sinks: namedLowered.ruleSet.sinks,
        transfers: [],
    });
    assert(namedValidation.valid, `named rules invalid: ${namedValidation.errors.join("; ")}`);
    const namedPositive = await runCase(
        scene,
        "free_function_surface_named_003_T",
        sourceRules,
        namedLowered.ruleSet.sinks,
    );
    const namedNegative = await runCase(
        scene,
        "free_function_surface_named_sibling_004_F",
        sourceRules,
        namedLowered.ruleSet.sinks,
    );
    assert(namedPositive, "top-level exported function sink should be detected through fallback selector");
    assert(!namedNegative, "sibling top-level exported function must not match named free-function selector");
    console.log("PASS test_rule_asset_free_function_surface_selector");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
