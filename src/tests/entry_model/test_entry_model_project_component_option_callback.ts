import * as path from "path";
import * as fs from "fs";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { AssetDocumentBase } from "../../core/assets/schema";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import { resolveKnownOptionCallbackRegistrationsFromStmt } from "../../core/substrate/semantics/KnownOptionCallbackRegistration";
import { createCanonicalApiRegistry, fromProjectDeclaration, type CanonicalApiDescriptor } from "../../core/api/identity";
import { bindExactAssetIdentities } from "../helpers/AssetIdentityTestUtils";
import { projectApiEffectAssetFromMethod } from "../helpers/ApiEffectTestAssets";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";

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

function findMethod(scene: Scene, methodName: string) {
    const method = scene.getMethods().find(item => item.getName?.() === methodName);
    assert(!!method, `method not found: ${methodName}`);
    return method;
}

function findMethodBySignature(scene: Scene, signature: string) {
    const method = scene.getMethods().find(item => item.getSignature?.()?.toString?.() === signature);
    assert(!!method, `method not found by signature: ${signature}`);
    return method;
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function writeProjectComponentFixture(): string {
    const root = resolveTestRunDir("entry_model", "project_component_option_callback");
    const sourceDir = path.join(root, "source");
    fs.rmSync(root, { recursive: true, force: true });
    writeText(path.join(sourceDir, "action_button_callback.ets"), [
        "declare function sink(value: string): void;",
        "declare function registerAction(options: { onBtnClick: (value: string) => void }): void;",
        "",
        "@Component",
        "struct ExternalButton {",
        "  onBtnClick?: (value: string) => void;",
        "",
        "  build(): void {}",
        "}",
        "",
        "@Entry",
        "@Component",
        "struct HostPage {",
        "  build() {",
        "    ExternalButton({",
        "      onBtnClick: (content: string) => {",
        "        sink(content);",
        "      }",
        "    });",
        "",
        "    registerAction({",
        "      onBtnClick: (content: string) => {",
        "        sink(\"not a component option callback\");",
        "      }",
        "    });",
        "  }",
        "}",
        "",
    ].join("\n"));
    return sourceDir;
}

function generatedProjectComponentSourceAsset(registrationMethod: any): {
    asset: AssetDocumentBase;
    canonicalApiDescriptor: CanonicalApiDescriptor;
} {
    const canonicalApiDescriptor = constructorDescriptorFromMethod(registrationMethod);
    const canonicalApiId = canonicalApiDescriptor.canonicalApiId;
    const asset = bindExactAssetIdentities({
        id: "project.semanticflow.component.source",
        plane: "rule",
        status: "reviewed",
        surfaces: [{
            surfaceId: "surface.ExternalButton.onBtnClick",
            kind: "invoke",
            canonicalApiId,
            evidence: {
                arkanalyzer: {
                    methodKey: arkanalyzerMethodKeyFromMethod(registrationMethod),
                },
            },
            confidence: "likely",
            provenance: {
                source: "llm-proposal",
                location: {
                    file: "action_button_callback.ets",
                    line: 16,
                },
            },
        }],
        bindings: [
            {
                bindingId: "binding.ExternalButton.onBtnClick.arg0.source",
                surfaceId: "surface.ExternalButton.onBtnClick",
                canonicalApiId,
                assetId: "project.semanticflow.component.source",
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
    } as AssetDocumentBase);
    return { asset, canonicalApiDescriptor };
}

function constructorDescriptorFromMethod(method: any): CanonicalApiDescriptor {
    const result = fromProjectDeclaration({
        domain: "local",
        moduleSpecifier: modulePathFromMethod(method),
        logicalDeclarationFile: projectDeclarationFileKeyFromMethod(method),
        exportPath: [{ kind: "namespace", name: "ExternalButton" }],
        declarationOwner: {
            kind: "class",
            path: ["ExternalButton"],
            normalizedName: "ExternalButton",
            arkanalyzerName: "ExternalButton",
        },
        member: { kind: "constructor", name: "constructor" },
        invoke: { kind: "new" },
        signature: {
            parameters: parameterTypesFromMethod(method).map((type, index) => ({ index, type: { text: type } })),
            returnType: { text: returnTypeFromMethod(method) },
        },
        arkanalyzer: arkanalyzerMethodKeyFromMethod(method),
        declarationLocations: [{ file: modulePathFromMethod(method) }],
    });
    if (result.status !== "accepted") {
        throw new Error(`constructor canonical descriptor rejected: ${result.reason}`);
    }
    return result.descriptor;
}

function modulePathFromMethod(method: any): string {
    const declaringFileName = declaringFileNameFromMethod(method);
    const normalized = declaringFileName.replace(/\\/g, "/").replace(/^@/, "").replace(/:\s*$/, "");
    assert(normalized.length > 0, `method has no declaring file: ${method.getSignature?.()?.toString?.() || "<unknown>"}`);
    return normalized;
}

function projectDeclarationFileKeyFromMethod(method: any): string {
    return declaringFileNameFromMethod(method).replace(/\\/g, "/").trim();
}

function declaringFileNameFromMethod(method: any): string {
    return String(
        method.getDeclaringArkClass?.()?.getSignature?.()?.getDeclaringFileSignature?.()?.toString?.()
        || method.getDeclaringArkFile?.()?.getFileSignature?.()?.toString?.()
        || "",
    );
}

function parameterTypesFromMethod(method: any): string[] {
    const parameters = method.getSignature?.()?.getMethodSubSignature?.()?.getParameters?.() || [];
    return parameters.map((parameter: any) => String(parameter?.getType?.()?.toString?.() || parameter?.toString?.() || "unknown"));
}

function returnTypeFromMethod(method: any): string {
    return String(method.getSignature?.()?.getMethodSubSignature?.()?.getReturnType?.()?.toString?.() || "void");
}

function arkanalyzerMethodKeyFromMethod(method: any) {
    return {
        declaringFileName: declaringFileNameFromMethod(method),
        declaringNamespacePath: [],
        declaringClassName: method.getDeclaringArkClass?.()?.getName?.() || "ExternalButton",
        methodName: method.getName?.() || "constructor",
        parameterTypes: parameterTypesFromMethod(method),
        returnType: returnTypeFromMethod(method),
        staticFlag: !!method.isStatic?.(),
    };
}

async function main(): Promise<void> {
    const sourceDir = writeProjectComponentFixture();
    const scene = buildScene(sourceDir);

    const registrations = collectRegistrations(scene);
    const projectComponentRegistrations = registrations.filter(registration =>
        registration.slotFamily === "project_component_option_slot"
        && registration.registrationOwnerName === "ExternalButton"
        && registration.registrationMethodName === "constructor"
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

    const componentRegistrationMethod = findMethodBySignature(scene, projectComponentRegistrations[0].registrationSignature);
    const generatedProjectSource = generatedProjectComponentSourceAsset(componentRegistrationMethod);
    const generatedProjectSourceAsset = generatedProjectSource.asset;
    const generatedProjectRules = lowerRuleAssetsToRuleSet(
        [generatedProjectSourceAsset],
        { loadMode: "semanticflow-evaluation" },
    );
    assert(
        generatedProjectRules.diagnostics.length === 0,
        `generated project component source asset should lower cleanly: ${generatedProjectRules.diagnostics.join("; ")}`,
    );
    const sinkEffect = projectApiEffectAssetFromMethod({
        id: "sink.fixture.sink",
        role: "sink",
        method: findMethod(scene, "sink"),
        endpoint: { base: { kind: "arg", index: 0 } },
        sinkKind: "test",
    });

    const sourceRules: SourceRule[] = [
        ...(generatedProjectRules.ruleSet.sources || []),
    ];
    const sinkRules: SinkRule[] = [
        {
            id: "sink.fixture.sink",
            enabled: true,
            match: { kind: "canonical_api_id_equals", value: sinkEffect.canonicalApiDescriptor.canonicalApiId },
            apiEffect: sinkEffect.apiEffect,
            target: { endpoint: "arg0" },
        },
    ];

    const engine = new TaintPropagationEngine(scene, 1, {
        apiAssets: [sinkEffect.asset, generatedProjectSourceAsset],
        canonicalApiRegistry: createCanonicalApiRegistry([
            sinkEffect.canonicalApiDescriptor,
            generatedProjectSource.canonicalApiDescriptor,
        ]),
    });
    engine.verbose = false;
    await engine.buildPAG({ entryModel: "arkMain" });
    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const externalButtonFlows = flows.filter(flow =>
        String(flow.sink?.toString?.() || "").includes("sink")
    );
    assert(
        (seedInfo.sourceRuleHits["ExternalButton.onBtnClick.arg0.source"] || 0) > 0,
        `expected generated v2 project component callback source to seed, hits=${JSON.stringify(seedInfo.sourceRuleHits)}, zeroHit=${JSON.stringify(seedInfo.sourceRuleZeroHitAudit)}, endpointStatus=${JSON.stringify(seedInfo.endpointResolutionAudit.map(item => ({ status: item.status, reason: item.reason, endpointBindingRef: item.endpointBindingRef })))}`,
    );
    assert(
        seedInfo.sourceSeedAudit.some(entry => entry.label.includes("%AM") && entry.label.includes("#cbArg0"))
            && seedInfo.seededLocals.some(label => label.includes("#cbArg0")),
        `project component callback source must seed the resolved anonymous callback body, seedAudit=${JSON.stringify(seedInfo.sourceSeedAudit)}, labels=${seedInfo.seededLocals.join("; ")}`,
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
