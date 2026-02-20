import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { TaintFact } from "../TaintFact";
import type {
    RuleEndpoint,
    RuleInvokeKind,
    RuleMatchKind as SchemaRuleMatchKind,
    TransferRule
} from "../rules/RuleSchema";

export type RuleMatchKind = SchemaRuleMatchKind;

export interface RuntimeRule {
    rule: TransferRule;
    matchRegex?: RegExp;
    normalizedMatchValue?: string;
    exactSignatureMatch?: string;
    exactCalleeSignatureMatch?: string;
    exactDeclaringClassMatch?: string;
}

export interface RuntimeRuleBucketIndex {
    universal: RuntimeRule[];
    methodNameEquals: Map<string, RuntimeRule[]>;
    signatureEquals: Map<string, RuntimeRule[]>;
    calleeSignatureEquals: Map<string, RuntimeRule[]>;
    declaringClassEquals: Map<string, RuntimeRule[]>;
}

export interface TransferExecutionStats {
    factCount: number;
    invokeSiteCount: number;
    ruleCheckCount: number;
    ruleMatchCount: number;
    endpointCheckCount: number;
    endpointMatchCount: number;
    dedupSkipCount: number;
    resultCount: number;
    elapsedMs: number;
}

export interface MethodEntityIndex {
    signatures: Set<string>;
    declaringClasses: Set<string>;
    declaringClassNames: Set<string>;
}

export interface EndpointDescriptor {
    endpoint: RuleEndpoint;
    path?: string[];
}

export interface InvokeSite {
    stmt: any;
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr;
    signature: string;
    methodName: string;
    calleeSignature: string;
    calleeMethodName: string;
    calleeFilePath: string;
    calleeClassText: string;
    calleeClassName: string;
    baseValue?: any;
    resultValue?: any;
    args: any[];
    invokeKind: RuleInvokeKind;
    callerMethodName: string;
    callerSignature: string;
    callerFilePath: string;
    callerClassText: string;
}

export interface SharedSceneRuleCache {
    runtimeRules: RuntimeRule[];
    ruleBuckets: RuntimeRuleBucketIndex;
    stmtOwner: Map<any, any>;
    invokeSiteByStmt: Map<any, InvokeSite>;
    siteRuleCandidateIndex: Map<any, RuntimeRule[]>;
}

export interface SceneRuleCacheStats {
    hitCount: number;
    missCount: number;
    disabledCount: number;
}

export interface TransferExecutionResult {
    ruleId: string;
    callSignature: string;
    to: RuleEndpoint;
    fact: TaintFact;
}

export interface TransferExecutionWithStats {
    results: TransferExecutionResult[];
    stats: TransferExecutionStats;
}
