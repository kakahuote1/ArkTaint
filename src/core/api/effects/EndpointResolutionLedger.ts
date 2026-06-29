import type {
    AssetEndpoint,
    CallbackLocator,
    EndpointProjectionFailureCategory,
    EndpointProjectionKindGroup,
} from "../../assets/schema";
import type { ApiEffectRole } from "../ApiOccurrenceIdentity";
import type { SemanticEffectSite } from "./SemanticEffectSite";

export type EndpointResolutionStatus =
    | "resolved"
    | "asset_endpoint_error"
    | "unsupported_exact_shape"
    | "no_runtime_endpoint"
    | "not_applicable_no_data"
    | "endpoint_projection_not_requested";

export type EndpointResolutionDiagnosticKind =
    | "asset_endpoint_error"
    | "unsupported_exact_shape"
    | "no_runtime_endpoint"
    | "not_applicable_no_data"
    | "endpoint_projection_not_requested";

export type EndpointProjectionConsumer =
    | ApiEffectRole
    | "source"
    | "sink"
    | "sanitizer"
    | "transfer"
    | "module"
    | "arkmain"
    | "handoff"
    | "arkui-resource";

export type EndpointResolutionValueKind =
    | "receiver"
    | "arg"
    | "rest"
    | "return"
    | "promiseResult"
    | "promiseRejected"
    | "callbackArg"
    | "callbackReturn"
    | "constructorResult"
    | "endpointValues";

export type EndpointResolutionSubstitutionKind =
    | "none"
    | "explicit_endpoint_node_ids"
    | "exact_pag_value"
    | "exact_access_path_value"
    | "exact_access_path_node";

export interface EndpointResolutionAnchor {
    stmtText?: string;
    methodSignature?: string;
}

export interface EndpointResolutionLedgerItem {
    effectSiteId: string;
    occurrenceId: string;
    rawOccurrenceId?: string;
    canonicalApiId: string;
    capability: ApiEffectRole;
    effectAssetId: string;
    surfaceId?: string;
    bindingId?: string;
    effectTemplateId?: string;
    endpointSpec: AssetEndpoint;
    endpointPath: string;
    endpointBaseKind: string;
    endpointKindGroup?: EndpointProjectionKindGroup;
    consumer: EndpointProjectionConsumer;
    consumerStatus: "consumable" | "blocked";
    valueKind: EndpointResolutionValueKind;
    status: EndpointResolutionStatus;
    reason: string;
    diagnosticKind?: EndpointResolutionDiagnosticKind;
    failureCategory?: EndpointProjectionFailureCategory;
    nodeIds: number[];
    carrierNodeIds: number[];
    anchor?: EndpointResolutionAnchor;
    materializedExact: boolean;
    substitutionKind: EndpointResolutionSubstitutionKind;
    contextId?: number;
    diagnosticDetails?: Record<string, unknown>;
    fieldPath?: string[];
    endpointBindingRef?: string;
}

export function isConsumableEndpointResolution(
    item: Pick<EndpointResolutionLedgerItem, "status" | "nodeIds" | "carrierNodeIds" | "fieldPath" | "materializedExact">,
): boolean {
    return isConsumableEndpointResolutionShape(item);
}

export interface EndpointResolutionLedgerItemInput {
    semanticSite: SemanticEffectSite;
    endpointPath: string;
    endpointBaseKind: string;
    consumer?: EndpointProjectionConsumer;
    valueKind?: EndpointResolutionValueKind;
    status: EndpointResolutionStatus;
    reason: string;
    diagnosticKind?: EndpointResolutionDiagnosticKind;
    nodeIds?: Iterable<number>;
    carrierNodeIds?: Iterable<number>;
    anchor?: EndpointResolutionAnchor;
    materializedExact?: boolean;
    substitutionKind?: EndpointResolutionSubstitutionKind;
    contextId?: number;
    diagnosticDetails?: Record<string, unknown>;
    fieldPath?: readonly string[];
    endpointKindGroup?: EndpointProjectionKindGroup;
    failureCategory?: EndpointProjectionFailureCategory;
}

