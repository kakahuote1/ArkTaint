import { parseSemanticFlowAssetModelOutput } from "../../core/semanticflow/SemanticFlowAssetModelOutput";
import { buildSemanticFlowApiModelingCandidateItem } from "../../core/semanticflow/SemanticFlowAdapters";
import { createSemanticFlowLlmDecider } from "../../core/semanticflow/SemanticFlowLlm";
import { buildSemanticFlowPrompt, buildSemanticFlowRepairPrompt } from "../../core/semanticflow/SemanticFlowPrompt";
import { formatSemanticFlowRuntimeSkills } from "../../core/semanticflow/SemanticFlowRuntimeSkills";
import { normalizeSemanticFlowRuleInputCandidatesWithTrace } from "../../core/semanticflow/SemanticFlowRuleInputCandidates";
import type { SemanticFlowDecisionInput } from "../../core/semanticflow/SemanticFlowTypes";
import { buildSemanticFlowTraceGraph } from "../../core/trace/SemanticFlowTraceGraph";
import { selectSemanticFlowRuleCandidatesForModeling } from "../../cli/semanticflow";
import { assert, expectThrows } from "./SemanticFlowV2TestHelpers";

function makeChatSdkAsset(): unknown {
    return {
        id: "asset.project.easemob.chat_sdk_login",
        plane: "rule",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: "surface.easemob.ChatUIKitClient.login",
                kind: "invoke",
                modulePath: "chatuikit/src/main/ets/ChatUIKitClient.ets",
                ownerName: "ChatUIKitClient",
                methodName: "login",
                invokeKind: "static",
                argCount: 2,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: {
                        file: "chatuikit/src/main/ets/ChatUIKitClient.ets",
                        line: 39,
                    },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.easemob.ChatUIKitClient.login.userId",
                surfaceId: "surface.easemob.ChatUIKitClient.login",
                assetId: "asset.project.easemob.chat_sdk_login",
                plane: "rule",
                role: "sink",
                endpoint: { base: { kind: "arg", index: 0 } },
                effectTemplateRefs: ["template.easemob.ChatUIKitClient.login.userId"],
                semanticsFamily: "project.chat_sdk_login",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.easemob.ChatUIKitClient.login.token",
                surfaceId: "surface.easemob.ChatUIKitClient.login",
                assetId: "asset.project.easemob.chat_sdk_login",
                plane: "rule",
                role: "sink",
                endpoint: { base: { kind: "arg", index: 1 } },
                effectTemplateRefs: ["template.easemob.ChatUIKitClient.login.token"],
                semanticsFamily: "project.chat_sdk_login",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.easemob.ChatUIKitClient.login.userId",
                kind: "rule.sink",
                value: { base: { kind: "arg", index: 0 } },
                sinkKind: "third_party_sdk_boundary",
                confidence: "likely",
            },
            {
                id: "template.easemob.ChatUIKitClient.login.token",
                kind: "rule.sink",
                value: { base: { kind: "arg", index: 1 } },
                sinkKind: "third_party_sdk_boundary",
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "easemob_uikit_external",
            evidenceLocations: [
                { file: "chatuikit/src/main/ets/ChatUIKitClient.ets", line: 39 },
            ],
        },
    };
}

function makeSendTextMessageAsset(ownerName: string): any {
    return {
        id: `asset.project.chat.${ownerName}.sendTextMessage`,
        plane: "rule",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: `surface.${ownerName}.sendTextMessage`,
                kind: "invoke",
                modulePath: "chatuikit/src/main/ets/viewmodels/MessageViewModel.ets",
                ownerName,
                methodName: "sendTextMessage",
                invokeKind: "instance",
                argCount: 1,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: {
                        file: "chatuikit/src/main/ets/viewmodels/MessageViewModel.ets",
                        line: 44,
                    },
                },
            },
        ],
        bindings: [
            {
                bindingId: `binding.${ownerName}.sendTextMessage.arg0.sink`,
                surfaceId: `surface.${ownerName}.sendTextMessage`,
                assetId: `asset.project.chat.${ownerName}.sendTextMessage`,
                plane: "rule",
                role: "sink",
                endpoint: { base: { kind: "arg", index: 0 } },
                effectTemplateRefs: [`template.${ownerName}.sendTextMessage.arg0.sink`],
                semanticsFamily: "project.chat_sdk_message",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: `template.${ownerName}.sendTextMessage.arg0.sink`,
                kind: "rule.sink",
                value: { base: { kind: "arg", index: 0 } },
                sinkKind: "third_party_sdk_boundary",
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "easemob_uikit_external",
            evidenceLocations: [
                { file: "chatuikit/src/main/ets/viewmodels/MessageViewModel.ets", line: 44 },
            ],
        },
    };
}

