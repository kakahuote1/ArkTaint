export type RuleMatchKind =
    | "signature_contains"
    | "signature_regex"
    | "method_name_equals"
    | "method_name_regex"
    | "local_name_regex";

export type RuleEndpoint = "base" | "result" | `arg${number}`;

export interface RuleMatch {
    kind: RuleMatchKind;
    value: string;
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
}

export interface SourceRule extends BaseRule {
    profile?: "seed_local_name" | "entry_param";
    target?: RuleEndpoint;
}

export interface SinkRule extends BaseRule {
    profile?: "keyword" | "signature";
    severity?: "low" | "medium" | "high";
}

export interface TransferRule extends BaseRule {
    from: RuleEndpoint;
    to: RuleEndpoint;
}

export interface TaintRuleSet {
    schemaVersion: string;
    meta?: RuleMeta;
    sources: SourceRule[];
    sinks: SinkRule[];
    transfers: TransferRule[];
}

export interface RuleValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