export function createEndpointResolutionLedgerItem(
    input: EndpointResolutionLedgerItemInput,
): EndpointResolutionLedgerItem {
    const item: EndpointResolutionLedgerItem = {
        effectSiteId: input.semanticSite.effectSiteId,
        occurrenceId: input.semanticSite.occurrenceId,
        rawOccurrenceId: input.semanticSite.rawOccurrenceId,
        canonicalApiId: input.semanticSite.canonicalApiId,
        capability: input.semanticSite.capability,
        effectAssetId: input.semanticSite.effectAssetId,
        surfaceId: input.semanticSite.surfaceId,
        bindingId: input.semanticSite.bindingId,
        effectTemplateId: input.semanticSite.effectTemplateId,
        endpointSpec: cloneAssetEndpoint(input.semanticSite.endpointSpec),
        endpointPath: input.endpointPath,
        endpointBaseKind: input.endpointBaseKind,
        endpointKindGroup: input.endpointKindGroup || endpointKindGroupFromAssetEndpoint(input.semanticSite.endpointSpec),
        consumer: input.consumer || input.semanticSite.capability,
        consumerStatus: "blocked",
        valueKind: input.valueKind || endpointValueKindFromBaseKind(input.endpointBaseKind),
        status: input.status,
        reason: input.reason,
        diagnosticKind: input.diagnosticKind,
        failureCategory: input.failureCategory || defaultFailureCategory(input.status),
        nodeIds: normalizeNodeIds(input.nodeIds),
        carrierNodeIds: normalizeNodeIds(input.carrierNodeIds),
        anchor: cloneAnchor(input.anchor),
        materializedExact: input.materializedExact === true,
        substitutionKind: input.substitutionKind || "none",
        contextId: normalizeContextId(input.contextId),
        diagnosticDetails: cloneDiagnosticDetails(input.diagnosticDetails),
        fieldPath: normalizePath(input.fieldPath),
        endpointBindingRef: input.semanticSite.endpointBindingRef,
    };
    item.consumerStatus = isConsumableEndpointResolutionShape(item) ? "consumable" : "blocked";
    if (!item.rawOccurrenceId) delete item.rawOccurrenceId;
    if (!item.surfaceId) delete item.surfaceId;
    if (!item.bindingId) delete item.bindingId;
    if (!item.effectTemplateId) delete item.effectTemplateId;
    if (!item.endpointKindGroup) delete item.endpointKindGroup;
    if (!item.diagnosticKind) delete item.diagnosticKind;
    if (!item.failureCategory || item.failureCategory === "none") delete item.failureCategory;
    if (!item.anchor || Object.keys(item.anchor).length === 0) delete item.anchor;
    if (item.contextId === undefined) delete item.contextId;
    if (!item.diagnosticDetails || Object.keys(item.diagnosticDetails).length === 0) delete item.diagnosticDetails;
    if (!item.fieldPath || item.fieldPath.length === 0) delete item.fieldPath;
    if (!item.endpointBindingRef) delete item.endpointBindingRef;
    return item;
}

export function createUnprojectedEndpointResolutionLedgerItem(
    semanticSite: SemanticEffectSite,
    reason: string = "mandatory_endpoint_projection_missing",
): EndpointResolutionLedgerItem {
    return createEndpointResolutionLedgerItem({
        semanticSite,
        endpointPath: endpointPathFromAssetEndpoint(semanticSite.endpointSpec),
        endpointBaseKind: semanticSite.endpointSpec.base.kind,
        status: "no_runtime_endpoint",
        reason,
        diagnosticKind: "no_runtime_endpoint",
        endpointKindGroup: endpointKindGroupFromAssetEndpoint(semanticSite.endpointSpec),
        failureCategory: "runtime_endpoint_missing",
        diagnosticDetails: {
            mandatoryProjectionRecordMissing: true,
        },
    });
}

export function completeEndpointResolutionLedger(
    semanticSites: Iterable<SemanticEffectSite>,
    projectedItems: Iterable<EndpointResolutionLedgerItem>,
): EndpointResolutionLedgerItem[] {
    const out: EndpointResolutionLedgerItem[] = [];
    const projectedSiteIds = new Set<string>();
    for (const item of projectedItems) {
        const cloned = cloneEndpointResolutionLedgerItem(item);
        out.push(cloned);
        projectedSiteIds.add(cloned.effectSiteId);
    }
    for (const semanticSite of semanticSites) {
        if (projectedSiteIds.has(semanticSite.effectSiteId)) continue;
        out.push(createUnprojectedEndpointResolutionLedgerItem(semanticSite));
    }
    return out;
}

