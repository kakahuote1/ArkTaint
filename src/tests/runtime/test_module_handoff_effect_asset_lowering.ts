import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import type { AssetDocumentBase } from "../../core/assets/schema";
import { lowerModuleAssetToInternalModuleLoweringIR } from "../../core/kernel/contracts/ModuleAssetLowering";
import type { TaintModule } from "../../core/kernel/contracts/ModuleContract";
import { compileInternalModuleLoweringIR } from "../../core/orchestration/modules/InternalModuleLoweringIRCompiler";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { propagateObjectAssignFieldBridgesByObj } from "../../core/kernel/propagation/WorklistFieldPropagation";
import { buildFrameworkBoundStateSourceRules } from "../../core/rules/FrameworkCallbackSourceCatalog";
import type { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function buildAuthHeadersPasswordFieldSourceRules(): SourceRule[] {
    return [{
        id: "source.fixture.buildAuthHeaders.password_field",
        sourceKind: "field_read",
        target: "result",
        match: { kind: "method_name_equals", value: "buildAuthHeaders" },
        calleeScope: {
            methodName: { mode: "equals", value: "password" },
        },
    }];
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

function projectHandoffAsset(): AssetDocumentBase {
    return {
        id: "project.PreferenceBridge.module",
        plane: "module",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.PreferenceBridge.save",
                kind: "invoke",
                modulePath: "src/main/ets/preference_case.ets",
                ownerName: "PreferenceBridge",
                methodName: "save",
                invokeKind: "instance",
                argCount: 3,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
            {
                surfaceId: "surface.PreferenceBridge.load",
                kind: "invoke",
                modulePath: "src/main/ets/preference_case.ets",
                ownerName: "PreferenceBridge",
                methodName: "load",
                invokeKind: "instance",
                argCount: 2,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
        ],
        bindings: [
            {
                bindingId: "binding.PreferenceBridge.save",
                surfaceId: "surface.PreferenceBridge.save",
                assetId: "project.PreferenceBridge.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 2 } },
                effectTemplateRefs: ["template.PreferenceBridge.save.put"],
                semanticsFamily: "fixture.preference",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.PreferenceBridge.load",
                surfaceId: "surface.PreferenceBridge.load",
                assetId: "project.PreferenceBridge.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "promiseResult" } },
                effectTemplateRefs: ["template.PreferenceBridge.load.get"],
                semanticsFamily: "fixture.preference",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.PreferenceBridge.save.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "persistent-storage-slot",
                    family: "fixture.preference",
                    key: [
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } },
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 1 } } },
                    ],
                    precision: "infer",
                },
                value: { base: { kind: "arg", index: 2 } },
                updateStrength: "infer",
                confidence: "likely",
            },
            {
                id: "template.PreferenceBridge.load.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "persistent-storage-slot",
                    family: "fixture.preference",
                    key: [
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } },
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 1 } } },
                    ],
                    precision: "infer",
                },
                target: { base: { kind: "promiseResult" } },
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            evidenceLocations: [{ file: "preference_case.ets" }],
        },
    };
}

function projectStaticHandoffAsset(): AssetDocumentBase {
    return {
        id: "project.StaticPreferenceBridge.module",
        plane: "module",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.StaticPreferenceBridge.save",
                kind: "invoke",
                modulePath: "entry/src/main/ets/preference_case.ets",
                ownerName: "StaticPreferenceBridge",
                methodName: "save",
                invokeKind: "static",
                argCount: 3,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
            {
                surfaceId: "surface.StaticPreferenceBridge.load",
                kind: "invoke",
                modulePath: "entry/src/main/ets/preference_case.ets",
                ownerName: "StaticPreferenceBridge",
                methodName: "load",
                invokeKind: "static",
                argCount: 2,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
        ],
        bindings: [
            {
                bindingId: "binding.StaticPreferenceBridge.save",
                surfaceId: "surface.StaticPreferenceBridge.save",
                assetId: "project.StaticPreferenceBridge.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 2 } },
                effectTemplateRefs: ["template.StaticPreferenceBridge.save.put"],
                semanticsFamily: "fixture.static_preference",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.StaticPreferenceBridge.load",
                surfaceId: "surface.StaticPreferenceBridge.load",
                assetId: "project.StaticPreferenceBridge.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "return" } },
                effectTemplateRefs: ["template.StaticPreferenceBridge.load.get"],
                semanticsFamily: "fixture.static_preference",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.StaticPreferenceBridge.save.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "persistent-storage-slot",
                    family: "fixture.static_preference",
                    key: [
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } },
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 1 } } },
                    ],
                    precision: "infer",
                },
                value: { base: { kind: "arg", index: 2 } },
                updateStrength: "infer",
                confidence: "likely",
            },
            {
                id: "template.StaticPreferenceBridge.load.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "persistent-storage-slot",
                    family: "fixture.static_preference",
                    key: [
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } },
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 1 } } },
                    ],
                    precision: "infer",
                },
                target: { base: { kind: "return" } },
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            evidenceLocations: [{ file: "preference_case.ets" }],
        },
    };
}

function projectNamespaceHandoffAsset(): AssetDocumentBase {
    return {
        id: "project.ExternalPreferenceBridge.module",
        plane: "module",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.ExternalPreferenceBridge.save",
                kind: "invoke",
                modulePath: "external_preference_bridge",
                ownerName: "ExternalPreferenceBridge",
                methodName: "save",
                invokeKind: "namespace",
                argCount: 3,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
            {
                surfaceId: "surface.ExternalPreferenceBridge.load",
                kind: "invoke",
                modulePath: "external_preference_bridge",
                ownerName: "ExternalPreferenceBridge",
                methodName: "load",
                invokeKind: "namespace",
                argCount: 2,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
            {
                surfaceId: "surface.ExternalPreferenceBridge.loadAsync",
                kind: "invoke",
                modulePath: "external_preference_bridge",
                ownerName: "ExternalPreferenceBridge",
                methodName: "loadAsync",
                invokeKind: "namespace",
                argCount: 2,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
        ],
        bindings: [
            {
                bindingId: "binding.ExternalPreferenceBridge.save",
                surfaceId: "surface.ExternalPreferenceBridge.save",
                assetId: "project.ExternalPreferenceBridge.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 2 } },
                effectTemplateRefs: ["template.ExternalPreferenceBridge.save.put"],
                semanticsFamily: "fixture.external_preference",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.ExternalPreferenceBridge.load",
                surfaceId: "surface.ExternalPreferenceBridge.load",
                assetId: "project.ExternalPreferenceBridge.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "return" } },
                effectTemplateRefs: ["template.ExternalPreferenceBridge.load.get"],
                semanticsFamily: "fixture.external_preference",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.ExternalPreferenceBridge.loadAsync",
                surfaceId: "surface.ExternalPreferenceBridge.loadAsync",
                assetId: "project.ExternalPreferenceBridge.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "promiseResult" } },
                effectTemplateRefs: ["template.ExternalPreferenceBridge.loadAsync.get"],
                semanticsFamily: "fixture.external_preference",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.ExternalPreferenceBridge.save.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "persistent-storage-slot",
                    family: "fixture.external_preference",
                    key: [
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } },
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 1 } } },
                    ],
                    precision: "infer",
                },
                value: { base: { kind: "arg", index: 2 } },
                updateStrength: "infer",
                confidence: "likely",
            },
            {
                id: "template.ExternalPreferenceBridge.load.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "persistent-storage-slot",
                    family: "fixture.external_preference",
                    key: [
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } },
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 1 } } },
                    ],
                    precision: "infer",
                },
                target: { base: { kind: "return" } },
                confidence: "likely",
            },
            {
                id: "template.ExternalPreferenceBridge.loadAsync.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "persistent-storage-slot",
                    family: "fixture.external_preference",
                    key: [
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } },
                        { kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 1 } } },
                    ],
                    precision: "infer",
                },
                target: { base: { kind: "promiseResult" } },
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            evidenceLocations: [{ file: "preference_case.ets" }],
        },
    };
}

function projectObjectFieldHandoffAsset(): AssetDocumentBase {
    return {
        id: "project.ReceiverFieldCarrier.module",
        plane: "module",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.ReceiverFieldCarrier.buildAuthHeaders",
                kind: "invoke",
                modulePath: "entry/src/main/ets/preference_case.ets",
                ownerName: "ReceiverFieldCarrierFixture",
                methodName: "buildAuthHeaders",
                invokeKind: "instance",
                argCount: 1,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
            {
                surfaceId: "surface.ReceiverFieldCarrier.request",
                kind: "invoke",
                modulePath: "entry/src/main/ets/preference_case.ets",
                ownerName: "ReceiverFieldCarrierFixture",
                methodName: "_request",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
        ],
        bindings: [
            {
                bindingId: "binding.ReceiverFieldCarrier.buildAuthHeaders",
                surfaceId: "surface.ReceiverFieldCarrier.buildAuthHeaders",
                assetId: "project.ReceiverFieldCarrier.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "return" } },
                effectTemplateRefs: ["template.ReceiverFieldCarrier.authHeaders.put"],
                semanticsFamily: "fixture.receiver_field",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.ReceiverFieldCarrier.request",
                surfaceId: "surface.ReceiverFieldCarrier.request",
                assetId: "project.ReceiverFieldCarrier.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                effectTemplateRefs: ["template.ReceiverFieldCarrier.authHeaders.get"],
                semanticsFamily: "fixture.receiver_field",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.ReceiverFieldCarrier.authHeaders.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "object-field",
                    family: "fixture.receiver_field",
                    key: [{ kind: "const", value: "authHeaders" }],
                    owner: [{ kind: "const", value: "ReceiverFieldCarrierFixture" }],
                    precision: "exact",
                },
                value: { base: { kind: "return" } },
                updateStrength: "infer",
                confidence: "likely",
            },
            {
                id: "template.ReceiverFieldCarrier.authHeaders.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "object-field",
                    family: "fixture.receiver_field",
                    key: [{ kind: "const", value: "authHeaders" }],
                    owner: [{ kind: "const", value: "ReceiverFieldCarrierFixture" }],
                    precision: "exact",
                },
                target: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            evidenceLocations: [{ file: "preference_case.ets" }],
        },
    };
}

