import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import {
    ArkArrayRef,
    ArkInstanceFieldRef,
    ArkParameterRef,
    ArkStaticFieldRef,
    ArkThisRef,
} from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import {
    AbstractExpr,
    ArkAwaitExpr,
    ArkInstanceInvokeExpr,
    ArkNewArrayExpr,
    ArkNewExpr,
} from "../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import type {
    AssetEndpoint,
    CallbackLocator,
    EndpointProjectionFailureCategory,
    EndpointProjectionKindGroup,
} from "../../assets/schema";
import { resolveStructuredEndpointAccessPathValues } from "../../api/effects/EndpointAccessPathProjector";
import type { SemanticEffectSite } from "../../api/effects/SemanticEffectSite";
import {
    cloneEndpointResolutionLedgerItem,
    createEndpointResolutionLedgerItem,
    isConsumableEndpointResolution,
    type EndpointResolutionDiagnosticKind,
    type EndpointProjectionConsumer,
    type EndpointResolutionAnchor,
    type EndpointResolutionLedgerItem,
    type EndpointResolutionStatus,
    type EndpointResolutionSubstitutionKind,
    type EndpointResolutionValueKind,
} from "../../api/effects/EndpointResolutionLedger";
import { normalizeFieldPathSegments } from "../field/FieldPath";
import { toContainerFieldKey } from "../model/ContainerSlotKeys";

export interface PagNodeResolutionAuditSnapshot {
    requestCount: number;
    directHitCount: number;
    substitutedValueCount: number;
    awaitUnwrapCount: number;
    expressionUseResolveCount: number;
    anchorLeftResolveCount: number;
    addAttemptCount: number;
    addFailureCount: number;
    unresolvedCount: number;
    unsupportedValueKinds: Record<string, number>;
    endpointResolutionRecordCount?: number;
    endpointResolutionStatusCounts?: Partial<Record<EndpointResolutionStatus, number>>;
    endpointResolutionRecords?: SemanticEndpointResolutionRecord[];
}

export type SemanticEndpointResolutionStatus = EndpointResolutionStatus;

export type SemanticEndpointResolutionRecord = EndpointResolutionLedgerItem;

export interface SemanticEndpointProjection {
    semanticSite: SemanticEffectSite;
    endpointSpec: AssetEndpoint;
    endpointPath: string;
    endpointBaseKind: string;
    status: SemanticEndpointResolutionStatus;
    reason: string;
    diagnosticKind?: EndpointResolutionDiagnosticKind;
    values: any[];
    nodeIds: number[];
    carrierNodeIds: number[];
    fieldPath?: string[];
    materializedExact: boolean;
    substitutionKind: EndpointResolutionSubstitutionKind;
    record: SemanticEndpointResolutionRecord;
}

export interface SemanticEndpointProjectionInput {
    pag: Pag;
    semanticSite: SemanticEffectSite;
    endpointSpec?: AssetEndpoint;
    stmt?: any;
    invokeExpr?: any;
    fieldRef?: ArkInstanceFieldRef;
    contextId?: number;
    allowNodeCreation?: boolean;
    exactMaterializationEvidence?: ExactEndpointMaterializationEvidence;
    consumer?: EndpointProjectionConsumer;
    semanticNodeIds?: Iterable<number>;
    endpointValues?: Iterable<any>;
    resolveCallbackArgumentValues?: (callback: CallbackLocator, argIndex: number) => Iterable<any>;
    resolveEndpointAccessPathValues?: (
        values: readonly any[],
        accessPath: readonly string[],
        endpoint: AssetEndpoint,
    ) => Iterable<any>;
    resolveEndpointAccessPathNodeIds?: (
        values: readonly any[],
        accessPath: readonly string[],
        endpoint: AssetEndpoint,
    ) => Iterable<number>;
}

export interface ExactEndpointMaterializationEvidence {
    kind: "semantic_effect_endpoint_ir" | "runtime_endpoint_ir";
    reason: string;
    endpointBindingRef?: string;
}

interface MutablePagNodeResolutionAudit {
    requestCount: number;
    directHitCount: number;
    substitutedValueCount: number;
    awaitUnwrapCount: number;
    expressionUseResolveCount: number;
    anchorLeftResolveCount: number;
    addAttemptCount: number;
    addFailureCount: number;
    unresolvedCount: number;
    unsupportedValueKinds: Map<string, number>;
}

const pagNodeResolutionAuditByPag = new WeakMap<Pag, MutablePagNodeResolutionAudit>();
const semanticEndpointResolutionRecordsByPag = new WeakMap<Pag, SemanticEndpointResolutionRecord[]>();

