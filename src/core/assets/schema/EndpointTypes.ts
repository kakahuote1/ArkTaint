export type CallbackLocator =
    | { kind: "arg"; index: number }
    | { kind: "option"; base: AssetEndpoint; accessPath: string[] };

export type EndpointBase =
    | { kind: "receiver" }
    | { kind: "arg"; index: number }
    | { kind: "rest"; startIndex: number }
    | { kind: "return" }
    | { kind: "callbackArg"; callback: CallbackLocator; argIndex: number }
    | { kind: "callbackReturn"; callback: CallbackLocator }
    | { kind: "promiseResult" }
    | { kind: "promiseRejected" }
    | { kind: "constructorResult" };

export interface AssetEndpoint {
    base: EndpointBase;
    accessPath?: string[];
    taintScope?: "self" | "contained-values";
}

export type EndpointProjectabilityDiagnostic =
    | "ok"
    | "arg_out_of_range"
    | "rest_out_of_range"
    | "receiver_not_projectable"
    | "return_not_projectable"
    | "promise_result_not_projectable"
    | "promise_rejected_not_projectable"
    | "constructor_result_not_projectable"
    | "callback_locator_not_projectable"
    | "callback_arg_not_projectable"
    | "access_path_not_projectable";

export interface EndpointProjectabilityResult {
    projectable: boolean;
    diagnostic: EndpointProjectabilityDiagnostic;
    reason: string;
}

export type EndpointProjectionKindGroup =
    | "arg"
    | "receiver"
    | "return"
    | "promise"
    | "callback"
    | "object_access_path"
    | "field_property"
    | "rest_spread"
    | "arkui_resource"
    | "module_carrier"
    | "unsupported";

export type EndpointProjectionFailureCategory =
    | "none"
    | "runtime_endpoint_missing"
    | "overload_no_data"
    | "asset_endpoint_wrong"
    | "schema_gate_missing"
    | "unsupported_exact_shape"
    | "not_applicable_no_data";

export interface AssetGuard {
    conditions?: StructuredCondition[];
    phase?: string;
    overloadId?: string;
}

export type StructuredCondition =
    | { kind: "const-eq"; endpoint: AssetEndpoint; value: string | number | boolean }
    | { kind: "const-neq"; endpoint: AssetEndpoint; value: string | number | boolean }
    | { kind: "type-is"; endpoint: AssetEndpoint; typeName: string }
    | { kind: "option-exists"; path: string[] }
    | { kind: "callback-present"; callback: CallbackLocator };

export type EndpointRelation =
    | "exact"
    | "subsumes"
    | "subsumed-by"
    | "overlap"
    | "disjoint"
    | "unknown";

export type GuardRelation =
    | "equivalent"
    | "implies"
    | "implied-by"
    | "overlap"
    | "disjoint"
    | "unknown";