function projectReceiverConfigAuthHeaderAsset(): AssetDocumentBase {
    return {
        id: "project.ConfigAuthCarrier.module",
        plane: "module",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.ConfigAuthCarrier.buildAuthHeaders",
                kind: "invoke",
                modulePath: "entry/src/main/ets/preference_case.ets",
                ownerName: "ConfigAuthCarrierFixture",
                methodName: "buildAuthHeaders",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
            {
                surfaceId: "surface.ConfigAuthCarrier.request",
                kind: "invoke",
                modulePath: "entry/src/main/ets/preference_case.ets",
                ownerName: "ConfigAuthCarrierFixture",
                methodName: "_request",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
        ],
        bindings: [
            {
                bindingId: "binding.ConfigAuthCarrier.buildAuthHeaders",
                surfaceId: "surface.ConfigAuthCarrier.buildAuthHeaders",
                assetId: "project.ConfigAuthCarrier.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["config", "password"] },
                effectTemplateRefs: ["template.ConfigAuthCarrier.authHeaders.put"],
                semanticsFamily: "fixture.config_auth_carrier",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.ConfigAuthCarrier.request",
                surfaceId: "surface.ConfigAuthCarrier.request",
                assetId: "project.ConfigAuthCarrier.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                effectTemplateRefs: ["template.ConfigAuthCarrier.authHeaders.get"],
                semanticsFamily: "fixture.config_auth_carrier",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.ConfigAuthCarrier.authHeaders.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "object-field",
                    family: "fixture.config_auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                    owner: [{ kind: "const", value: "ConfigAuthCarrierFixture" }],
                    precision: "exact",
                },
                value: { base: { kind: "receiver" }, accessPath: ["config", "password"] },
                updateStrength: "infer",
                confidence: "likely",
            },
            {
                id: "template.ConfigAuthCarrier.authHeaders.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "object-field",
                    family: "fixture.config_auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                    owner: [{ kind: "const", value: "ConfigAuthCarrierFixture" }],
                    precision: "exact",
                },
                target: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            evidenceLocations: [{ file: "preference_case.ets" }],
        },
    };
}

function projectWebDavLikeAuthHeaderAsset(): AssetDocumentBase {
    return {
        id: "project.WebDavLikeAuthCarrier.module",
        plane: "module",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.WebDavLikeAuthCarrier.buildAuthHeaders",
                kind: "invoke",
                modulePath: "entry/src/main/ets/preference_case.ets",
                ownerName: "WebDavLikeAuthCarrierFixture",
                methodName: "buildAuthHeaders",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
            {
                surfaceId: "surface.WebDavLikeAuthCarrier.request",
                kind: "invoke",
                modulePath: "entry/src/main/ets/preference_case.ets",
                ownerName: "WebDavLikeAuthCarrierFixture",
                methodName: "_request",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
        ],
        bindings: [
            {
                bindingId: "binding.WebDavLikeAuthCarrier.buildAuthHeaders",
                surfaceId: "surface.WebDavLikeAuthCarrier.buildAuthHeaders",
                assetId: "project.WebDavLikeAuthCarrier.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["config", "password"] },
                effectTemplateRefs: ["template.WebDavLikeAuthCarrier.authHeaders.put"],
                semanticsFamily: "fixture.webdav_like_auth_carrier",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.WebDavLikeAuthCarrier.request",
                surfaceId: "surface.WebDavLikeAuthCarrier.request",
                assetId: "project.WebDavLikeAuthCarrier.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                effectTemplateRefs: ["template.WebDavLikeAuthCarrier.authHeaders.get"],
                semanticsFamily: "fixture.webdav_like_auth_carrier",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.WebDavLikeAuthCarrier.authHeaders.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "object-field",
                    family: "fixture.webdav_like_auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                    owner: [{ kind: "const", value: "WebDavLikeAuthCarrierFixture" }],
                    precision: "exact",
                },
                value: { base: { kind: "receiver" }, accessPath: ["config", "password"] },
                updateStrength: "weak",
                confidence: "likely",
            },
            {
                id: "template.WebDavLikeAuthCarrier.authHeaders.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "object-field",
                    family: "fixture.webdav_like_auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                    owner: [{ kind: "const", value: "WebDavLikeAuthCarrierFixture" }],
                    precision: "exact",
                },
                target: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            evidenceLocations: [{ file: "preference_case.ets" }],
        },
    };
}

function projectWebDavRealisticAuthHeaderAsset(): AssetDocumentBase {
    return {
        id: "project.WebDavRealisticAuthCarrier.module",
        plane: "module",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.WebDavRealisticAuthCarrier.buildAuthHeaders",
                kind: "invoke",
                modulePath: "entry/src/main/ets/preference_case.ets",
                ownerName: "WebDavRealisticAuthCarrierFixture",
                methodName: "buildAuthHeaders",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
            {
                surfaceId: "surface.WebDavRealisticAuthCarrier.request",
                kind: "invoke",
                modulePath: "entry/src/main/ets/preference_case.ets",
                ownerName: "WebDavRealisticAuthCarrierFixture",
                methodName: "_request",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
        ],
        bindings: [
            {
                bindingId: "binding.WebDavRealisticAuthCarrier.buildAuthHeaders",
                surfaceId: "surface.WebDavRealisticAuthCarrier.buildAuthHeaders",
                assetId: "project.WebDavRealisticAuthCarrier.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["config", "password"] },
                effectTemplateRefs: ["template.WebDavRealisticAuthCarrier.authHeaders.put"],
                semanticsFamily: "fixture.webdav_realistic_auth_carrier",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.WebDavRealisticAuthCarrier.request",
                surfaceId: "surface.WebDavRealisticAuthCarrier.request",
                assetId: "project.WebDavRealisticAuthCarrier.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                effectTemplateRefs: ["template.WebDavRealisticAuthCarrier.authHeaders.get"],
                semanticsFamily: "fixture.webdav_realistic_auth_carrier",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.WebDavRealisticAuthCarrier.authHeaders.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "object-field",
                    family: "fixture.webdav_realistic_auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                    owner: [{ kind: "const", value: "WebDavRealisticAuthCarrierFixture" }],
                    precision: "exact",
                },
                value: { base: { kind: "receiver" }, accessPath: ["config", "password"] },
                updateStrength: "weak",
                confidence: "likely",
            },
            {
                id: "template.WebDavRealisticAuthCarrier.authHeaders.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "object-field",
                    family: "fixture.webdav_realistic_auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                    owner: [{ kind: "const", value: "WebDavRealisticAuthCarrierFixture" }],
                    precision: "exact",
                },
                target: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            evidenceLocations: [{ file: "preference_case.ets" }],
        },
    };
}

function projectConstructorConfigAuthHeaderAsset(): AssetDocumentBase {
    return {
        id: "project.ConstructorConfigAuthCarrier.module",
        plane: "module",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.ConstructorConfigAuthCarrier.constructor",
                kind: "construct",
                modulePath: "entry/src/main/ets/preference_case.ets",
                className: "ConstructorConfigAuthCarrierFixture",
                argCount: 1,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
            {
                surfaceId: "surface.ConstructorConfigAuthCarrier.request",
                kind: "invoke",
                modulePath: "entry/src/main/ets/preference_case.ets",
                ownerName: "ConstructorConfigAuthCarrierFixture",
                methodName: "_request",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "preference_case.ets" } },
            },
        ],
        bindings: [
            {
                bindingId: "binding.ConstructorConfigAuthCarrier.constructor",
                surfaceId: "surface.ConstructorConfigAuthCarrier.constructor",
                assetId: "project.ConstructorConfigAuthCarrier.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 0 }, accessPath: ["password"] },
                effectTemplateRefs: ["template.ConstructorConfigAuthCarrier.authHeaders.put"],
                semanticsFamily: "fixture.constructor_config_auth_carrier",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.ConstructorConfigAuthCarrier.request",
                surfaceId: "surface.ConstructorConfigAuthCarrier.request",
                assetId: "project.ConstructorConfigAuthCarrier.module",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                effectTemplateRefs: ["template.ConstructorConfigAuthCarrier.authHeaders.get"],
                semanticsFamily: "fixture.constructor_config_auth_carrier",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.ConstructorConfigAuthCarrier.authHeaders.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "object-field",
                    family: "fixture.constructor_config_auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                    owner: [{ kind: "const", value: "ConstructorConfigAuthCarrierFixture" }],
                    precision: "exact",
                },
                value: { base: { kind: "arg", index: 0 }, accessPath: ["password"] },
                updateStrength: "weak",
                confidence: "likely",
            },
            {
                id: "template.ConstructorConfigAuthCarrier.authHeaders.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "object-field",
                    family: "fixture.constructor_config_auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                    owner: [{ kind: "const", value: "ConstructorConfigAuthCarrierFixture" }],
                    precision: "exact",
                },
                target: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            evidenceLocations: [{ file: "preference_case.ets" }],
        },
    };
}