export function projectSemanticEffectEndpoint(input: SemanticEndpointProjectionInput): SemanticEndpointProjection {
    const endpointSpec = input.endpointSpec || input.semanticSite.endpointSpec;
    const endpointPath = formatSemanticEndpointPath(endpointSpec, input.invokeExpr);
    const accessPath = normalizeFieldPathSegments(endpointSpec.accessPath);
    const fieldPath = resolveSemanticEndpointFieldPath(endpointSpec, input.invokeExpr, accessPath);
    const baseResolution = resolveSemanticEndpointBaseValues(input, endpointSpec);
    const endpointResolution = resolveEndpointAccessPath(input, endpointSpec, baseResolution, accessPath);
    const endpointValues = [...endpointResolution.values];
    const explicitNodeIds = input.semanticNodeIds === undefined
        ? undefined
        : normalizeExistingNodeIds(input.pag, input.semanticNodeIds);
    const explicitAccessPathNodeIds = endpointResolution.nodeIds === undefined
        ? undefined
        : normalizeExistingNodeIds(input.pag, endpointResolution.nodeIds);
    const allowNodeCreation = shouldMaterializeSemanticEndpointNodes(input, baseResolution, endpointResolution);
    const resolvedNodeIds = explicitNodeIds !== undefined
        ? explicitNodeIds
        : explicitAccessPathNodeIds !== undefined
            ? explicitAccessPathNodeIds
            : resolveSemanticEndpointValueNodeIds(input.pag, endpointValues, input.stmt, input.contextId, allowNodeCreation);
    const allowCarrierNodeCreation = shouldMaterializeSemanticEndpointCarrierNodes(input, baseResolution, accessPath);
    const carrierNodeIds = resolveSemanticEndpointCarrierNodeIds(
        input,
        baseResolution,
        resolvedNodeIds,
        accessPath,
        allowCarrierNodeCreation,
    );
    const resolvedByCarrierField = resolvedNodeIds.length === 0
        && isResolvedCarrierFieldEndpoint(baseResolution, carrierNodeIds, accessPath);
    const nodeIds = resolvedByCarrierField ? [...carrierNodeIds] : resolvedNodeIds;
    const values = resolvedByCarrierField && endpointValues.length === 0
        ? [...baseResolution.values]
        : endpointValues;
    const status = classifyEndpointResolutionStatus(
        baseResolution,
        endpointResolution,
        nodeIds,
        carrierNodeIds,
        accessPath,
        explicitNodeIds,
        explicitAccessPathNodeIds,
    );
    const reason = status === "resolved"
        ? resolvedByCarrierField
            ? `${baseResolution.reason}.access_path_carrier:${fieldPath!.join(".")}`
            : endpointResolution.reason
        : missingEndpointReason(
            endpointSpec,
            endpointResolution.reason,
            values,
            explicitNodeIds || explicitAccessPathNodeIds,
            fieldPath,
        );
    const diagnosticKind = status === "resolved"
        ? undefined
        : status;
    const materializedExact = status === "resolved" && (nodeIds.length > 0 || resolvedByCarrierField);
    const substitutionKind = resolveSubstitutionKind(
        explicitNodeIds,
        explicitAccessPathNodeIds,
        endpointResolution.substitutionKind,
        materializedExact,
        resolvedByCarrierField,
    );
    const record = createEndpointResolutionLedgerItem({
        semanticSite: input.semanticSite,
        endpointPath,
        endpointBaseKind: endpointSpec.base.kind,
        consumer: input.consumer,
        valueKind: baseResolution.valueKind,
        status,
        reason,
        diagnosticKind,
        nodeIds,
        carrierNodeIds,
        anchor: resolveEndpointAnchor(input.stmt),
        materializedExact,
        substitutionKind,
        contextId: input.contextId,
        endpointKindGroup: classifyEndpointKindGroup(input, endpointSpec, baseResolution, endpointResolution, accessPath, fieldPath),
        failureCategory: classifyEndpointFailureCategory(status, reason),
        diagnosticDetails: buildEndpointDiagnosticDetails(input, baseResolution, endpointResolution, accessPath, fieldPath, allowNodeCreation, status, reason),
        fieldPath: fieldPath && fieldPath.length > 0 ? [...fieldPath] : undefined,
    });
    const projection: SemanticEndpointProjection = {
        semanticSite: input.semanticSite,
        endpointSpec,
        endpointPath,
        endpointBaseKind: endpointSpec.base.kind,
        status,
        reason,
        diagnosticKind,
        values,
        nodeIds,
        carrierNodeIds,
        fieldPath: record.fieldPath,
        materializedExact,
        substitutionKind,
        record,
    };
    recordSemanticEndpointResolution(input.pag, projection);
    return projection;
}

function resolveSemanticEndpointFieldPath(
    endpoint: AssetEndpoint,
    invokeExpr: any,
    accessPath: readonly string[] | undefined,
): string[] | undefined {
    const segments: string[] = [];
    if (endpoint.base.kind === "arg" && isSpreadArg(invokeExpr, endpoint.base.index)) {
        segments.push(toContainerFieldKey("arr:*"));
    }
    if (accessPath && accessPath.length > 0) {
        segments.push(...accessPath);
    }
    return normalizeFieldPathSegments(segments);
}

function shouldMaterializeSemanticEndpointNodes(
    input: SemanticEndpointProjectionInput,
    baseResolution: EndpointBaseResolution,
    endpointResolution: EndpointValueResolution,
): boolean {
    if (input.allowNodeCreation !== true) return false;
    if (baseResolution.unsupported) return false;
    if (baseResolution.failureStatus || endpointResolution.failureStatus) return false;
    if (endpointResolution.nodeIds !== undefined) return false;
    if (!hasExactMaterializationEvidence(input)) return false;
    return endpointResolution.values.some(value => isBuildablePagValue(value));
}

function shouldMaterializeSemanticEndpointCarrierNodes(
    input: SemanticEndpointProjectionInput,
    baseResolution: EndpointBaseResolution,
    accessPath: readonly string[] | undefined,
): boolean {
    if (input.allowNodeCreation !== true) return false;
    if (!accessPath || accessPath.length === 0) return false;
    if (baseResolution.unsupported || baseResolution.failureStatus) return false;
    if (!hasExactMaterializationEvidence(input)) return false;
    return baseResolution.values.some(value => isBuildablePagValue(value));
}

function hasExactMaterializationEvidence(input: SemanticEndpointProjectionInput): boolean {
    const evidence = input.exactMaterializationEvidence;
    if (!evidence) return false;
    if (evidence.kind !== "semantic_effect_endpoint_ir" && evidence.kind !== "runtime_endpoint_ir") return false;
    if (typeof evidence.reason !== "string" || evidence.reason.trim().length === 0) return false;
    const endpointBindingRef = evidence.endpointBindingRef || input.semanticSite.endpointBindingRef;
    return typeof endpointBindingRef === "string" && endpointBindingRef.trim().length > 0;
}

