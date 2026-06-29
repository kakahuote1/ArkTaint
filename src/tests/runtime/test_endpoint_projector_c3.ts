import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { ArkAwaitExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import type { AssetEndpoint } from "../../core/assets/schema";
import type { SemanticEffectSite } from "../../core/api/effects/SemanticEffectSite";
import {
    getPagNodeResolutionAuditSnapshot,
    projectSemanticEffectEndpoint,
    resetPagNodeResolutionAudit,
} from "../../core/kernel/contracts/PagNodeResolution";
import { emitEndpointProjectionFacts } from "../../core/kernel/contracts/ModuleEmissionUtils";
import {
    completeEndpointResolutionLedger,
    isConsumableEndpointResolution,
} from "../../core/api/effects/EndpointResolutionLedger";
import {
    isResolvedEndpointRuntimeValueProjection,
    projectEndpointRuntimeValues,
} from "../../core/api/effects/EndpointAccessPathProjector";
import { toContainerFieldKey } from "../../core/kernel/model/ContainerSlotKeys";
import { buildEndpointResolutionSummary } from "../../cli/c6Diagnostics";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

class FakePagNode {
    constructor(private readonly id: number, private readonly pointsTo: number[] = []) {}

    getID(): number {
        return this.id;
    }

    getPointTo(): number[] {
        return this.pointsTo;
    }
}

class FakePag {
    private readonly valueToId = new Map<any, number>();
    private readonly nodes = new Map<number, FakePagNode>();
    private nextId = 1000;

    add(value: any, id: number, pointsTo: number[] = []): void {
        this.valueToId.set(value, id);
        this.nodes.set(id, new FakePagNode(id, pointsTo));
        for (const objectId of pointsTo) {
            if (!this.nodes.has(objectId)) this.nodes.set(objectId, new FakePagNode(objectId));
        }
    }

    getNodesByValue(value: any): Map<number, number> | undefined {
        const id = this.valueToId.get(value);
        return id === undefined ? undefined : new Map([[id, id]]);
    }

    getNode(id: number): FakePagNode | undefined {
        return this.nodes.get(id);
    }

    getOrNewNode(_contextId: number, value: any): FakePagNode {
        const existing = this.valueToId.get(value);
        if (existing !== undefined) return this.nodes.get(existing)!;
        const id = this.nextId++;
        this.add(value, id);
        return this.nodes.get(id)!;
    }
}

function site(endpoint: AssetEndpoint, capability: SemanticEffectSite["capability"] = "source"): SemanticEffectSite {
    return {
        effectSiteId: `effect:${capability}:${JSON.stringify(endpoint)}`,
        occurrenceId: "occurrence.c3",
        rawOccurrenceId: "raw.c3",
        canonicalApiId: "api:test:c3",
        capability,
        effectAssetId: "asset.c3",
        surfaceId: "surface.c3",
        bindingId: "binding.c3",
        effectTemplateId: "template.c3",
        endpointSpec: endpoint,
        endpointBindingRef: "value",
    };
}

function project(
    pag: FakePag,
    endpoint: AssetEndpoint,
    extra: Partial<Parameters<typeof projectSemanticEffectEndpoint>[0]> = {},
) {
    return projectSemanticEffectEndpoint({
        pag: pag as any,
        semanticSite: site(endpoint, extra.semanticSite?.capability || "source"),
        endpointSpec: endpoint,
        ...extra,
    });
}

function main(): void {
    const pag = new FakePag();
    resetPagNodeResolutionAudit(pag as any);

    const arg0 = new Local("arg0");
    const arg1 = new Local("arg1");
    const receiver = new Local("receiver");
    const rest = new Local("rest");
    const restValue0 = new Local("restValue0");
    const restValue1 = new Local("restValue1");
    const result = new Local("result");
    const callbackPayload = new Local("callbackPayload");
    const callbackResult = new Local("callbackResult");
    const fieldToken = new Local("fieldToken");
    const objectMessage = new Local("objectMessage");
    const modulePayload = new Local("modulePayload");
    const arkuiResource = new Local("arkuiResource");
    const optionMessage = new Local("optionMessage");
    const arrayPinValue = new Local("arrayPinValue");
    const lazyArg = new Local("lazyArg");
    const lazyMessage = new Local("lazyMessage");
    const carrierOnly = new Local("carrierOnly");
    const detachedArg = new Local("detachedArg");
    const canonicalDetachedArg = new Local("detachedArg");
    const optionArg = new Local("optionArg", {
        getClassSignature: () => ({
            toString: () => "@endpoint_projector_c3/Fake.ets: %AC0",
        }),
    } as any);

    pag.add(arg0, 10, [110]);
    pag.add(arg1, 11);
    pag.add(receiver, 111);
    pag.add(rest, 12);
    pag.add(restValue0, 25);
    pag.add(restValue1, 26);
    pag.add(result, 13);
    pag.add(callbackPayload, 14);
    pag.add(callbackResult, 15);
    pag.add(fieldToken, 16);
    pag.add(objectMessage, 17);
    pag.add(modulePayload, 18);
    pag.add(arkuiResource, 19);
    pag.add(optionMessage, 20);
    pag.add(optionArg, 21);
    pag.add(carrierOnly, 22, [220]);
    pag.add(canonicalDetachedArg, 23);
    pag.add(arrayPinValue, 24);

    const invokeExpr = {
        getArgs: () => [arg0, arg1, rest],
        getSpreadFlags: () => [false, false, true],
    };

    const argProjection = project(pag, { base: { kind: "arg", index: 1 } }, { invokeExpr });
    assert(argProjection.status === "resolved", "arg in range should resolve");
    assert(argProjection.record.consumer === "source", "ledger should default consumer from semantic capability");
    assert(argProjection.record.valueKind === "arg", "ledger should record arg value kind");
    assert(argProjection.record.endpointSpec.base.kind === "arg", "ledger should include endpoint spec");
    assert(argProjection.record.surfaceId === "surface.c3", "ledger should include surface id");
    assert(argProjection.record.bindingId === "binding.c3", "ledger should include binding id");
    assert(argProjection.record.effectTemplateId === "template.c3", "ledger should include template id");
    assert(argProjection.record.endpointKindGroup === "arg", "arg projection should be grouped as arg");
    assert(argProjection.record.consumerStatus === "consumable", "resolved arg should be consumable");
    assert(argProjection.materializedExact, "resolved arg should be exact");
    assert(argProjection.record.materializedExact, "ledger should record exact materialization");
    assert(argProjection.record.substitutionKind === "exact_pag_value", "arg should resolve from exact PAG value");

    const receiverProjection = project(
        pag,
        { base: { kind: "receiver" } },
        { fieldRef: { getBase: () => receiver } as any },
    );
    assert(receiverProjection.status === "resolved", "receiver endpoint should resolve from field receiver base");
    assert(receiverProjection.reason === "receiver_base", `unexpected receiver reason ${receiverProjection.reason}`);
    assert(receiverProjection.nodeIds[0] === 111, "receiver endpoint should resolve exact receiver PAG node");
    assert(receiverProjection.record.endpointKindGroup === "receiver", "receiver projection should be grouped as receiver");

    const spreadProjection = project(pag, { base: { kind: "arg", index: 2 } }, { invokeExpr });
    assert(spreadProjection.endpointPath === "arg2[]", `spread endpoint path should be exact, got ${spreadProjection.endpointPath}`);
    assert(spreadProjection.reason === "arg2_spread", `spread reason should be preserved, got ${spreadProjection.reason}`);
    assert(
        spreadProjection.fieldPath?.[0] === toContainerFieldKey("arr:*"),
        `spread endpoint should project array element field path, got ${spreadProjection.fieldPath?.join(".")}`,
    );
    assert(spreadProjection.record.endpointKindGroup === "rest_spread", "spread endpoint should be grouped as rest_spread");

    const restInvoke = {
        getArgs: () => [arg0, arg1, restValue0, restValue1],
        getSpreadFlags: () => [false, false, false, false],
    };
    const restProjection = project(pag, { base: { kind: "rest", startIndex: 2 } } as any, { invokeExpr: restInvoke });
    assert(restProjection.status === "resolved", "rest endpoint should resolve every runtime arg from startIndex");
    assert(restProjection.endpointPath === "rest2[]", `rest endpoint path should be explicit, got ${restProjection.endpointPath}`);
    assert(restProjection.reason === "rest2_all", `rest endpoint reason should be explicit, got ${restProjection.reason}`);
    assert(restProjection.nodeIds.join(",") === "25,26", `rest endpoint should resolve all rest arg nodes, got ${restProjection.nodeIds.join(",")}`);
    assert(restProjection.values[0] === restValue0 && restProjection.values[1] === restValue1, "rest endpoint should preserve all runtime rest values");
    assert(restProjection.record.endpointKindGroup === "rest_spread", "rest endpoint should be grouped as rest_spread");

    const lazyInvoke = {
        getArgs: () => [lazyArg],
        getSpreadFlags: () => [false],
    };
    const lazyArgNoMaterialization = project(pag, { base: { kind: "arg", index: 0 } }, { invokeExpr: lazyInvoke });
    assert(lazyArgNoMaterialization.status === "no_runtime_endpoint", "default projection must not fabricate a missing arg node");
    assert(lazyArgNoMaterialization.reason === "arg0_pag_node_missing", `missing arg node should be kind-aware, got ${lazyArgNoMaterialization.reason}`);
    assert(lazyArgNoMaterialization.record.failureCategory === "runtime_endpoint_missing", "missing runtime endpoint should have runtime failure category");
    assert(lazyArgNoMaterialization.record.consumerStatus === "blocked", "unresolved arg should be blocked");
    assert(!isConsumableEndpointResolution(lazyArgNoMaterialization.record), "unresolved arg endpoint must not be consumable");
    assert(
        emitEndpointProjectionFacts(pag as any, lazyArgNoMaterialization, "source", 0, "unresolved").length === 0,
        "unresolved endpoint projection must not emit module facts",
    );

    const materializationWithoutEvidence = project(pag, { base: { kind: "arg", index: 0 } }, { invokeExpr: lazyInvoke, allowNodeCreation: true });
    assert(materializationWithoutEvidence.status === "no_runtime_endpoint", "allowNodeCreation alone must not materialize an endpoint node");
    assert(
        (materializationWithoutEvidence.record.diagnosticDetails as any).materializationBlockedReason === "missing_exact_materialization_evidence",
        "ledger should explain materialization blocked by missing exact evidence",
    );
    assert(!isConsumableEndpointResolution(materializationWithoutEvidence.record), "materialization without evidence must not be consumable");

    const materializedArg = project(
        pag,
        { base: { kind: "arg", index: 0 } },
        {
            invokeExpr: lazyInvoke,
            allowNodeCreation: true,
            exactMaterializationEvidence: {
                kind: "semantic_effect_endpoint_ir",
                reason: "accepted semantic endpoint arg0 local",
                endpointBindingRef: "value",
            },
        },
    );
    assert(materializedArg.status === "resolved", "explicitly allowed source endpoint may materialize exact buildable arg node");
    assert(materializedArg.nodeIds[0] >= 1000, "materialized arg should receive a new PAG node");
    assert(materializedArg.record.substitutionKind === "exact_pag_value", "materialized arg should remain exact PAG value substitution");
    assert((materializedArg.record.diagnosticDetails as any).materializationEvidence.kind === "semantic_effect_endpoint_ir", "ledger should record exact materialization evidence");
    assert(isConsumableEndpointResolution(materializedArg.record), "resolved materialized endpoint should be consumable");
    assert(
        emitEndpointProjectionFacts(pag as any, materializedArg, "source", 0, "resolved").length === 1,
        "resolved consumable endpoint projection should emit one module fact",
    );
    const nonConsumableResolved = {
        ...materializedArg,
        materializedExact: false,
        record: {
            ...materializedArg.record,
            materializedExact: false,
        },
    };
    assert(
        emitEndpointProjectionFacts(pag as any, nonConsumableResolved, "source", 0, "non-consumable").length === 0,
        "resolved status without consumable exact ledger evidence must not emit module facts",
    );

    const methodScopedAnchor = {
        getCfg: () => ({
            getDeclaringMethod: () => ({
                getBody: () => ({
                    getLocals: () => ({
                        get: (name: string) => name === "detachedArg" ? canonicalDetachedArg : undefined,
                    }),
                }),
            }),
        }),
        toString: () => "sink(detachedArg)",
    };
    const detachedInvoke = {
        getArgs: () => [detachedArg],
        getSpreadFlags: () => [false],
    };
    const detachedProjection = project(
        pag,
        { base: { kind: "arg", index: 0 } },
        { stmt: methodScopedAnchor, invokeExpr: detachedInvoke },
    );
    assert(detachedProjection.status === "resolved", "method-scoped exact local canonicalization should resolve endpoint node");
    assert(detachedProjection.nodeIds[0] === 23, `detached arg should resolve canonical local node, got ${detachedProjection.nodeIds[0]}`);
    assert(detachedProjection.record.substitutionKind === "exact_pag_value", "canonical local substitution must stay exact");

    const runtimeMissingArg = project(pag, { base: { kind: "arg", index: 3 } }, { invokeExpr });
    assert(runtimeMissingArg.status === "not_applicable_no_data", "missing runtime arg should be overload/no-data, not an asset endpoint error");
    assert(runtimeMissingArg.reason === "arg3_not_present_in_runtime_overload", `unexpected missing runtime arg reason ${runtimeMissingArg.reason}`);
    assert(!runtimeMissingArg.record.materializedExact, "missing runtime arg endpoint must not materialize");
    assert(runtimeMissingArg.record.failureCategory === "overload_no_data", "missing runtime arg should have overload/no-data failure category");
    assert((runtimeMissingArg.record.diagnosticDetails as any).requestedIndex === 3, "ledger should record requested arg index");
    assert(!isConsumableEndpointResolution(runtimeMissingArg.record), "missing runtime arg endpoint must not be consumable");

    const invalidEndpoint = project(pag, { base: { kind: "arg", index: -1 } as any }, { invokeExpr });
    assert(invalidEndpoint.status === "asset_endpoint_error", "invalid endpoint shape should remain an asset endpoint error");
    assert(invalidEndpoint.reason === "arg-1_invalid_index", `unexpected invalid endpoint reason ${invalidEndpoint.reason}`);
    assert(invalidEndpoint.record.failureCategory === "schema_gate_missing", "invalid endpoint shape should point to schema gate failure");
    assert(!isConsumableEndpointResolution(invalidEndpoint.record), "asset endpoint error must not be consumable");

    const assignment = new ArkAssignStmt(result, arg0);
    const returnProjection = project(pag, { base: { kind: "return" } }, { stmt: assignment });
    assert(returnProjection.status === "resolved", "assigned return should resolve to assignment left");
    assert(returnProjection.reason === "return_assignment", `unexpected return reason ${returnProjection.reason}`);
    assert(returnProjection.record.anchor?.stmtText?.includes("result"), "ledger should include stmt anchor");
    assert(returnProjection.record.endpointKindGroup === "return", "return projection should be grouped as return");

    const unassignedReturn = project(pag, { base: { kind: "return" } });
    assert(unassignedReturn.status === "no_runtime_endpoint", "unassigned return must not fabricate a node");
    assert(unassignedReturn.reason === "return_requires_assignment", `unexpected unassigned return reason ${unassignedReturn.reason}`);

    const awaited = new ArkAssignStmt(result, new ArkAwaitExpr(arg0));
    const promiseResult = project(pag, { base: { kind: "promiseResult" } }, { stmt: awaited });
    assert(promiseResult.status === "resolved", "promise result assignment should resolve");
    assert(promiseResult.reason === "promiseResult_await_assignment", `unexpected promise result reason ${promiseResult.reason}`);
    assert(promiseResult.record.endpointKindGroup === "promise", "promiseResult projection should be grouped as promise");

    const promiseRejected = project(pag, { base: { kind: "promiseRejected" } }, { stmt: awaited });
    assert(promiseRejected.status === "resolved", "promise rejected assignment should resolve exact result anchor");
    assert(promiseRejected.endpointPath === "promiseRejected", "promiseRejected path should be explicit");

    const callbackArg = project(
        pag,
        { base: { kind: "callbackArg", callback: { kind: "arg", index: 0 }, argIndex: 0 } },
        { resolveCallbackArgumentValues: () => [callbackPayload] },
    );
    assert(callbackArg.status === "resolved", "callbackArg should resolve through callback resolver");
    assert(callbackArg.endpointPath === "callback:arg0.arg0", `unexpected callbackArg path ${callbackArg.endpointPath}`);
    assert(callbackArg.record.endpointKindGroup === "callback", "callbackArg projection should be grouped as callback");

    const callbackReturn = project(
        pag,
        { base: { kind: "callbackReturn", callback: { kind: "arg", index: 0 } } },
        { stmt: new ArkAssignStmt(callbackResult, arg0) },
    );
    assert(callbackReturn.status === "resolved", "callbackReturn should require exact callback return assignment");

    const constructorResult = project(pag, { base: { kind: "constructorResult" } }, { stmt: assignment });
    assert(constructorResult.status === "resolved", "constructorResult should resolve new expression result assignment");

    const objectLiteralProjection = project(
        pag,
        { base: { kind: "arg", index: 0 }, accessPath: ["nested", "token"] },
        {
            endpointValues: [{ nested: { token: fieldToken } }],
        },
    );
    assert(objectLiteralProjection.status === "resolved", "object literal accessPath should resolve exact property value");
    assert(objectLiteralProjection.nodeIds[0] === 16, "object literal accessPath should materialize property value node");
    assert(objectLiteralProjection.record.substitutionKind === "exact_access_path_value", "ledger should record accessPath value substitution");
    assert(objectLiteralProjection.record.endpointKindGroup === "object_access_path", "object literal accessPath should be grouped explicitly");

    const missingObjectLiteralNode = project(
        pag,
        { base: { kind: "arg", index: 0 }, accessPath: ["message"] },
        {
            endpointValues: [{ message: lazyMessage }],
        },
    );
    assert(missingObjectLiteralNode.status === "no_runtime_endpoint", "object literal property without a PAG node must not resolve by default");
    assert(missingObjectLiteralNode.nodeIds.length === 0, "object literal property must not create endpoint nodes by default");
    assert(
        missingObjectLiteralNode.reason === "arg0_access_path_pag_node_missing:message",
        `missing object literal property node should be explicit, got ${missingObjectLiteralNode.reason}`,
    );
    assert(!isConsumableEndpointResolution(missingObjectLiteralNode.record), "missing object literal endpoint must not be consumable");

    const carrierFieldProjection = project(
        pag,
        { base: { kind: "arg", index: 0 }, accessPath: ["payload"] },
        { endpointValues: [carrierOnly] },
    );
    assert(carrierFieldProjection.status === "resolved", "carrier field accessPath should resolve against an exact carrier PAG node");
    assert(carrierFieldProjection.nodeIds[0] === 220, "carrier field projection should anchor nodeIds to the exact object carrier node");
    assert(carrierFieldProjection.carrierNodeIds[0] === 220, "carrier field projection should preserve the exact object carrier node");
    assert(carrierFieldProjection.values[0] === carrierOnly, "carrier field projection should expose the exact carrier value to endpoint consumers");
    assert(carrierFieldProjection.fieldPath?.[0] === "payload", "carrier field projection should retain the requested field path");
    assert(carrierFieldProjection.record.substitutionKind === "exact_access_path_node", "ledger should record carrier-field node substitution");
    assert(isConsumableEndpointResolution(carrierFieldProjection.record), "carrier field projection should be consumable through carrier plus fieldPath");

    const fieldCarrier = {
        getFieldValue(name: string) {
            return name === "message" ? objectMessage : undefined;
        },
    };
    const fieldProjection = project(
        pag,
        { base: { kind: "arg", index: 0 }, accessPath: ["message"] },
        { endpointValues: [fieldCarrier] },
    );
    assert(fieldProjection.status === "resolved", "field/property accessPath should resolve exact property value");
    assert(fieldProjection.nodeIds[0] === 17, "field/property accessPath should resolve property node");
    assert(fieldProjection.record.endpointKindGroup === "object_access_path", "plain-object accessPath should be grouped explicitly");

    const optionArgAnchor = new ArkAssignStmt(new Local("ignored"), optionArg);
    const optionArgInvoke = {
        getArgs: () => [optionArg],
        getSpreadFlags: () => [false],
    };
    installFakeObjectLiteralCfg(optionArgAnchor, optionMessage, optionArg);
    const optionArgProjection = project(
        pag,
        { base: { kind: "arg", index: 0 }, accessPath: ["message"] },
        { stmt: optionArgAnchor, invokeExpr: optionArgInvoke },
    );
    assert(optionArgProjection.status === "resolved", "object literal arg accessPath should resolve from structured initializer evidence");
    assert(optionArgProjection.nodeIds[0] === 20, "object literal arg accessPath should resolve captured local node");
    assert(
        optionArgProjection.reason.includes("structured_access_path:message"),
        `object literal arg accessPath should record structured evidence, got ${optionArgProjection.reason}`,
    );

    const arrayObjectProjection = project(
        pag,
        { base: { kind: "arg", index: 0 }, accessPath: ["certificatePinning", "publicKeyHash"] },
        {
            endpointValues: [{ certificatePinning: [{ publicKeyHash: arrayPinValue, hashAlgorithm: "SHA-256" }] }],
        },
    );
    assert(arrayObjectProjection.status === "resolved", "array element object accessPath should resolve exact field value");
    assert(arrayObjectProjection.nodeIds[0] === 24, "array element object accessPath should materialize the nested field node");
    assert(
        arrayObjectProjection.reason.includes("structured_access_path:certificatePinning.publicKeyHash"),
        `array element object accessPath should record structured evidence, got ${arrayObjectProjection.reason}`,
    );
    assert(
        arrayObjectProjection.record.substitutionKind === "exact_access_path_value",
        "array element object accessPath should stay an exact field-value substitution",
    );

    const moduleProjection = project(
        pag,
        { base: { kind: "arg", index: 0 }, accessPath: ["payload"] },
        {
            consumer: "module",
            endpointValues: [{ payload: modulePayload }],
            contextId: 7,
        },
    );
    assert(moduleProjection.status === "resolved", "module carrier endpoint should resolve through common projector");
    assert(moduleProjection.record.consumer === "module", "ledger should preserve module consumer");
    assert(moduleProjection.record.contextId === 7, "ledger should preserve context id");
    assert(moduleProjection.record.endpointKindGroup === "module_carrier", "module consumer endpoint should be grouped as module carrier");

    const arkuiProjection = project(
        pag,
        { base: { kind: "arg", index: 0 }, accessPath: ["resource"] },
        {
            consumer: "arkui-resource",
            endpointValues: [{ resource: arkuiResource }],
        },
    );
    assert(arkuiProjection.status === "resolved", "ArkUI resource endpoint should resolve through common projector");
    assert(arkuiProjection.record.consumer === "arkui-resource", "ledger should preserve ArkUI resource consumer");
    assert(arkuiProjection.record.endpointKindGroup === "arkui_resource", "ArkUI resource endpoint should be grouped explicitly");

    const callbackMissing = project(
        pag,
        { base: { kind: "callbackArg", callback: { kind: "option", base: { base: { kind: "arg", index: 0 } }, accessPath: ["onReady"] }, argIndex: 0 } },
    );
    assert(callbackMissing.status === "no_runtime_endpoint", "missing callback binding must not resolve");
    assert(callbackMissing.reason === "callback_binding_missing", `unexpected callback missing reason ${callbackMissing.reason}`);

    const accessPathMissing = project(
        pag,
        { base: { kind: "arg", index: 0 }, accessPath: ["missing"] },
        { endpointValues: [{ other: arg0 }] },
    );
    assert(accessPathMissing.status === "unsupported_exact_shape", "unresolved accessPath must be an exact-shape block");
    assert(accessPathMissing.nodeIds.length === 0, "unresolved accessPath must not create endpoint nodes");
    assert(accessPathMissing.endpointPath === "arg0.missing", `missing accessPath should record exact path, got ${accessPathMissing.endpointPath}`);
    assert(accessPathMissing.record.fieldPath?.[0] === "missing", "missing accessPath ledger should record field path");
    assert(accessPathMissing.reason.includes("access_path_unresolved:missing"), `unexpected accessPath missing reason ${accessPathMissing.reason}`);
    assert(!isConsumableEndpointResolution(accessPathMissing.record), "unsupported accessPath endpoint must not be consumable");

    const noDataEndpoint = project(
        pag,
        { base: { kind: "arg", index: 0 } },
        { endpointValues: [] },
    );
    assert(noDataEndpoint.status === "not_applicable_no_data", "empty endpointValues should be classified as no-data");
    assert(noDataEndpoint.reason === "endpoint_values_empty", `empty endpoint values should be explicit, got ${noDataEndpoint.reason}`);
    assert(!isConsumableEndpointResolution(noDataEndpoint.record), "no-data endpoint must not be consumable");

    const unbuildableEndpoint = project(
        pag,
        { base: { kind: "arg", index: 0 }, accessPath: ["message"] },
        { endpointValues: [{ message: { text: "plain-object-not-pag-value" } }] },
    );
    assert(unbuildableEndpoint.status === "unsupported_exact_shape", "unbuildable accessPath value must not resolve");
    assert(unbuildableEndpoint.nodeIds.length === 0, "unbuildable value must not produce endpoint nodes");
    assert(!isConsumableEndpointResolution(unbuildableEndpoint.record), "unbuildable endpoint must not be consumable");

    const audit = getPagNodeResolutionAuditSnapshot(pag as any);
    assert(audit.endpointResolutionRecordCount === 29, `expected 29 endpoint ledger records, got ${audit.endpointResolutionRecordCount}`);
    assert(audit.endpointResolutionStatusCounts?.resolved === 19, "audit should summarize resolved endpoint projections");
    assert(audit.endpointResolutionStatusCounts?.asset_endpoint_error === 1, "audit should summarize asset endpoint errors");
    assert(audit.endpointResolutionStatusCounts?.no_runtime_endpoint === 5, "audit should summarize no-runtime endpoint blocks");
    assert(audit.endpointResolutionStatusCounts?.unsupported_exact_shape === 2, "audit should summarize unsupported exact shapes");
    assert(audit.endpointResolutionStatusCounts?.not_applicable_no_data === 2, "audit should summarize no-data endpoints");
    assert(
        (audit.endpointResolutionRecords || []).every(record =>
            record.consumer && record.consumerStatus && record.valueKind && typeof record.materializedExact === "boolean" && record.substitutionKind && record.endpointSpec,
        ),
        "every endpoint ledger record should carry C3 audit fields",
    );
    assert(
        (audit.endpointResolutionRecords || []).every(record =>
            record.status === "resolved" || !isConsumableEndpointResolution(record),
        ),
        "non-resolved endpoint records must not be consumable",
    );

    const endpointRecords = audit.endpointResolutionRecords || [];
    const semanticRows = endpointRecords.map(record => ({
        recordKind: "semantic_effect_site",
        effectSiteId: record.effectSiteId,
        capability: record.capability,
        endpointResolution: record,
    }));
    const endpointSummary = buildEndpointResolutionSummary(endpointRecords, semanticRows) as any;
    assert(endpointSummary.endpointRecordCountMatchesSemanticSites === true, "endpoint summary should report ledger/site count alignment");
    assert(endpointSummary.byEndpointKindGroup.rest_spread === 2, "summary should group rest/spread endpoints");
    assert(endpointSummary.byEndpointKindGroup.object_access_path >= 1, "summary should group object accessPath endpoints");
    assert(endpointSummary.byEndpointKindGroup.field_property >= 1, "summary should group field/property endpoints");
    assert(endpointSummary.byEndpointKindGroup.module_carrier === 1, "summary should group module carrier endpoints");
    assert(endpointSummary.byEndpointKindGroup.arkui_resource === 1, "summary should group ArkUI resource endpoints");
    assert(endpointSummary.byFailureCategory.overload_no_data === 2, "summary should classify overload/no-data blocks");
    assert(endpointSummary.byAssetEndpointErrorCategory.schema_gate_missing === 1, "summary should classify asset endpoint errors by schema gate");

    const completedLedger = completeEndpointResolutionLedger(
        [site({ base: { kind: "arg", index: 0 } }, "sink")],
        [],
    );
    assert(completedLedger.length === 1, "ledger completion should emit one record for an unprojected semantic site");
    assert(completedLedger[0].status === "no_runtime_endpoint", "unprojected semantic site must not use endpoint_projection_not_requested");
    assert(
        completedLedger[0].reason === "mandatory_endpoint_projection_missing",
        `unexpected unprojected reason ${completedLedger[0].reason}`,
    );
    assert(completedLedger[0].endpointKindGroup === "arg", "unprojected completion should keep endpoint kind group");
    assert(completedLedger[0].failureCategory === "runtime_endpoint_missing", "unprojected completion should classify runtime endpoint missing");
    assert(completedLedger[0].consumerStatus === "blocked", "unprojected completion must be blocked");
    assert(!isConsumableEndpointResolution(completedLedger[0]), "unprojected endpoint completion must not be consumable");

    assertConsumerProjectionGateMatrix();
    assertRuntimeValueProjectorClassification();

    console.log("PASS test_endpoint_projector_c3");
}

function assertConsumerProjectionGateMatrix(): void {
    const consumers = ["source", "sink", "sanitizer", "transfer", "module", "arkmain"] as const;
    for (const consumer of consumers) {
        const pag = new FakePag();
        resetPagNodeResolutionAudit(pag as any);
        const resolvedValue = new Local(`resolved_${consumer}`);
        const missingValue = new Local(`missing_${consumer}`);
        const endpoint: AssetEndpoint = { base: { kind: "arg", index: 0 } };
        pag.add(resolvedValue, 700);

        const resolved = project(
            pag,
            endpoint,
            {
                semanticSite: site(endpoint, consumer as any),
                consumer,
                invokeExpr: {
                    getArgs: () => [resolvedValue],
                    getSpreadFlags: () => [false],
                },
            },
        );
        assert(resolved.status === "resolved", `${consumer} resolved endpoint should use common projector`);
        assert(resolved.record.consumer === consumer, `${consumer} ledger should record consumer`);
        assert(resolved.record.consumerStatus === "consumable", `${consumer} resolved endpoint should be consumable`);
        assert(isConsumableEndpointResolution(resolved.record), `${consumer} resolved endpoint should pass common gate`);

        const blocked = project(
            pag,
            endpoint,
            {
                semanticSite: site(endpoint, consumer as any),
                consumer,
                invokeExpr: {
                    getArgs: () => [missingValue],
                    getSpreadFlags: () => [false],
                },
            },
        );
        assert(blocked.status === "no_runtime_endpoint", `${consumer} missing PAG endpoint should be no_runtime_endpoint`);
        assert(blocked.record.consumer === consumer, `${consumer} blocked ledger should record consumer`);
        assert(blocked.record.consumerStatus === "blocked", `${consumer} missing endpoint should be blocked`);
        assert(!isConsumableEndpointResolution(blocked.record), `${consumer} blocked endpoint must fail common gate`);
    }
}

function assertRuntimeValueProjectorClassification(): void {
    const argValue = new Local("runtimeArg");
    const receiverValue = new Local("runtimeReceiver");
    const nestedValue = new Local("runtimeNested");
    const arrayNestedValue = new Local("runtimeArrayNested");
    const invokeExpr = {
        getArgs: () => [argValue],
        getSpreadFlags: () => [false],
    };

    const resolvedArg = projectEndpointRuntimeValues({
        endpoint: { base: { kind: "arg", index: 0 } },
        invokeExpr,
    });
    assert(resolvedArg.status === "resolved", "runtime projector should resolve arg0 values");
    assert(resolvedArg.values[0] === argValue, "runtime projector should return exact arg value");
    assert(isResolvedEndpointRuntimeValueProjection(resolvedArg), "resolved runtime arg should pass runtime gate");

    const resolvedReceiver = projectEndpointRuntimeValues({
        endpoint: { base: { kind: "receiver" } },
        receiver: receiverValue,
    });
    assert(resolvedReceiver.status === "resolved", "runtime projector should resolve explicit receiver values");
    assert(resolvedReceiver.endpointPath === "base", `receiver endpoint path should be base, got ${resolvedReceiver.endpointPath}`);

    const objectAccessPath = projectEndpointRuntimeValues({
        endpoint: { base: { kind: "arg", index: 0 }, accessPath: ["nested", "token"] },
        endpointValues: [{ nested: { token: nestedValue } }],
    });
    assert(objectAccessPath.status === "resolved", "runtime projector should resolve object accessPath values");
    assert(objectAccessPath.values[0] === nestedValue, "runtime projector should preserve exact object accessPath value");
    assert(objectAccessPath.fieldPath?.join(".") === "nested.token", "runtime projector should record object field path");

    const arrayObjectAccessPath = projectEndpointRuntimeValues({
        endpoint: { base: { kind: "arg", index: 0 }, accessPath: ["certificatePinning", "publicKeyHash"] },
        endpointValues: [{ certificatePinning: [{ publicKeyHash: arrayNestedValue, hashAlgorithm: "SHA-256" }] }],
    });
    assert(arrayObjectAccessPath.status === "resolved", "runtime projector should resolve array element object accessPath values");
    assert(arrayObjectAccessPath.values[0] === arrayNestedValue, "runtime projector should preserve exact array element field value");
    assert(
        arrayObjectAccessPath.fieldPath?.join(".") === "certificatePinning.publicKeyHash",
        "runtime projector should record array element object field path",
    );

    const missingReceiver = projectEndpointRuntimeValues({
        endpoint: { base: { kind: "receiver" } },
    });
    assert(missingReceiver.status === "no_runtime_endpoint", "runtime projector should classify missing receiver as no_runtime_endpoint");
    assert(missingReceiver.reason === "receiver_runtime_value_missing", `unexpected receiver missing reason ${missingReceiver.reason}`);
    assert(!isResolvedEndpointRuntimeValueProjection(missingReceiver), "missing receiver must fail runtime gate");

    const invalidArg = projectEndpointRuntimeValues({
        endpoint: { base: { kind: "arg", index: -1 } as any },
        invokeExpr,
    });
    assert(invalidArg.status === "asset_endpoint_error", "runtime projector should classify invalid arg endpoint as asset_endpoint_error");
    assert(invalidArg.reason === "arg-1_invalid_index", `unexpected invalid arg reason ${invalidArg.reason}`);
    assert(invalidArg.failureCategory === "schema_gate_missing", "invalid arg should keep schema gate failure category");
    assert(!isResolvedEndpointRuntimeValueProjection(invalidArg), "asset endpoint error must fail runtime gate");
}

function installFakeObjectLiteralCfg(anchorStmt: ArkAssignStmt, optionMessage: Local, optionArg: Local): void {
    const locals = new Map<string, Local>([
        ["optionMessage", optionMessage],
        ["optionArg", optionArg],
    ]);
    const fakeClass = {
        getSignature: () => ({
            toString: () => "@endpoint_projector_c3/Fake.ets: %AC0",
        }),
        getFields: () => [
            {
                getName: () => "message",
                getSignature: () => ({
                    getFieldName: () => "message",
                }),
                getInitializer: () => ({
                    toString: () => "this.message = optionMessage",
                }),
            },
        ],
    };
    const fakeScene = {
        getClass: (signature: string) => signature === "@endpoint_projector_c3/Fake.ets: %AC0" ? fakeClass : undefined,
        getClasses: () => [fakeClass],
    };
    const fakeMethod = {
        getSignature: () => ({
            toString: () => "@endpoint_projector_c3/Fake.ets: main()",
        }),
        getBody: () => ({
            getLocals: () => locals,
        }),
        getDeclaringArkFile: () => ({
            getScene: () => fakeScene,
        }),
    };
    const fakeCfg = {
        getDeclaringMethod: () => fakeMethod,
        getStmts: () => [anchorStmt],
    };
    (anchorStmt as any).setCfg(fakeCfg);
}

main();