function makeChatInputMenuViewCallbackSourceAsset(
    mode: "static-owner" | "free-function",
    locationFile = "chatuikit/src/main/ets/components/chat/ChatView.ets",
): any {
    const staticOwner = mode === "static-owner";
    const surface: any = {
        surfaceId: "surface.ChatInputMenuView",
        kind: "invoke",
        modulePath: "chatuikit/src/main/ets/components/chat/ChatComponents.ets",
        functionName: "ChatInputMenuView",
        invokeKind: staticOwner ? "static" : "free-function",
        argCount: 1,
        confidence: "likely",
        provenance: {
            source: "llm-proposal",
            location: {
                file: locationFile,
                line: 539,
            },
        },
    };
    if (staticOwner) {
        surface.ownerName = "ChatComponents";
        surface.methodName = "ChatInputMenuView";
    }
    return {
        id: `asset.project.chat.ChatInputMenuView.${mode}`,
        plane: "rule",
        status: "llm-generated",
        surfaces: [surface],
        bindings: [
            {
                bindingId: "binding.ChatInputMenuView.onClickSend.arg0.source",
                surfaceId: "surface.ChatInputMenuView",
                assetId: `asset.project.chat.ChatInputMenuView.${mode}`,
                plane: "rule",
                role: "source",
                endpoint: {
                    base: {
                        kind: "callbackArg",
                        callback: {
                            kind: "option",
                            base: { base: { kind: "arg", index: 0 } },
                            accessPath: ["onClickSend"],
                        },
                        argIndex: 0,
                    },
                },
                effectTemplateRefs: ["template.ChatInputMenuView.onClickSend.arg0.source"],
                semanticsFamily: "project.chat_input_callback",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.ChatInputMenuView.onClickSend.arg0.source",
                kind: "rule.source",
                sourceKind: "callback_param",
                value: {
                    base: {
                        kind: "callbackArg",
                        callback: {
                            kind: "option",
                            base: { base: { kind: "arg", index: 0 } },
                            accessPath: ["onClickSend"],
                        },
                        argIndex: 0,
                    },
                },
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "easemob_uikit_external",
            evidenceLocations: [
                { file: "chatuikit/src/main/ets/components/chat/ChatView.ets", line: 539 },
            ],
        },
    };
}

function makeOwnerlessReturnedValueAsset(
    mode: "free-function" | "static-sibling-binding-static",
): any {
    const freeSurface = {
        surfaceId: "surface.getHomeListAxios.free",
        kind: "invoke",
        modulePath: "entry/src/main/ets/http/apiService.ets",
        functionName: "getHomeListAxios",
        invokeKind: "free-function",
        argCount: 1,
        confidence: "likely",
        provenance: {
            source: "llm-proposal",
            location: { file: "entry/src/main/ets/http/apiService.ets", line: 31 },
        },
    };
    const staticSurface = {
        surfaceId: "surface.getHomeListAxios.static",
        kind: "invoke",
        modulePath: "entry/src/main/ets/http/apiService.ets",
        ownerName: "apiService",
        methodName: "getHomeListAxios",
        invokeKind: "static",
        argCount: 1,
        confidence: "likely",
        provenance: {
            source: "llm-proposal",
            location: { file: "entry/src/main/ets/http/apiService.ets", line: 31 },
        },
    };
    const bindingSurfaceId = mode === "free-function"
        ? freeSurface.surfaceId
        : staticSurface.surfaceId;
    return {
        id: `asset.project.apiService.getHomeListAxios.${mode}`,
        plane: "rule",
        status: "llm-generated",
        surfaces: mode === "free-function"
            ? [freeSurface]
            : [freeSurface, staticSurface],
        bindings: [
            {
                bindingId: "binding.getHomeListAxios.return.source",
                surfaceId: bindingSurfaceId,
                assetId: `asset.project.apiService.getHomeListAxios.${mode}`,
                plane: "rule",
                role: "source",
                endpoint: { base: { kind: "promiseResult" } },
                effectTemplateRefs: ["template.getHomeListAxios.return.source"],
                semanticsFamily: "project.api_service_response",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.getHomeListAxios.return.source",
                kind: "rule.source",
                sourceKind: "call_return",
                value: { base: { kind: "promiseResult" } },
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "semanticflow",
            evidenceLocations: [
                { file: "entry/src/main/ets/http/apiService.ets", line: 31 },
            ],
        },
    };
}

function testRuleInputReturnedValueFocusNormalization(): void {
    const base: any = {
        callee_signature: "@entry/src/main/ets/http/AxiosHttp.ets: AxiosHttpRequest.request(Unknown)",
        method: "request",
        invokeKind: "instance",
        argCount: 1,
        sourceFile: "entry/src/main/ets/http/AxiosHttp.ets",
        candidateOrigin: "recall_api_surface",
        returnType: "Promise<T>",
        topEntries: [
            "origin=recall_api_surface",
            "candidateTier=project-wrapper",
            "candidateReason=network-boundary-effect",
            "coverageGapSource=fixture_flow_queries",
            "coverageGapReason=coverage.role_endpoint_guard_gap",
        ],
    };
    const normalized = normalizeSemanticFlowRuleInputCandidatesWithTrace([base]);
    assert(
        normalized.trace.returnedValueSiblingCreatedCount === 1,
        `expected one returned-value trace event, got ${normalized.trace.returnedValueSiblingCreatedCount}`,
    );
    assert(
        normalized.trace.events.some(event => event.kind === "returned_value_sibling_created"
            && event.sibling?.semanticFocus === "returned_value_surface"),
        "ruleInput normalization trace must record returned-value sibling creation",
    );
    assert(normalized.items.length === 2, `expected returned-value sibling, got ${normalized.items.length}`);
    assert(
        normalized.items.some(item => item.method === "request" && (item as any).semanticFocus === "returned_value_surface"),
        "ruleInput normalization must add returned-value focus sibling for coverage-proven Promise wrapper",
    );

    const inferredReturn: any = {
        callee_signature: "@entry/src/main/ets/http/apiService.ets: getHomeList(Unknown)",
        method: "getHomeList",
        invokeKind: "static",
        argCount: 1,
        sourceFile: "entry/src/main/ets/http/apiService.ets",
        candidateOrigin: "recall_api_surface",
        topEntries: [
            "origin=recall_api_surface",
            "candidateTier=project-wrapper",
            "candidateReason=network-boundary-effect",
        ],
        methodSnippet: [
            "20 | export function getHomeList(date: string = \"\") {",
            "21 |   return httpClient.get<HomeModel>({",
            "22 |     url: baseUrl + \"api/v2/feed\",",
            "23 |     extraData: { \"date\": date }",
            "24 |   })",
            "25 | }",
        ].join("\n"),
    };
    const inferredNormalized = normalizeSemanticFlowRuleInputCandidatesWithTrace([inferredReturn]);
    assert(
        inferredNormalized.trace.returnedValueSiblingCreatedCount === 1,
        `expected one inferred returned-value sibling, got ${inferredNormalized.trace.returnedValueSiblingCreatedCount}`,
    );
    assert(
        inferredNormalized.items.some(item => item.method === "getHomeList" && (item as any).semanticFocus === "returned_value_surface"),
        "ruleInput normalization must infer returned-value focus from request-wrapper return expressions even without explicit returnType",
    );

    const voidLike: any = {
        ...inferredReturn,
        method: "refreshCache",
        callee_signature: "@entry/src/main/ets/http/apiService.ets: refreshCache(Unknown)",
        methodSnippet: [
            "40 | export function refreshCache(date: string = \"\") {",
            "41 |   httpClient.get<HomeModel>({ url: baseUrl })",
            "42 |   return",
            "43 | }",
        ].join("\n"),
    };
    const voidNormalized = normalizeSemanticFlowRuleInputCandidatesWithTrace([voidLike]);
    assert(
        voidNormalized.trace.returnedValueSiblingCreatedCount === 0,
        `void-like wrapper must not create returned-value sibling, got ${voidNormalized.trace.returnedValueSiblingCreatedCount}`,
    );

    const existingFocused = {
        ...base,
        candidateOrigin: "recall_returned_value_surface",
        semanticFocus: "returned_value_surface",
        topEntries: [...base.topEntries, "semanticFocus=returned_value_surface"],
    };
    const alreadyPaired = normalizeSemanticFlowRuleInputCandidatesWithTrace([base, existingFocused]);
    const focusedCount = alreadyPaired.items.filter(item => (item as any).semanticFocus === "returned_value_surface").length;
    assert(focusedCount === 1, `expected no duplicate returned-value sibling, got ${focusedCount}`);

    const graph = buildSemanticFlowTraceGraph({
        run: {
            runId: "semanticflow-trace-test",
            project: "fixture",
            engineVersion: "test",
            assetVersion: "test",
            configHash: "test",
            startedAt: new Date(0).toISOString(),
            completedAt: new Date(0).toISOString(),
            status: "completed",
        },
        items: [],
        sourceRuns: [
            {
                sourceDir: "entry/src/main/ets",
                status: "ok",
                ruleCandidatePackagingTrace: normalized.trace,
            },
        ],
    });
    assert(
        graph.gates.some(gate => gate.scope?.includes("rule_input_normalization")
            && (gate.evidence as any)?.returnedValueSiblingCreatedCount === 1),
        "SemanticFlow trace graph must include ruleInput normalization summary gate",
    );
    assert(
        graph.coverage.some(record => record.kind === "semanticflow_candidate"
            && JSON.stringify(record.evidence || {}).includes("returned_value_surface")
            && JSON.stringify(record.evidence || {}).includes("returned_value_sibling_created")),
        "SemanticFlow trace graph coverage must expose returned-value sibling creation",
    );
}

function makeReceiverFieldRuleOnlySinkAsset(): any {
    return {
        id: "asset.project.authCarrier.request.ruleOnly",
        plane: "rule",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: "surface.AuthCarrier.request",
                kind: "invoke",
                modulePath: "entry/src/main/ets/AuthCarrier.ets",
                ownerName: "AuthCarrier",
                methodName: "request",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "entry/src/main/ets/AuthCarrier.ets", line: 20 },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.AuthCarrier.request.authHeaders.sink",
                surfaceId: "surface.AuthCarrier.request",
                assetId: "asset.project.authCarrier.request.ruleOnly",
                plane: "rule",
                role: "sink",
                endpoint: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                effectTemplateRefs: ["template.AuthCarrier.request.authHeaders.sink"],
                semanticsFamily: "project.auth_carrier",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.AuthCarrier.request.authHeaders.sink",
                kind: "rule.sink",
                value: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                sinkKind: "network_request",
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "auth_carrier_fixture",
            evidenceLocations: [{ file: "entry/src/main/ets/AuthCarrier.ets", line: 20 }],
        },
    };
}

function makeHdWebCallbackRegisterAsset(): any {
    return {
        id: "project.HdWeb.onLoad.callbackRegistration",
        plane: "arkmain",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: "surface.HdWeb",
                kind: "invoke",
                modulePath: "commons/basic/src/main/ets/components/HdWeb.ets",
                functionName: "HdWeb",
                invokeKind: "free-function",
                argCount: 1,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "features/home/src/main/ets/views/QuestionDetailComp.ets", line: 202 },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.HdWeb.onLoad.callbackRegister",
                surfaceId: "surface.HdWeb",
                assetId: "project.HdWeb.onLoad.callbackRegistration",
                plane: "arkmain",
                role: "entry",
                endpoint: {
                    base: {
                        kind: "callbackArg",
                        callback: {
                            kind: "option",
                            base: { base: { kind: "arg", index: 0 } },
                            accessPath: ["onLoad"],
                        },
                        argIndex: 0,
                    },
                },
                effectTemplateRefs: ["template.HdWeb.onLoad.callbackRegister"],
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.HdWeb.onLoad.callbackRegister",
                kind: "entry.callbackRegister",
                callback: {
                    kind: "option",
                    base: { base: { kind: "arg", index: 0 } },
                    accessPath: ["onLoad"],
                },
                callbackRole: "lifecycle-onLoad",
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "interview_handbook_fixture",
            evidenceLocations: [{ file: "features/home/src/main/ets/views/QuestionDetailComp.ets", line: 202 }],
        },
    };
}