export function cloneEndpointResolutionLedgerItem(
    item: EndpointResolutionLedgerItem,
): EndpointResolutionLedgerItem {
    const cloned: EndpointResolutionLedgerItem = {
        effectSiteId: item.effectSiteId,
        occurrenceId: item.occurrenceId,
        rawOccurrenceId: item.rawOccurrenceId,
        canonicalApiId: item.canonicalApiId,
        capability: item.capability,
        effectAssetId: item.effectAssetId,
        surfaceId: item.surfaceId,
        bindingId: item.bindingId,
        effectTemplateId: item.effectTemplateId,
        endpointSpec: cloneAssetEndpoint(item.endpointSpec),
        endpointPath: item.endpointPath,
        endpointBaseKind: item.endpointBaseKind,
        endpointKindGroup: item.endpointKindGroup,
        consumer: item.consumer,
        consumerStatus: item.consumerStatus || (isConsumableEndpointResolutionShape(item) ? "consumable" : "blocked"),
        valueKind: item.valueKind,
        status: item.status,
        reason: item.reason,
        diagnosticKind: item.diagnosticKind,
        failureCategory: item.failureCategory,
        nodeIds: [...item.nodeIds],
        carrierNodeIds: [...item.carrierNodeIds],
        anchor: cloneAnchor(item.anchor),
        materializedExact: item.materializedExact === true,
        substitutionKind: item.substitutionKind || "none",
        contextId: normalizeContextId(item.contextId),
        diagnosticDetails: cloneDiagnosticDetails(item.diagnosticDetails),
        fieldPath: item.fieldPath ? [...item.fieldPath] : undefined,
        endpointBindingRef: item.endpointBindingRef,
    };
    if (!cloned.rawOccurrenceId) delete cloned.rawOccurrenceId;
    if (!cloned.surfaceId) delete cloned.surfaceId;
    if (!cloned.bindingId) delete cloned.bindingId;
    if (!cloned.effectTemplateId) delete cloned.effectTemplateId;
    if (!cloned.endpointKindGroup) delete cloned.endpointKindGroup;
    if (!cloned.diagnosticKind) delete cloned.diagnosticKind;
    if (!cloned.failureCategory || cloned.failureCategory === "none") delete cloned.failureCategory;
    if (!cloned.anchor || Object.keys(cloned.anchor).length === 0) delete cloned.anchor;
    if (cloned.contextId === undefined) delete cloned.contextId;
    if (!cloned.diagnosticDetails || Object.keys(cloned.diagnosticDetails).length === 0) delete cloned.diagnosticDetails;
    if (!cloned.fieldPath || cloned.fieldPath.length === 0) delete cloned.fieldPath;
    if (!cloned.endpointBindingRef) delete cloned.endpointBindingRef;
    return cloned;
}

export function endpointPathFromAssetEndpoint(endpoint: AssetEndpoint): string {
    let base: string;
    switch (endpoint.base.kind) {
        case "receiver":
            base = "base";
            break;
        case "arg":
            base = `arg${endpoint.base.index}`;
            break;
        case "rest":
            base = `rest${endpoint.base.startIndex}[]`;
            break;
        case "return":
            base = "result";
            break;
        case "promiseResult":
            base = "promiseResult";
            break;
        case "promiseRejected":
            base = "promiseRejected";
            break;
        case "constructorResult":
            base = "constructorResult";
            break;
        case "callbackArg":
            base = `${callbackLocatorPath(endpoint.base.callback)}.arg${endpoint.base.argIndex}`;
            break;
        case "callbackReturn":
            base = `${callbackLocatorPath(endpoint.base.callback)}.return`;
            break;
    }
    const accessPath = normalizePath(endpoint.accessPath);
    return accessPath && accessPath.length > 0 ? `${base}.${accessPath.join(".")}` : base;
}

function callbackLocatorPath(locator: CallbackLocator): string {
    if (locator.kind === "arg") return `callback:arg${locator.index}`;
    const accessPath = normalizePath(locator.accessPath);
    const suffix = accessPath && accessPath.length > 0 ? `.${accessPath.join(".")}` : "";
    return `callback:option:${endpointPathFromAssetEndpoint(locator.base)}${suffix}`;
}