export function recordSemanticEndpointResolution(
    pag: Pag,
    projection: SemanticEndpointProjection,
): void {
    const records = semanticEndpointResolutionRecordsByPag.get(pag) || [];
    records.push(cloneEndpointResolutionLedgerItem(projection.record));
    semanticEndpointResolutionRecordsByPag.set(pag, records);
}

export function getSemanticEndpointResolutionRecords(pag: Pag): SemanticEndpointResolutionRecord[] {
    return (semanticEndpointResolutionRecordsByPag.get(pag) || [])
        .map(record => cloneEndpointResolutionLedgerItem(record));
}

export function resetSemanticEndpointResolutionRecords(pag: Pag): void {
    semanticEndpointResolutionRecordsByPag.set(pag, []);
}

export function isConsumableSemanticEndpointProjection(projection: SemanticEndpointProjection): boolean {
    return isConsumableEndpointResolution(projection.record);
}

interface EndpointBaseResolution {
    values: any[];
    reason: string;
    valueKind: EndpointResolutionValueKind;
    unsupported?: boolean;
    failureStatus?: EndpointResolutionDiagnosticKind;
    diagnosticDetails?: Record<string, unknown>;
}

interface EndpointValueResolution {
    values: any[];
    reason: string;
    substitutionKind: EndpointResolutionSubstitutionKind;
    nodeIds?: Iterable<number>;
    failureStatus?: EndpointResolutionDiagnosticKind;
    diagnosticDetails?: Record<string, unknown>;
}

function resolveSemanticEndpointBaseValues(
    input: SemanticEndpointProjectionInput,
    endpoint: AssetEndpoint,
): EndpointBaseResolution {
    if (input.endpointValues !== undefined) {
        return {
            values: [...input.endpointValues].filter(value => value !== undefined && value !== null),
            reason: "endpoint_values_supplied",
            valueKind: "endpointValues",
        };
    }

    switch (endpoint.base.kind) {
        case "receiver": {
            const fieldRef = input.fieldRef || propertyWriteFieldRefFromStmt(input.stmt);
            const base = input.invokeExpr instanceof ArkInstanceInvokeExpr
                ? input.invokeExpr.getBase()
                : fieldRef?.getBase?.();
            return valueResult(base, "receiver_base", "receiver");
        }
        case "arg": {
            const args = input.invokeExpr?.getArgs?.() || [];
            const index = endpoint.base.index;
            if (!Number.isInteger(index) || index < 0) {
                return {
                    values: [],
                    reason: `arg${index}_invalid_index`,
                    valueKind: "arg",
                    failureStatus: "asset_endpoint_error",
                    diagnosticDetails: {
                        requestedIndex: index,
                        actualArgCount: args.length,
                        failureCategory: "schema_gate_missing",
                    },
                };
            }
            const propertyWriteValue = propertyWriteArgValueFromStmt(input, index);
            if (propertyWriteValue !== undefined) {
                return valueResult(propertyWriteValue, `arg${index}_property_write_rhs`, "arg");
            }
            if (index >= args.length) {
                return {
                    values: [],
                    reason: `arg${index}_not_present_in_runtime_overload`,
                    valueKind: "arg",
                    failureStatus: "not_applicable_no_data",
                    diagnosticDetails: {
                        requestedIndex: index,
                        actualArgCount: args.length,
                        failureCategory: "overload_no_data",
                    },
                };
            }
            return valueResult(args[index], isSpreadArg(input.invokeExpr, index) ? `arg${index}_spread` : `arg${index}`, "arg");
        }
        case "rest": {
            const args = input.invokeExpr?.getArgs?.() || [];
            const startIndex = endpoint.base.startIndex;
            if (!Number.isInteger(startIndex) || startIndex < 0) {
                return {
                    values: [],
                    reason: `rest${startIndex}_invalid_start_index`,
                    valueKind: "rest",
                    failureStatus: "asset_endpoint_error",
                    diagnosticDetails: {
                        requestedStartIndex: startIndex,
                        actualArgCount: args.length,
                        failureCategory: "schema_gate_missing",
                    },
                };
            }
            if (startIndex >= args.length) {
                return {
                    values: [],
                    reason: `rest${startIndex}_no_runtime_args`,
                    valueKind: "rest",
                    failureStatus: "not_applicable_no_data",
                    diagnosticDetails: {
                        requestedStartIndex: startIndex,
                        actualArgCount: args.length,
                        failureCategory: "overload_no_data",
                    },
                };
            }
            return {
                values: args.slice(startIndex).filter(value => value !== undefined && value !== null),
                reason: `rest${startIndex}_all`,
                valueKind: "rest",
                diagnosticDetails: {
                    requestedStartIndex: startIndex,
                    actualArgCount: args.length,
                    restArgCount: Math.max(0, args.length - startIndex),
                },
            };
        }
        case "return":
        case "constructorResult":
        case "callbackReturn":
            return valueResult(
                resultValueFromStmt(input.stmt),
                resultValueReason(input.stmt, endpoint.base.kind),
                endpoint.base.kind,
            );
        case "promiseResult":
        case "promiseRejected":
            return valueResult(
                resultValueFromStmt(input.stmt),
                resultValueReason(input.stmt, endpoint.base.kind),
                endpoint.base.kind,
            );
        case "callbackArg": {
            if (!Number.isInteger(endpoint.base.argIndex) || endpoint.base.argIndex < 0) {
                return {
                    values: [],
                    reason: `callback_arg${endpoint.base.argIndex}_invalid_index`,
                    valueKind: "callbackArg",
                    failureStatus: "asset_endpoint_error",
                    diagnosticDetails: {
                        callback: formatCallbackLocatorPath(endpoint.base.callback),
                        argIndex: endpoint.base.argIndex,
                        failureCategory: "schema_gate_missing",
                    },
                };
            }
            const values = input.resolveCallbackArgumentValues
                ? [...input.resolveCallbackArgumentValues(endpoint.base.callback, endpoint.base.argIndex)]
                    .filter(value => value !== undefined && value !== null)
                : [];
            return {
                values,
                reason: values.length > 0
                    ? `callback_arg${endpoint.base.argIndex}`
                    : "callback_binding_missing",
                valueKind: "callbackArg",
                diagnosticDetails: {
                    callback: formatCallbackLocatorPath(endpoint.base.callback),
                    argIndex: endpoint.base.argIndex,
                },
            };
        }
        default:
            return {
                values: [],
                reason: `endpoint_kind_unsupported:${(endpoint.base as any).kind || "unrecognized"}`,
                valueKind: "endpointValues",
                unsupported: true,
                failureStatus: "unsupported_exact_shape",
            };
    }
}