function makeReceiverFieldReturnedValueSourceAsset(): any {
    return {
        id: "asset.project.authCarrier.request.returnedResponse",
        plane: "rule",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: "surface.AuthCarrier.request",
                kind: "invoke",
                modulePath: "entry/src/main/ets/AuthCarrier.ets",
                ownerName: "AuthCarrier",
                methodName: "request",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "entry/src/main/ets/AuthCarrier.ets", line: 20 },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.AuthCarrier.request.response.source",
                surfaceId: "surface.AuthCarrier.request",
                assetId: "asset.project.authCarrier.request.returnedResponse",
                plane: "rule",
                role: "source",
                endpoint: { base: { kind: "promiseResult" } },
                effectTemplateRefs: ["template.AuthCarrier.request.response.source"],
                semanticsFamily: "project.auth_carrier_response",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.AuthCarrier.request.response.source",
                kind: "rule.source",
                sourceKind: "call_return",
                value: { base: { kind: "promiseResult" } },
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "auth_carrier_fixture",
            evidenceLocations: [{ file: "entry/src/main/ets/AuthCarrier.ets", line: 20 }],
        },
    };
}

function makeProjectStorageWrapperRuleOnlySinkAsset(): any {
    return {
        id: "asset.project.projectKvStore.putData.ruleOnly",
        plane: "rule",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: "surface.ProjectKvStore.putData",
                kind: "invoke",
                modulePath: "entry/src/main/ets/utils/ProjectKvStore.ets",
                ownerName: "ProjectKvStore",
                methodName: "putData",
                invokeKind: "namespace",
                argCount: 2,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "entry/src/main/ets/pages/StaticStoragePage.ets", line: 6 },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.ProjectKvStore.putData.arg1.sink",
                surfaceId: "surface.ProjectKvStore.putData",
                assetId: "asset.project.projectKvStore.putData.ruleOnly",
                plane: "rule",
                role: "sink",
                endpoint: { base: { kind: "arg", index: 1 } },
                effectTemplateRefs: ["template.ProjectKvStore.putData.arg1.sink"],
                semanticsFamily: "project.project_kv_store",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.ProjectKvStore.putData.arg1.sink",
                kind: "rule.sink",
                value: { base: { kind: "arg", index: 1 } },
                sinkKind: "storage_write",
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "project_storage_fixture",
            evidenceLocations: [{ file: "entry/src/main/ets/pages/StaticStoragePage.ets", line: 6 }],
        },
    };
}

function makeProjectStorageWrapperPersistentSlotAsset(): any {
    return {
        id: "asset.project.projectKvStore.sessionToken.persistentSlot",
        plane: "module",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: "surface.ProjectKvStore.putData",
                kind: "invoke",
                modulePath: "entry/src/main/ets/utils/ProjectKvStore.ets",
                ownerName: "ProjectKvStore",
                methodName: "putData",
                invokeKind: "namespace",
                argCount: 2,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "entry/src/main/ets/pages/StaticStoragePage.ets", line: 6 },
                },
            },
            {
                surfaceId: "surface.ProjectKvStore.getData",
                kind: "invoke",
                modulePath: "entry/src/main/ets/utils/ProjectKvStore.ets",
                ownerName: "ProjectKvStore",
                methodName: "getData",
                invokeKind: "namespace",
                argCount: 1,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "entry/src/main/ets/pages/StaticStoragePage.ets", line: 5 },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.ProjectKvStore.putData.sessionToken.put",
                surfaceId: "surface.ProjectKvStore.putData",
                assetId: "asset.project.projectKvStore.sessionToken.persistentSlot",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 1 } },
                effectTemplateRefs: ["template.ProjectKvStore.putData.sessionToken.put"],
                semanticsFamily: "project.project_kv_store.persistent_slot",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.ProjectKvStore.getData.sessionToken.get",
                surfaceId: "surface.ProjectKvStore.getData",
                assetId: "asset.project.projectKvStore.sessionToken.persistentSlot",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "promiseResult" } },
                effectTemplateRefs: ["template.ProjectKvStore.getData.sessionToken.get"],
                semanticsFamily: "project.project_kv_store.persistent_slot",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.ProjectKvStore.putData.sessionToken.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "persistent-storage-slot",
                    family: "project.project_kv_store",
                    key: [{ kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } }],
                    precision: "infer",
                },
                value: { base: { kind: "arg", index: 1 } },
                updateStrength: "weak",
                confidence: "likely",
            },
            {
                id: "template.ProjectKvStore.getData.sessionToken.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "persistent-storage-slot",
                    family: "project.project_kv_store",
                    key: [{ kind: "fromEndpoint", endpoint: { base: { kind: "arg", index: 0 } } }],
                    precision: "infer",
                },
                target: { base: { kind: "promiseResult" } },
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "project_storage_fixture",
            evidenceLocations: [{ file: "entry/src/main/ets/pages/StaticStoragePage.ets", line: 5 }],
        },
    };
}

function makeProjectStorageWrapperPersistentSlotOverloadAsset(): any {
    const asset = makeProjectStorageWrapperPersistentSlotAsset();
    return {
        ...asset,
        id: "asset.project.projectKvStore.sessionToken.persistentSlot.overloads",
        surfaces: [
            ...asset.surfaces,
            {
                surfaceId: "surface.ProjectKvStore.getDataWithDefault",
                kind: "invoke",
                modulePath: "entry/src/main/ets/utils/ProjectKvStore.ets",
                ownerName: "ProjectKvStore",
                methodName: "getData",
                invokeKind: "namespace",
                argCount: 2,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "entry/src/main/ets/pages/StaticStoragePage.ets", line: 9 },
                },
            },
        ],
        bindings: [
            ...asset.bindings.map((binding: any) => ({ ...binding, assetId: "asset.project.projectKvStore.sessionToken.persistentSlot.overloads" })),
            {
                bindingId: "binding.ProjectKvStore.getDataWithDefault.sessionToken.get",
                surfaceId: "surface.ProjectKvStore.getDataWithDefault",
                assetId: "asset.project.projectKvStore.sessionToken.persistentSlot.overloads",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "promiseResult" } },
                effectTemplateRefs: ["template.ProjectKvStore.getData.sessionToken.get"],
                semanticsFamily: "project.project_kv_store.persistent_slot",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        provenance: {
            ...asset.provenance,
            evidenceLocations: [
                ...(asset.provenance?.evidenceLocations || []),
                { file: "entry/src/main/ets/pages/StaticStoragePage.ets", line: 9 },
            ],
        },
    };
}

function makeReceiverFieldObjectFieldHandoffAsset(): any {
    return {
        id: "asset.project.authCarrier.authHeaders.objectField",
        plane: "module",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: "surface.AuthCarrier.setAuthHeaders",
                kind: "invoke",
                modulePath: "entry/src/main/ets/AuthCarrier.ets",
                ownerName: "AuthCarrier",
                methodName: "setAuthHeaders",
                invokeKind: "instance",
                argCount: 1,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "entry/src/main/ets/AuthCarrier.ets", line: 8 },
                },
            },
            {
                surfaceId: "surface.AuthCarrier.request",
                kind: "invoke",
                modulePath: "entry/src/main/ets/AuthCarrier.ets",
                ownerName: "AuthCarrier",
                methodName: "request",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "entry/src/main/ets/AuthCarrier.ets", line: 20 },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.AuthCarrier.setAuthHeaders.authHeaders.put",
                surfaceId: "surface.AuthCarrier.setAuthHeaders",
                assetId: "asset.project.authCarrier.authHeaders.objectField",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 0 } },
                effectTemplateRefs: ["template.AuthCarrier.setAuthHeaders.authHeaders.put"],
                semanticsFamily: "project.auth_carrier.object_field",
                completeness: "partial",
                confidence: "likely",
            },
            {
                bindingId: "binding.AuthCarrier.request.authHeaders.get",
                surfaceId: "surface.AuthCarrier.request",
                assetId: "asset.project.authCarrier.authHeaders.objectField",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                effectTemplateRefs: ["template.AuthCarrier.request.authHeaders.get"],
                semanticsFamily: "project.auth_carrier.object_field",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.AuthCarrier.setAuthHeaders.authHeaders.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "object-field",
                    family: "project.auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                    precision: "exact",
                },
                value: { base: { kind: "arg", index: 0 } },
                confidence: "likely",
            },
            {
                id: "template.AuthCarrier.request.authHeaders.get",
                kind: "handoff.get",
                handle: {
                    cellKind: "object-field",
                    family: "project.auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                    precision: "exact",
                },
                target: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "auth_carrier_fixture",
            evidenceLocations: [{ file: "entry/src/main/ets/AuthCarrier.ets", line: 8 }],
        },
    };
}

