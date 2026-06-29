import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import {
    ArkAwaitExpr,
    ArkInstanceInvokeExpr,
} from "../../../../arkanalyzer/out/src/core/base/Expr";
import type {
    AssetEndpoint,
    CallbackLocator,
    EndpointProjectionFailureCategory,
} from "../../assets/schema";
import type {
    EndpointResolutionDiagnosticKind,
    EndpointResolutionStatus,
    EndpointResolutionValueKind,
} from "./EndpointResolutionLedger";

interface AccessPathProjectionResult {
    values: any[];
    reason?: string;
    diagnosticDetails?: Record<string, unknown>;
}

const MAX_ACCESS_PATH_DEPTH = 8;

export interface EndpointRuntimeValueProjectionInput {
    endpoint: AssetEndpoint;
    stmt?: any;
    invokeExpr?: any;
    receiver?: any;
    result?: any;
    endpointValues?: Iterable<any>;
    resolveCallbackArgumentValues?: (callback: CallbackLocator, argIndex: number) => Iterable<any>;
    resolveAccessPathValues?: (
        values: readonly any[],
        accessPath: readonly string[],
        endpoint: AssetEndpoint,
    ) => Iterable<any>;
}

export interface EndpointRuntimeValueProjection {
    endpointSpec: AssetEndpoint;
    endpointPath: string;
    endpointBaseKind: string;
    status: EndpointResolutionStatus;
    reason: string;
    diagnosticKind?: EndpointResolutionDiagnosticKind;
    values: any[];
    valueKind: EndpointResolutionValueKind;
    fieldPath?: string[];
    failureCategory?: EndpointProjectionFailureCategory;
    diagnosticDetails?: Record<string, unknown>;
}

interface EndpointRuntimeBaseValueResolution {
    values: any[];
    reason: string;
    valueKind: EndpointResolutionValueKind;
    unsupported?: boolean;
    failureStatus?: EndpointResolutionDiagnosticKind;
    diagnosticDetails?: Record<string, unknown>;
}

interface EndpointRuntimeAccessPathResolution {
    values: any[];
    reason: string;
    failureStatus?: EndpointResolutionDiagnosticKind;
    diagnosticDetails?: Record<string, unknown>;
}

export function projectEndpointRuntimeValues(
    input: EndpointRuntimeValueProjectionInput,
): EndpointRuntimeValueProjection {
    const endpoint = input.endpoint;
    const fieldPath = normalizeAccessPath(endpoint.accessPath);
    const baseResolution = resolveRuntimeEndpointBaseValues(input, endpoint);
    const endpointResolution = resolveRuntimeEndpointAccessPath(input, endpoint, baseResolution, fieldPath);
    const status = classifyRuntimeEndpointStatus(baseResolution, endpointResolution);
    const reason = status === "resolved"
        ? endpointResolution.reason
        : runtimeMissingEndpointReason(endpoint, endpointResolution.reason, endpointResolution.values);
    const diagnosticKind = status === "resolved" ? undefined : status;
    const failureCategory = classifyRuntimeEndpointFailureCategory(status, reason);
    const diagnosticDetails = mergeDiagnosticDetails(
        baseResolution.diagnosticDetails,
        endpointResolution.diagnosticDetails,
        failureCategory === "none" ? undefined : { failureCategory },
    );
    const projection: EndpointRuntimeValueProjection = {
        endpointSpec: endpoint,
        endpointPath: formatRuntimeEndpointPath(endpoint, input.invokeExpr),
        endpointBaseKind: endpoint.base.kind,
        status,
        reason,
        diagnosticKind,
        values: [...endpointResolution.values],
        valueKind: baseResolution.valueKind,
        fieldPath,
        failureCategory,
        diagnosticDetails,
    };
    if (!projection.diagnosticKind) delete projection.diagnosticKind;
    if (!projection.fieldPath || projection.fieldPath.length === 0) delete projection.fieldPath;
    if (!projection.failureCategory || projection.failureCategory === "none") delete projection.failureCategory;
    if (!projection.diagnosticDetails || Object.keys(projection.diagnosticDetails).length === 0) {
        delete projection.diagnosticDetails;
    }
    return projection;
}