function resultValueFromStmt(stmt: any): any | undefined {
    if (stmt instanceof ArkAssignStmt) return stmt.getLeftOp?.();
    return undefined;
}

function resultValueReason(stmt: any, kind: string): string {
    if (!(stmt instanceof ArkAssignStmt)) return `${kind}_requires_assignment`;
    const right = stmt.getRightOp?.();
    if (right instanceof ArkAwaitExpr) return `${kind}_await_assignment`;
    return `${kind}_assignment`;
}

function propertyWriteFieldRefFromStmt(stmt: any): ArkInstanceFieldRef | undefined {
    if (!(stmt instanceof ArkAssignStmt)) return undefined;
    const left = stmt.getLeftOp?.();
    return left instanceof ArkInstanceFieldRef ? left : undefined;
}

function propertyWriteArgValueFromStmt(input: SemanticEndpointProjectionInput, index: number): any | undefined {
    if (index !== 0) return undefined;
    const fieldRef = propertyWriteFieldRefFromStmt(input.stmt);
    if (!fieldRef) return undefined;
    if (input.fieldRef && !sameInstanceFieldRef(input.fieldRef, fieldRef)) return undefined;
    return input.stmt.getRightOp?.();
}

function sameInstanceFieldRef(left: ArkInstanceFieldRef, right: ArkInstanceFieldRef): boolean {
    if (left === right) return true;
    const leftBase = left.getBase?.()?.toString?.() || "";
    const rightBase = right.getBase?.()?.toString?.() || "";
    if (leftBase !== rightBase) return false;
    const leftSignature = left.getFieldSignature?.()?.toString?.() || left.getFieldName?.() || "";
    const rightSignature = right.getFieldSignature?.()?.toString?.() || right.getFieldName?.() || "";
    return leftSignature.length > 0 && leftSignature === rightSignature;
}

function valueResult(value: any, reason: string, valueKind: EndpointResolutionValueKind): EndpointBaseResolution {
    return value === undefined || value === null
        ? { values: [], reason, valueKind }
        : { values: [value], reason, valueKind };
}

function resolveEndpointAccessPath(
    input: SemanticEndpointProjectionInput,
    endpoint: AssetEndpoint,
    baseResolution: EndpointBaseResolution,
    fieldPath: readonly string[] | undefined,
): EndpointValueResolution {
    if (!fieldPath || fieldPath.length === 0) {
        return {
            values: baseResolution.values,
            reason: baseResolution.reason,
            substitutionKind: "none",
            diagnosticDetails: baseResolution.diagnosticDetails,
        };
    }

    const explicitNodeIds = input.resolveEndpointAccessPathNodeIds
        ? [...input.resolveEndpointAccessPathNodeIds(baseResolution.values, fieldPath, endpoint)]
        : [];
    if (explicitNodeIds.length > 0) {
        return {
            values: [],
            nodeIds: explicitNodeIds,
            reason: `${baseResolution.reason}.access_path_node:${fieldPath.join(".")}`,
            substitutionKind: "exact_access_path_node",
            diagnosticDetails: baseResolution.diagnosticDetails,
        };
    }

    const suppliedValues = input.resolveEndpointAccessPathValues
        ? [...input.resolveEndpointAccessPathValues(baseResolution.values, fieldPath, endpoint)]
            .filter(value => value !== undefined && value !== null)
        : [];
    const structuredValues = suppliedValues.length > 0
        ? { values: [], reason: undefined, diagnosticDetails: undefined }
        : resolveStructuredEndpointAccessPathValues(baseResolution.values, fieldPath, input.stmt);
    const resolvedValues = suppliedValues.length > 0
        ? suppliedValues
        : structuredValues.values.length > 0
            ? structuredValues.values
            : resolveKnownAccessPathValues(baseResolution.values, fieldPath);
    if (resolvedValues.length > 0) {
        return {
            values: resolvedValues,
            reason: structuredValues.reason
                ? `${baseResolution.reason}.${structuredValues.reason}`
                : `${baseResolution.reason}.access_path:${fieldPath.join(".")}`,
            substitutionKind: "exact_access_path_value",
            diagnosticDetails: {
                ...(baseResolution.diagnosticDetails || {}),
                ...(structuredValues.diagnosticDetails || {}),
            },
        };
    }

    return {
        values: [],
        reason: `${baseResolution.reason}.access_path_unresolved:${fieldPath.join(".")}`,
        substitutionKind: "none",
        failureStatus: baseResolution.values.length > 0 ? "unsupported_exact_shape" : baseResolution.failureStatus,
        diagnosticDetails: {
            ...(baseResolution.diagnosticDetails || {}),
            accessPath: [...fieldPath],
            baseValueCount: baseResolution.values.length,
        },
    };
}

function resolveKnownAccessPathValues(values: readonly any[], fieldPath: readonly string[]): any[] {
    let current = [...values].filter(value => value !== undefined && value !== null);
    for (const segment of fieldPath) {
        const next: any[] = [];
        for (const value of current) {
            const exact = resolveKnownAccessSegmentValue(value, segment);
            if (exact !== undefined && exact !== null) next.push(exact);
        }
        current = dedupeValues(next);
        if (current.length === 0) break;
    }
    return current;
}