function projectEventEmitterAsset(): AssetDocumentBase {
    return {
        id: "project.ProjectEventHub.eventEmitter",
        plane: "module",
        status: "schema-valid",
        surfaces: [
            {
                surfaceId: "surface.ProjectEventHub.on",
                kind: "invoke",
                modulePath: "src/main/ets/event_hub_case.ets",
                ownerName: "ProjectEventHub",
                methodName: "on",
                invokeKind: "static",
                argCount: 2,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "event_hub_case.ets" } },
            },
            {
                surfaceId: "surface.ProjectEventHub.sendEvent",
                kind: "invoke",
                modulePath: "src/main/ets/event_hub_case.ets",
                ownerName: "ProjectEventHub",
                methodName: "sendEvent",
                invokeKind: "static",
                argCount: 1,
                confidence: "likely",
                provenance: { source: "llm-proposal", location: { file: "event_hub_case.ets" } },
            },
        ],
        bindings: [
            {
                bindingId: "binding.ProjectEventHub.eventEmitter",
                surfaceId: "surface.ProjectEventHub.on",
                assetId: "project.ProjectEventHub.eventEmitter",
                plane: "module",
                role: "handoff",
                effectTemplateRefs: ["template.ProjectEventHub.eventEmitter"],
                semanticsFamily: "project.eventhub",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.ProjectEventHub.eventEmitter",
                kind: "module.eventEmitter",
                onMethods: ["on"],
                emitMethods: ["sendEvent"],
                channelArgIndexes: [0],
                payloadArgIndex: -1,
                callbackArgIndex: 1,
                callbackParamIndex: 0,
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            projectId: "event_hub_fixture",
        },
    };
}

async function runCase(
    scene: Scene,
    caseName: string,
    modules: TaintModule[],
    options: { expectFlow?: boolean; sourceRules?: SourceRule[] } = {},
): Promise<number> {
    const sourceRules: SourceRule[] = options.sourceRules || [{
        id: "source.fixture.local.taint_src",
        sourceKind: "seed_local_name",
        target: "matched_param",
        match: { kind: "local_name_regex", value: "^taint_src$" },
    }];
    const sinkRules: SinkRule[] = [{
        id: "sink.fixture.Sink.arg0",
        match: { kind: "method_name_equals", value: "Sink", argCount: 1 },
        target: "arg0",
    }];
    const entry = resolveCaseMethod(scene, "preference_case.ets", caseName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, `missing entry method: ${caseName}`);

    const engine = new TaintPropagationEngine(scene, 1, {
        includeBuiltinModules: false,
        modules,
    });
    engine.verbose = false;
    await engine.buildPAG({
        syntheticEntryMethods: [entryMethod!],
        entryModel: "explicit",
    });
    try {
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
    } catch {
        engine.setActiveReachableMethodSignatures(undefined);
    }

    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules).length;
    if ((options.expectFlow ?? caseName.endsWith("_T")) && flows === 0) {
        const audit = engine.getModuleAuditSnapshot();
        const observedTaintFacts = engine.getObservedTaintFacts();
        const observedFacts = [...observedTaintFacts.entries()]
            .flatMap(([nodeId, facts]) => facts.map(fact => ({
                nodeId,
                field: fact.field?.join(".") || "",
                source: fact.source,
                value: String(fact.node.getValue?.()?.toString?.() || ""),
                method: String(fact.node.getStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || ""),
            })))
            .slice(0, 120);
        const objectAssignProbe = [...observedTaintFacts.entries()]
            .flatMap(([nodeId, facts]) => facts.map(fact => ({ nodeId, fact })))
            .filter(({ fact }) => String(fact.node.getStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "").includes("WebDavRealisticAuthCarrierFixture._request"))
            .map(({ nodeId, fact }) => ({
                nodeId,
                value: String(fact.node.getValue?.()?.toString?.() || ""),
                field: fact.field?.join(".") || "",
                outputs: propagateObjectAssignFieldBridgesByObj(
                    engine.pag,
                    nodeId,
                    fact.field || [],
                    fact.source,
                    fact.contextID,
                    undefined,
                ).map(out => ({
                    nodeId: out.node.getID(),
                    value: String(out.node.getValue?.()?.toString?.() || ""),
                    field: out.field?.join(".") || "",
                })),
            }));
        const syntheticFieldBridgeMap = (engine as any).syntheticFieldBridgeMap as Map<string, unknown[]> | undefined;
        const syntheticFieldBridgeProbe = syntheticFieldBridgeMap
            ? [...syntheticFieldBridgeMap.entries()]
                .filter(([key, bridges]) => key.includes("password") || JSON.stringify(bridges).includes("password"))
                .slice(0, 80)
            : [];
        throw new Error([
            `${caseName} should recover a flow, got 0`,
            `seedCount=${seedInfo.seedCount}`,
            `sourceRuleHits=${JSON.stringify(seedInfo.sourceRuleHits)}`,
            `sourceSeedAudit=${JSON.stringify(seedInfo.sourceSeedAudit.slice(0, 40))}`,
            `loadedModuleIds=${JSON.stringify(audit.loadedModuleIds)}`,
            `moduleStats=${JSON.stringify(audit.moduleStats)}`,
            `observedFacts=${JSON.stringify(observedFacts)}`,
            `objectAssignProbe=${JSON.stringify(objectAssignProbe)}`,
            `syntheticFieldBridgeProbe=${JSON.stringify(syntheticFieldBridgeProbe)}`,
            `requestIr=${JSON.stringify(describeMethodIr(scene, "WebDavRealisticAuthCarrierFixture._request"))}`,
        ].join("\n"));
    }
    return flows;
}