export function isResolvedEndpointRuntimeValueProjection(
    projection: Pick<EndpointRuntimeValueProjection, "status" | "values">,
): boolean {
    return projection.status === "resolved" && projection.values.length > 0;
}

function resolveRuntimeEndpointBaseValues(
    input: EndpointRuntimeValueProjectionInput,
    endpoint: AssetEndpoint,
): EndpointRuntimeBaseValueResolution {
    if (input.endpointValues !== undefined) {
        return {
            values: [...input.endpointValues].filter(value => value !== undefined && value !== null),
            reason: "endpoint_values_supplied",
            valueKind: "endpointValues",
        };
    }

    switch (endpoint.base.kind) {
        case "receiver": {
            const base = input.receiver !== undefined
                ? input.receiver
                : input.invokeExpr instanceof ArkInstanceInvokeExpr
                    ? input.invokeExpr.getBase()
                    : input.invokeExpr?.getBase?.();
            return runtimeValueResult(base, "receiver_base", "receiver");
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
            return runtimeValueResult(args[index], isRuntimeSpreadArg(input.invokeExpr, index) ? `arg${index}_spread` : `arg${index}`, "arg");
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
        case "promiseResult":
        case "promiseRejected":
            return runtimeValueResult(
                input.result !== undefined ? input.result : runtimeResultValueFromStmt(input.stmt),
                runtimeResultValueReason(input.stmt, endpoint.base.kind),
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
                        callback: formatRuntimeCallbackLocatorPath(endpoint.base.callback),
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
                reason: values.length > 0 ? `callback_arg${endpoint.base.argIndex}` : "callback_binding_missing",
                valueKind: "callbackArg",
                diagnosticDetails: {
                    callback: formatRuntimeCallbackLocatorPath(endpoint.base.callback),
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

function resolveRuntimeEndpointAccessPath(
    input: EndpointRuntimeValueProjectionInput,
    endpoint: AssetEndpoint,
    baseResolution: EndpointRuntimeBaseValueResolution,
    fieldPath: readonly string[] | undefined,
): EndpointRuntimeAccessPathResolution {
    if (!fieldPath || fieldPath.length === 0) {
        return {
            values: baseResolution.values,
            reason: baseResolution.reason,
            diagnosticDetails: baseResolution.diagnosticDetails,
        };
    }
    if (baseResolution.values.length === 0) {
        return {
            values: [],
            reason: baseResolution.reason,
            failureStatus: baseResolution.failureStatus,
            diagnosticDetails: {
                ...(baseResolution.diagnosticDetails || {}),
                accessPath: [...fieldPath],
                baseValueCount: 0,
            },
        };
    }

    const suppliedValues = input.resolveAccessPathValues
        ? [...input.resolveAccessPathValues(baseResolution.values, fieldPath, endpoint)]
            .filter(value => value !== undefined && value !== null)
        : [];
    const structuredValues = suppliedValues.length > 0
        ? { values: [], reason: undefined, diagnosticDetails: undefined }
        : resolveStructuredEndpointAccessPathValues(baseResolution.values, fieldPath, input.stmt);
    const resolvedValues = suppliedValues.length > 0
        ? suppliedValues
        : structuredValues.values.length > 0
            ? structuredValues.values
            : resolveRuntimeKnownAccessPathValues(baseResolution.values, fieldPath);
    if (resolvedValues.length > 0) {
        return {
            values: dedupeValues(resolvedValues),
            reason: structuredValues.reason
                ? `${baseResolution.reason}.${structuredValues.reason}`
                : `${baseResolution.reason}.access_path:${fieldPath.join(".")}`,
            diagnosticDetails: mergeDiagnosticDetails(
                baseResolution.diagnosticDetails,
                structuredValues.diagnosticDetails,
            ),
        };
    }

    return {
        values: [],
        reason: `${baseResolution.reason}.access_path_unresolved:${fieldPath.join(".")}`,
        failureStatus: "unsupported_exact_shape",
        diagnosticDetails: {
            ...(baseResolution.diagnosticDetails || {}),
            accessPath: [...fieldPath],
            baseValueCount: baseResolution.values.length,
        },
    };
}

function classifyRuntimeEndpointStatus(
    baseResolution: EndpointRuntimeBaseValueResolution,
    endpointResolution: EndpointRuntimeAccessPathResolution,
): EndpointResolutionStatus {
    if (baseResolution.failureStatus) return baseResolution.failureStatus;
    if (endpointResolution.failureStatus) return endpointResolution.failureStatus;
    if (baseResolution.unsupported) return "unsupported_exact_shape";
    if (endpointResolution.values.length > 0) return "resolved";
    return baseResolution.reason === "endpoint_values_supplied"
        ? "not_applicable_no_data"
        : "no_runtime_endpoint";
}

function runtimeMissingEndpointReason(
    endpoint: AssetEndpoint,
    valueReason: string,
    values: readonly any[],
): string {
    if (values.length === 0) return runtimeEndpointValueMissingReason(endpoint, valueReason);
    return `${runtimeEndpointReasonPrefix(endpoint)}_runtime_value_not_consumable:${valueReason}`;
}

function runtimeEndpointValueMissingReason(endpoint: AssetEndpoint, valueReason: string): string {
    if (valueReason.includes("access_path_unresolved:")) return valueReason;
    if (valueReason === "endpoint_values_supplied") return "endpoint_values_empty";
    if (valueReason === "receiver_base") return "receiver_runtime_value_missing";
    if (valueReason === "callback_binding_missing") return valueReason;
    if (valueReason.endsWith("_requires_assignment")) return valueReason;
    if (valueReason.endsWith("_not_present_in_runtime_overload")) return valueReason;
    if (valueReason.endsWith("_out_of_range") || valueReason.endsWith("_invalid_index")) return valueReason;
    return `${runtimeEndpointReasonPrefix(endpoint)}_runtime_value_missing:${valueReason}`;
}

function runtimeEndpointReasonPrefix(endpoint: AssetEndpoint): string {
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

function classifyRuntimeEndpointFailureCategory(
    status: EndpointResolutionStatus,
    reason: string,
): EndpointProjectionFailureCategory {
    if (status === "resolved") return "none";
    if (status === "asset_endpoint_error") {
        return reason.includes("invalid_index") || reason.includes("out_of_range")
            ? "schema_gate_missing"
            : "asset_endpoint_wrong";
    }
    if (status === "unsupported_exact_shape") return "unsupported_exact_shape";
    if (status === "not_applicable_no_data") {
        return reason.includes("runtime_overload") || reason.includes("endpoint_values_empty")
            ? "overload_no_data"
            : "not_applicable_no_data";
    }
    return "runtime_endpoint_missing";
}

function runtimeValueResult(
    value: any,
    reason: string,
    valueKind: EndpointResolutionValueKind,
): EndpointRuntimeBaseValueResolution {
    return value === undefined || value === null
        ? { values: [], reason, valueKind }
        : { values: [value], reason, valueKind };
}

function runtimeResultValueFromStmt(stmt: any): any | undefined {
    if (stmt instanceof ArkAssignStmt) return stmt.getLeftOp?.();
    return undefined;
}

function runtimeResultValueReason(stmt: any, kind: string): string {
    if (!(stmt instanceof ArkAssignStmt)) return `${kind}_requires_assignment`;
    const right = stmt.getRightOp?.();
    if (right instanceof ArkAwaitExpr) return `${kind}_await_assignment`;
    return `${kind}_assignment`;
}

function resolveRuntimeKnownAccessPathValues(values: readonly any[], fieldPath: readonly string[]): any[] {
    let current = [...values].filter(value => value !== undefined && value !== null);
    for (const segment of fieldPath) {
        const next: any[] = [];
        for (const value of current) {
            for (const candidate of resolveRuntimeKnownSegmentValues(value, segment, 0, new Set<any>())) {
                if (candidate !== undefined && candidate !== null) next.push(candidate);
            }
        }
        current = dedupeValues(next);
        if (current.length === 0) break;
    }
    return current;
}

function resolveRuntimeKnownSegmentValues(
    value: any,
    segment: string,
    depth: number,
    visiting: Set<any>,
): any[] {
    if (value === undefined || value === null || !segment || depth > MAX_ACCESS_PATH_DEPTH) {
        return [];
    }
    if (Array.isArray(value)) {
        if (visiting.has(value)) return [];
        visiting.add(value);
        const values: any[] = [];
        for (const element of value) {
            values.push(...resolveRuntimeKnownSegmentValues(element, segment, depth + 1, visiting));
        }
        visiting.delete(value);
        return dedupeValues(values);
    }
    const exact = resolveDirectObjectSegmentValue(value, segment);
    return exact !== undefined && exact !== null ? [exact] : [];
}

function formatRuntimeEndpointPath(endpoint: AssetEndpoint, invokeExpr?: any): string {
    let base: string;
    switch (endpoint.base.kind) {
        case "receiver":
            base = "base";
            break;
        case "arg":
            base = `arg${endpoint.base.index}${isRuntimeSpreadArg(invokeExpr, endpoint.base.index) ? "[]" : ""}`;
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
            base = `${formatRuntimeCallbackLocatorPath(endpoint.base.callback)}.arg${endpoint.base.argIndex}`;
            break;
        case "callbackReturn":
            base = `${formatRuntimeCallbackLocatorPath(endpoint.base.callback)}.return`;
            break;
        default:
            base = String((endpoint.base as any).kind || "unrecognized");
            break;
    }
    const accessPath = normalizeAccessPath(endpoint.accessPath);
    return accessPath && accessPath.length > 0 ? `${base}.${accessPath.join(".")}` : base;
}

function formatRuntimeCallbackLocatorPath(locator: CallbackLocator): string {
    if (locator.kind === "arg") return `callback:arg${locator.index}`;
    const accessPath = normalizeAccessPath(locator.accessPath);
    const suffix = accessPath && accessPath.length > 0 ? `.${accessPath.join(".")}` : "";
    return `callback:option:${formatRuntimeEndpointPath(locator.base)}${suffix}`;
}

function normalizeAccessPath(path: readonly string[] | undefined): string[] | undefined {
    if (!path) return undefined;
    const normalized = path.map(item => String(item || "").trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : undefined;
}

function isRuntimeSpreadArg(invokeExpr: any, index: number): boolean {
    if (!Number.isInteger(index) || index < 0) return false;
    const flags = invokeExpr?.getSpreadFlags?.();
    return Array.isArray(flags) && flags[index] === true;
}

function mergeDiagnosticDetails(
    ...items: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
    const out: Record<string, unknown> = {};
    for (const item of items) {
        if (!item) continue;
        Object.assign(out, item);
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

export function resolveStructuredEndpointAccessPathValues(
    values: readonly any[],
    accessPath: readonly string[],
    anchorStmt?: any,
): AccessPathProjectionResult {
    const normalizedPath = accessPath.map(segment => String(segment || "").trim()).filter(Boolean);
    if (normalizedPath.length === 0) {
        return { values: [...values] };
    }

    let current = values.filter(value => value !== undefined && value !== null);
    const reasons: string[] = [];
    for (const segment of normalizedPath) {
        const next: any[] = [];
        for (const value of current) {
            const resolved = resolveStructuredAccessSegmentValue(value, segment, anchorStmt, 0, new Set<string>());
            for (const candidate of resolved.values) {
                if (candidate !== undefined && candidate !== null) next.push(candidate);
            }
            if (resolved.reason) reasons.push(resolved.reason);
        }
        current = dedupeValues(next);
        if (current.length === 0) break;
    }

    return {
        values: current,
        reason: current.length > 0 ? `structured_access_path:${normalizedPath.join(".")}` : undefined,
        diagnosticDetails: reasons.length > 0
            ? {
                structuredAccessPath: normalizedPath,
                structuredAccessEvidence: [...new Set(reasons)].sort(),
            }
            : undefined,
    };
}

function resolveStructuredAccessSegmentValue(
    value: any,
    segment: string,
    anchorStmt: any,
    depth: number,
    visiting: Set<string>,
): AccessPathProjectionResult {
    if (!value || !segment || depth > MAX_ACCESS_PATH_DEPTH) {
        return { values: [] };
    }

    if (Array.isArray(value)) {
        const values: any[] = [];
        const reasons: string[] = [];
        for (const element of value) {
            const resolved = resolveStructuredAccessSegmentValue(element, segment, anchorStmt, depth + 1, visiting);
            for (const candidate of resolved.values) {
                if (candidate !== undefined && candidate !== null) values.push(candidate);
            }
            if (resolved.reason) reasons.push(resolved.reason);
        }
        return {
            values: dedupeValues(values),
            reason: values.length > 0
                ? `array_element:${[...new Set(reasons)].sort().join("+") || "field"}`
                : undefined,
        };
    }

    const direct = resolveDirectObjectSegmentValue(value, segment);
    if (direct !== undefined && direct !== null) {
        return {
            values: [direct],
            reason: "direct_object_property",
        };
    }

    const objectLiteral = resolveObjectLiteralInitializerSegmentValue(value, segment, anchorStmt, depth, visiting);
    if (objectLiteral.values.length > 0) {
        return objectLiteral;
    }

    if (value instanceof Local) {
        const assigned = resolveLatestAssignedValueBefore(value, anchorStmt);
        if (assigned && assigned !== value) {
            const key = localVisitKey(value, anchorStmt, segment);
            if (!visiting.has(key)) {
                visiting.add(key);
                const resolved = resolveStructuredAccessSegmentValue(
                    assigned,
                    segment,
                    assigned.getDeclaringStmt?.() || anchorStmt,
                    depth + 1,
                    visiting,
                );
                visiting.delete(key);
                if (resolved.values.length > 0) return resolved;
            }
        }
    }

    return { values: [] };
}

function resolveDirectObjectSegmentValue(value: any, segment: string): any | undefined {
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

function resolveObjectLiteralInitializerSegmentValue(
    value: any,
    segment: string,
    anchorStmt: any,
    depth: number,
    visiting: Set<string>,
): AccessPathProjectionResult {
    const classSignature = resolveValueClassSignatureAtStmt(value, anchorStmt, depth + 1, visiting);
    if (!classSignature) return { values: [] };
    const arkClass = resolveClassFromAnchor(anchorStmt, classSignature);
    if (!arkClass) return { values: [] };

    const fields = arkClass.getFields?.() || [];
    const matchedValues: any[] = [];
    const reasons: string[] = [];
    for (const field of fields) {
        const fieldName = field?.getSignature?.()?.getFieldName?.() || field?.getName?.();
        if (fieldName !== segment) continue;
        const initializer = field?.getInitializer?.();
        const initializerValue = resolveInitializerAssignedValue(initializer, anchorStmt);
        if (initializerValue !== undefined && initializerValue !== null) {
            matchedValues.push(initializerValue);
            reasons.push("object_literal_field_initializer");
            continue;
        }
        const capturedLocalName = parseInitializerCapturedLocalName(initializer);
        if (!capturedLocalName) continue;
        const capturedLocal = resolveLocalByName(anchorStmt, capturedLocalName);
        if (capturedLocal) {
            matchedValues.push(capturedLocal);
            reasons.push("object_literal_captured_local");
        }
    }

    return {
        values: dedupeValues(matchedValues),
        reason: matchedValues.length > 0 ? "object_literal_initializer" : undefined,
        diagnosticDetails: reasons.length > 0
            ? {
                classSignature,
                fieldName: segment,
                structuredAccessEvidence: [...new Set(reasons)].sort(),
            }
            : undefined,
    };
}

function resolveInitializerAssignedValue(initializer: any, anchorStmt: any): any | undefined {
    if (initializer instanceof ArkAssignStmt) {
        const right = initializer.getRightOp?.();
        if (right instanceof Local) return right;
        const localName = parseCapturedLocalToken(String(right?.toString?.() || ""));
        return localName ? resolveLocalByName(anchorStmt, localName) : right;
    }
    return undefined;
}

function parseInitializerCapturedLocalName(initializer: any): string | undefined {
    const text = String(initializer?.toString?.() || "").trim();
    if (!text) return undefined;
    const rhs = text.includes("=") ? text.split("=").slice(1).join("=").trim() : text;
    return parseCapturedLocalToken(rhs);
}

function parseCapturedLocalToken(text: string): string | undefined {
    const trimmed = String(text || "").trim();
    if (!trimmed) return undefined;
    if (/^['"`].*['"`]$/.test(trimmed)) return undefined;
    return /^[%A-Za-z_$][%A-Za-z0-9_$]*$/.test(trimmed) ? trimmed : undefined;
}

function resolveLocalByName(anchorStmt: any, localName: string): Local | undefined {
    const method = anchorStmt?.getCfg?.()?.getDeclaringMethod?.();
    const locals = method?.getBody?.()?.getLocals?.();
    const value = locals?.get?.(localName);
    return value instanceof Local ? value : undefined;
}

function resolveLatestAssignedValueBefore(local: Local, anchorStmt: any): any | undefined {
    const cfg = anchorStmt?.getCfg?.() || local.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;

    let latest: ArkAssignStmt | undefined;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) break;
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (stmt.getLeftOp?.() !== local) continue;
        latest = stmt;
    }
    return latest?.getRightOp?.();
}

function resolveValueClassSignatureAtStmt(
    value: any,
    anchorStmt: any,
    depth: number,
    visiting: Set<string>,
): string | undefined {
    if (!value || depth > MAX_ACCESS_PATH_DEPTH) return undefined;
    const direct = resolveClassSignatureFromValue(value);
    if (direct) return direct;
    if (!(value instanceof Local)) return undefined;

    const key = localVisitKey(value, anchorStmt, "class");
    if (visiting.has(key)) return undefined;
    visiting.add(key);
    const assigned = resolveLatestAssignedValueBefore(value, anchorStmt);
    const resolved = assigned
        ? resolveValueClassSignatureAtStmt(assigned, assigned.getDeclaringStmt?.() || anchorStmt, depth + 1, visiting)
        : undefined;
    visiting.delete(key);
    return resolved;
}

function resolveClassSignatureFromValue(value: any): string | undefined {
    const typeAny = value?.getType?.();
    const classSignature = typeAny?.getClassSignature?.() || value?.getClassSignature?.();
    const text = String(classSignature?.toString?.() || "").trim();
    return text && !text.includes("%unk") && !text.includes("@unk") ? text : undefined;
}

function resolveClassFromAnchor(anchorStmt: any, classSignature: string): any | undefined {
    const method = anchorStmt?.getCfg?.()?.getDeclaringMethod?.();
    const declaringClass = method?.getDeclaringArkClass?.();
    const declaringClassSignature = String(declaringClass?.getSignature?.()?.toString?.() || "").trim();
    if (declaringClassSignature === classSignature) {
        return declaringClass;
    }

    const scene = method?.getDeclaringArkFile?.()?.getScene?.()
        || declaringClass?.getDeclaringArkFile?.()?.getScene?.();
    if (!scene) return undefined;
    for (const cls of scene.getClasses?.() || []) {
        const signature = String(cls?.getSignature?.()?.toString?.() || "").trim();
        if (signature === classSignature) return cls;
    }
    return undefined;
}

function localVisitKey(local: Local, anchorStmt: any, suffix: string): string {
    const methodSignature = anchorStmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
    const name = local.getName?.() || local.toString?.() || "";
    return `${methodSignature}:${name}:${suffix}`;
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