function resolveKnownAccessSegmentValue(value: any, segment: string): any | undefined {
    if (!value || !segment) return undefined;
    if (isFieldRefForSegment(value, segment)) return value;
    if (value instanceof Map) return value.has(segment) ? value.get(segment) : undefined;
    if (Object.prototype.hasOwnProperty.call(Object(value), segment)) return value[segment];
    for (const methodName of [
        "getPropertyValue",
        "getProperty",
        "getFieldValue",
        "getField",
        "getFieldWithName",
        "getValueForField",
    ]) {
        const method = value?.[methodName];
        if (typeof method !== "function") continue;
        const resolved = method.call(value, segment);
        if (resolved !== undefined && resolved !== null) return resolved;
    }
    return undefined;
}

function isFieldRefForSegment(value: any, segment: string): boolean {
    const fieldName = value?.getFieldSignature?.()?.getFieldName?.() || value?.getFieldName?.();
    return typeof fieldName === "string" && fieldName === segment;
}

function dedupeValues(values: readonly any[]): any[] {
    const out: any[] = [];
    const seen = new Set<any>();
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        out.push(value);
    }
    return out;
}

function resolveSubstitutionKind(
    explicitNodeIds: readonly number[] | undefined,
    explicitAccessPathNodeIds: readonly number[] | undefined,
    endpointSubstitutionKind: EndpointResolutionSubstitutionKind,
    materializedExact: boolean,
    resolvedByCarrierField: boolean,
): EndpointResolutionSubstitutionKind {
    if (explicitNodeIds !== undefined && explicitNodeIds.length > 0) return "explicit_endpoint_node_ids";
    if (explicitAccessPathNodeIds !== undefined && explicitAccessPathNodeIds.length > 0) return "exact_access_path_node";
    if (resolvedByCarrierField) return "exact_access_path_node";
    if (endpointSubstitutionKind !== "none") return endpointSubstitutionKind;
    return materializedExact ? "exact_pag_value" : "none";
}

function resolveEndpointAnchor(stmt: any): EndpointResolutionAnchor | undefined {
    const anchor: EndpointResolutionAnchor = {};
    const stmtText = stmt?.toString?.();
    if (typeof stmtText === "string" && stmtText.length > 0) anchor.stmtText = stmtText;
    const methodSignature = stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
    if (typeof methodSignature === "string" && methodSignature.length > 0) anchor.methodSignature = methodSignature;
    return Object.keys(anchor).length > 0 ? anchor : undefined;
}

function buildEndpointDiagnosticDetails(
    input: SemanticEndpointProjectionInput,
    baseResolution: EndpointBaseResolution,
    endpointResolution: EndpointValueResolution,
    accessPath: readonly string[] | undefined,
    fieldPath: readonly string[] | undefined,
    allowNodeCreation: boolean,
    status: SemanticEndpointResolutionStatus,
    reason: string,
): Record<string, unknown> | undefined {
    const details: Record<string, unknown> = {
        baseReason: baseResolution.reason,
        valueCount: endpointResolution.values.length,
        endpointKindGroup: classifyEndpointKindGroup(input, input.endpointSpec || input.semanticSite.endpointSpec, baseResolution, endpointResolution, accessPath, fieldPath),
        failureCategory: classifyEndpointFailureCategory(status, reason),
        consumerStatus: status === "resolved" ? "projected" : "blocked",
    };
    if (accessPath && accessPath.length > 0) details.accessPath = [...accessPath];
    if (fieldPath && fieldPath.length > 0 && fieldPath.join(".") !== (accessPath || []).join(".")) {
        details.fieldPath = [...fieldPath];
    }
    if (endpointResolution.nodeIds !== undefined) details.accessPathNodeIdsSupplied = true;
    if (input.allowNodeCreation === true) {
        details.nodeCreationRequested = true;
        if (allowNodeCreation) {
            details.materializationEvidence = {
                kind: input.exactMaterializationEvidence?.kind,
                reason: input.exactMaterializationEvidence?.reason,
                endpointBindingRef: input.exactMaterializationEvidence?.endpointBindingRef || input.semanticSite.endpointBindingRef,
            };
        } else if (endpointResolution.nodeIds === undefined && endpointResolution.values.some(value => isBuildablePagValue(value))) {
            details.materializationBlockedReason = "missing_exact_materialization_evidence";
        }
    }
    Object.assign(details, baseResolution.diagnosticDetails || {}, endpointResolution.diagnosticDetails || {});
    return details;
}

function classifyEndpointKindGroup(
    input: SemanticEndpointProjectionInput,
    endpoint: AssetEndpoint,
    baseResolution: EndpointBaseResolution,
    endpointResolution: EndpointValueResolution,
    accessPath: readonly string[] | undefined,
    fieldPath: readonly string[] | undefined,
): EndpointProjectionKindGroup {
    const consumer = input.consumer || input.semanticSite.capability;
    if (consumer === "module" || consumer === "handoff" || consumer === "arkmain") return "module_carrier";
    if (consumer === "arkui-resource" || isArkUiEndpoint(input.semanticSite.canonicalApiId)) return "arkui_resource";
    if (endpoint.base.kind === "callbackArg" || endpoint.base.kind === "callbackReturn") return "callback";
    if (endpoint.base.kind === "promiseResult" || endpoint.base.kind === "promiseRejected") return "promise";
    if (endpoint.base.kind === "receiver") return "receiver";
    if (endpoint.base.kind === "return" || endpoint.base.kind === "constructorResult") return "return";
    if (endpoint.base.kind === "arg" && isSpreadArg(input.invokeExpr, endpoint.base.index)) return "rest_spread";
    if (endpoint.base.kind === "rest") return "rest_spread";
    const normalizedFieldPath = fieldPath && fieldPath.length > 0 ? fieldPath : accessPath;
    if (normalizedFieldPath && normalizedFieldPath.length > 0) {
        if (endpointResolution.reason.includes("structured_access_path") || baseResolution.values.some(isPlainObjectEndpointCarrier)) {
            return "object_access_path";
        }
        return "field_property";
    }
    if (endpoint.base.kind === "arg") return "arg";
    return "unsupported";
}