function normalizePath(path: readonly string[] | undefined): string[] | undefined {
    if (!path) return undefined;
    const normalized = path.map(item => String(item || "").trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
}

function cloneAssetEndpoint(endpoint: AssetEndpoint): AssetEndpoint {
    const cloned: AssetEndpoint = {
        base: cloneEndpointBase(endpoint.base),
    };
    const accessPath = normalizePath(endpoint.accessPath);
    if (accessPath) cloned.accessPath = accessPath;
    if (endpoint.taintScope) cloned.taintScope = endpoint.taintScope;
    return cloned;
}

function cloneEndpointBase(base: AssetEndpoint["base"]): AssetEndpoint["base"] {
    switch (base.kind) {
        case "receiver":
            return { kind: "receiver" };
        case "arg":
            return { kind: "arg", index: base.index };
        case "rest":
            return { kind: "rest", startIndex: base.startIndex };
        case "return":
            return { kind: "return" };
        case "promiseResult":
            return { kind: "promiseResult" };
        case "promiseRejected":
            return { kind: "promiseRejected" };
        case "constructorResult":
            return { kind: "constructorResult" };
        case "callbackArg":
            return {
                kind: "callbackArg",
                callback: cloneCallbackLocator(base.callback),
                argIndex: base.argIndex,
            };
        case "callbackReturn":
            return {
                kind: "callbackReturn",
                callback: cloneCallbackLocator(base.callback),
            };
    }
}

function cloneCallbackLocator(locator: CallbackLocator): CallbackLocator {
    if (locator.kind === "arg") return { kind: "arg", index: locator.index };
    return {
        kind: "option",
        base: cloneAssetEndpoint(locator.base),
        accessPath: normalizePath(locator.accessPath) || [],
    };
}

function isConsumableEndpointResolutionShape(
    item: Pick<EndpointResolutionLedgerItem, "status" | "nodeIds" | "carrierNodeIds" | "fieldPath" | "materializedExact">,
): boolean {
    if (item.status !== "resolved" || item.materializedExact !== true) return false;
    if (item.nodeIds.length > 0) return true;
    return !!item.fieldPath && item.fieldPath.length > 0 && item.carrierNodeIds.length > 0;
}

function normalizeNodeIds(nodeIds: Iterable<number> | undefined): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const rawNodeId of nodeIds || []) {
        const nodeId = Number(rawNodeId);
        if (!Number.isInteger(nodeId) || seen.has(nodeId)) continue;
        seen.add(nodeId);
        out.push(nodeId);
    }
    return out;
}

function endpointValueKindFromBaseKind(baseKind: string): EndpointResolutionValueKind {
    switch (baseKind) {
        case "receiver":
        case "arg":
        case "rest":
        case "return":
        case "promiseResult":
        case "promiseRejected":
        case "callbackArg":
        case "callbackReturn":
        case "constructorResult":
            return baseKind;
        default:
            return "endpointValues";
    }
}

function endpointKindGroupFromAssetEndpoint(endpoint: AssetEndpoint): EndpointProjectionKindGroup {
    if (endpoint.accessPath && endpoint.accessPath.length > 0) return "field_property";
    switch (endpoint.base.kind) {
        case "receiver":
            return "receiver";
        case "arg":
            return "arg";
        case "rest":
            return "rest_spread";
        case "return":
        case "constructorResult":
            return "return";
        case "promiseResult":
        case "promiseRejected":
            return "promise";
        case "callbackArg":
        case "callbackReturn":
            return "callback";
        default:
            return "unsupported";
    }
}

function defaultFailureCategory(status: EndpointResolutionStatus): EndpointProjectionFailureCategory {
    switch (status) {
        case "resolved":
            return "none";
        case "asset_endpoint_error":
            return "asset_endpoint_wrong";
        case "unsupported_exact_shape":
            return "unsupported_exact_shape";
        case "no_runtime_endpoint":
        case "endpoint_projection_not_requested":
            return "runtime_endpoint_missing";
        case "not_applicable_no_data":
            return "not_applicable_no_data";
    }
}

function cloneAnchor(anchor: EndpointResolutionAnchor | undefined): EndpointResolutionAnchor | undefined {
    if (!anchor) return undefined;
    const out: EndpointResolutionAnchor = {};
    if (typeof anchor.stmtText === "string" && anchor.stmtText.length > 0) out.stmtText = anchor.stmtText;
    if (typeof anchor.methodSignature === "string" && anchor.methodSignature.length > 0) out.methodSignature = anchor.methodSignature;
    return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeContextId(contextId: number | undefined): number | undefined {
    return Number.isInteger(contextId) ? Number(contextId) : undefined;
}

function cloneDiagnosticDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!details || Object.keys(details).length === 0) return undefined;
    return { ...details };
}
