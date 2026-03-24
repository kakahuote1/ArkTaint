// ==================== Taint Rule Schema v2.0 ====================

export type RuleMatchKind =
    | "signature_contains"
    | "signature_equals"
    | "signature_regex"
    | "declaring_class_equals"
    | "method_name_equals"
    | "method_name_regex"
    | "local_name_regex";

export type RuleEndpoint = "base" | "result" | "matched_param" | `arg${number}`;
export type RuleInvokeKind = "any" | "instance" | "static";
export type RuleConstraintMode = "equals" | "contains" | "regex";
export type SourceRuleKind = "seed_local_name" | "entry_param" | "call_return" | "call_arg" | "field_read" | "callback_param";
export type EntryParamMatchMode = "name_only" | "name_and_type";
export type RuleSeverity = "low" | "medium" | "high" | "critical";

export interface RuleStringConstraint {
    mode: RuleConstraintMode;
    value: string;
}

export interface RuleMatch {
    kind: RuleMatchKind;
    value: string;
    calleeClass?: RuleStringConstraint;
    invokeKind?: RuleInvokeKind;
    argCount?: number;
    typeHint?: string;
}

export interface RuleScopeConstraint {
    file?: RuleStringConstraint;
    module?: RuleStringConstraint;
    className?: RuleStringConstraint;
    methodName?: RuleStringConstraint;
}

export interface RuleEndpointRef {
    endpoint: RuleEndpoint;
    path?: string[];
    pathFrom?: RuleEndpoint;
    slotKind?: string;
}

export type RuleEndpointOrRef = RuleEndpoint | RuleEndpointRef;

export interface RuleMeta {
    name?: string;
    description?: string;
    updatedAt?: string;
}

export interface BaseRule {
    id: string;
    enabled?: boolean;
    description?: string;
    tags?: string[];
    family?: string;
    tier?: "A" | "B" | "C";
    match: RuleMatch;
    scope?: RuleScopeConstraint;
    category?: string;
    severity?: RuleSeverity;
}

export interface SourceRule extends BaseRule {
    sourceKind: SourceRuleKind;
    target: RuleEndpointOrRef;
    callbackArgIndexes?: number[];
    paramNameIncludes?: string[];
    paramTypeIncludes?: string[];
    paramMatchMode?: EntryParamMatchMode;
}

export interface SinkRule extends BaseRule {
    target?: RuleEndpointOrRef;
}

export interface SanitizerRule extends BaseRule {
    target?: RuleEndpointOrRef;
}

export interface TransferRule extends BaseRule {
    from: RuleEndpointOrRef;
    to: RuleEndpointOrRef;
}

export interface TaintRuleSet {
    schemaVersion: "2.0";
    meta?: RuleMeta;
    sources: SourceRule[];
    sinks: SinkRule[];
    sanitizers?: SanitizerRule[];
    transfers: TransferRule[];
}

export interface RuleValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export function normalizeEndpoint(e: RuleEndpointOrRef): RuleEndpointRef {
    if (typeof e === "string") return { endpoint: e as RuleEndpoint };
    return e;
}
