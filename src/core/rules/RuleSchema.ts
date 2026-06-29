// ==================== Taint Rule Schema v2.0 ====================

import type { ApiEffectIdentity } from "../api/ApiOccurrenceIdentity";

export type RuleMatchKind = "canonical_api_id_equals";

export type RuleEndpoint = "base" | "result" | "matched_param" | `arg${number}`;
export type RuleInvokeKind = "any" | "instance" | "static";
export type RuleEndpointTaintScope = "self" | "contained-values";
export type RuleSlotWriteMode = "replace" | "append";
export type SourceRuleKind =
    | "seed_local_name"
    | "entry_param"
    | "call_return"
    | "call_arg"
    | "field_read"
    | "callback_param"
    | "bound_state";
export type RuleSeverity = "low" | "medium" | "high" | "critical";

export interface RuleMatch {
    kind: RuleMatchKind;
    value: string;
}

export interface RuleEndpointRef {
    endpoint: RuleEndpoint;
    path?: string[];
    pathFrom?: RuleEndpoint;
    slotKind?: string;
    slotWriteMode?: RuleSlotWriteMode;
    taintScope?: RuleEndpointTaintScope;
    semanticEndpointKind?: "return" | "promiseResult" | "promiseRejected" | "constructorResult" | "callbackReturn" | "rest";
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
    match: RuleMatch;
    category?: string;
    severity?: RuleSeverity;
    apiEffect: ApiEffectIdentity;
}

export interface SourceRule extends BaseRule {
    sourceKind: SourceRuleKind;
    target: RuleEndpointOrRef;
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