function isArkUiEndpoint(canonicalApiId: string): boolean {
    const id = canonicalApiId.toLowerCase();
    return id.includes("domain=arkui") || id.includes("arkui") || id.includes("%40internal%2fcomponent");
}

function isPlainObjectEndpointCarrier(value: any): boolean {
    if (!value || typeof value !== "object") return false;
    if (value instanceof Map) return false;
    if (isBuildablePagValue(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function classifyEndpointFailureCategory(
    status: SemanticEndpointResolutionStatus,
    reason: string,
): EndpointProjectionFailureCategory {
    if (status === "resolved") return "none";
    if (status === "not_applicable_no_data") {
        return reason.includes("runtime_overload") || reason.includes("no_data") || reason.includes("endpoint_values_empty")
            ? "overload_no_data"
            : "not_applicable_no_data";
    }
    if (status === "asset_endpoint_error") {
        return reason.includes("invalid_index") || reason.includes("out_of_range")
            ? "schema_gate_missing"
            : "asset_endpoint_wrong";
    }
    if (status === "unsupported_exact_shape") return "unsupported_exact_shape";
    return "runtime_endpoint_missing";
}

function resolveSemanticEndpointValueNodeIds(
    pag: Pag,
    values: any[],
    anchorStmt: any,
    contextId: number | undefined,
    allowNodeCreation: boolean,
): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const value of values) {
        const nodes = allowNodeCreation
            ? materializeExactPagNodes(pag, value, anchorStmt, contextId || 0)
            : resolveExistingPagNodes(pag, value, anchorStmt);
        if (!nodes || nodes.size === 0) continue;
        for (const nodeId of nodes.values()) {
            if (seen.has(nodeId)) continue;
            seen.add(nodeId);
            out.push(nodeId);
        }
    }
    return out;
}

function resolveSemanticEndpointCarrierNodeIds(
    input: SemanticEndpointProjectionInput,
    baseResolution: EndpointBaseResolution,
    nodeIds: readonly number[],
    accessPath: readonly string[] | undefined,
    allowNodeCreation: boolean,
): number[] {
    const directCarrierNodeIds = resolveCarrierNodeIds(input.pag, nodeIds);
    if (directCarrierNodeIds.length > 0) return directCarrierNodeIds;
    if (!accessPath || accessPath.length === 0) return [];
    if (baseResolution.unsupported || baseResolution.failureStatus) return [];
    const baseNodeIds = resolveSemanticEndpointValueNodeIds(
        input.pag,
        baseResolution.values,
        input.stmt,
        input.contextId,
        allowNodeCreation,
    );
    return resolveCarrierNodeIds(input.pag, baseNodeIds);
}

function normalizeExistingNodeIds(pag: Pag, nodeIds: Iterable<number>): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const rawNodeId of nodeIds) {
        const nodeId = Number(rawNodeId);
        if (!Number.isInteger(nodeId) || seen.has(nodeId)) continue;
        if (!pag.getNode(nodeId)) continue;
        seen.add(nodeId);
        out.push(nodeId);
    }
    return out;
}

function resolveCarrierNodeIds(pag: Pag, nodeIds: readonly number[]): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    const add = (nodeId: number): void => {
        if (!Number.isInteger(nodeId) || seen.has(nodeId)) return;
        seen.add(nodeId);
        out.push(nodeId);
    };
    for (const nodeId of nodeIds) {
        const node = pag.getNode(nodeId) as any;
        let hasPointTo = false;
        for (const objectId of node?.getPointTo?.() || []) {
            hasPointTo = true;
            add(Number(objectId));
        }
        if (!hasPointTo) add(nodeId);
    }
    return out;
}

function missingEndpointReason(
    endpoint: AssetEndpoint,
    valueReason: string,
    values: readonly any[],
    explicitNodeIds?: readonly number[],
    fieldPath?: readonly string[],
): string {
    const prefix = endpointReasonPrefix(endpoint);
    if (explicitNodeIds !== undefined && explicitNodeIds.length === 0) {
        return `${prefix}_node_resolver_empty`;
    }
    if (values.length === 0) {
        return endpointValueMissingReason(endpoint, valueReason);
    }
    if (values.every(isNoDataEndpointValue)) {
        return `${prefix}_no_data_constant`;
    }
    if (fieldPath && fieldPath.length > 0) {
        return `${prefix}_access_path_pag_node_missing:${fieldPath.join(".")}`;
    }
    return `${prefix}_pag_node_missing`;
}

function endpointValueMissingReason(endpoint: AssetEndpoint, valueReason: string): string {
    if (valueReason.includes("access_path_unresolved:")) return valueReason;
    if (valueReason === "endpoint_values_supplied") return "endpoint_values_empty";
    if (valueReason === "receiver_base") return "receiver_runtime_value_missing";
    if (valueReason === "callback_binding_missing") return valueReason;
    if (valueReason.endsWith("_requires_assignment")) return valueReason;
    if (valueReason.endsWith("_not_present_in_runtime_overload")) return valueReason;
    if (valueReason.endsWith("_out_of_range") || valueReason.endsWith("_invalid_index")) return valueReason;
    return `${endpointReasonPrefix(endpoint)}_runtime_value_missing:${valueReason}`;
}