function describeMethodIr(scene: Scene, signatureNeedle: string): unknown[] {
    const method = scene.getMethods().find(m => m.getSignature().toString().includes(signatureNeedle));
    const stmts = method?.getCfg?.()?.getStmts?.() || [];
    return stmts.map((stmt: any) => {
        const entry: Record<string, unknown> = {
            stmt: String(stmt?.toString?.() || ""),
            stmtClass: stmt?.constructor?.name || "",
        };
        const invokeExpr = stmt?.containsInvokeExpr?.() ? stmt.getInvokeExpr?.() : undefined;
        if (invokeExpr) {
            entry.invokeClass = invokeExpr.constructor?.name || "";
            entry.invokeSig = String(invokeExpr.getMethodSignature?.()?.toString?.() || "");
            entry.args = (invokeExpr.getArgs?.() || []).map((arg: any) => ({
                text: String(arg?.toString?.() || ""),
                class: arg?.constructor?.name || "",
                field: String(arg?.getFieldSignature?.()?.getFieldName?.() || arg?.getFieldName?.() || ""),
                base: String(arg?.getBase?.()?.toString?.() || ""),
                baseClass: arg?.getBase?.()?.constructor?.name || "",
            }));
        }
        if (stmt?.getLeftOp || stmt?.getRightOp) {
            const left = stmt.getLeftOp?.();
            const right = stmt.getRightOp?.();
            entry.left = {
                text: String(left?.toString?.() || ""),
                class: left?.constructor?.name || "",
                field: String(left?.getFieldSignature?.()?.getFieldName?.() || left?.getFieldName?.() || ""),
                base: String(left?.getBase?.()?.toString?.() || ""),
            };
            entry.right = {
                text: String(right?.toString?.() || ""),
                class: right?.constructor?.name || "",
                field: String(right?.getFieldSignature?.()?.getFieldName?.() || right?.getFieldName?.() || ""),
                base: String(right?.getBase?.()?.toString?.() || ""),
            };
        }
        return entry;
    });
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("runtime", "module_handoff_effect_asset_lowering");
    const repoRoot = resolveTestRunPath("runtime", "module_handoff_effect_asset_lowering", "fixture");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const eventEmitterLowered = lowerModuleAssetToInternalModuleLoweringIR(projectEventEmitterAsset(), {
        loadMode: "semanticflow-evaluation",
    });
    const eventEmitterSemantic = eventEmitterLowered.semantics.find(semantic => semantic.kind === "event_emitter") as any;
    assert(eventEmitterSemantic, "module.eventEmitter asset should lower to event_emitter semantic");
    assert(eventEmitterSemantic.payloadArgIndex === -1, "module.eventEmitter must preserve no-payload dispatch payloadArgIndex=-1");
    const eventEmitterModules = compileInternalModuleLoweringIR(eventEmitterLowered);
    assert(eventEmitterModules.some(module => module.id.includes("eventEmitter")), "module.eventEmitter semantic should compile to a runtime module");

    writeText(path.join(sourceDir, "preference_case.ets"), [
        "class PreferenceBridge {",
        "  save(scope: string, key: string, value: string): void {}",
        "  load(scope: string, key: string): string { return \"clean\"; }",
        "}",
        "class StaticPreferenceBridge {",
        "  static save(scope: string, key: string, value: string): void {}",
        "  static load(scope: string, key: string): string { return \"clean\"; }",
        "}",
        "enum EventKey {",
        "  LoginWebDav = 10019,",
        "  Other = 10020",
        "}",
        "class ProjectEventHub {",
        "  static on(key: EventKey, callback: (showToast?: boolean) => void): void {}",
        "  static sendEvent(key: EventKey, showToast: boolean = false): void {}",
        "}",
        "class ReceiverFieldCarrierFixture {",
        "  authHeaders: string = \"\";",
        "  otherHeaders: string = \"\";",
        "",
        "  buildAuthHeaders(value: string): string {",
        "    return value;",
        "  }",
        "",
        "  init(value: string): void {",
        "    this.authHeaders = this.buildAuthHeaders(value);",
        "  }",
        "",
        "  _request(): void {",
        "    const finalHeaders = this.authHeaders;",
        "    Sink(finalHeaders);",
        "  }",
        "",
        "  _requestOther(): void {",
        "    const finalHeaders = this.otherHeaders;",
        "    Sink(finalHeaders);",
        "  }",
        "}",
        "class ConfigAuthCarrierFixture {",
        "  config: { user: string; password: string; server: string } = { user: \"\", password: \"\", server: \"\" };",
        "  authHeaders: string = \"\";",
        "  otherHeaders: string = \"\";",
        "",
        "  buildAuthHeaders(): string {",
        "    return `Basic ${this.config.user}:${this.config.password}`;",
        "  }",
        "",
        "  _request(): void {",
        "    const finalHeaders = this.authHeaders;",
        "    Sink(finalHeaders);",
        "  }",
        "",
        "  _requestOther(): void {",
        "    const finalHeaders = this.otherHeaders;",
        "    Sink(finalHeaders);",
        "  }",
        "}",
        "class ConstructorConfigAuthCarrierFixture {",
        "  config: { user: string; password: string; server: string };",
        "  authHeaders: string = \"\";",
        "  otherHeaders: string = \"\";",
        "",
        "  constructor(config: { user: string; password: string; server: string }) {",
        "    this.config = config;",
        "    this.authHeaders = \"clean\";",
        "  }",
        "",
        "  _request(): void {",
        "    const finalHeaders = this.authHeaders;",
        "    Sink(finalHeaders);",
        "  }",
        "",
        "  _requestOther(): void {",
        "    const finalHeaders = this.otherHeaders;",
        "    Sink(finalHeaders);",
        "  }",
        "}",
        "class WebDavLikeAuthCarrierFixture {",
        "  config: { user: string; password: string; server: string };",
        "  authHeaders: string = \"\";",
        "  otherHeaders: string = \"\";",
        "",
        "  constructor(config: { user: string; password: string; server: string }) {",
        "    this.config = config;",
        "    this.authHeaders = this.buildAuthHeaders();",
        "  }",
        "",
        "  buildAuthHeaders(): string {",
        "    return `Basic ${this.config.user}:${this.config.password}`;",
        "  }",
        "",
        "  _request(): void {",
        "    const finalHeaders = this.authHeaders;",
        "    Sink(finalHeaders);",
        "  }",
        "",
        "  _requestOther(): void {",
        "    const finalHeaders = this.otherHeaders;",
        "    Sink(finalHeaders);",
        "  }",
        "}",
        "class WebDavRealisticAuthCarrierFixture {",
        "  config: { username: string; password: string; server: string; authType: string };",
        "  authHeaders: { Authorization?: string } = {};",
        "  otherHeaders: { Authorization?: string } = {};",
        "",
        "  constructor(config: { username: string; password: string; server: string; authType: string }) {",
        "    this.config = config;",
        "    this.authHeaders = this.buildAuthHeaders();",
        "  }",
        "",
        "  encode(value: string): string {",
        "    return `encoded:${value}`;",
        "  }",
        "",
        "  buildAuthHeaders(): { Authorization?: string } {",
        "    if (this.config.authType === \"basic\" && this.config.username && this.config.password) {",
        "      const credentials: string = `${this.config.username}:${this.config.password}`;",
        "      const base64: string = this.encode(credentials);",
        "      return { Authorization: `Basic ${base64}` };",
        "    }",
        "    return {};",
        "  }",
        "",
        "  _request(): void {",
        "    const finalHeaders: { Authorization?: string } = {};",
        "    if (this.authHeaders) {",
        "      Object.assign(finalHeaders, this.authHeaders);",
        "    }",
        "    Sink(finalHeaders.Authorization || \"\");",
        "  }",
        "",
        "  _requestOther(): void {",
        "    const finalHeaders: { Authorization?: string } = {};",
        "    if (this.otherHeaders) {",
        "      Object.assign(finalHeaders, this.otherHeaders);",
        "    }",
        "    Sink(finalHeaders.Authorization || \"\");",
        "  }",
        "}",
        "",
        "function Sink(value: string): void {}",
        "",
        "export function same_key_T(): void {",
        "  const bridge = new PreferenceBridge();",
        "  const taint_src = \"secret\";",
        "  bridge.save(\"profile\", \"token\", taint_src);",
        "  const observed = bridge.load(\"profile\", \"token\");",
        "  Sink(observed);",
        "}",
        "",
        "export function other_key_F(): void {",
        "  const bridge = new PreferenceBridge();",
        "  const taint_src = \"secret\";",
        "  bridge.save(\"profile\", \"token\", taint_src);",
        "  const observed = bridge.load(\"profile\", \"role\");",
        "  Sink(observed);",
        "}",
        "",
        "export function static_same_key_T(): void {",
        "  const taint_src = \"secret\";",
        "  StaticPreferenceBridge.save(\"profile\", \"token\", taint_src);",
        "  const observed = StaticPreferenceBridge.load(\"profile\", \"token\");",
        "  Sink(observed);",
        "}",
        "",
        "export function static_other_key_F(): void {",
        "  const taint_src = \"secret\";",
        "  StaticPreferenceBridge.save(\"profile\", \"token\", taint_src);",
        "  const observed = StaticPreferenceBridge.load(\"profile\", \"role\");",
        "  Sink(observed);",
        "}",
        "",
        "export function object_field_receiver_carrier_T(): void {",
        "  const fixture = new ReceiverFieldCarrierFixture();",
        "  const taint_src = \"secret\";",
        "  fixture.init(taint_src);",
        "  fixture._request();",
        "}",
        "",
        "export function object_field_receiver_carrier_other_field_F(): void {",
        "  const fixture = new ReceiverFieldCarrierFixture();",
        "  const taint_src = \"secret\";",
        "  fixture.init(taint_src);",
        "  fixture._requestOther();",
        "}",
        "",
        "export function object_field_module_only_carrier_T(): void {",
        "  const fixture = new ReceiverFieldCarrierFixture();",
        "  const taint_src = \"secret\";",
        "  const generated = fixture.buildAuthHeaders(taint_src);",
        "  const ignored = generated.length;",
        "  fixture._request();",
        "}",
        "",
        "export function object_field_module_only_other_field_F(): void {",
        "  const fixture = new ReceiverFieldCarrierFixture();",
        "  const taint_src = \"secret\";",
        "  const generated = fixture.buildAuthHeaders(taint_src);",
        "  const ignored = generated.length;",
        "  fixture._requestOther();",
        "}",
        "",
        "export function receiver_config_password_to_auth_header_T(): void {",
        "  const fixture = new ConfigAuthCarrierFixture();",
        "  const taint_src = \"secret\";",
        "  fixture.config.password = taint_src;",
        "  const generated = fixture.buildAuthHeaders();",
        "  const ignored = generated.length;",
        "  fixture._request();",
        "}",
        "",
        "export function receiver_config_server_not_password_F(): void {",
        "  const fixture = new ConfigAuthCarrierFixture();",
        "  const taint_src = \"secret\";",
        "  fixture.config.server = taint_src;",
        "  const generated = fixture.buildAuthHeaders();",
        "  const ignored = generated.length;",
        "  fixture._request();",
        "}",
        "",
        "export function receiver_config_password_other_field_F(): void {",
        "  const fixture = new ConfigAuthCarrierFixture();",
        "  const taint_src = \"secret\";",
        "  fixture.config.password = taint_src;",
        "  const generated = fixture.buildAuthHeaders();",
        "  const ignored = generated.length;",
        "  fixture._requestOther();",
        "}",
        "",
        "export function receiver_config_method_body_field_source_to_auth_header_T(): void {",
        "  const fixture = new ConfigAuthCarrierFixture();",
        "  const generated = fixture.buildAuthHeaders();",
        "  const ignored = generated.length;",
        "  fixture._request();",
        "}",
        "",
        "export function receiver_config_method_body_field_source_other_field_F(): void {",
        "  const fixture = new ConfigAuthCarrierFixture();",
        "  const generated = fixture.buildAuthHeaders();",
        "  const ignored = generated.length;",
        "  fixture._requestOther();",
        "}",
        "",
        "export function constructor_config_password_to_auth_header_T(): void {",
        "  const taint_src = \"secret\";",
        "  const config = { user: \"clean_user\", password: taint_src, server: \"clean_server\" };",
        "  const fixture = new ConstructorConfigAuthCarrierFixture(config);",
        "  fixture._request();",
        "}",
        "",
        "export function constructor_config_server_not_password_F(): void {",
        "  const taint_src = \"secret\";",
        "  const config = { user: \"clean_user\", password: \"clean_password\", server: taint_src };",
        "  const fixture = new ConstructorConfigAuthCarrierFixture(config);",
        "  fixture._request();",
        "}",
        "",
        "export function constructor_config_password_other_field_F(): void {",
        "  const taint_src = \"secret\";",
        "  const config = { user: \"clean_user\", password: taint_src, server: \"clean_server\" };",
        "  const fixture = new ConstructorConfigAuthCarrierFixture(config);",
        "  fixture._requestOther();",
        "}",
        "",
        "export function namespace_same_key_T(): void {",
        "  const taint_src = \"secret\";",
        "  ExternalPreferenceBridge.save(\"profile\", \"token\", taint_src);",
        "  const observed = ExternalPreferenceBridge.load(\"profile\", \"token\");",
        "  Sink(observed);",
        "}",
        "",
        "export function namespace_other_key_F(): void {",
        "  const taint_src = \"secret\";",
        "  ExternalPreferenceBridge.save(\"profile\", \"token\", taint_src);",
        "  const observed = ExternalPreferenceBridge.load(\"profile\", \"role\");",
        "  Sink(observed);",
        "}",
        "",
        "export async function namespace_await_same_key_T(): Promise<void> {",
        "  const taint_src = \"secret\";",
        "  ExternalPreferenceBridge.save(\"profile\", \"token\", taint_src);",
        "  const observed = await ExternalPreferenceBridge.loadAsync(\"profile\", \"token\") as string ?? \"\";",
        "  Sink(observed);",
        "}",
        "",
        "export async function namespace_await_other_key_F(): Promise<void> {",
        "  const taint_src = \"secret\";",
        "  ExternalPreferenceBridge.save(\"profile\", \"token\", taint_src);",
        "  const observed = await ExternalPreferenceBridge.loadAsync(\"profile\", \"role\") as string ?? \"\";",
        "  Sink(observed);",
        "}",
        "",
        "class BackupConfigFixture {",
        "  user: string = \"\";",
        "  password: string = \"\";",
        "  server: string = \"\";",
        "",
        "  async loadUserTemplate_T(): Promise<void> {",
        "    const taint_src = \"secret\";",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_user\", taint_src);",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_password\", \"clean_password\");",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_server_address\", \"clean_server\");",
        "    this.user = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_user\") as string ?? \"\";",
        "    this.password = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_password\") as string ?? \"\";",
        "    this.server = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_server_address\") as string ?? \"\";",
        "    Sink(`user:${this.user}; password:${this.password}; server:${this.server}`);",
        "  }",
        "",
        "  async loadPasswordTemplate_T(): Promise<void> {",
        "    const taint_src = \"secret\";",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_user\", \"clean_user\");",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_password\", taint_src);",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_server_address\", \"clean_server\");",
        "    this.user = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_user\") as string ?? \"\";",
        "    this.password = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_password\") as string ?? \"\";",
        "    this.server = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_server_address\") as string ?? \"\";",
        "    Sink(`user:${this.user}; password:${this.password}; server:${this.server}`);",
        "  }",
        "",
        "  async loadServerTemplate_T(): Promise<void> {",
        "    const taint_src = \"secret\";",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_user\", \"clean_user\");",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_password\", \"clean_password\");",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_server_address\", taint_src);",
        "    this.user = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_user\") as string ?? \"\";",
        "    this.password = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_password\") as string ?? \"\";",
        "    this.server = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_server_address\") as string ?? \"\";",
        "    Sink(`user:${this.user}; password:${this.password}; server:${this.server}`);",
        "  }",
        "",
        "  async loadOtherKeyTemplate_F(): Promise<void> {",
        "    const taint_src = \"secret\";",
        "    ExternalPreferenceBridge.save(\"profile\", \"other\", taint_src);",
        "    this.user = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_user\") as string ?? \"\";",
        "    this.password = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_password\") as string ?? \"\";",
        "    this.server = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_server_address\") as string ?? \"\";",
        "    Sink(`user:${this.user}; password:${this.password}; server:${this.server}`);",
        "  }",
        "}",
        "",
        "export async function namespace_await_template_user_field_T(): Promise<void> {",
        "  const fixture = new BackupConfigFixture();",
        "  await fixture.loadUserTemplate_T();",
        "}",
        "",
        "export async function namespace_await_template_password_field_T(): Promise<void> {",
        "  const fixture = new BackupConfigFixture();",
        "  await fixture.loadPasswordTemplate_T();",
        "}",
        "",
        "export async function namespace_await_template_server_field_T(): Promise<void> {",
        "  const fixture = new BackupConfigFixture();",
        "  await fixture.loadServerTemplate_T();",
        "}",
        "",
        "export async function namespace_await_template_other_key_F(): Promise<void> {",
        "  const fixture = new BackupConfigFixture();",
        "  await fixture.loadOtherKeyTemplate_F();",
        "}",
        "",
        "class BoundBackupConfigFixture {",
        "  user: string = \"\";",
        "  password: string = \"\";",
        "  server: string = \"\";",
        "",
        "  bindUser(): void {",
        "    TextInput({ text: $$this.user, placeholder: \"user\" });",
        "    this.password = \"clean_password\";",
        "    this.server = \"clean_server\";",
        "  }",
        "",
        "  bindPassword(): void {",
        "    this.user = \"clean_user\";",
        "    TextInput({ text: $$this.password, placeholder: \"password\" });",
        "    this.server = \"clean_server\";",
        "  }",
        "",
        "  bindServer(): void {",
        "    this.user = \"clean_user\";",
        "    this.password = \"clean_password\";",
        "    TextInput({ text: $$this.server, placeholder: \"server\" });",
        "  }",
        "",
        "  bindNone(): void {",
        "    TextInput({ text: this.user, placeholder: \"plain_user\" });",
        "    this.password = \"clean_password\";",
        "    this.server = \"clean_server\";",
        "  }",
        "",
        "  bindAll(): void {",
        "    TextInput({ text: $$this.user, placeholder: \"user\" });",
        "    TextInput({ text: $$this.password, placeholder: \"password\" });",
        "    TextInput({ text: $$this.server, placeholder: \"server\" });",
        "  }",
        "",
        "  async persistAndRenderTemplate(): Promise<void> {",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_user\", this.user);",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_password\", this.password);",
        "    ExternalPreferenceBridge.save(\"profile\", \"webdav_server_address\", this.server);",
        "    this.user = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_user\") as string ?? \"\";",
        "    this.password = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_password\") as string ?? \"\";",
        "    this.server = await ExternalPreferenceBridge.loadAsync(\"profile\", \"webdav_server_address\") as string ?? \"\";",
        "    Sink(`user:${this.user}; password:${this.password}; server:${this.server}`);",
        "  }",
        "",
        "  requestConstructorConfig(): void {",
        "    const config = { user: this.user, password: this.password, server: this.server };",
        "    const fixture = new ConstructorConfigAuthCarrierFixture(config);",
        "    fixture._request();",
        "  }",
        "",
        "  requestConstructorConfigOtherField(): void {",
        "    const config = { user: this.user, password: this.password, server: this.server };",
        "    const fixture = new ConstructorConfigAuthCarrierFixture(config);",
        "    fixture._requestOther();",
        "  }",
        "",
        "  aboutToAppearRegisterWebDav(): void {",
        "    ProjectEventHub.on(EventKey.LoginWebDav, (showToast: boolean = false) => {",
        "      const config = { user: this.user, password: this.password, server: this.server };",
        "      const fixture = new ConstructorConfigAuthCarrierFixture(config);",
        "      fixture._request();",
        "    });",
        "  }",
        "",
        "  aboutToAppearRegisterWebDavOtherField(): void {",
        "    ProjectEventHub.on(EventKey.LoginWebDav, (showToast: boolean = false) => {",
        "      const config = { user: this.user, password: this.password, server: this.server };",
        "      const fixture = new ConstructorConfigAuthCarrierFixture(config);",
        "      fixture._requestOther();",
        "    });",
        "  }",
        "",
        "  aboutToAppearRegisterWebDavLike(): void {",
        "    ProjectEventHub.on(EventKey.LoginWebDav, (showToast: boolean = false) => {",
        "      const config = { user: this.user, password: this.password, server: this.server };",
        "      const fixture = new WebDavLikeAuthCarrierFixture(config);",
        "      fixture._request();",
        "    });",
        "  }",
        "",
        "  aboutToAppearRegisterWebDavRealistic(): void {",
        "    ProjectEventHub.on(EventKey.LoginWebDav, (showToast: boolean = false) => {",
        "      const config = { username: this.user, password: this.password, server: this.server, authType: \"basic\" };",
        "      const fixture = new WebDavRealisticAuthCarrierFixture(config);",
        "      fixture._request();",
        "    });",
        "  }",
        "}",
        "class StorageLinkedBackupConfigFixture {",
        "  @StorageLink('User') user: string = \"\";",
        "  @StorageLink('Password') password: string = \"\";",
        "  @StorageLink('Server') server: string = \"\";",
        "",
        "  bindPassword(): void {",
        "    this.user = \"clean_user\";",
        "    TextInput({ text: $$this.password, placeholder: \"password\" });",
        "    this.server = \"clean_server\";",
        "  }",
        "",
        "  bindServer(): void {",
        "    this.user = \"clean_user\";",
        "    this.password = \"clean_password\";",
        "    TextInput({ text: $$this.server, placeholder: \"server\" });",
        "  }",
        "",
        "  aboutToAppearRegisterWebDav(): void {",
        "    ProjectEventHub.on(EventKey.LoginWebDav, (showToast: boolean = false) => {",
        "      const config = { user: this.user, password: this.password, server: this.server };",
        "      const fixture = new ConstructorConfigAuthCarrierFixture(config);",
        "      fixture._request();",
        "    });",
        "  }",
        "",
        "  aboutToAppearRegisterWebDavLike(): void {",
        "    ProjectEventHub.on(EventKey.LoginWebDav, (showToast: boolean = false) => {",
        "      const config = { user: this.user, password: this.password, server: this.server };",
        "      const fixture = new WebDavLikeAuthCarrierFixture(config);",
        "      fixture._request();",
        "    });",
        "  }",
        "",
        "  aboutToAppearRegisterWebDavRealistic(): void {",
        "    ProjectEventHub.on(EventKey.LoginWebDav, (showToast: boolean = false) => {",
        "      const config = { username: this.user, password: this.password, server: this.server, authType: \"basic\" };",
        "      const fixture = new WebDavRealisticAuthCarrierFixture(config);",
        "      fixture._request();",
        "    });",
        "  }",
        "}",
        "",
        "export async function namespace_boundstate_handoff_user_template_T(): Promise<void> {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindUser();",
        "  await fixture.persistAndRenderTemplate();",
        "}",
        "",
        "export async function namespace_boundstate_handoff_password_template_T(): Promise<void> {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindPassword();",
        "  await fixture.persistAndRenderTemplate();",
        "}",
        "",
        "export async function namespace_boundstate_handoff_server_template_T(): Promise<void> {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindServer();",
        "  await fixture.persistAndRenderTemplate();",
        "}",
        "",
        "export async function namespace_boundstate_handoff_plain_value_F(): Promise<void> {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindNone();",
        "  await fixture.persistAndRenderTemplate();",
        "}",
        "",
        "export async function namespace_boundstate_handoff_all_fields_template_T(): Promise<void> {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindAll();",
        "  await fixture.persistAndRenderTemplate();",
        "}",
        "",
        "export function boundstate_constructor_config_password_to_auth_header_T(): void {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindPassword();",
        "  fixture.requestConstructorConfig();",
        "}",
        "",
        "export function boundstate_constructor_config_server_not_password_F(): void {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindServer();",
        "  fixture.requestConstructorConfig();",
        "}",
        "",
        "export function boundstate_constructor_config_plain_value_F(): void {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindNone();",
        "  fixture.requestConstructorConfig();",
        "}",
        "",
        "export function boundstate_constructor_config_password_other_field_F(): void {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindPassword();",
        "  fixture.requestConstructorConfigOtherField();",
        "}",
        "",
        "export function eventhub_boundstate_constructor_config_password_to_auth_header_T(): void {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindPassword();",
        "  fixture.aboutToAppearRegisterWebDav();",
        "  ProjectEventHub.sendEvent(EventKey.LoginWebDav, true);",
        "}",
        "",
        "export function eventhub_boundstate_constructor_config_server_not_password_F(): void {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindServer();",
        "  fixture.aboutToAppearRegisterWebDav();",
        "  ProjectEventHub.sendEvent(EventKey.LoginWebDav, true);",
        "}",
        "",
        "export function eventhub_boundstate_constructor_config_password_other_field_F(): void {",
        "  const fixture = new BoundBackupConfigFixture();",
        "  fixture.bindPassword();",
        "  fixture.aboutToAppearRegisterWebDavOtherField();",
        "  ProjectEventHub.sendEvent(EventKey.LoginWebDav, true);",
        "}",
        "",
        "export function storage_link_eventhub_constructor_config_password_to_auth_header_T(): void {",
        "  const fixture = new StorageLinkedBackupConfigFixture();",
        "  fixture.bindPassword();",
        "  fixture.aboutToAppearRegisterWebDav();",
        "  ProjectEventHub.sendEvent(EventKey.LoginWebDav, true);",
        "}",
        "",
        "export function storage_link_eventhub_constructor_config_server_not_password_F(): void {",
        "  const fixture = new StorageLinkedBackupConfigFixture();",
        "  fixture.bindServer();",
        "  fixture.aboutToAppearRegisterWebDav();",
        "  ProjectEventHub.sendEvent(EventKey.LoginWebDav, true);",
        "}",
        "",
        "export function storage_link_eventhub_webdav_like_password_to_auth_header_T(): void {",
        "  const fixture = new StorageLinkedBackupConfigFixture();",
        "  fixture.bindPassword();",
        "  fixture.aboutToAppearRegisterWebDavLike();",
        "  ProjectEventHub.sendEvent(EventKey.LoginWebDav, true);",
        "}",
        "",
        "export function storage_link_eventhub_webdav_like_server_not_password_F(): void {",
        "  const fixture = new StorageLinkedBackupConfigFixture();",
        "  fixture.bindServer();",
        "  fixture.aboutToAppearRegisterWebDavLike();",
        "  ProjectEventHub.sendEvent(EventKey.LoginWebDav, true);",
        "}",
        "",
        "export function storage_link_eventhub_webdav_realistic_password_to_auth_header_T(): void {",
        "  const fixture = new StorageLinkedBackupConfigFixture();",
        "  fixture.bindPassword();",
        "  fixture.aboutToAppearRegisterWebDavRealistic();",
        "  ProjectEventHub.sendEvent(EventKey.LoginWebDav, true);",
        "}",
        "",
        "export function storage_link_eventhub_webdav_realistic_server_not_password_F(): void {",
        "  const fixture = new StorageLinkedBackupConfigFixture();",
        "  fixture.bindServer();",
        "  fixture.aboutToAppearRegisterWebDavRealistic();",
        "  ProjectEventHub.sendEvent(EventKey.LoginWebDav, true);",
        "}",
        "",
    ].join("\n"));

    const lowered = lowerModuleAssetToInternalModuleLoweringIR(projectHandoffAsset(), {
        loadMode: "semanticflow-evaluation",
    });
    assert(lowered.semantics.some(semantic => semantic.kind === "handoff_effect"), "module handoff asset should lower to handoff_effect semantic");
    const modules = compileInternalModuleLoweringIR(lowered);
    assert(modules.some(module => module.id.includes("handoff.effects")), "handoff_effect semantic should compile to a runtime module");

    const scene = buildScene(repoRoot);
    const sameKey = await runCase(scene, "same_key_T", modules);
    const otherKey = await runCase(scene, "other_key_F", modules);
    assert(otherKey === 0, `different key should not recover a flow, got ${otherKey}`);

    const staticLowered = lowerModuleAssetToInternalModuleLoweringIR(projectStaticHandoffAsset(), {
        loadMode: "semanticflow-evaluation",
    });
    assert(staticLowered.semantics.some(semantic => semantic.kind === "handoff_effect"), "static module handoff asset should lower to handoff_effect semantic");
    const staticModules = compileInternalModuleLoweringIR(staticLowered);
    assert(staticModules.some(module => module.id.includes("handoff.effects")), "static handoff_effect semantic should compile to a runtime module");
    const staticSameKey = await runCase(scene, "static_same_key_T", staticModules);
    const staticOtherKey = await runCase(scene, "static_other_key_F", staticModules);
    assert(staticSameKey > 0, `static same key should recover a flow, got ${staticSameKey}`);
    assert(staticOtherKey === 0, `static different key should not recover a flow, got ${staticOtherKey}`);
    const staticNamespaceCase = await runCase(scene, "namespace_same_key_T", staticModules, { expectFlow: false });
    assert(staticNamespaceCase === 0, `static asset must not match unresolved namespace-style instance invoke, got ${staticNamespaceCase}`);

    const objectFieldLowered = lowerModuleAssetToInternalModuleLoweringIR(projectObjectFieldHandoffAsset(), {
        loadMode: "semanticflow-evaluation",
    });
    assert(objectFieldLowered.semantics.some(semantic => semantic.kind === "handoff_effect"), "object-field module handoff asset should lower to handoff_effect semantic");
    const objectFieldModules = compileInternalModuleLoweringIR(objectFieldLowered);
    assert(objectFieldModules.some(module => module.id.includes("handoff.effects")), "object-field handoff_effect semantic should compile to a runtime module");
    const objectFieldCarrier = await runCase(scene, "object_field_receiver_carrier_T", objectFieldModules);
    const objectFieldOther = await runCase(scene, "object_field_receiver_carrier_other_field_F", objectFieldModules, { expectFlow: false });
    const objectFieldModuleOnly = await runCase(scene, "object_field_module_only_carrier_T", objectFieldModules);
    const objectFieldModuleOnlyOther = await runCase(scene, "object_field_module_only_other_field_F", objectFieldModules, { expectFlow: false });
    assert(objectFieldCarrier > 0, `object-field receiver carrier should recover a flow, got ${objectFieldCarrier}`);
    assert(objectFieldOther === 0, `object-field receiver carrier must not taint sibling field, got ${objectFieldOther}`);
    assert(objectFieldModuleOnly > 0, `object-field module-only carrier should recover a flow, got ${objectFieldModuleOnly}`);
    assert(objectFieldModuleOnlyOther === 0, `object-field module-only carrier must not taint sibling field, got ${objectFieldModuleOnlyOther}`);

    const receiverConfigLowered = lowerModuleAssetToInternalModuleLoweringIR(projectReceiverConfigAuthHeaderAsset(), {
        loadMode: "semanticflow-evaluation",
    });
    assert(receiverConfigLowered.semantics.some(semantic => semantic.kind === "handoff_effect"), "receiver-config object-field asset should lower to handoff_effect semantic");
    const receiverConfigModules = compileInternalModuleLoweringIR(receiverConfigLowered);
    assert(receiverConfigModules.some(module => module.id.includes("handoff.effects")), "receiver-config object-field semantic should compile to a runtime module");
    const receiverConfigPassword = await runCase(scene, "receiver_config_password_to_auth_header_T", receiverConfigModules);
    const receiverConfigServerOnly = await runCase(scene, "receiver_config_server_not_password_F", receiverConfigModules, { expectFlow: false });
    const receiverConfigOtherField = await runCase(scene, "receiver_config_password_other_field_F", receiverConfigModules, { expectFlow: false });
    const receiverConfigMethodBodySource = await runCase(scene, "receiver_config_method_body_field_source_to_auth_header_T", receiverConfigModules, {
        sourceRules: buildAuthHeadersPasswordFieldSourceRules(),
    });
    const receiverConfigMethodBodyOtherField = await runCase(scene, "receiver_config_method_body_field_source_other_field_F", receiverConfigModules, {
        expectFlow: false,
        sourceRules: buildAuthHeadersPasswordFieldSourceRules(),
    });
    assert(receiverConfigPassword > 0, `receiver config.password should recover authHeaders flow, got ${receiverConfigPassword}`);
    assert(receiverConfigServerOnly === 0, `receiver config.server must not satisfy config.password carrier, got ${receiverConfigServerOnly}`);
    assert(receiverConfigOtherField === 0, `receiver config.password must not taint sibling output field, got ${receiverConfigOtherField}`);
    assert(receiverConfigMethodBodySource > 0, `callee-body receiver config.password field source should recover authHeaders flow, got ${receiverConfigMethodBodySource}`);
    assert(receiverConfigMethodBodyOtherField === 0, `callee-body receiver config.password field source must not taint sibling output field, got ${receiverConfigMethodBodyOtherField}`);

    const webDavLikeLowered = lowerModuleAssetToInternalModuleLoweringIR(projectWebDavLikeAuthHeaderAsset(), {
        loadMode: "semanticflow-evaluation",
    });
    assert(webDavLikeLowered.semantics.some(semantic => semantic.kind === "handoff_effect"), "WebDav-like receiver-config asset should lower to handoff_effect semantic");
    const webDavLikeModules = compileInternalModuleLoweringIR(webDavLikeLowered);
    assert(webDavLikeModules.some(module => module.id.includes("handoff.effects")), "WebDav-like receiver-config semantic should compile to a runtime module");

    const webDavRealisticLowered = lowerModuleAssetToInternalModuleLoweringIR(projectWebDavRealisticAuthHeaderAsset(), {
        loadMode: "semanticflow-evaluation",
    });
    assert(webDavRealisticLowered.semantics.some(semantic => semantic.kind === "handoff_effect"), "WebDav realistic receiver-config asset should lower to handoff_effect semantic");
    const webDavRealisticModules = compileInternalModuleLoweringIR(webDavRealisticLowered);
    assert(webDavRealisticModules.some(module => module.id.includes("handoff.effects")), "WebDav realistic receiver-config semantic should compile to a runtime module");

    const constructorConfigLowered = lowerModuleAssetToInternalModuleLoweringIR(projectConstructorConfigAuthHeaderAsset(), {
        loadMode: "semanticflow-evaluation",
    });
    assert(constructorConfigLowered.semantics.some(semantic => semantic.kind === "handoff_effect"), "constructor-config object-field asset should lower to handoff_effect semantic");
    const constructorConfigModules = compileInternalModuleLoweringIR(constructorConfigLowered);
    assert(constructorConfigModules.some(module => module.id.includes("handoff.effects")), "constructor-config object-field semantic should compile to a runtime module");
    const constructorConfigPassword = await runCase(scene, "constructor_config_password_to_auth_header_T", constructorConfigModules);
    const constructorConfigServerOnly = await runCase(scene, "constructor_config_server_not_password_F", constructorConfigModules, { expectFlow: false });
    const constructorConfigOtherField = await runCase(scene, "constructor_config_password_other_field_F", constructorConfigModules, { expectFlow: false });
    assert(constructorConfigPassword > 0, `constructor arg0.password should recover authHeaders flow, got ${constructorConfigPassword}`);
    assert(constructorConfigServerOnly === 0, `constructor arg0.server must not satisfy arg0.password carrier, got ${constructorConfigServerOnly}`);
    assert(constructorConfigOtherField === 0, `constructor arg0.password must not taint sibling output field, got ${constructorConfigOtherField}`);

    const namespaceLowered = lowerModuleAssetToInternalModuleLoweringIR(projectNamespaceHandoffAsset(), {
        loadMode: "semanticflow-evaluation",
    });
    assert(namespaceLowered.semantics.some(semantic => semantic.kind === "handoff_effect"), "namespace module handoff asset should lower to handoff_effect semantic");
    const namespaceModules = compileInternalModuleLoweringIR(namespaceLowered);
    assert(namespaceModules.some(module => module.id.includes("handoff.effects")), "namespace handoff_effect semantic should compile to a runtime module");
    const namespaceSameKey = await runCase(scene, "namespace_same_key_T", namespaceModules);
    const namespaceOtherKey = await runCase(scene, "namespace_other_key_F", namespaceModules);
    assert(namespaceSameKey > 0, `namespace same key should recover a flow over unresolved imported-owner callsites, got ${namespaceSameKey}`);
    assert(namespaceOtherKey === 0, `namespace different key should not recover a flow, got ${namespaceOtherKey}`);
    const namespaceAwaitSameKey = await runCase(scene, "namespace_await_same_key_T", namespaceModules);
    const namespaceAwaitOtherKey = await runCase(scene, "namespace_await_other_key_F", namespaceModules);
    assert(namespaceAwaitSameKey > 0, `namespace await same key should recover a flow through promiseResult, got ${namespaceAwaitSameKey}`);
    assert(namespaceAwaitOtherKey === 0, `namespace await different key should not recover a flow, got ${namespaceAwaitOtherKey}`);
    const templateUserField = await runCase(scene, "namespace_await_template_user_field_T", namespaceModules);
    const templatePasswordField = await runCase(scene, "namespace_await_template_password_field_T", namespaceModules);
    const templateServerField = await runCase(scene, "namespace_await_template_server_field_T", namespaceModules);
    const templateOtherKey = await runCase(scene, "namespace_await_template_other_key_F", namespaceModules);
    assert(templateUserField > 0, `namespace await template user field should recover a flow, got ${templateUserField}`);
    assert(templatePasswordField > 0, `namespace await template password field should recover a flow, got ${templatePasswordField}`);
    assert(templateServerField > 0, `namespace await template server field should recover a flow, got ${templateServerField}`);
    assert(templateOtherKey === 0, `namespace await template other key should not recover a flow, got ${templateOtherKey}`);
    const boundStateSourceRules = buildFrameworkBoundStateSourceRules()
        .filter(rule => rule.id === "source.harmony.input.textinput.text_binding");
    const boundUserTemplate = await runCase(scene, "namespace_boundstate_handoff_user_template_T", namespaceModules, { sourceRules: boundStateSourceRules });
    const boundPasswordTemplate = await runCase(scene, "namespace_boundstate_handoff_password_template_T", namespaceModules, { sourceRules: boundStateSourceRules });
    const boundServerTemplate = await runCase(scene, "namespace_boundstate_handoff_server_template_T", namespaceModules, { sourceRules: boundStateSourceRules });
    const boundPlainValue = await runCase(scene, "namespace_boundstate_handoff_plain_value_F", namespaceModules, {
        expectFlow: false,
        sourceRules: boundStateSourceRules,
    });
    const boundAllFieldsTemplate = await runCase(scene, "namespace_boundstate_handoff_all_fields_template_T", namespaceModules, { sourceRules: boundStateSourceRules });
    assert(boundUserTemplate > 0, `bound-state user field should cross project handoff into template sink, got ${boundUserTemplate}`);
    assert(boundPasswordTemplate > 0, `bound-state password field should cross project handoff into template sink, got ${boundPasswordTemplate}`);
    assert(boundServerTemplate > 0, `bound-state server field should cross project handoff into template sink, got ${boundServerTemplate}`);
    assert(boundPlainValue === 0, `plain TextInput value must not seed bound-state handoff flow, got ${boundPlainValue}`);
    assert(boundAllFieldsTemplate >= 3, `three bound-state source occurrences should remain distinguishable at one template sink, got ${boundAllFieldsTemplate}`);

    const boundConstructorPassword = await runCase(scene, "boundstate_constructor_config_password_to_auth_header_T", constructorConfigModules, { sourceRules: boundStateSourceRules });
    const boundConstructorServerOnly = await runCase(scene, "boundstate_constructor_config_server_not_password_F", constructorConfigModules, {
        expectFlow: false,
        sourceRules: boundStateSourceRules,
    });
    const boundConstructorPlainValue = await runCase(scene, "boundstate_constructor_config_plain_value_F", constructorConfigModules, {
        expectFlow: false,
        sourceRules: boundStateSourceRules,
    });
    const boundConstructorOtherField = await runCase(scene, "boundstate_constructor_config_password_other_field_F", constructorConfigModules, {
        expectFlow: false,
        sourceRules: boundStateSourceRules,
    });
    assert(boundConstructorPassword > 0, `bound-state password should reach constructor arg0.password carrier, got ${boundConstructorPassword}`);
    assert(boundConstructorServerOnly === 0, `bound-state server must not satisfy constructor arg0.password carrier, got ${boundConstructorServerOnly}`);
    assert(boundConstructorPlainValue === 0, `plain TextInput value must not seed constructor arg0.password carrier, got ${boundConstructorPlainValue}`);
    assert(boundConstructorOtherField === 0, `bound-state password must not taint sibling constructor output field, got ${boundConstructorOtherField}`);

    const eventConstructorModules = [...eventEmitterModules, ...constructorConfigModules];
    const eventBoundConstructorPassword = await runCase(scene, "eventhub_boundstate_constructor_config_password_to_auth_header_T", eventConstructorModules, { sourceRules: boundStateSourceRules });
    const eventBoundConstructorServerOnly = await runCase(scene, "eventhub_boundstate_constructor_config_server_not_password_F", eventConstructorModules, {
        expectFlow: false,
        sourceRules: boundStateSourceRules,
    });
    assert(eventBoundConstructorPassword > 0, `event-bound password should cross EventHub callback into constructor arg0.password carrier, got ${eventBoundConstructorPassword}`);
    assert(eventBoundConstructorServerOnly === 0, `event-bound server must not satisfy constructor arg0.password carrier, got ${eventBoundConstructorServerOnly}`);

    const storageLinkedEventPassword = await runCase(scene, "storage_link_eventhub_constructor_config_password_to_auth_header_T", eventConstructorModules, { sourceRules: boundStateSourceRules });
    const storageLinkedEventServerOnly = await runCase(scene, "storage_link_eventhub_constructor_config_server_not_password_F", eventConstructorModules, {
        expectFlow: false,
        sourceRules: boundStateSourceRules,
    });
    assert(storageLinkedEventPassword > 0, `@StorageLink password should cross EventHub callback into constructor arg0.password carrier, got ${storageLinkedEventPassword}`);
    assert(storageLinkedEventServerOnly === 0, `@StorageLink server must not satisfy constructor arg0.password carrier, got ${storageLinkedEventServerOnly}`);

    const eventWebDavLikeModules = [...eventEmitterModules, ...webDavLikeModules];
    const storageLinkedEventWebDavLikePassword = await runCase(scene, "storage_link_eventhub_webdav_like_password_to_auth_header_T", eventWebDavLikeModules, { sourceRules: boundStateSourceRules });
    const storageLinkedEventWebDavLikeServerOnly = await runCase(scene, "storage_link_eventhub_webdav_like_server_not_password_F", eventWebDavLikeModules, {
        expectFlow: false,
        sourceRules: boundStateSourceRules,
    });
    assert(storageLinkedEventWebDavLikePassword > 0, `@StorageLink password should reach WebDav-like buildAuthHeaders receiver config carrier, got ${storageLinkedEventWebDavLikePassword}`);
    assert(storageLinkedEventWebDavLikeServerOnly === 0, `@StorageLink server must not satisfy WebDav-like receiver config password carrier, got ${storageLinkedEventWebDavLikeServerOnly}`);

    const eventWebDavRealisticModules = [...eventEmitterModules, ...webDavRealisticModules];
    const storageLinkedEventWebDavRealisticPassword = await runCase(scene, "storage_link_eventhub_webdav_realistic_password_to_auth_header_T", eventWebDavRealisticModules, { sourceRules: boundStateSourceRules });
    const storageLinkedEventWebDavRealisticServerOnly = await runCase(scene, "storage_link_eventhub_webdav_realistic_server_not_password_F", eventWebDavRealisticModules, {
        expectFlow: false,
        sourceRules: boundStateSourceRules,
    });
    assert(storageLinkedEventWebDavRealisticPassword > 0, `@StorageLink password should reach realistic WebDav buildAuthHeaders receiver config carrier, got ${storageLinkedEventWebDavRealisticPassword}`);
    assert(storageLinkedEventWebDavRealisticServerOnly === 0, `@StorageLink server must not satisfy realistic WebDav receiver config password carrier, got ${storageLinkedEventWebDavRealisticServerOnly}`);

    console.log("PASS test_module_handoff_effect_asset_lowering");
    console.log(`same_key_flows=${sameKey}`);
    console.log(`other_key_flows=${otherKey}`);
    console.log(`static_same_key_flows=${staticSameKey}`);
    console.log(`static_other_key_flows=${staticOtherKey}`);
    console.log(`static_namespace_case_flows=${staticNamespaceCase}`);
    console.log(`object_field_receiver_carrier_flows=${objectFieldCarrier}`);
    console.log(`object_field_receiver_carrier_other_field_flows=${objectFieldOther}`);
    console.log(`object_field_module_only_carrier_flows=${objectFieldModuleOnly}`);
    console.log(`object_field_module_only_other_field_flows=${objectFieldModuleOnlyOther}`);
    console.log(`receiver_config_password_to_auth_header_flows=${receiverConfigPassword}`);
    console.log(`receiver_config_server_not_password_flows=${receiverConfigServerOnly}`);
    console.log(`receiver_config_password_other_field_flows=${receiverConfigOtherField}`);
    console.log(`receiver_config_method_body_field_source_to_auth_header_flows=${receiverConfigMethodBodySource}`);
    console.log(`receiver_config_method_body_field_source_other_field_flows=${receiverConfigMethodBodyOtherField}`);
    console.log(`namespace_same_key_flows=${namespaceSameKey}`);
    console.log(`namespace_other_key_flows=${namespaceOtherKey}`);
    console.log(`namespace_await_same_key_flows=${namespaceAwaitSameKey}`);
    console.log(`namespace_await_other_key_flows=${namespaceAwaitOtherKey}`);
    console.log(`namespace_await_template_user_field_flows=${templateUserField}`);
    console.log(`namespace_await_template_password_field_flows=${templatePasswordField}`);
    console.log(`namespace_await_template_server_field_flows=${templateServerField}`);
    console.log(`namespace_await_template_other_key_flows=${templateOtherKey}`);
    console.log(`namespace_boundstate_handoff_user_template_flows=${boundUserTemplate}`);
    console.log(`namespace_boundstate_handoff_password_template_flows=${boundPasswordTemplate}`);
    console.log(`namespace_boundstate_handoff_server_template_flows=${boundServerTemplate}`);
    console.log(`namespace_boundstate_handoff_plain_value_flows=${boundPlainValue}`);
    console.log(`namespace_boundstate_handoff_all_fields_template_flows=${boundAllFieldsTemplate}`);
    console.log(`boundstate_constructor_config_password_to_auth_header_flows=${boundConstructorPassword}`);
    console.log(`boundstate_constructor_config_server_not_password_flows=${boundConstructorServerOnly}`);
    console.log(`boundstate_constructor_config_plain_value_flows=${boundConstructorPlainValue}`);
    console.log(`boundstate_constructor_config_password_other_field_flows=${boundConstructorOtherField}`);
    console.log(`eventhub_boundstate_constructor_config_password_to_auth_header_flows=${eventBoundConstructorPassword}`);
    console.log(`eventhub_boundstate_constructor_config_server_not_password_flows=${eventBoundConstructorServerOnly}`);
    console.log(`storage_link_eventhub_constructor_config_password_to_auth_header_flows=${storageLinkedEventPassword}`);
    console.log(`storage_link_eventhub_constructor_config_server_not_password_flows=${storageLinkedEventServerOnly}`);
    console.log(`storage_link_eventhub_webdav_like_password_to_auth_header_flows=${storageLinkedEventWebDavLikePassword}`);
    console.log(`storage_link_eventhub_webdav_like_server_not_password_flows=${storageLinkedEventWebDavLikeServerOnly}`);
    console.log(`storage_link_eventhub_webdav_realistic_password_to_auth_header_flows=${storageLinkedEventWebDavRealisticPassword}`);
    console.log(`storage_link_eventhub_webdav_realistic_server_not_password_flows=${storageLinkedEventWebDavRealisticServerOnly}`);
}

main().catch(error => {
    console.error("FAIL test_module_handoff_effect_asset_lowering");
    console.error(error);
    process.exitCode = 1;
});