function makeConstructReceiverEndpointHandoffAsset(): any {
    return {
        id: "asset.project.authCarrier.constructor.badReceiver",
        plane: "module",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: "surface.AuthCarrier.constructor",
                kind: "construct",
                modulePath: "entry/src/main/ets/AuthCarrier.ets",
                className: "AuthCarrier",
                argCount: 1,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "entry/src/main/ets/AuthCarrier.ets", line: 8 },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.AuthCarrier.constructor.authHeaders.put",
                surfaceId: "surface.AuthCarrier.constructor",
                assetId: "asset.project.authCarrier.constructor.badReceiver",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["config", "password"] },
                effectTemplateRefs: ["template.AuthCarrier.constructor.authHeaders.put"],
                semanticsFamily: "project.auth_carrier.object_field",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: "template.AuthCarrier.constructor.authHeaders.put",
                kind: "handoff.put",
                handle: {
                    cellKind: "object-field",
                    family: "project.auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                    precision: "exact",
                },
                value: { base: { kind: "receiver" }, accessPath: ["config", "password"] },
                updateStrength: "weak",
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "auth_carrier_fixture",
            evidenceLocations: [{ file: "entry/src/main/ets/AuthCarrier.ets", line: 8 }],
        },
    };
}

function makeReceiverFieldMixedPlaneModuleAsset(): any {
    const asset = makeReceiverFieldObjectFieldHandoffAsset();
    return {
        ...asset,
        id: "asset.project.authCarrier.request.mixedPlane",
        effectTemplates: [
            ...(asset.effectTemplates || []),
            {
                id: "template.AuthCarrier.request.authHeaders.sink",
                kind: "rule.sink",
                value: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                sinkKind: "network_request",
                confidence: "likely",
            },
        ],
        bindings: [
            ...(asset.bindings || []),
            {
                bindingId: "binding.AuthCarrier.request.authHeaders.sink",
                surfaceId: "surface.AuthCarrier.request",
                assetId: "asset.project.authCarrier.request.mixedPlane",
                plane: "module",
                role: "sink",
                endpoint: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                effectTemplateRefs: ["template.AuthCarrier.request.authHeaders.sink"],
                semanticsFamily: "project.auth_carrier.object_field",
                completeness: "partial",
                confidence: "likely",
            },
        ],
    };
}

function makeBrokenObjectFieldModuleRepairAsset(): any {
    return {
        id: "asset.project.authCarrier.brokenRepair",
        plane: "module",
        status: "llm-generated",
        surfaces: [
            {
                surfaceId: "surface.AuthCarrier.buildAuthHeaders",
                kind: "invoke",
                modulePath: "entry/src/main/ets/AuthCarrier.ets",
                ownerName: "AuthCarrier",
                methodName: "buildAuthHeaders",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "entry/src/main/ets/AuthCarrier.ets", line: 8 },
                },
            },
            {
                surfaceId: "surface.AuthCarrier.request",
                kind: "invoke",
                ownerName: "AuthCarrier",
                methodName: "request",
                invokeKind: "instance",
                argCount: 0,
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "entry/src/main/ets/AuthCarrier.ets", line: 20 },
                },
            },
        ],
        bindings: [
            {
                bindingId: "binding.AuthCarrier.buildAuthHeaders.authHeaders.put",
                surfaceId: "surface.AuthCarrier.buildAuthHeaders",
                assetId: "asset.project.authCarrier.brokenRepair",
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "receiver" }, accessPath: ["config", "password"] },
                effectTemplateRefs: ["template.AuthCarrier.buildAuthHeaders.authHeaders.put"],
                semanticsFamily: "project.auth_carrier.object_field",
                completeness: "partial",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                kind: "handoff.put",
                handle: {
                    cellKind: "object-field",
                    family: "project.auth_carrier",
                    key: [{ kind: "const", value: "authHeaders" }],
                },
                value: { base: { kind: "receiver" }, accessPath: ["config", "password"] },
                updateStrength: "weak",
                confidence: "likely",
            },
        ],
        relations: [],
        provenance: {
            source: "llm",
            projectId: "auth_carrier_fixture",
            evidenceLocations: [{ file: "entry/src/main/ets/AuthCarrier.ets", line: 8 }],
        },
    };
}

async function expectRejects(fn: () => Promise<unknown>, contains: string): Promise<void> {
    try {
        await fn();
    } catch (error) {
        const text = String((error as any)?.message || error);
        assert(text.includes(contains), `expected "${contains}", got "${text}"`);
        return;
    }
    throw new Error(`expected async error containing "${contains}"`);
}

