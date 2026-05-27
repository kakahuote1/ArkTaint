export type CallbackLocator =
    | { kind: "arg"; index: number }
    | { kind: "option"; base: AssetEndpoint; accessPath: string[] };

export type EndpointBase =
    | { kind: "receiver" }
    | { kind: "arg"; index: number }
    | { kind: "return" }
    | { kind: "callbackArg"; callback: CallbackLocator; argIndex: number }
    | { kind: "callbackReturn"; callback: CallbackLocator }
    | { kind: "promiseResult" }
    | { kind: "constructorResult" };

export interface AssetEndpoint {
    base: EndpointBase;
    accessPath?: string[];
}

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
