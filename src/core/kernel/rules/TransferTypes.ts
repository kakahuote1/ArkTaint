import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { TaintFact } from "../model/TaintFact";
import type {
    RuleEndpoint,
    RuleEndpointRef,
    RuleEndpointTaintScope,
    RuleInvokeKind,
    RuleSlotWriteMode,
    TransferRule
} from "../../rules/RuleSchema";

export interface RuntimeRule {
    rule: TransferRule;
}

export interface RuntimeRuleBucketIndex {
    universal: RuntimeRule[];
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
    siteConsumptions: TransferSemanticSiteConsumption[];
}

export interface TransferNoCandidateCallsite {
    calleeSignature: string;
    canonicalApiId?: string;
    method: string;
    invokeKind: RuleInvokeKind;
    argCount: number;
    sourceFile: string;
    count: number;
}

export interface TransferEndpointConsumption {
    endpoint: RuleEndpoint;
    endpointPath?: string;
    status: string;
    reason: string;
    nodeIds: number[];
    carrierNodeIds: number[];
    fieldPath?: string[];
    materializedExact: boolean;
}

export interface TransferSemanticSiteConsumption {
    ruleId: string;
    canonicalApiId: string;
    effectSiteId?: string;
    occurrenceId?: string;
    rawOccurrenceId?: string;
    effectAssetId?: string;
    surfaceId?: string;
    bindingId?: string;
    effectTemplateId?: string;
    callSignature?: string;
    callerSignature?: string;
    method?: string;
    invokeKind?: RuleInvokeKind;
    sourceFile?: string;
    scheduled: boolean;
    fromMatched: boolean;
    toProjected: boolean;
    resultCount: number;
    blockedReason?: string;
    fromEndpoint?: TransferEndpointConsumption;
    toEndpoint?: TransferEndpointConsumption;
    count?: number;
}

export interface EndpointDescriptor {
    endpoint: RuleEndpoint;
    path?: string[];
    pathFrom?: RuleEndpoint;
    slotKind?: string;
    slotWriteMode?: RuleSlotWriteMode;
    taintScope?: RuleEndpointTaintScope;
    semanticEndpointKind?: RuleEndpointRef["semanticEndpointKind"];
}

export interface InvokeSite {
    stmt: any;
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr | ArkPtrInvokeExpr;
    callerMethod?: any;
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
    scopeClassTexts?: string[];
    scopeModuleTexts?: string[];
    scopeFileTexts?: string[];
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