function endpointReasonPrefix(endpoint: AssetEndpoint): string {
    switch (endpoint.base.kind) {
        case "receiver":
            return "receiver";
        case "arg":
            return `arg${endpoint.base.index}`;
        case "rest":
            return `rest${endpoint.base.startIndex}`;
        case "return":
            return "return";
        case "promiseResult":
            return "promiseResult";
        case "promiseRejected":
            return "promiseRejected";
        case "constructorResult":
            return "constructorResult";
        case "callbackArg":
            return `callbackArg${endpoint.base.argIndex}`;
        case "callbackReturn":
            return "callbackReturn";
        default:
            return `endpoint_${String((endpoint.base as any).kind || "unrecognized")}`;
    }
}

function classifyEndpointResolutionStatus(
    baseResolution: EndpointBaseResolution,
    endpointResolution: EndpointValueResolution,
    nodeIds: readonly number[],
    carrierNodeIds: readonly number[],
    accessPath: readonly string[] | undefined,
    explicitNodeIds?: readonly number[],
    explicitAccessPathNodeIds?: readonly number[],
): SemanticEndpointResolutionStatus {
    if (nodeIds.length > 0) return "resolved";
    if (isResolvedCarrierFieldEndpoint(baseResolution, carrierNodeIds, accessPath)) return "resolved";
    if (baseResolution.failureStatus) return baseResolution.failureStatus;
    if (endpointResolution.failureStatus) return endpointResolution.failureStatus;
    if (baseResolution.unsupported) return "unsupported_exact_shape";
    if (explicitNodeIds !== undefined || explicitAccessPathNodeIds !== undefined) return "no_runtime_endpoint";
    if (endpointResolution.values.length === 0) {
        return baseResolution.reason === "endpoint_values_supplied"
            ? "not_applicable_no_data"
            : "no_runtime_endpoint";
    }
    if (endpointResolution.values.every(isNoDataEndpointValue)) return "not_applicable_no_data";
    if (endpointResolution.values.every(value => !isBuildablePagValue(value))) return "unsupported_exact_shape";
    return "no_runtime_endpoint";
}

function isResolvedCarrierFieldEndpoint(
    baseResolution: EndpointBaseResolution,
    carrierNodeIds: readonly number[],
    accessPath: readonly string[] | undefined,
): boolean {
    return !!accessPath
        && accessPath.length > 0
        && baseResolution.values.length > 0
        && !baseResolution.unsupported
        && !baseResolution.failureStatus
        && carrierNodeIds.length > 0;
}

function isNoDataEndpointValue(value: any): boolean {
    return value instanceof Constant;
}

export function formatSemanticEndpointPath(endpoint: AssetEndpoint, invokeExpr?: any): string {
    let base: string;
    switch (endpoint.base.kind) {
        case "receiver":
            base = "base";
            break;
        case "arg":
            base = `arg${endpoint.base.index}${isSpreadArg(invokeExpr, endpoint.base.index) ? "[]" : ""}`;
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
            base = `${formatCallbackLocatorPath(endpoint.base.callback)}.arg${endpoint.base.argIndex}`;
            break;
        case "callbackReturn":
            base = `${formatCallbackLocatorPath(endpoint.base.callback)}.return`;
            break;
        default:
            base = String((endpoint.base as any).kind || "unrecognized");
            break;
    }
    const accessPath = normalizeFieldPathSegments(endpoint.accessPath);
    return accessPath && accessPath.length > 0 ? `${base}.${accessPath.join(".")}` : base;
}

function formatCallbackLocatorPath(locator: CallbackLocator): string {
    if (locator.kind === "arg") return `callback:arg${locator.index}`;
    const accessPath = normalizeFieldPathSegments(locator.accessPath);
    const suffix = accessPath && accessPath.length > 0 ? `.${accessPath.join(".")}` : "";
    return `callback:option:${formatSemanticEndpointPath(locator.base)}${suffix}`;
}

function isSpreadArg(invokeExpr: any, index: number): boolean {
    if (!Number.isInteger(index) || index < 0) return false;
    const flags = invokeExpr?.getSpreadFlags?.();
    return Array.isArray(flags) && flags[index] === true;
}

export function resolveExistingPagNodes(
    pag: Pag,
    value: any,
    anchorStmt?: any,
): Map<number, number> | undefined {
    const audit = getMutableAudit(pag);
    audit.requestCount++;
    let nodes = pag.getNodesByValue(value);
    if (nodes && nodes.size > 0) {
        audit.directHitCount++;
        return nodes;
    }

    const canonicalLocal = resolveCanonicalLocalFromAnchor(value, anchorStmt);
    if (canonicalLocal && canonicalLocal !== value) {
        nodes = pag.getNodesByValue(canonicalLocal);
        if (nodes && nodes.size > 0) {
            audit.substitutedValueCount++;
            return nodes;
        }
    }

    const pagValue = resolvePagNodeValue(value, anchorStmt, new Set(), audit);
    if (!pagValue) {
        audit.unresolvedCount++;
        recordValueKind(audit.unsupportedValueKinds, value);
        return undefined;
    }
    if (pagValue !== value) {
        audit.substitutedValueCount++;
    }

    if (pagValue !== value) {
        nodes = pag.getNodesByValue(pagValue);
        if (nodes && nodes.size > 0) {
            return nodes;
        }
    }

    audit.unresolvedCount++;
    return undefined;
}

function resolveCanonicalLocalFromAnchor(value: any, anchorStmt?: any): Local | undefined {
    if (!(value instanceof Local)) return undefined;
    const name = value.getName?.();
    if (typeof name !== "string" || name.length === 0) return undefined;
    const methods = [
        anchorStmt?.getCfg?.()?.getDeclaringMethod?.(),
        value.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.(),
    ];
    for (const method of methods) {
        const candidate = method?.getBody?.()?.getLocals?.()?.get?.(name);
        if (candidate instanceof Local) return candidate;
    }
    return undefined;
}

