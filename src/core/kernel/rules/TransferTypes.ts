import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { TaintFact } from "../model/TaintFact";
import type {
    RuleEndpoint,
    RuleInvokeKind,
    RuleMatchKind as SchemaRuleMatchKind,
    TransferRule
} from "../../rules/RuleSchema";

export type RuleMatchKind = SchemaRuleMatchKind;

export interface RuntimeRule {
    rule: TransferRule;
    matchRegex?: RegExp;
    normalizedMatchValue?: string;
    exactSignatureMatch?: string;
    exactDeclaringClassMatch?: string;
}

export interface RuntimeRuleBucketIndex {
    universal: RuntimeRule[];
    methodNameEquals: Map<string, RuntimeRule[]>;
    signatureEquals: Map<string, RuntimeRule[]>;
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
    noCandidateCallsites: TransferNoCandidateCallsite[];
}

export interface TransferNoCandidateCallsite {
    calleeSignature: string;
    method: string;
    invokeKind: RuleInvokeKind;
    argCount: number;
    sourceFile: string;
    count: number;
}

export interface MethodEntityIndex {
    signatures: Set<string>;
    declaringClasses: Set<string>;
    declaringClassNames: Set<string>;
}

export interface EndpointDescriptor {
    endpoint: RuleEndpoint;
    path?: string[];
    pathFrom?: RuleEndpoint;
    slotKind?: string;
}

export interface InvokeSite {
    stmt: any;
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr | ArkPtrInvokeExpr;
    signature: string;
    methodName: string;
    calleeSignature: string;
    calleeMethodName: string;
    calleeFilePath: string;
    calleeClassText: string;
    calleeClassName: string;
    candidateSignatures?: string[];
    candidateMethodNames?: string[];
    candidateClassTexts?: string[];
    candidateClassNames?: string[];
    candidateFilePaths?: string[];
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
    paramArgAliasMap: Map<Local, any[]>;
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