async function main(): Promise<void> {
    testRuleInputReturnedValueFocusNormalization();

    const runtimeSkills = formatSemanticFlowRuntimeSkills();
    assert(
        runtimeSkills.includes("Third-party and project API surfaces must be generated as project-scoped assets"),
        "runtime skill must route third-party/project APIs through generated project assets",
    );
    assert(
        runtimeSkills.includes("same-name local classes"),
        "runtime skill must treat same-name local classes as negative evidence",
    );
    assert(
        runtimeSkills.includes("Do not model `ChatClient`, `sendMessage`, `login`, `on`, `emit`, or `send` by name alone"),
        "runtime skill must forbid generic chat/event name modeling",
    );
    assert(
        runtimeSkills.includes("getRichEditorContent()"),
        "runtime skill must allow project UI callback sources only when evidence shows wrapped user input",
    );
    assert(
        runtimeSkills.includes("Do not model a callback parameter as a source when the callback merely forwards"),
        "runtime skill must reject callback sources for plain internal forwarding",
    );
    assert(
        runtimeSkills.includes("A callback written as `(content: MessageContent) => { ... }`")
            && runtimeSkills.includes("argIndex: 0"),
        "runtime skill must derive single-parameter callback payloads as argIndex 0",
    );
    assert(
        runtimeSkills.includes("trailing optional/default parameters")
            && runtimeSkills.includes("sendTextMessage(content)"),
        "runtime skill must keep InvokeSurface.argCount aligned to observed call arity for default parameters",
    );
    assert(
        runtimeSkills.includes("methodSignature")
            && runtimeSkills.includes("declaring owner")
            && runtimeSkills.includes("implementation class is evidence"),
        "runtime skill must require receiver method surfaces to use the analyzer-resolved declaring owner",
    );
    assert(
        runtimeSkills.includes("Every `rule.sink` effect template must include a non-empty `sinkKind`"),
        "runtime skill must require sinkKind for project API sink assets",
    );
    assert(
        runtimeSkills.includes("candidateOrigin=recall_direct_boundary_surface")
            && runtimeSkills.includes("direct_project_or_third_party_callsite_evidence"),
        "runtime skill must explain direct page/component SDK boundary candidates without turning them into kernel rules",
    );
    assert(
        runtimeSkills.includes("candidateOrigin=recall_callback_surface")
            && runtimeSkills.includes("callbackOwnerResolved=true")
            && runtimeSkills.includes("plane=\"arkmain\"")
            && runtimeSkills.includes("entry.callbackRegister")
            && runtimeSkills.includes("Do not require evidence for the caller callback body"),
        "runtime skill must model resolved project component lifecycle option callbacks as arkmain callback registration assets",
    );
    assert(
        runtimeSkills.includes("topic`, `channel`, `queue`, `room`, `conversation`")
            && runtimeSkills.includes("selector/control metadata by default")
            && runtimeSkills.includes("`payload`, `message`, `body`, `content`, `data`"),
        "runtime skill must distinguish pub/sub routing selectors from payload sink endpoints",
    );
    assert(
        runtimeSkills.includes("Receiver-field carrier evidence")
            && runtimeSkills.includes("cellKind=\"object-field\"")
            && runtimeSkills.includes("do not model receiver field reads")
            && runtimeSkills.includes("only marks formal parameters as `rule.sink` is incomplete")
            && runtimeSkills.includes("value: { \"base\": { \"kind\": \"receiver\" }, \"accessPath\": [\"options\", \"secret\"] }")
            && runtimeSkills.includes("updateStrength: \"weak\"")
            && runtimeSkills.includes('role: "handoff"')
            && runtimeSkills.includes("never use `role: \"put\"` or `role: \"get\"`"),
        "runtime skill must guide receiver-field hidden carriers into object-field handoff or precise receiver sinks",
    );
    assert(
        runtimeSkills.includes("formalParam=argN;name=...;semanticRole=...")
            && runtimeSkills.includes("requestWrapperEndpointHint")
            && runtimeSkills.includes("control-metadata")
            && runtimeSkills.includes("destination-metadata"),
        "runtime skill must require request-wrapper endpoint choice to respect structured formal parameter roles",
    );

    const parsed = parseSemanticFlowAssetModelOutput(JSON.stringify({
        status: "done",
        asset: makeChatSdkAsset(),
        rationale: ["ChatUIKitClient.login forwards userId and token across a third-party SDK boundary."],
    }));
    assert(parsed.status === "done", "expected generated chat SDK asset to parse");
    assert(parsed.asset.status === "llm-generated", "third-party project asset must remain llm-generated");
    assert(parsed.asset.effectTemplates?.length === 2, "chat login must keep endpoint-specific sink templates");

    const promoted = makeChatSdkAsset() as any;
    promoted.status = "reviewed";
    promoted.provenance.source = "manual";
    expectThrows(
        () => parseSemanticFlowAssetModelOutput(JSON.stringify({ status: "done", asset: promoted })),
        "is not analyzer-backed",
    );

    const prompt = buildSemanticFlowPrompt({
        anchor: {
            id: "chat-sdk-login",
            surface: "ChatUIKitClient.login",
            owner: "ChatUIKitClient",
            methodSignature: "ChatUIKitClient.login(string,string)",
            filePath: "chatuikit/src/main/ets/ChatUIKitClient.ets",
            metaTags: ["third-party-sdk", "chat-sdk"],
        },
        draftId: "draft.chat-sdk-login",
        slice: {
            anchorId: "chat-sdk-login",
            round: 1,
            template: "callable-transfer",
            observations: [
                "ChatUIKitClient.login forwards userId and token into the Easemob SDK.",
                "LocalChatUIKitClient.login is a local stub and must not be modeled as the same surface.",
            ],
            snippets: [
                {
                    label: "sdk-login",
                    code: "ChatUIKitClient.login(userId, token);",
                },
                {
                    label: "same-name-negative",
                    code: "LocalChatUIKitClient.login(userId, token);",
                },
            ],
        },
        round: 1,
        history: [],
    });
    assert(prompt.system.includes("Third-party and project API surfaces"), "prompt must include project SDK boundary guidance");
    assert(prompt.system.includes("one-parameter callback uses argIndex=0"), "prompt must forbid guessing argIndex 1 for single-parameter callbacks");
    assert(prompt.system.includes('"accessPath": ["onClickSend"] }, "argIndex": 0'), "prompt example must use a single-parameter option callback source");
    assert(prompt.system.includes("observed callsite argCount"), "prompt must tell LLM not to inflate argCount for optional/default parameters");
    assert(
        prompt.system.includes("Every observed companion surface arity")
            && prompt.system.includes("get(key)")
            && prompt.system.includes("get(key, defaultValue)"),
        "prompt must require storage wrapper assets to cover observed overload/default-value call shapes",
    );
    assert(
        prompt.system.includes("Project storage and persistent-state wrappers are routed through persistent-storage-slot semantics")
            && prompt.system.includes("this.getPreferences")
            && prompt.system.includes("this.itemBuilder"),
        "prompt must route storage-wrapper receiver helpers to persistent-storage-slot semantics",
    );
    assert(prompt.system.includes("derive ownerName and methodName from methodSignature"), "prompt must prefer analyzer-resolved signature owner over implementation snippets");
    assert(
        prompt.system.includes("Every rule.sink effect template must include a non-empty sinkKind"),
        "prompt must require sinkKind for generated rule.sink assets",
    );
    assert(
        prompt.system.includes("do not classify save/set/put methods as rule.sink")
            && prompt.system.includes("persistent-storage-slot")
            && prompt.system.includes("keyed-semantic-slot"),
        "prompt must require project persistent-state wrappers to use module handoff instead of storage sink assets",
    );
    assert(
        prompt.system.includes("Paired handoff surfaces")
            && prompt.system.includes("identical cellKind")
            && prompt.system.includes("key=[arg0,arg1]")
            && prompt.system.includes("omit owner"),
        "prompt must require paired handoff wrappers to use consistent handle layouts",
    );
    assert(
        prompt.system.includes("Optional scope and owner must also be identical")
            && prompt.system.includes("Do not add a const owner to only one side"),
        "prompt must forbid one-sided optional handoff owner layouts",
    );
    assert(
        prompt.system.includes("@%unk/%unk: .ComponentName")
            && prompt.system.includes("@entry/.../File.ets: functionName(...)")
            && prompt.system.includes("Do not set ownerName or methodName"),
        "prompt must require ownerless component/function calls to stay free-function surfaces",
    );
    assert(
        prompt.system.includes("candidateOrigin=recall_callback_surface")
            && prompt.system.includes("callbackOwnerResolved=true")
            && prompt.system.includes("emit plane=\"arkmain\" with entry.callbackRegister")
            && prompt.system.includes("Do not ask for caller callback body evidence"),
        "prompt must force resolved project component lifecycle callback surfaces into arkmain callback registration assets",
    );
    assert(
        prompt.system.includes("selector/control metadata by default")
            && prompt.system.includes("Prefer `payload`, `message`, `body`, `content`, `data`"),
        "prompt must carry pub/sub selector-vs-payload endpoint guidance",
    );
    assert(
        prompt.system.includes("module.eventEmitter")
            && prompt.system.includes("payloadArgIndex=-1")
            && prompt.system.includes("onMethods")
            && prompt.system.includes("emitMethods")
            && prompt.system.includes("The event key/channel is selector metadata")
            && prompt.system.includes("Do not output core.capability"),
        "prompt must require project event-bus wrappers to use declarative module.eventEmitter instead of core capabilities or broad rule effects",
    );
    assert(
        prompt.system.includes("Receiver-field carrier evidence")
            && prompt.system.includes("cellKind=\"object-field\"")
            && prompt.system.includes("Do not model receiver field reads")
            && prompt.system.includes("arg-only or all-argument sinks")
            && prompt.system.includes("rule-only asset is incomplete")
            && prompt.system.includes("Minimal valid object-field handoff example")
            && prompt.system.includes('"role": "handoff"')
            && prompt.system.includes('"kind": "handoff.put"')
            && prompt.system.includes('"cellKind": "object-field"')
            && prompt.system.includes('"accessPath": ["options", "secret"]')
            && prompt.system.includes('"updateStrength": "weak"')
            && prompt.system.includes("do not default to {\"base\":{\"kind\":\"return\"}}")
            && prompt.system.includes("ConstructSurface handoff.put")
            && prompt.system.includes("Do not use {\"base\":{\"kind\":\"receiver\"}} on construct-surface"),
        "prompt must carry receiver-field hidden carrier guidance",
    );
    const repairPrompt = buildSemanticFlowRepairPrompt({
        validationError: "$.effectTemplates[0].handle.key[0] must be a HandleKeyPartTemplate; $.surfaces[0].className must be a stable non-empty string",
        original: prompt,
        raw: JSON.stringify({
            status: "done",
            asset: {
                plane: "module",
                surfaces: [{ kind: "construct", ownerName: "AuthCarrier" }],
                effectTemplates: [{
                    kind: "handoff.put",
                    handle: { cellKind: "object-field", family: "project.auth", key: ["authHeaders"] },
                    value: null,
                }],
            },
        }),
    });
    assert(
        repairPrompt.system.includes("key:[\"requestHeaders\"] is invalid")
            && repairPrompt.system.includes("{\"kind\":\"const\",\"value\":\"requestHeaders\"}")
            && repairPrompt.system.includes("Do not leave handoff.put value or handoff.get target as null")
            && repairPrompt.system.includes("ConstructSurface records must use kind=\"construct\", className")
            && repairPrompt.system.includes("ConstructSurface endpoints must not use receiver")
            && repairPrompt.system.includes("When repairing to plane=\"module\" for hidden receiver-field carriers")
            && repairPrompt.system.includes("Never drop modulePath when copying companion surfaces")
            && repairPrompt.system.includes("Template/reference integrity is mandatory after repair")
            && repairPrompt.system.includes("precision is required")
            && repairPrompt.system.includes("observed companion surface arities")
            && repairPrompt.system.includes("Replace module.event-emitter core capability drafts with kind=\"module.eventEmitter\""),
        "repair prompt must explicitly fix object-field shorthand handles, construct surfaces, module-only handoff, surface identity, and template refs",
    );
    assert(
        prompt.system.includes("formalParam=argN;name=...;semanticRole=...")
            && prompt.system.includes("requestWrapperEndpointHint")
            && prompt.system.includes("control-metadata")
            && prompt.system.includes("header-or-credential-payload"),
        "prompt must make structured request-wrapper parameter roles binding for endpoint choice",
    );
    assert(
        prompt.system.includes("registration callsite file")
            && prompt.system.includes("callerFile"),
        "prompt must require ownerless callback source provenance to use callerFile",
    );
    assert(prompt.user.includes("LocalChatUIKitClient.login"), "prompt must preserve same-name negative evidence");

    const hdWebCallbackInput: SemanticFlowDecisionInput = {
        anchor: {
            id: "api-modeling.HdWeb.onLoad.callbackRegister",
            surface: "HdWeb",
            methodSignature: "@commons/basic/src/main/ets/components/HdWeb.ets: HdWeb(Unknown)",
            filePath: "commons/basic/src/main/ets/components/HdWeb.ets",
            metaTags: ["api-modeling-candidate", "recall_callback_surface"],
        },
        draftId: "draft.HdWeb.onLoad",
        slice: {
            anchorId: "api-modeling.HdWeb.onLoad.callbackRegister",
            round: 0,
            template: "callable-transfer",
            observations: [
                "candidateOrigin=recall_callback_surface",
                "callbackProperties=onLoad",
                "topEntry=callbackOwnerResolved=true",
                "topEntry=resolvedCallbackOwnerFile=commons/basic/src/main/ets/components/HdWeb.ets",
            ],
            snippets: [
                {
                    label: "callsite-0",
                    code: "callerFile: features/home/src/main/ets/views/QuestionDetailComp.ets\nHdWeb({ controller: this.webController, onLoad: () => { this.webController.runJavaScript(`writeContent(${this.item.answer || ''})`) } })",
                },
                {
                    label: "owner",
                    code: "Web({ src: this.src, controller: this.controller }).onPageEnd(() => { this.onLoad() })",
                },
            ],
            companions: ["HdWeb"],
        },
        round: 0,
        history: [],
    };
    const hdWebCallbackDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeHdWebCallbackRegisterAsset(),
        }),
    });
    const hdWebCallbackDecision = await hdWebCallbackDecider.decide(hdWebCallbackInput);
    assert(
        hdWebCallbackDecision.status === "done",
        "arkmain callbackRegister assets must not be rejected as receiver-field carrier handoffs when caller callback body reads receiver fields",
    );

    const receiverCarrierInput: SemanticFlowDecisionInput = {
        anchor: {
            id: "api-modeling.AuthCarrier.request",
            owner: "AuthCarrier",
            surface: "request",
            methodSignature: "@entry/src/main/ets/AuthCarrier.ets: AuthCarrier.request()",
            filePath: "entry/src/main/ets/AuthCarrier.ets",
            metaTags: ["api-modeling-candidate", "receiver-field-carrier"],
        },
        draftId: "draft.AuthCarrier.request",
        slice: {
            anchorId: "api-modeling.AuthCarrier.request",
            round: 0,
            template: "multi-surface",
            observations: [
                "carrierRoots=1",
                "carrierRoot=this.authHeaders",
                "carrierTouch=read:this.authHeaders.read",
                "carrierCompanion=setAuthHeaders writes this.authHeaders",
            ],
            snippets: [
                {
                    label: "method",
                    code: "request() { const finalHeaders = {}; Object.assign(finalHeaders, this.authHeaders); this.logger.debug('headers', finalHeaders); }",
                },
                {
                    label: "carrier-sibling-setAuthHeaders",
                    code: "setAuthHeaders(headers: Record<string,string>) { this.authHeaders = headers; }",
                },
            ],
        },
        round: 0,
        history: [],
    };
    const receiverRuleOnlyDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeReceiverFieldRuleOnlySinkAsset(),
        }),
    });
    await expectRejects(
        () => receiverRuleOnlyDecider.decide(receiverCarrierInput),
        "requires plane=\"module\" object-field handoff companion",
    );
    const returnedValueSourceDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeReceiverFieldReturnedValueSourceAsset(),
        }),
    });
    const returnedValueSourceDecision = await returnedValueSourceDecider.decide({
        ...receiverCarrierInput,
        anchor: {
            ...receiverCarrierInput.anchor,
            id: "api-modeling.AuthCarrier.request.returned-value",
            metaTags: [
                ...(receiverCarrierInput.anchor.metaTags || []),
                "returned_value_surface",
            ],
        },
        slice: {
            ...receiverCarrierInput.slice,
            notes: [
                ...(receiverCarrierInput.slice.notes || []),
                "Focus this modeling item on the visible returned value.",
            ],
        },
    });
    assert(
        returnedValueSourceDecision.status === "done",
        "returned-value focused promiseResult rule.source should remain valid despite receiver carrier evidence",
    );
    const receiverObjectFieldDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeReceiverFieldObjectFieldHandoffAsset(),
        }),
    });
    const receiverObjectFieldDecision = await receiverObjectFieldDecider.decide(receiverCarrierInput);
    assert(receiverObjectFieldDecision.status === "done", "object-field module handoff companion should be accepted");

    const projectStorageWrapperInput: SemanticFlowDecisionInput = {
        anchor: {
            id: "api-modeling.ProjectKvStore.putData",
            owner: "ProjectKvStore",
            surface: "putData",
            methodSignature: "@entry/src/main/ets/pages/StaticStoragePage.ets: ProjectKvStore.putData(Unknown, Unknown)",
            filePath: "entry/src/main/ets/pages/StaticStoragePage.ets",
            metaTags: ["api-modeling-candidate", "direct-boundary", "project-storage-wrapper"],
        },
        draftId: "draft.ProjectKvStore.putData",
        slice: {
            anchorId: "api-modeling.ProjectKvStore.putData",
            round: 0,
            template: "multi-surface",
            observations: [
                "signature=@entry/src/main/ets/pages/StaticStoragePage.ets: ProjectKvStore.putData(Unknown, Unknown)",
                "method=putData",
                "argCount=2",
                "topEntry=directBoundaryNamespaceOwnerCallsite=true",
                "topEntry=directBoundaryResolvedImport=true",
                "topEntry=resolvedImportFile=entry/src/main/ets/utils/ProjectKvStore.ets",
                "topEntry=importSource=../utils/ProjectKvStore",
                "topEntry=declaredOwner=ProjectKvStore",
                "companion=ProjectKvStore.getData('session_token')",
            ],
            snippets: [
                {
                    label: "callsite-put",
                    code: "await ProjectKvStore.putData('session_token', this.token);",
                },
                {
                    label: "callsite-get",
                    code: "this.token = await ProjectKvStore.getData('session_token');",
                },
            ],
        },
        round: 0,
        history: [],
    };
    const projectStorageRuleOnlyDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeProjectStorageWrapperRuleOnlySinkAsset(),
        }),
    });
    await expectRejects(
        () => projectStorageRuleOnlyDecider.decide(projectStorageWrapperInput),
        "requires plane=\"module\" persistent-storage-slot handoff",
    );
    const projectStorageModuleDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeProjectStorageWrapperPersistentSlotAsset(),
        }),
    });
    const projectStorageModuleDecision = await projectStorageModuleDecider.decide(projectStorageWrapperInput);
    assert(projectStorageModuleDecision.status === "done", "persistent-storage-slot module handoff should be accepted");

    const projectStorageWrapperWithReceiverHelperInput: SemanticFlowDecisionInput = {
        ...projectStorageWrapperInput,
        anchor: {
            ...projectStorageWrapperInput.anchor,
            id: "api-modeling.ProjectKvStore.getData.receiver-helper",
            surface: "getData",
            methodSignature: "@entry/src/main/ets/pages/StaticStoragePage.ets: ProjectKvStore.getData(Unknown, Unknown)",
        },
        draftId: "draft.ProjectKvStore.getData.receiver-helper",
        slice: {
            ...projectStorageWrapperInput.slice,
            anchorId: "api-modeling.ProjectKvStore.getData.receiver-helper",
            observations: [
                ...projectStorageWrapperInput.slice.observations,
                "carrier-sibling-ui-helper=this.itemBuilder wraps the current call but does not store the data",
                "carrier-sibling-storage-helper=this.getPreferences reads the backing preferences helper",
                "companion=ProjectKvStore.getData('session_token', '')",
            ],
            snippets: [
                ...projectStorageWrapperInput.slice.snippets,
                {
                    label: "carrier-sibling-ui-helper",
                    code: "this.itemBuilder('profile', () => ProjectKvStore.getData('session_token', ''))",
                },
                {
                    label: "carrier-sibling-storage-helper",
                    code: "static async getData(key: string, defaultValue: string = '') { const preferences = await this.getPreferences(); return preferences.get(key, defaultValue); }",
                },
            ],
        },
    };
    const projectStorageRuleOnlyWithReceiverHelperDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeProjectStorageWrapperRuleOnlySinkAsset(),
        }),
    });
    await expectRejects(
        () => projectStorageRuleOnlyWithReceiverHelperDecider.decide(projectStorageWrapperWithReceiverHelperInput),
        "requires plane=\"module\" persistent-storage-slot handoff",
    );
    const projectStorageModuleWithReceiverHelperDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeProjectStorageWrapperPersistentSlotOverloadAsset(),
        }),
    });
    const projectStorageModuleWithReceiverHelperDecision = await projectStorageModuleWithReceiverHelperDecider.decide(projectStorageWrapperWithReceiverHelperInput);
    assert(
        projectStorageModuleWithReceiverHelperDecision.status === "done",
        "persistent-storage-slot module handoff must not be rejected by incidental receiver-field helper evidence",
    );

    const projectStorageWrapperOverloadInput: SemanticFlowDecisionInput = {
        ...projectStorageWrapperInput,
        anchor: {
            ...projectStorageWrapperInput.anchor,
            id: "api-modeling.ProjectKvStore.putData.overload-companion",
        },
        draftId: "draft.ProjectKvStore.putData.overload-companion",
        slice: {
            ...projectStorageWrapperInput.slice,
            anchorId: "api-modeling.ProjectKvStore.putData.overload-companion",
            observations: [
                ...projectStorageWrapperInput.slice.observations,
                "companion=ProjectKvStore.getData('session_token', '')",
            ],
            snippets: [
                ...projectStorageWrapperInput.slice.snippets,
                {
                    label: "callsite-get-default",
                    code: "this.token = await ProjectKvStore.getData('session_token', '');",
                },
            ],
        },
    };
    const projectStorageNarrowModuleDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeProjectStorageWrapperPersistentSlotAsset(),
        }),
    });
    await expectRejects(
        () => projectStorageNarrowModuleDecider.decide(projectStorageWrapperOverloadInput),
        "must cover every observed companion surface arity",
    );
    const projectStorageOverloadModuleDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeProjectStorageWrapperPersistentSlotOverloadAsset(),
        }),
    });
    const projectStorageOverloadDecision = await projectStorageOverloadModuleDecider.decide(projectStorageWrapperOverloadInput);
    assert(projectStorageOverloadDecision.status === "done", "persistent-storage-slot module handoff should cover observed overload/default get arities");

    const constructReceiverEndpointDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeConstructReceiverEndpointHandoffAsset(),
        }),
    });
    await expectRejects(
        () => constructReceiverEndpointDecider.decide(receiverCarrierInput),
        "must not use receiver on a construct surface",
    );

    const mixedPlaneModuleDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeReceiverFieldMixedPlaneModuleAsset(),
        }),
    });
    await expectRejects(
        () => mixedPlaneModuleDecider.decide(receiverCarrierInput),
        "kind rule.sink is not compatible with asset plane module",
    );

    const brokenRepairDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeBrokenObjectFieldModuleRepairAsset(),
        }),
    });
    await expectRejects(
        () => brokenRepairDecider.decide(receiverCarrierInput),
        "$.surfaces[1].modulePath must be a stable non-empty string",
    );

    const ownerMismatchDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeSendTextMessageAsset("MessageViewModel"),
        }),
    });
    await expectRejects(
        () => ownerMismatchDecider.decide({
            anchor: {
                id: "api-modeling.base-sendTextMessage",
                owner: "BaseMessageViewModel",
                surface: "sendTextMessage",
                methodSignature: "@chatuikit/src/main/ets/viewmodels/MessageViewModel.ets: BaseMessageViewModel.sendTextMessage(MessageContent, boolean, OnMessageError, OnMessageSuccess)",
                filePath: "chatuikit/src/main/ets/viewmodels/MessageViewModel.ets",
                metaTags: ["api-modeling-candidate", "instance"],
            },
            draftId: "draft.base-sendTextMessage",
            slice: {
                anchorId: "api-modeling.base-sendTextMessage",
                round: 0,
                template: "multi-surface",
                observations: [
                    "signature=@chatuikit/src/main/ets/viewmodels/MessageViewModel.ets: BaseMessageViewModel.sendTextMessage(MessageContent, boolean, OnMessageError, OnMessageSuccess)",
                    "method=sendTextMessage",
                    "methodSnippetSource=MessageViewModel implementation override forwards content to SDK sendMessage",
                ],
                snippets: [
                    {
                        label: "method",
                        code: "export class MessageViewModel extends BaseMessageViewModel { sendTextMessage(content?: MessageContent) { this.sendMessage(content); } }",
                    },
                ],
            },
            round: 0,
            history: [],
        }),
        "does not match analyzer-backed declaring owner BaseMessageViewModel",
    );

    const ownerAlignedDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeSendTextMessageAsset("BaseMessageViewModel"),
        }),
    });
    const ownerAlignedDecision = await ownerAlignedDecider.decide({
        anchor: {
            id: "api-modeling.base-sendTextMessage.ok",
            owner: "BaseMessageViewModel",
            surface: "sendTextMessage",
            methodSignature: "@chatuikit/src/main/ets/viewmodels/MessageViewModel.ets: BaseMessageViewModel.sendTextMessage(MessageContent, boolean, OnMessageError, OnMessageSuccess)",
            filePath: "chatuikit/src/main/ets/viewmodels/MessageViewModel.ets",
            metaTags: ["api-modeling-candidate", "instance"],
        },
        draftId: "draft.base-sendTextMessage.ok",
        slice: {
            anchorId: "api-modeling.base-sendTextMessage.ok",
            round: 0,
            template: "multi-surface",
            observations: ["signature owner is BaseMessageViewModel"],
            snippets: [],
        },
        round: 0,
        history: [],
    });
    assert(ownerAlignedDecision.status === "done", "signature-owner aligned project sink asset should be accepted");

    const ownerlessStaticDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeChatInputMenuViewCallbackSourceAsset("static-owner"),
        }),
    });
    await expectRejects(
        () => ownerlessStaticDecider.decide({
            anchor: {
                id: "api-modeling.ChatInputMenuView",
                owner: "",
                surface: "ChatInputMenuView",
                methodSignature: "@%unk/%unk: .ChatInputMenuView()",
                filePath: "chatuikit/src/main/ets/components/chat/ChatView.ets",
                metaTags: ["api-modeling-candidate", "static", "callback"],
            },
            draftId: "draft.ChatInputMenuView",
            slice: {
                anchorId: "api-modeling.ChatInputMenuView",
                round: 0,
                template: "multi-surface",
                observations: [
                    "signature=@%unk/%unk: .ChatInputMenuView()",
                    "callbackProperties=onClickSend",
                    "importSource=../../components/chat/ChatComponents",
                ],
                snippets: [],
            },
            round: 0,
            history: [],
        }),
        "must use ownerless free-function identity",
    );

    const ownerlessFunctionDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeChatInputMenuViewCallbackSourceAsset("free-function"),
        }),
    });
    const ownerlessFunctionDecision = await ownerlessFunctionDecider.decide({
        anchor: {
            id: "api-modeling.ChatInputMenuView.ok",
            owner: "",
            surface: "ChatInputMenuView",
            methodSignature: "@%unk/%unk: .ChatInputMenuView()",
            filePath: "chatuikit/src/main/ets/components/chat/ChatView.ets",
            metaTags: ["api-modeling-candidate", "static", "callback"],
        },
        draftId: "draft.ChatInputMenuView.ok",
            slice: {
                anchorId: "api-modeling.ChatInputMenuView.ok",
                round: 0,
                template: "multi-surface",
                observations: ["signature=@%unk/%unk: .ChatInputMenuView()"],
                snippets: [
                    {
                        label: "callsite",
                        code: "callerFile: chatuikit/src/main/ets/components/chat/ChatView.ets\ninvokeLine: 539\nChatInputMenuView({ onClickSend: (content: MessageContent) => { this.messageViewModel.sendTextMessage(content); } })",
                    },
                ],
            },
            round: 0,
            history: [],
        });
    assert(ownerlessFunctionDecision.status === "done", "ownerless component callback source should be accepted as free-function surface");

    const ownerlessReturnedValueOkDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeOwnerlessReturnedValueAsset("free-function"),
        }),
    });
    const ownerlessReturnedValueOk = await ownerlessReturnedValueOkDecider.decide({
        anchor: {
            id: "api-modeling.getHomeListAxios.ok",
            owner: "",
            surface: "getHomeListAxios",
            methodSignature: "@entry/src/main/ets/http/apiService.ets: getHomeListAxios(Unknown)",
            filePath: "entry/src/main/ets/http/apiService.ets",
            metaTags: ["api-modeling-candidate", "returned_value_surface"],
        },
        draftId: "draft.getHomeListAxios.ok",
        draft: {
            surfaces: [
                {
                    surfaceId: "surface.getHomeListAxios.free",
                    kind: "invoke",
                    modulePath: "entry/src/main/ets/http/apiService.ets",
                    functionName: "getHomeListAxios",
                    invokeKind: "free-function",
                    argCount: 1,
                    confidence: "certain",
                    provenance: { source: "analyzer" },
                },
            ],
        },
        slice: {
            anchorId: "api-modeling.getHomeListAxios.ok",
            round: 0,
            template: "multi-surface",
            observations: ["signature=@entry/src/main/ets/http/apiService.ets: getHomeListAxios(Unknown)", "returned-value modeling question"],
            snippets: [
                {
                    label: "callsite",
                    code: "export function getHomeListAxios(date: string = \"\") {\n  return axiosClient.get<HomeModel>({ url: baseUrl + \"api/v2/feed\" })\n}",
                },
            ],
        },
        round: 0,
        history: [],
    });
    assert(ownerlessReturnedValueOk.status === "done", "ownerless returned-value source should accept free-function surface");

    const ownerlessReturnedValueWrongSiblingDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeOwnerlessReturnedValueAsset("static-sibling-binding-static"),
        }),
    });
    await expectRejects(
        () => ownerlessReturnedValueWrongSiblingDecider.decide({
            anchor: {
                id: "api-modeling.getHomeListAxios.bad-sibling",
                owner: "",
                surface: "getHomeListAxios",
                methodSignature: "@entry/src/main/ets/http/apiService.ets: getHomeListAxios(Unknown)",
                filePath: "entry/src/main/ets/http/apiService.ets",
                metaTags: ["api-modeling-candidate", "returned_value_surface"],
            },
            draftId: "draft.getHomeListAxios.bad-sibling",
            draft: {
                surfaces: [
                    {
                        surfaceId: "surface.getHomeListAxios.free",
                        kind: "invoke",
                        modulePath: "entry/src/main/ets/http/apiService.ets",
                        functionName: "getHomeListAxios",
                        invokeKind: "free-function",
                        argCount: 1,
                        confidence: "certain",
                        provenance: { source: "analyzer" },
                    },
                    {
                        surfaceId: "surface.getHomeListAxios.static",
                        kind: "invoke",
                        modulePath: "entry/src/main/ets/http/apiService.ets",
                        ownerName: "apiService",
                        methodName: "getHomeListAxios",
                        invokeKind: "static",
                        argCount: 1,
                        confidence: "certain",
                        provenance: { source: "analyzer" },
                    },
                ],
            },
            slice: {
                anchorId: "api-modeling.getHomeListAxios.bad-sibling",
                round: 0,
                template: "multi-surface",
                observations: ["signature=@entry/src/main/ets/http/apiService.ets: getHomeListAxios(Unknown)", "returned-value modeling question"],
                snippets: [
                    {
                        label: "callsite",
                        code: "export function getHomeListAxios(date: string = \"\") {\n  return axiosClient.get<HomeModel>({ url: baseUrl + \"api/v2/feed\" })\n}",
                    },
                ],
            },
            round: 0,
            history: [],
        }),
        "must use ownerless free-function identity",
    );

    const ownerlessWrongCallerFileDecider = createSemanticFlowLlmDecider({
        repairInvalidJson: false,
        modelInvoker: async () => JSON.stringify({
            status: "done",
            asset: makeChatInputMenuViewCallbackSourceAsset(
                "free-function",
                "chatuikit/src/main/ets/components/chat/ChatComponents.ets",
            ),
        }),
    });
    await expectRejects(
        () => ownerlessWrongCallerFileDecider.decide({
            anchor: {
                id: "api-modeling.ChatInputMenuView.wrong-caller-file",
                owner: "",
                surface: "ChatInputMenuView",
                methodSignature: "@%unk/%unk: .ChatInputMenuView()",
                filePath: "chatuikit/src/main/ets/components/chat/ChatComponents.ets",
                metaTags: ["api-modeling-candidate", "static", "callback"],
            },
            draftId: "draft.ChatInputMenuView.wrong-caller-file",
            slice: {
                anchorId: "api-modeling.ChatInputMenuView.wrong-caller-file",
                round: 0,
                template: "multi-surface",
                observations: [
                    "signature=@%unk/%unk: .ChatInputMenuView()",
                    "importSource=../../components/chat/ChatComponents",
                ],
                snippets: [
                    {
                        label: "callsite",
                        code: "callerFile: chatuikit/src/main/ets/components/chat/ChatView.ets\ninvokeLine: 539\nChatInputMenuView({ onClickSend: (content: MessageContent) => { this.messageViewModel.sendTextMessage(content); } })",
                    },
                ],
            },
            round: 0,
            history: [],
        }),
        "must use analyzer-backed registration callerFile",
    );

    const candidates = [
        "getUserProfileFromCache",
        "getUserProfile",
        "getUnreadCount",
        "getGroupInfoFromCache",
        "createNotification",
        "getFrom",
    ].map((method, index) => ({
        callee_signature: `@chatuikit/src/main/ets/internal/manager/Manager${index}.ets: Manager${index}.${method}(Unknown)`,
        method,
        invokeKind: "instance",
        argCount: 1,
        sourceFile: `chatuikit/src/main/ets/internal/manager/Manager${index}.ets`,
        count: 1,
        candidateOrigin: "recall_api_surface",
        methodSnippet: `${method}(key: string) { return this.cache.get(key); }`,
    }));
    candidates.push({
        callee_signature: "@%unk/%unk: .ChatInputMenuView()",
        method: "ChatInputMenuView",
        invokeKind: "static",
        argCount: 1,
        sourceFile: "chatuikit/src/main/ets/components/chat/ChatComponents.ets",
        count: 1,
        candidateOrigin: "recall_callback_surface",
        callbackProperties: ["onClickSend", "onClickText"],
        contextSlices: [
            {
                callerFile: "chatuikit/src/main/ets/components/chat/ChatView.ets",
                callerMethod: "build",
                invokeLine: 539,
                invokeStmtText: "ChatInputMenuView({ onClickSend: (content: MessageContent) => { this.messageViewModel.sendTextMessage(content); }, onClickText: () => {} })",
                windowLines: "ChatInputMenuView({ onClickSend: (content: MessageContent) => { this.messageViewModel.sendTextMessage(content); } })",
                cfgNeighborStmts: [],
            },
        ],
    } as any);
    const selected = selectSemanticFlowRuleCandidatesForModeling(candidates as any, 6);
    assert(
        selected.some(item => item.method === "ChatInputMenuView"),
        "payload-carrying callback component candidate must survive a small SemanticFlow LLM budget",
    );

    const requestWrapperItem = buildSemanticFlowApiModelingCandidateItem({
        callee_signature: "@project/network/Client.ets: Client._request(Unknown, Unknown, Unknown, Unknown, Unknown)",
        method: "_request",
        invokeKind: "instance",
        argCount: 5,
        sourceFile: "project/network/Client.ets",
        methodSnippet: [
            "  1 |   async _request(",
            "  2 |     method: string,",
            "  3 |     path: string,",
            "  4 |     body?: string | ArrayBuffer,",
            "  5 |     headers?: RequestHeaders,",
            "  6 |     expectBinary: boolean = false",
            "  7 |   ): Promise<Response> {",
            "  8 |     const request = new Request(path, method, headers, body);",
            "  9 |     return await this.session.fetch(request);",
            " 10 |   }",
        ].join("\n"),
        methodSnippetSource: "test_request_wrapper",
    } as any);
    const requestObservations = requestWrapperItem.initialSlice.observations;
    assert(
        requestObservations.some(line => line.includes("formalParam=arg0;name=method") && line.includes("semanticRole=control-metadata")),
        `request wrapper observations must classify method as control metadata, got ${requestObservations.join(",")}`,
    );
    assert(
        requestObservations.some(line => line.includes("formalParam=arg1;name=path") && line.includes("semanticRole=destination-metadata")),
        `request wrapper observations must classify path as destination metadata, got ${requestObservations.join(",")}`,
    );
    assert(
        requestObservations.some(line => line.includes("formalParam=arg2;name=body") && line.includes("semanticRole=payload")),
        `request wrapper observations must classify body as payload, got ${requestObservations.join(",")}`,
    );
    assert(
        requestObservations.some(line => line.includes("formalParam=arg3;name=headers") && line.includes("semanticRole=header-or-credential-payload")),
        `request wrapper observations must classify headers as header payload, got ${requestObservations.join(",")}`,
    );
    assert(
        requestObservations.some(line => line.includes("requestWrapperEndpointHint=payload:arg2(body),arg3(headers) metadata:arg0(method),arg1(path)")),
        `request wrapper observations must summarize payload vs metadata slots, got ${requestObservations.join(",")}`,
    );

    console.log("PASS test_semanticflow_project_api_modeling_contract");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
