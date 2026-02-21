export type RuleMatchKind =
    | "signature_contains"
    | "signature_equals"
    | "signature_regex"
    | "callee_signature_equals"
    | "declaring_class_equals"
    | "method_name_equals"
    | "method_name_regex"
    | "local_name_regex";

export type RuleEndpoint = "base" | "result" | `arg${number}`;
export type RuleInvokeKind = "any" | "instance" | "static";
export type RuleConstraintMode = "equals" | "contains" | "regex";
export type SourceRuleKind = "seed_local_name" | "entry_param" | "call_return" | "call_arg" | "field_read";

export interface RuleMatch {
    kind: RuleMatchKind;
    value: string;
}

export interface RuleStringConstraint {
    mode: RuleConstraintMode;
    value: string;
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
}

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
    match: RuleMatch;
    scope?: RuleScopeConstraint;
    invokeKind?: RuleInvokeKind;
    argCount?: number;
    typeHint?: string;
}

export interface SourceRule extends BaseRule {
    profile?: "seed_local_name" | "entry_param";
    kind?: SourceRuleKind;
    target?: RuleEndpoint;
    targetRef?: RuleEndpointRef;
}

export interface SinkRule extends BaseRule {
    profile?: "keyword" | "signature";
    severity?: "low" | "medium" | "high";
    category?: string;
    sinkTarget?: RuleEndpoint;
    sinkTargetRef?: RuleEndpointRef;
}

export interface SanitizerRule extends BaseRule {
    sanitizeTarget?: RuleEndpoint;
    sanitizeTargetRef?: RuleEndpointRef;
}

export interface TransferRule extends BaseRule {
    from: RuleEndpoint;
    to: RuleEndpoint;
    fromRef?: RuleEndpointRef;
    toRef?: RuleEndpointRef;
}

export interface TaintRuleSet {
    schemaVersion: string;
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