export function materializeExactPagNodes(
    pag: Pag,
    value: any,
    anchorStmt?: any,
    contextId: number = 0,
): Map<number, number> | undefined {
    const existing = resolveExistingPagNodes(pag, value, anchorStmt);
    if (existing && existing.size > 0) {
        return existing;
    }
    if (!isBuildablePagValue(value)) {
        return undefined;
    }

    const audit = getMutableAudit(pag);
    audit.addAttemptCount++;
    const getOrNewNode = (pag as any)?.getOrNewNode;
    if (typeof getOrNewNode !== "function") {
        audit.addFailureCount++;
        return undefined;
    }
    try {
        const node = getOrNewNode.call(pag, contextId, value, anchorStmt);
        const nodeId = node?.getID?.();
        if (typeof nodeId !== "number") {
            audit.addFailureCount++;
            return undefined;
        }
        return new Map<number, number>([[nodeId, nodeId]]);
    } catch {
        audit.addFailureCount++;
        return undefined;
    }
}

export function resolvePagNodeValue(
    value: any,
    anchorStmt?: any,
    visiting: Set<any> = new Set(),
    audit?: MutablePagNodeResolutionAudit,
): any | undefined {
    if (!value || visiting.has(value)) {
        return undefined;
    }
    visiting.add(value);

    if (isBuildablePagValue(value)) {
        return value;
    }

    if (value instanceof ArkAwaitExpr) {
        audit && audit.awaitUnwrapCount++;
        return resolvePagNodeValue(value.getPromise?.(), anchorStmt, visiting, audit);
    }

    if (value instanceof AbstractExpr) {
        const uses = value.getUses?.() || [];
        for (const use of uses) {
            audit && audit.expressionUseResolveCount++;
            const resolved = resolvePagNodeValue(use, anchorStmt, visiting, audit);
            if (resolved) {
                return resolved;
            }
        }
    }

    const left = anchorStmt?.getLeftOp?.();
    if (left && left !== value) {
        audit && audit.anchorLeftResolveCount++;
        return resolvePagNodeValue(left, undefined, visiting, audit);
    }

    return undefined;
}

export function isBuildablePagValue(value: any): boolean {
    return value instanceof Local
        || value instanceof ArkInstanceFieldRef
        || value instanceof ArkStaticFieldRef
        || value instanceof ArkArrayRef
        || value instanceof ArkNewExpr
        || value instanceof ArkNewArrayExpr
        || value instanceof ArkParameterRef
        || value instanceof ArkThisRef;
}

export function resetPagNodeResolutionAudit(pag: Pag): void {
    pagNodeResolutionAuditByPag.set(pag, createMutableAudit());
    resetSemanticEndpointResolutionRecords(pag);
}

export function getPagNodeResolutionAuditSnapshot(pag: Pag): PagNodeResolutionAuditSnapshot {
    const audit = getMutableAudit(pag);
    const endpointResolutionRecords = getSemanticEndpointResolutionRecords(pag);
    return {
        requestCount: audit.requestCount,
        directHitCount: audit.directHitCount,
        substitutedValueCount: audit.substitutedValueCount,
        awaitUnwrapCount: audit.awaitUnwrapCount,
        expressionUseResolveCount: audit.expressionUseResolveCount,
        anchorLeftResolveCount: audit.anchorLeftResolveCount,
        addAttemptCount: audit.addAttemptCount,
        addFailureCount: audit.addFailureCount,
        unresolvedCount: audit.unresolvedCount,
        unsupportedValueKinds: toSortedRecord(audit.unsupportedValueKinds),
        endpointResolutionRecordCount: endpointResolutionRecords.length,
        endpointResolutionStatusCounts: summarizeEndpointResolutionStatuses(endpointResolutionRecords),
        endpointResolutionRecords,
    };
}

export function emptyPagNodeResolutionAuditSnapshot(): PagNodeResolutionAuditSnapshot {
    return {
        requestCount: 0,
        directHitCount: 0,
        substitutedValueCount: 0,
        awaitUnwrapCount: 0,
        expressionUseResolveCount: 0,
        anchorLeftResolveCount: 0,
        addAttemptCount: 0,
        addFailureCount: 0,
        unresolvedCount: 0,
        unsupportedValueKinds: {},
        endpointResolutionRecordCount: 0,
        endpointResolutionStatusCounts: {},
        endpointResolutionRecords: [],
    };
}

function summarizeEndpointResolutionStatuses(
    records: readonly SemanticEndpointResolutionRecord[],
): Partial<Record<EndpointResolutionStatus, number>> {
    const out: Partial<Record<EndpointResolutionStatus, number>> = {};
    for (const record of records) {
        out[record.status] = (out[record.status] || 0) + 1;
    }
    return out;
}

function getMutableAudit(pag: Pag): MutablePagNodeResolutionAudit {
    let audit = pagNodeResolutionAuditByPag.get(pag);
    if (!audit) {
        audit = createMutableAudit();
        pagNodeResolutionAuditByPag.set(pag, audit);
    }
    return audit;
}

function createMutableAudit(): MutablePagNodeResolutionAudit {
    return {
        requestCount: 0,
        directHitCount: 0,
        substitutedValueCount: 0,
        awaitUnwrapCount: 0,
        expressionUseResolveCount: 0,
        anchorLeftResolveCount: 0,
        addAttemptCount: 0,
        addFailureCount: 0,
        unresolvedCount: 0,
        unsupportedValueKinds: new Map<string, number>(),
    };
}

function recordValueKind(target: Map<string, number>, value: any): void {
    const kind = resolveValueKind(value);
    target.set(kind, (target.get(kind) || 0) + 1);
}

function resolveValueKind(value: any): string {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    const ctor = value?.constructor?.name;
    if (typeof ctor === "string" && ctor.trim().length > 0) {
        return ctor;
    }
    return typeof value;
}

function toSortedRecord(map: Map<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        out[key] = value;
    }
    return out;
}
