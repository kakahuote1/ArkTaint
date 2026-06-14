import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { AssetDocumentBase } from "../../core/assets/schema";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import { resolveKnownOptionCallbackRegistrationsFromStmt } from "../../core/substrate/semantics/KnownOptionCallbackRegistration";

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

function collectRegistrations(scene: Scene): any[] {
    const out: any[] = [];
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts?.() || []) {
            out.push(...resolveKnownOptionCallbackRegistrationsFromStmt(stmt, scene, method));
        }
    }
    return out;
}

function generatedProjectComponentSourceAsset(): AssetDocumentBase {
    return {
        id: "project.semanticflow.component.source",
        plane: "rule",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.ExternalButton.onBtnClick",
                kind: "invoke",
                modulePath: "action_button_callback.ets",
                functionName: "ExternalButton",
                invokeKind: "free-function",
                argCount: 1,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: {
                        file: "action_button_callback.ets",
                        line: 12,
                    },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.ExternalButton.onBtnClick.arg0.source",
                surfaceId: "surface.ExternalButton.onBtnClick",
                assetId: "project.ExternalButton.onBtnClick",
                plane: "rule",
                role: "source",
                endpoint: {
                    base: {
                        kind: "callbackArg",
                        callback: {
                            kind: "option",
                            base: { base: { kind: "arg", index: 0 } },
                            accessPath: ["onBtnClick"],
                        },
                        argIndex: 0,
                    },
                },
                effectTemplateRefs: ["template.ExternalButton.onBtnClick.arg0.source"],
                semanticsFamily: "ui-input",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.ExternalButton.onBtnClick.arg0.source",
                kind: "rule.source",
                value: {
                    base: {
                        kind: "callbackArg",
                        callback: {
                            kind: "option",
                            base: { base: { kind: "arg", index: 0 } },
                            accessPath: ["onBtnClick"],
                        },
                        argIndex: 0,
                    },
                },
                sourceKind: "callback_param",
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            projectId: "semanticflow",
        },
    };
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/project_component_option_action_callback");
    const scene = buildScene(sourceDir);

    const registrations = collectRegistrations(scene);
    const projectComponentRegistrations = registrations.filter(registration =>
        registration.slotFamily === "project_component_option_slot"
        && registration.registrationMethodName === "ExternalButton"
    );
    const lowerCaseHelperRegistrations = registrations.filter(registration =>
        registration.registrationMethodName === "registerAction"
    );

    assert(
        projectComponentRegistrations.length === 1,
        `expected one project component option callback registration, actual=${projectComponentRegistrations.length}`,
    );
    assert(
        projectComponentRegistrations[0].callbackMethod?.getSignature?.()?.toString?.().includes("%AM"),
        "expected ExternalButton.onBtnClick callback method to resolve",
    );
    assert(
        projectComponentRegistrations[0].callbackFieldName === "onBtnClick",
        `expected project component callback field name to be preserved, actual=${projectComponentRegistrations[0].callbackFieldName}`,
    );
    assert(
        lowerCaseHelperRegistrations.length === 0,
        `lowercase helper registerAction must not be promoted as component callback, actual=${lowerCaseHelperRegistrations.length}`,
    );

    const generatedProjectRules = lowerRuleAssetsToRuleSet(
        [generatedProjectComponentSourceAsset()],
        { loadMode: "semanticflow-evaluation" },
    );
    assert(
        generatedProjectRules.diagnostics.length === 0,
        `generated project component source asset should lower cleanly: ${generatedProjectRules.diagnostics.join("; ")}`,
    );

    const sourceRules: SourceRule[] = [
        {
            id: "source.fixture.input",
            enabled: true,
            match: { kind: "method_name_equals", value: "input" },
            sourceKind: "call_return",
            target: "result",
        },
        ...(generatedProjectRules.ruleSet.sources || []),
        {
            id: "source.fixture.externalButton.wrongField.arg0",
            enabled: true,
            match: { kind: "method_name_equals", value: "ExternalButton" },
            sourceKind: "callback_param",
            target: { endpoint: "arg0" },
            callbackArgIndexes: [0],
            callbackFieldNames: ["wrongField"],
            callbackResolution: "known_option",
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

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const externalButtonFlows = flows.filter(flow =>
        String(flow.sink?.toString?.() || "").includes("sink")
    );

    assert(seedInfo.seedCount > 0, "expected input() call-return source to seed");
    assert(
        (seedInfo.sourceRuleHits["ExternalButton.onBtnClick.arg0.source"] || 0) > 0,
        "expected generated v2 project component callback source to seed",
    );
    assert(
        seedInfo.seededLocals.some(label => label.includes("@ExternalButton#cbArg0")),
        `project component callback source must seed the field callback body, labels=${seedInfo.seededLocals.join("; ")}`,
    );
    assert(
        (seedInfo.sourceRuleHits["source.fixture.externalButton.wrongField.arg0"] || 0) === 0,
        "wrong project component callback field name must not seed",
    );
    assert(
        externalButtonFlows.length > 0,
        `expected component action callback to enter ArkMain reachability and expose source -> sink flow, got ${flows.length} total flows`,
    );

    console.log("PASS test_entry_model_project_component_option_callback");
    console.log(`registrations=${registrations.length}`);
    console.log(`project_component_registrations=${projectComponentRegistrations.length}`);
    console.log(`flows=${flows.length}`);
}

main().catch(error => {
    console.error("FAIL test_entry_model_project_component_option_callback");
    console.error(error);
    process.exitCode = 1;
});
