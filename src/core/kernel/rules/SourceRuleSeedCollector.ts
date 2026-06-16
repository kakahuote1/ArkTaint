import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { resolveCallbackRegistrationsFromStmt } from "../../substrate/queries/CallbackBindingQuery";
import { resolveKnownOptionCallbackRegistrationsFromStmt } from "../../substrate/semantics/KnownOptionCallbackRegistration";
import {
    resolveMethodsFromAnonymousObjectCarrierByField,
    resolveMethodsFromCallable,
} from "../../substrate/queries/CalleeResolver";
import { resolveSdkImportScopeCandidates } from "../../substrate/queries/SdkProvenance";
import { getMethodBySignature } from "../contracts/MethodLookup";
import { TaintFact } from "../model/TaintFact";
import {
    normalizeEndpoint,
    RuleEndpoint,
    RuleEndpointRef,
    RuleEndpointOrRef,
    RuleInvokeKind,
    RuleScopeConstraint,
    RuleStringConstraint,
    SourceRule,
    SourceRuleKind,
} from "../../rules/RuleSchema";
import { resolvePromiseFulfillmentSourceNodeIdsFromInvoke } from "../handoff/ExecutionHandoffContractBindingResolver";

const RECEIVER_TYPE_HINT_TRACE_CACHE = new WeakMap<ArkMethod, Map<string, string[]>>();

export interface SourceRuleSeedCollectionArgs {
    scene: Scene;
    pag: Pag;
    sourceRules: SourceRule[];
    emptyContextId: number;
    allowedMethodSignatures?: Set<string>;
}

export interface SourceRuleSeedCollectionResult {
    facts: TaintFact[];
    seededLocals: string[];
    sourceRuleHits: Record<string, number>;
    activatedMethodSignatures: string[];
    sourceSeedAudit: SourceRuleSeedAuditEntry[];
    sourceRuleZeroHitAudit: SourceRuleZeroHitAuditEntry[];
}

export interface SourceRuleSeedAuditEntry {
    ruleId: string;
    source: string;
    factId: string;
    nodeId: number;
    contextId: number;
    fieldPath?: string[];
    label: string;
}

export type SourceRuleZeroHitReason =
    | "source_rule_no_matching_callsite"
    | "source_rule_callsite_outside_allowed_methods"
    | "source_rule_matching_callsite_no_seed_fact"
    | "source_rule_non_call_zero_hit";

export interface SourceRuleZeroHitCallsiteSample {
    methodSignature: string;
    calleeSignature: string;
    stmtText: string;
    line: number;
    allowed: boolean;
}

export interface SourceRuleZeroHitAuditEntry {
    ruleId: string;
    sourceKind: SourceRuleKind;
    reason: SourceRuleZeroHitReason;
    allowedMethodFilterActive: boolean;
    matchedCallsiteCount: number;
    matchedAllowedCallsiteCount: number;
    matchedExcludedCallsiteCount: number;
    sampleCallsites: SourceRuleZeroHitCallsiteSample[];
}

export function collectSourceRuleSeeds(args: SourceRuleSeedCollectionArgs): SourceRuleSeedCollectionResult {
    const methods = resolveSourceScopeMethods(args.scene, args.allowedMethodSignatures);
    const facts: TaintFact[] = [];
    const seededLocals = new Set<string>();
    const seenFactIds = new Set<string>();
    const sourceRuleHits = new Map<string, number>();
    const sourceSeedAudit: SourceRuleSeedAuditEntry[] = [];
    const activatedMethodSignatures = new Set<string>();
    const bestTierBySiteFamily = new Map<string, number>();
    const parameterLocalCache = new WeakMap<ArkMethod, ParameterLocalInfo[]>();

    const getCachedParameterLocals = (method: ArkMethod): ParameterLocalInfo[] => {
        const cached = parameterLocalCache.get(method);
        if (cached) return cached;
        const resolved = getParameterLocals(method);
        parameterLocalCache.set(method, resolved);
        return resolved;
    };

    const pushFact = (fact: TaintFact, label: string, ruleId: string, activationMethod?: ArkMethod): boolean => {
        if (seenFactIds.has(fact.taintId)) return false;
        seenFactIds.add(fact.taintId);
        facts.push(fact);
        seededLocals.add(label);
        sourceRuleHits.set(ruleId, (sourceRuleHits.get(ruleId) || 0) + 1);
        const activationSignature = activationMethod?.getSignature?.()?.toString?.();
        if (activationSignature) {
            activatedMethodSignatures.add(activationSignature);
        }
        sourceSeedAudit.push({
            ruleId,
            source: fact.source,
            factId: fact.taintId,
            nodeId: fact.node.getID(),
            contextId: fact.contextID,
            fieldPath: fact.field ? [...fact.field] : undefined,
            label,
        });
        return true;
    };

    const resolveRuleFamily = (rule: SourceRule): string | undefined => {
        const family = typeof rule.family === "string" ? rule.family.trim() : "";
        return family.length > 0 ? family : undefined;
    };
    const resolveRuleTier = (rule: SourceRule): number => {
        if (rule.tier === "A") return 3;
        if (rule.tier === "B") return 2;
        if (rule.tier === "C") return 1;
        return 0;
    };
    const canApplyRuleAtSite = (rule: SourceRule, siteKey: string): boolean => {
        const family = resolveRuleFamily(rule);
        if (!family) return true;
        const key = `${siteKey}|${family}`;
        const best = bestTierBySiteFamily.get(key);
        return best === undefined || resolveRuleTier(rule) >= best;
    };
    const markRuleAppliedAtSite = (rule: SourceRule, siteKey: string): void => {
        const family = resolveRuleFamily(rule);
        if (!family) return;
        const key = `${siteKey}|${family}`;
        const tier = resolveRuleTier(rule);
        const best = bestTierBySiteFamily.get(key) || 0;
        if (tier > best) {
            bestTierBySiteFamily.set(key, tier);
        }
    };

    const orderedSourceRules = [...args.sourceRules].sort(compareSourceRuleTierAndId);

    for (const rule of orderedSourceRules) {
        if (rule.enabled === false) continue;
        const kind = resolveSourceRuleKind(rule);
        const target = resolveSourceRuleTarget(rule, kind);

        for (const method of methods) {
            if (!matchesScope(method, rule.scope)) continue;

            if (kind === "seed_local_name" || kind === "entry_param") {
                const body = method.getBody();
                if (!body) continue;
                const paramLocals = getCachedParameterLocals(method);
                const methodParameters = method.getParameters?.() || [];

                for (const local of body.getLocals().values()) {
                    const localName = local.getName();
                    const param = paramLocals.find(p => p.local.getName() === localName);
                    const paramIndex = param ? param.index : undefined;
                    const parameter = paramIndex !== undefined ? methodParameters[paramIndex] : undefined;

                    if (!matchesSourceLocalRule(rule, kind, method, localName, paramIndex, parameter)) continue;

                    let applied = false;
                    const siteKey = `${method.getSignature().toString()}|local:${localName}`;
                    if (!canApplyRuleAtSite(rule, siteKey)) continue;
                    const sourceTag = sourceTagForOccurrence(rule.id, siteKey, `local:${localName}`);
                    const localFacts = seedFactsFromValue(args.pag, local, sourceTag, args.emptyContextId, target.path);
                    for (const fact of localFacts) {
                        if (pushFact(fact, `${method.getName()}:${localName}`, rule.id, method)) {
                            applied = true;
                        }
                    }
                    if (applied) {
                        markRuleAppliedAtSite(rule, siteKey);
                    }
                }
                continue;
            }

            const cfg = method.getCfg();
            if (!cfg) continue;

            if (kind === "call_return" || kind === "call_arg") {
                for (const stmt of cfg.getStmts()) {
                    if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                    const invokeExpr = stmt.getInvokeExpr();
                    if (!invokeExpr) continue;

                    const calleeSignature = invokeExpr.getMethodSignature?.().toString?.() || "";
                    const calleeName = resolveInvokeMethodName(invokeExpr, calleeSignature);
                    if (!matchesSourceCallRule(rule, calleeSignature, calleeName, invokeExpr, method)) continue;

                    const targetValue = resolveInvokeTargetValue(stmt, invokeExpr, target.endpoint);
                    if (!targetValue) continue;

                    const promiseResultNodeIds = target.semanticEndpointKind === "promiseResult"
                        ? resolvePromiseFulfillmentSourceNodeIdsFromInvoke(args.scene, args.pag, invokeExpr)
                        : [];
                    const site = resolveStmtSite(method, stmt);
                    const siteKey = `${method.getSignature().toString()}|call:${calleeSignature}|${site.key}`;
                    if (!canApplyRuleAtSite(rule, siteKey)) continue;
                    const sourceTag = sourceTagForOccurrence(rule.id, siteKey, `call:${calleeName || "invoke"}:${site.label}`);
                    const callFacts = promiseResultNodeIds.length > 0
                        ? seedFactsFromNodeIds(args.pag, promiseResultNodeIds, sourceTag, args.emptyContextId, target.path)
                        : seedFactsFromValue(args.pag, targetValue, sourceTag, args.emptyContextId, target.path);
                    let applied = false;
                    for (const fact of callFacts) {
                        if (pushFact(fact, `${method.getName()}:${site.label}`, rule.id, method)) {
                            applied = true;
                        }
                    }
                    if (targetValue instanceof Local) {
                        const aliasFacts = seedLocalAliasFactsInMethod(
                            args.pag,
                            method,
                            targetValue,
                            sourceTag,
                            args.emptyContextId,
                            target.path,
                        );
                        for (const fact of aliasFacts) {
                            if (pushFact(fact, `${method.getName()}:${site.label}:alias`, rule.id, method)) {
                                applied = true;
                            }
                        }
                    }
                    if (applied) {
                        markRuleAppliedAtSite(rule, siteKey);
                    }
                }
                continue;
            }

            if (kind === "bound_state") {
                for (const stmt of cfg.getStmts()) {
                    if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                    const invokeExpr = stmt.getInvokeExpr();
                    if (!invokeExpr) continue;

                    const calleeSignature = invokeExpr.getMethodSignature?.().toString?.() || "";
                    const calleeName = resolveInvokeMethodName(invokeExpr, calleeSignature);
                    if (!matchesSourceCallRule(rule, calleeSignature, calleeName, invokeExpr, method)) continue;

                    const optionsValue = resolveInvokeTargetValue(stmt, invokeExpr, target.endpoint);
                    if (!optionsValue) continue;

                    const boundFieldNames = collectBoundStateFieldNamesFromOptions(
                        args.scene,
                        optionsValue,
                        target.path || [],
                    );
                    if (boundFieldNames.length === 0) continue;

                    const site = resolveStmtSite(method, stmt);
                    const siteKey = `${method.getSignature().toString()}|bound_state:${calleeSignature}|${site.key}`;
                    if (!canApplyRuleAtSite(rule, siteKey)) continue;

                    let applied = false;
                    for (const fieldName of boundFieldNames) {
                        const sourceTag = sourceTagForOccurrence(
                            rule.id,
                            `${siteKey}|field:${fieldName}`,
                            `bound:${fieldName}:${site.label}`,
                        );
                        const facts = seedDeclaringClassFieldNameFacts(
                            args.pag,
                            method,
                            fieldName,
                            sourceTag,
                            args.emptyContextId,
                        );
                        for (const fact of facts) {
                            if (pushFact(fact, `${method.getName()}:${fieldName}@bound_state`, rule.id, method)) {
                                applied = true;
                            }
                        }
                    }
                    if (applied) {
                        markRuleAppliedAtSite(rule, siteKey);
                    }
                }
                continue;
            }

            if (kind === "callback_param") {
                const targetParamIndex = resolveCallbackTargetParamIndex(rule);
                if (targetParamIndex === undefined) continue;

                for (const stmt of cfg.getStmts()) {
                    if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                    const knownOptionRegistrations = resolveKnownOptionCallbackRegistrationsForSourceRule(
                        stmt,
                        args.scene,
                        method,
                        rule,
                    );
                    const genericRegistrations = shouldPreferKnownOptionCallbackRegistrations(rule, knownOptionRegistrations)
                        ? []
                        : resolveCallbackRegistrationsFromStmt(
                            stmt,
                            args.scene,
                            method,
                            ({ invokeExpr, explicitArgs, scene, sourceMethod }) => {
                                const calleeSignature = invokeExpr.getMethodSignature?.().toString?.() || "";
                                const calleeName = resolveInvokeMethodName(invokeExpr, calleeSignature);
                                if (!matchesSourceCallRule(rule, calleeSignature, calleeName, invokeExpr, method)) {
                                    return null;
                                }

                                const callbackArgIndexes = resolveCallbackArgIndexes(
                                    rule,
                                    explicitArgs,
                                    scene,
                                    sourceMethod
                                );
                                if (callbackArgIndexes.length === 0) {
                                    return null;
                                }

                                return {
                                    callbackArgIndexes,
                                    callbackFieldNames: normalizeCallbackFieldNames(rule),
                                    reason: `Source callback registration ${calleeName || calleeSignature} from ${sourceMethod.getName()}`,
                                };
                            }
                        );
                    const registrations = [
                        ...knownOptionRegistrations,
                        ...genericRegistrations,
                    ];

                    for (const registration of registrations) {
                        activatedMethodSignatures.add(registration.callbackMethod.getSignature().toString());
                        const callbackParams = getCachedParameterLocals(registration.callbackMethod);
                        const callbackParam = resolveCallbackUserParam(callbackParams, targetParamIndex);
                        if (!callbackParam) continue;

                        const line = registration.registrationInvokeExpr?.getOriginPositionInfo?.().getLineNo?.()
                            ?? registration.registrationMethod.getCfg?.()?.getStmts?.()?.[0]?.getOriginPositionInfo?.().getLineNo?.()
                            ?? -1;
                        const siteKey = `${method.getSignature().toString()}|callback:${registration.registrationSignature}|line:${line}|cbArg:${registration.callbackArgIndex}`;
                        if (!canApplyRuleAtSite(rule, siteKey)) continue;
                        let applied = false;
                        const sourceTag = sourceTagForOccurrence(
                            rule.id,
                            siteKey,
                            `callback:arg${targetParamIndex}:line${line}`,
                        );

                        const callbackFacts = seedFactsFromValue(
                            args.pag,
                            callbackParam.local,
                            sourceTag,
                            args.emptyContextId,
                            target.path
                        );
                        for (const fact of callbackFacts) {
                            if (pushFact(
                                fact,
                                `${registration.callbackMethod.getName()}:arg${targetParamIndex}@${registration.registrationMethodName || "callback"}#cbArg${registration.callbackArgIndex}`,
                                rule.id,
                                registration.callbackMethod
                            )) {
                                applied = true;
                            }
                        }

                        const aliasFacts = seedLocalAliasFactsInMethod(
                            args.pag,
                            registration.callbackMethod,
                            callbackParam.local,
                            sourceTag,
                            args.emptyContextId,
                            target.path
                        );
                        for (const fact of aliasFacts) {
                            if (pushFact(
                                fact,
                                `${registration.callbackMethod.getName()}:arg${targetParamIndex}->alias#cbArg${registration.callbackArgIndex}`,
                                rule.id,
                                registration.callbackMethod
                            )) {
                                applied = true;
                            }
                        }

                        const forwardedFacts = seedForwardedCallbackParamFacts(
                            args.scene,
                            args.pag,
                            registration.callbackMethod,
                            callbackParam.local,
                            sourceTag,
                            args.emptyContextId,
                            target.path,
                            activatedMethodSignatures
                        );
                        for (const fact of forwardedFacts) {
                            if (pushFact(
                                fact,
                                `${registration.callbackMethod.getName()}:arg${targetParamIndex}->forward#cbArg${registration.callbackArgIndex}`,
                                rule.id,
                                registration.callbackMethod
                            )) {
                                applied = true;
                            }
                        }

                        if (applied) {
                            markRuleAppliedAtSite(rule, siteKey);
                        }
                    }
                }
                continue;
            }

            if (kind === "field_read") {
                for (const stmt of cfg.getStmts()) {
                    if (!(stmt instanceof ArkAssignStmt)) continue;
                    const right = stmt.getRightOp();
                    if (!(right instanceof ArkInstanceFieldRef)) continue;
                    const left = stmt.getLeftOp();

                    const fieldName = right.getFieldSignature().getFieldName();
                    const fieldSignature = right.getFieldSignature().toString();
                    if (!matchesSourceFieldReadRule(rule, method, right, left?.toString?.() || "", fieldName, fieldSignature)) {
                        continue;
                    }
                    if (target.path && target.path.length > 0 && target.path[0] !== fieldName) {
                        continue;
                    }

                    const targetValue = resolveFieldReadTargetValue(stmt, right, target.endpoint);
                    if (!targetValue) continue;

                    let applied = false;
                    const site = resolveStmtSite(method, stmt);
                    const siteKey = `${method.getSignature().toString()}|field:${fieldSignature}|${site.key}`;
                    if (!canApplyRuleAtSite(rule, siteKey)) continue;
                    const sourceTag = sourceTagForOccurrence(rule.id, siteKey, `field:${fieldName}:${site.label}`);
                    const readFacts = seedFactsFromValue(args.pag, targetValue, sourceTag, args.emptyContextId, undefined);
                    for (const fact of readFacts) {
                        if (pushFact(fact, `${method.getName()}:${fieldName}`, rule.id, method)) {
                            applied = true;
                        }
                    }
                    if (applied) {
                        markRuleAppliedAtSite(rule, siteKey);
                    }
                }
            }
        }
    }

    return {
        facts,
        seededLocals: [...seededLocals].sort(),
        sourceRuleHits: toRecord(sourceRuleHits),
        activatedMethodSignatures: [...activatedMethodSignatures].sort(),
        sourceSeedAudit,
        sourceRuleZeroHitAudit: buildSourceRuleZeroHitAudit(
            args.scene,
            orderedSourceRules,
            sourceRuleHits,
            args.allowedMethodSignatures,
        ),
    };
}

function buildSourceRuleZeroHitAudit(
    scene: Scene,
    sourceRules: SourceRule[],
    sourceRuleHits: Map<string, number>,
    allowedMethodSignatures?: Set<string>,
): SourceRuleZeroHitAuditEntry[] {
    const out: SourceRuleZeroHitAuditEntry[] = [];
    for (const rule of sourceRules) {
        const ruleId = typeof rule?.id === "string" ? rule.id.trim() : "";
        if (!ruleId || rule.enabled === false) continue;
        if ((sourceRuleHits.get(ruleId) || 0) > 0) continue;
        const kind = resolveSourceRuleKind(rule);
        if (!isCallLikeSourceKind(kind)) {
            out.push({
                ruleId,
                sourceKind: kind,
                reason: "source_rule_non_call_zero_hit",
                allowedMethodFilterActive: !!allowedMethodSignatures,
                matchedCallsiteCount: 0,
                matchedAllowedCallsiteCount: 0,
                matchedExcludedCallsiteCount: 0,
                sampleCallsites: [],
            });
            continue;
        }
        const samples: SourceRuleZeroHitCallsiteSample[] = [];
        let matchedCallsiteCount = 0;
        let matchedAllowedCallsiteCount = 0;
        let matchedExcludedCallsiteCount = 0;
        for (const method of scene.getMethods()) {
            if (!matchesScope(method, rule.scope)) continue;
            const cfg = method.getCfg?.();
            if (!cfg) continue;
            const methodSignature = method.getSignature().toString();
            const allowed = !allowedMethodSignatures || allowedMethodSignatures.has(methodSignature);
            for (const stmt of cfg.getStmts()) {
                if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                const invokeExpr = stmt.getInvokeExpr();
                if (!invokeExpr) continue;
                const calleeSignature = invokeExpr.getMethodSignature?.().toString?.() || "";
                const calleeName = resolveInvokeMethodName(invokeExpr, calleeSignature);
                if (!matchesSourceCallRule(rule, calleeSignature, calleeName, invokeExpr, method)) continue;
                matchedCallsiteCount += 1;
                if (allowed) {
                    matchedAllowedCallsiteCount += 1;
                } else {
                    matchedExcludedCallsiteCount += 1;
                }
                if (samples.length < 5) {
                    samples.push({
                        methodSignature,
                        calleeSignature,
                        stmtText: stmt.toString?.() || "",
                        line: stmt.getOriginPositionInfo?.()?.getLineNo?.() ?? -1,
                        allowed,
                    });
                }
            }
        }
        const reason: SourceRuleZeroHitReason = matchedCallsiteCount === 0
            ? "source_rule_no_matching_callsite"
            : matchedAllowedCallsiteCount === 0
                ? "source_rule_callsite_outside_allowed_methods"
                : "source_rule_matching_callsite_no_seed_fact";
        out.push({
            ruleId,
            sourceKind: kind,
            reason,
            allowedMethodFilterActive: !!allowedMethodSignatures,
            matchedCallsiteCount,
            matchedAllowedCallsiteCount,
            matchedExcludedCallsiteCount,
            sampleCallsites: samples,
        });
    }
    return out;
}

function isCallLikeSourceKind(kind: SourceRuleKind): boolean {
    return kind === "call_return"
        || kind === "call_arg"
        || kind === "callback_param"
        || kind === "bound_state";
}

function sourceTagForOccurrence(ruleId: string, occurrenceKey: string, label: string): string {
    const normalizedLabel = String(label || "site")
        .replace(/[^A-Za-z0-9_.:-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) || "site";
    return `source_rule:${ruleId}#occ=${normalizedLabel}:${stableSourceOccurrenceHash(occurrenceKey)}`;
}

function resolveStmtSite(method: ArkMethod, stmt: unknown): { key: string; label: string } {
    const line = (stmt as any)?.getOriginPositionInfo?.()?.getLineNo?.() ?? -1;
    if (Number.isFinite(line) && line >= 0) {
        return { key: `line:${line}`, label: `line${line}` };
    }

    const stmts = method.getCfg?.()?.getStmts?.() || [];
    const index = stmts.indexOf(stmt as any);
    const safeIndex = index >= 0 ? index : -1;
    const text = String((stmt as any)?.toString?.() || "");
    const hash = stableSourceOccurrenceHash(`${method.getSignature().toString()}|${safeIndex}|${text}`);
    return {
        key: `stmt:${safeIndex}:${hash}`,
        label: `stmt${safeIndex}`,
    };
}

function stableSourceOccurrenceHash(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function resolveSourceScopeMethods(
    scene: Scene,
    allowedMethodSignatures?: Set<string>
): ArkMethod[] {
    const allMethods = scene.getMethods();
    if (allowedMethodSignatures && allowedMethodSignatures.size > 0) {
        return allMethods.filter(m => allowedMethodSignatures.has(m.getSignature().toString()));
    }
    return allMethods;
}

interface ParameterLocalInfo {
    index: number;
    local: Local;
    refText: string;
    hiddenClosureCarrier: boolean;
}

function getParameterLocals(method: ArkMethod): ParameterLocalInfo[] {
    const out: ParameterLocalInfo[] = [];
    const cfg = method.getCfg();
    if (!cfg) return out;

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
        const leftOp = stmt.getLeftOp();
        if (!(leftOp instanceof Local)) continue;

        const refText = stmt.getRightOp().toString();
        const m = refText.match(/parameter(\d+)/);
        if (!m) continue;

        out.push({
            index: Number(m[1]),
            local: leftOp,
            refText,
            hiddenClosureCarrier: isHiddenClosureCarrierParam(leftOp, refText),
        });
    }
    out.sort((a, b) => a.index - b.index);
    return out;
}

function isHiddenClosureCarrierParam(local: Local, refText: string): boolean {
    const localName = local.getName?.() || "";
    if (/^%closures\d*$/.test(localName)) return true;
    return /parameter\d+\s*:\s*\[[^\]]+\]/.test(refText);
}

function resolveCallbackUserParam(
    callbackParams: ParameterLocalInfo[],
    userParamIndex: number
): ParameterLocalInfo | undefined {
    if (!Number.isInteger(userParamIndex) || userParamIndex < 0) return undefined;
    const visibleParams = callbackParams.filter(param => !param.hiddenClosureCarrier);
    if (visibleParams.length > 0) {
        return visibleParams[userParamIndex];
    }
    return callbackParams.find(param => param.index === userParamIndex);
}

function resolveSourceRuleKind(rule: SourceRule): SourceRuleKind {
    return rule.sourceKind;
}

function defaultEndpointForSourceKind(kind: SourceRuleKind): RuleEndpoint | undefined {
    if (kind === "entry_param" || kind === "call_arg" || kind === "callback_param") return "arg0";
    if (kind === "call_return" || kind === "field_read") return "result";
    return undefined;
}

function resolveSourceRuleTarget(
    rule: SourceRule,
    kind: SourceRuleKind
): { endpoint?: RuleEndpoint; path?: string[]; semanticEndpointKind?: RuleEndpointRef["semanticEndpointKind"] } {
    const norm = normalizeEndpoint(rule.target);
    return {
        endpoint: norm.endpoint ?? defaultEndpointForSourceKind(kind),
        path: norm.path,
        semanticEndpointKind: norm.semanticEndpointKind,
    };
}

function resolveInvokeMethodName(invokeExpr: any, signature: string): string {
    const fromSig = invokeExpr.getMethodSignature?.().getMethodSubSignature?.().getMethodName?.() || "";
    if (fromSig) return String(fromSig);
    const m = signature.match(/\.([A-Za-z0-9_$]+)\(/);
    return m ? m[1] : "";
}

function matchesSourceLocalRule(
    rule: SourceRule,
    kind: SourceRuleKind,
    method: ArkMethod,
    localName: string,
    paramIndex?: number,
    parameter?: any
): boolean {
    if (kind === "entry_param" && paramIndex === undefined) {
        return false;
    }

    const targetEndpoint = normalizeEndpoint(rule.target).endpoint;
    if (kind === "entry_param" && targetEndpoint) {
        const m = /^arg(\d+)$/.exec(targetEndpoint);
        if (m && Number(m[1]) !== paramIndex) {
            return false;
        }
    }
    if (kind === "entry_param") {
        const paramNameIncludes = rule.paramNameIncludes || [];
        const paramTypeIncludes = rule.paramTypeIncludes || [];
        const paramMatchMode = rule.paramMatchMode || (paramTypeIncludes.length > 0 ? "name_and_type" : "name_only");
        const paramName = String(parameter?.getName?.() || "").toLowerCase();
        const paramType = String(parameter?.getType?.()?.toString?.() || "").toLowerCase();

        if (paramNameIncludes.length > 0) {
            const hasName = paramNameIncludes.some(k => paramName.includes(String(k).toLowerCase()));
            if (!hasName) {
                return false;
            }
        }

        if (paramMatchMode === "name_and_type" && paramTypeIncludes.length > 0) {
            const hasType = paramTypeIncludes.some(k => paramType.includes(String(k).toLowerCase()));
            if (!hasType) {
                return false;
            }
        }
    }

    const methodSignature = method.getSignature().toString();
    const methodName = method.getName();
    const classSignature = method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
    const className = method.getDeclaringArkClass?.()?.getName?.() || "";
    const value = rule.match.value || "";
    switch (rule.match.kind) {
        case "method_name_equals":
            return methodName === value;
        case "signature_equals":
            return exactTextMatch(methodSignature, value);
        case "declaring_class_equals":
            return exactDeclaringClassMatch(classSignature, className, value);
        case "field_name_equals":
            return localName === value;
        default:
            return false;
    }
}

function matchesSourceCallRule(
    rule: SourceRule,
    calleeSignature: string,
    calleeName: string,
    invokeExpr: any,
    sourceMethod?: ArkMethod,
): boolean {
    if (!matchesInvokeShape(rule, invokeExpr, calleeSignature, sourceMethod)) return false;
    if (!matchesInvokeCalleeScope(rule.calleeScope, invokeExpr, calleeSignature, calleeName, sourceMethod)) return false;

    const value = rule.match.value || "";
    const normalizedCalleeSignature = normalizeInvokeSignatureForRuleMatch(calleeSignature);
    const normalizedValue = normalizeInvokeSignatureForRuleMatch(value);
    switch (rule.match.kind) {
        case "method_name_equals":
            if (calleeName === value) {
                return true;
            }
            if (calleeName === "constructor") {
                const classSignature = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
                const className = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.getClassName?.() || "";
                return exactDeclaringClassMatch(classSignature, className, value);
            }
            return false;
        case "signature_equals":
            return exactTextMatch(calleeSignature, value)
                || exactTextMatch(normalizedCalleeSignature, normalizedValue);
        case "declaring_class_equals": {
            const classSignature = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
            const className = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.getClassName?.() || "";
            return exactDeclaringClassMatch(classSignature, className, value);
        }
        case "field_name_equals":
            return false;
        default:
            return false;
    }
}

function compareSourceRuleTierAndId(left: SourceRule, right: SourceRule): number {
    const tierWeight = (rule: SourceRule): number => {
        if (rule.tier === "A") return 3;
        if (rule.tier === "B") return 2;
        if (rule.tier === "C") return 1;
        return 0;
    };
    const delta = tierWeight(right) - tierWeight(left);
    if (delta !== 0) return delta;
    return String(left.id || "").localeCompare(String(right.id || ""));
}

function matchesInvokeCalleeScope(
    scope: RuleScopeConstraint | undefined,
    invokeExpr: any,
    calleeSignature: string,
    calleeName: string,
    sourceMethod?: ArkMethod,
): boolean {
    if (!scope) return true;
    const methodSig = invokeExpr.getMethodSignature?.();
    const classSig = methodSig?.getDeclaringClassSignature?.();
    const classText = classSig?.getClassName?.() || classSig?.toString?.() || "";
    const fileText = classSig?.getDeclaringFileSignature?.()?.toString?.() || extractFilePathFromSignature(calleeSignature);
    const moduleText = calleeSignature || fileText;
    if (scope.methodDecorators && scope.methodDecorators.length > 0) return false;
    if (!matchStringConstraint(scope.methodName, calleeName)) return false;

    const sdkImportScope = resolveSdkImportScopeCandidates(sourceMethod, invokeExpr);
    if (!matchConstraintAgainstCandidates(scope.file, [fileText, ...sdkImportScope.fileTexts])) return false;
    if (!matchConstraintAgainstCandidates(scope.module, [moduleText, ...sdkImportScope.moduleTexts])) return false;
    if (!matchConstraintAgainstCandidates(scope.className, [classText, ...sdkImportScope.classTexts])) return false;
    return true;
}

function matchesSourceFieldReadRule(
    rule: SourceRule,
    method: ArkMethod,
    fieldRef: ArkInstanceFieldRef,
    leftText: string,
    fieldName: string,
    fieldSignature: string
): boolean {
    if (!matchesFieldReadCalleeScope(rule.calleeScope, fieldRef, fieldSignature, fieldName, method)) {
        return false;
    }
    const value = rule.match.value || "";
    const methodSignature = method.getSignature().toString();
    const classSignature = method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
    const className = method.getDeclaringArkClass?.()?.getName?.() || "";
    switch (rule.match.kind) {
        case "method_name_equals":
            return method.getName() === value;
        case "signature_equals":
            return exactTextMatch(fieldSignature, value) || exactTextMatch(methodSignature, value);
        case "declaring_class_equals":
            return exactDeclaringClassMatch(classSignature, className, value);
        case "field_name_equals":
            return fieldName === value;
        default:
            return false;
    }
}

function matchesFieldReadCalleeScope(
    scope: RuleScopeConstraint | undefined,
    fieldRef: ArkInstanceFieldRef,
    fieldSignature: string,
    fieldName: string,
    sourceMethod?: ArkMethod,
): boolean {
    if (!scope) return true;
    const declaringSig = fieldRef.getFieldSignature?.().getDeclaringSignature?.();
    const fileText = declaringSig?.getDeclaringFileSignature?.()?.toString?.() || extractFilePathFromSignature(fieldSignature);
    const classText = (declaringSig as any)?.getClassName?.() || declaringSig?.toString?.() || "";
    const moduleText = fieldSignature || fileText;
    if (scope.methodDecorators && scope.methodDecorators.length > 0) return false;
    if (!matchStringConstraint(scope.methodName, fieldName)) return false;

    const syntheticInvoke = {
        getBase: () => fieldRef.getBase?.(),
        getMethodSignature: () => undefined,
    };
    const sdkImportScope = resolveSdkImportScopeCandidates(sourceMethod, syntheticInvoke);
    if (!matchConstraintAgainstCandidates(scope.file, [fileText, ...sdkImportScope.fileTexts])) return false;
    if (!matchConstraintAgainstCandidates(scope.module, [moduleText, ...sdkImportScope.moduleTexts])) return false;
    if (!matchConstraintAgainstCandidates(scope.className, [classText, ...sdkImportScope.classTexts])) return false;
    return true;
}

function matchesInvokeShape(
    rule: SourceRule,
    invokeExpr: any,
    calleeSignature: string,
    sourceMethod?: ArkMethod,
): boolean {
    const invokeKind = rule.match.invokeKind;
    if (invokeKind && invokeKind !== "any") {
        const actualKind: RuleInvokeKind = invokeExpr instanceof ArkInstanceInvokeExpr ? "instance" : "static";
        if (actualKind !== invokeKind) return false;
    }

    if (rule.match.argCount !== undefined) {
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length !== rule.match.argCount) return false;
    }

    if (!matchesLiteralArgConstraints(rule, invokeExpr)) {
        return false;
    }

    const typeHint = rule.match.typeHint;
    if (typeHint && typeHint.trim().length > 0) {
        const hint = typeHint.trim().toLowerCase();
        const declaringClass = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
        const baseText = invokeExpr instanceof ArkInstanceInvokeExpr ? (invokeExpr.getBase()?.toString?.() || "") : "";
        const ptrText = invokeExpr instanceof ArkPtrInvokeExpr ? (invokeExpr.toString?.() || "") : "";
        const invokeText = invokeExpr.toString?.() || "";
        const receiverTraceText = collectReceiverTypeHintTrace(sourceMethod, invokeExpr).join(" ");
        const haystack = `${calleeSignature} ${declaringClass} ${baseText} ${ptrText} ${invokeText} ${receiverTraceText}`.toLowerCase();
        if (!matchesTypeHint(haystack, hint)) return false;
    }

    return true;
}

function matchesLiteralArgConstraints(rule: SourceRule, invokeExpr: any): boolean {
    const constraints = rule.match.literalArgs;
    if (!Array.isArray(constraints) || constraints.length === 0) return true;
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    for (const constraint of constraints) {
        if (!constraint || !Number.isInteger(constraint.index) || constraint.index < 0) {
            return false;
        }
        const arg = args[constraint.index];
        if (arg === undefined) return false;
        const actual = normalizeLiteralArgText(arg);
        const allowed = Array.isArray(constraint.values)
            ? constraint.values.map(value => normalizeLiteralArgText(value))
            : [];
        if (allowed.length === 0 || !allowed.includes(actual)) {
            return false;
        }
    }
    return true;
}

function normalizeLiteralArgText(value: unknown): string {
    let text = String((value as any)?.getValue?.() ?? (value as any)?.getText?.() ?? (value as any)?.toString?.() ?? value ?? "");
    text = text.trim();
    if (
        (text.startsWith("\"") && text.endsWith("\""))
        || (text.startsWith("'") && text.endsWith("'"))
        || (text.startsWith("`") && text.endsWith("`"))
    ) {
        text = text.slice(1, -1);
    }
    return text;
}

function matchesTypeHint(haystack: string, hint: string): boolean {
    if (haystack.includes(hint)) {
        return true;
    }
    const parts = hint
        .split(/[.\s:/\\]+/)
        .map(part => part.trim())
        .filter(Boolean);
    if (parts.length <= 1) {
        return false;
    }
    return parts.every(part => haystack.includes(part));
}

function collectReceiverTypeHintTrace(sourceMethod: ArkMethod | undefined, invokeExpr: any): string[] {
    if (!sourceMethod || !(invokeExpr instanceof ArkInstanceInvokeExpr)) return [];
    const base = invokeExpr.getBase?.();
    if (!(base instanceof Local)) return [];
    const localKey = base.toString?.() || base.getName?.() || "";
    if (!localKey) return [];
    let methodCache = RECEIVER_TYPE_HINT_TRACE_CACHE.get(sourceMethod);
    if (!methodCache) {
        methodCache = new Map<string, string[]>();
        RECEIVER_TYPE_HINT_TRACE_CACHE.set(sourceMethod, methodCache);
    }
    const cached = methodCache.get(localKey);
    if (cached) return cached;
    const out: string[] = [];
    collectLocalProducerTrace(sourceMethod, base, out, new Set<string>(), 16);
    methodCache.set(localKey, out);
    return out;
}

function collectLocalProducerTrace(
    method: ArkMethod,
    local: Local,
    out: string[],
    seen: Set<string>,
    depth: number,
): void {
    if (depth <= 0) return;
    const localKey = local.toString?.() || "";
    if (!localKey || seen.has(localKey)) return;
    seen.add(localKey);

    const cfg = method.getCfg?.();
    const stmts = cfg?.getStmts?.() || [];
    for (const stmt of stmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp?.();
        if (!(left instanceof Local)) continue;
        if ((left.toString?.() || "") !== localKey) continue;

        out.push(stmt.toString?.() || "");
        const right = stmt.getRightOp?.();
        if (right instanceof ArkInstanceFieldRef) {
            const fieldSignature = right.getFieldSignature?.()?.toString?.() || "";
            if (fieldSignature) {
                out.push(fieldSignature);
            }
            const nextBase = right.getBase?.();
            if (nextBase instanceof Local) {
                collectLocalProducerTrace(method, nextBase, out, seen, depth - 1);
            }
        }
        if (!stmt.containsInvokeExpr?.()) continue;
        const invoke = stmt.getInvokeExpr?.();
        const sig = invoke?.getMethodSignature?.()?.toString?.() || "";
        if (sig) out.push(sig);
        if (invoke instanceof ArkInstanceInvokeExpr) {
            const nextBase = invoke.getBase?.();
            if (nextBase instanceof Local) {
                collectLocalProducerTrace(method, nextBase, out, seen, depth - 1);
            }
        }
    }
}

function resolveInvokeTargetValue(stmt: any, invokeExpr: any, endpoint?: RuleEndpoint): any | undefined {
    if (!endpoint || endpoint === "result") {
        if (!(stmt instanceof ArkAssignStmt)) return undefined;
        return stmt.getLeftOp();
    }
    if (endpoint === "base") {
        if (invokeExpr instanceof ArkInstanceInvokeExpr) return invokeExpr.getBase();
        return undefined;
    }
    const m = /^arg(\d+)$/.exec(endpoint);
    if (!m) return undefined;
    const idx = Number(m[1]);
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (!Number.isFinite(idx) || idx < 0 || idx >= args.length) return undefined;
    return args[idx];
}

function normalizeExactMatchText(value: string): string {
    return value.trim();
}

function exactTextMatch(actual: string, expected: string): boolean {
    return normalizeExactMatchText(actual) === normalizeExactMatchText(expected);
}

function exactDeclaringClassMatch(classSignature: string, className: string, expected: string): boolean {
    const normalizedExpected = normalizeExactMatchText(expected);
    if (!normalizedExpected) return false;
    return normalizeExactMatchText(classSignature) === normalizedExpected
        || normalizeExactMatchText(className) === normalizedExpected;
}

function normalizeInvokeSignatureForRuleMatch(signature: string): string {
    return String(signature || "")
        .replace(/\.\[static\]/g, ".")
        .replace(/\[static\]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function resolveCallbackTargetParamIndex(rule: SourceRule): number | undefined {
    const endpoint = normalizeEndpoint(rule.target).endpoint || "arg0";
    if (typeof endpoint !== "string") return undefined;
    const m = /^arg(\d+)$/.exec(endpoint);
    if (!m) return undefined;
    return Number(m[1]);
}

function resolveCallbackArgIndexes(
    rule: SourceRule,
    callArgs: any[],
    scene: Scene,
    callerMethod?: ArkMethod
): number[] {
    const explicit = normalizeCallbackArgIndexes(rule, callArgs.length);
    if (explicit.length > 0) {
        const resolvedExplicit = explicit.filter(idx => {
            if (idx < 0 || idx >= callArgs.length) return false;
            const callbackMethods = resolveCallbackMethodsFromRuleArg(scene, callArgs[idx], rule, callerMethod);
            return callbackMethods.length > 0;
        });
        if (resolvedExplicit.length > 0) {
            return resolvedExplicit;
        }
    }

    const inferred: number[] = [];
    for (let i = 0; i < callArgs.length; i++) {
        const arg = callArgs[i];
        const callbackMethods = resolveCallbackMethodsFromRuleArg(scene, arg, rule, callerMethod);
        if (callbackMethods.length > 0) {
            inferred.push(i);
        }
    }
    return inferred;
}

function normalizeCallbackArgIndexes(rule: SourceRule, argCount: number): number[] {
    const result = new Set<number>();
    if (Array.isArray(rule.callbackArgIndexes)) {
        for (const idx of rule.callbackArgIndexes) {
            if (!Number.isInteger(idx) || idx < 0 || idx >= argCount) continue;
            result.add(idx);
        }
    }
    return [...result.values()].sort((a, b) => a - b);
}

function normalizeCallbackFieldNames(rule: SourceRule): string[] | undefined {
    if (!Array.isArray(rule.callbackFieldNames)) {
        return undefined;
    }
    const out = new Set<string>();
    for (const raw of rule.callbackFieldNames) {
        const text = String(raw || "").trim();
        if (text) out.add(text);
    }
    return out.size > 0 ? [...out.values()].sort((a, b) => a.localeCompare(b)) : undefined;
}

function shouldPreferKnownOptionCallbackRegistrations(rule: SourceRule, registrations: any[]): boolean {
    return rule.callbackResolution === "known_option"
        && Array.isArray(registrations)
        && registrations.length > 0;
}

function resolveKnownOptionCallbackRegistrationsForSourceRule(
    stmt: any,
    scene: Scene,
    sourceMethod: ArkMethod,
    rule: SourceRule,
): any[] {
    if (rule.callbackResolution !== "known_option") {
        return [];
    }

    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];
    const calleeSignature = invokeExpr.getMethodSignature?.().toString?.() || "";
    const calleeName = resolveInvokeMethodName(invokeExpr, calleeSignature);
    if (!matchesSourceCallRule(rule, calleeSignature, calleeName, invokeExpr, sourceMethod)) {
        return [];
    }

    const fieldNames = new Set(normalizeCallbackFieldNames(rule) || []);
    return resolveKnownOptionCallbackRegistrationsFromStmt(stmt, scene, sourceMethod)
        .filter(registration =>
            fieldNames.size === 0
            || fieldNames.has(String(registration.callbackFieldName || "")),
        );
}

function resolveCallbackMethodsFromArg(scene: Scene, callbackArg: any, callerMethod?: ArkMethod): ArkMethod[] {
    const out = new Map<string, ArkMethod>();
    const candidateNames = new Set<string>();
    const visitingLocals = new Set<string>();
    const callerSig = callerMethod?.getSignature?.().toString?.() || "";
    const callerFilePath = callerSig ? extractFilePathFromSignature(callerSig) : "";
    const callerClassName = callerMethod?.getDeclaringArkClass?.()?.getName?.() || "";

    // IR-first: resolve callable targets from type/def-use before falling back to name heuristics.
    const structuralMethods = resolveMethodsFromCallable(scene, callbackArg, {
        maxCandidates: 12,
        enableLocalBacktrace: true,
        maxBacktraceSteps: 6,
        maxVisitedDefs: 20,
    }) as ArkMethod[];
    if (structuralMethods.length > 0) {
        const scoped = selectScopedCallbackMethods(structuralMethods, callerFilePath, callerClassName);
        if (scoped.length > 0) {
            return scoped;
        }
        return structuralMethods;
    }

    const addMethodLikeNames = (text: string): void => {
        if (!text) return;
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) {
            candidateNames.add(text);
        }
        const amMatches = text.match(/%AM\d+\$[A-Za-z0-9_]+/g) || [];
        for (const m of amMatches) {
            candidateNames.add(m);
        }
        const methodSigMatches = text.matchAll(/\.([A-Za-z0-9_$]+)\(/g);
        for (const m of methodSigMatches) {
            if (m[1]) candidateNames.add(m[1]);
        }
        const tailMember = text.match(/\.([A-Za-z0-9_$]+)$/);
        if (tailMember && tailMember[1]) {
            candidateNames.add(tailMember[1]);
        }
    };

    const collectFromValue = (value: any): void => {
        if (!value) return;
        addMethodLikeNames(value?.toString?.() || "");

        if (!(value instanceof Local)) return;
        const localName = value.getName();
        candidateNames.add(localName);
        if (visitingLocals.has(localName)) return;
        visitingLocals.add(localName);

        const declStmt = value.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== value) return;
        const rightOp: any = declStmt.getRightOp?.();
        if (rightOp instanceof Local) {
            collectFromValue(rightOp);
            return;
        }
        if (rightOp instanceof ArkInstanceFieldRef) {
            const fieldName = rightOp.getFieldSignature?.().getFieldName?.() || "";
            if (fieldName) candidateNames.add(fieldName);
            addMethodLikeNames(rightOp.getFieldSignature?.().toString?.() || "");
            return;
        }
        addMethodLikeNames(rightOp?.toString?.() || "");
    };

    collectFromValue(callbackArg);

    const methodsByName = new Map<string, ArkMethod[]>();
    for (const method of scene.getMethods()) {
        const methodName = method.getName();
        if (!candidateNames.has(methodName)) continue;
        if (!methodsByName.has(methodName)) methodsByName.set(methodName, []);
        methodsByName.get(methodName)!.push(method);
    }

    for (const [, methods] of methodsByName.entries()) {
        const scoped = selectScopedCallbackMethods(methods, callerFilePath, callerClassName);
        for (const method of scoped) {
            out.set(method.getSignature().toString(), method);
        }
    }

    return [...out.values()];
}

function selectScopedCallbackMethods(
    methods: ArkMethod[],
    callerFilePath: string,
    callerClassName: string
): ArkMethod[] {
    if (!methods || methods.length === 0) return [];
    if (methods.length === 1) return methods;

    const sameFile = callerFilePath
        ? methods.filter(m => extractFilePathFromSignature(m.getSignature().toString()) === callerFilePath)
        : [];
    const sameClass = callerClassName
        ? methods.filter(m => (m.getDeclaringArkClass?.()?.getName?.() || "") === callerClassName)
        : [];

    if (sameFile.length > 0) return sameFile;
    if (sameClass.length > 0) return sameClass;
    return methods;
}

function resolveFieldReadTargetValue(
    stmt: ArkAssignStmt,
    fieldRef: ArkInstanceFieldRef,
    endpoint?: RuleEndpoint
): any | undefined {
    if (!endpoint || endpoint === "result") {
        return stmt.getLeftOp();
    }
    if (endpoint === "base") {
        return fieldRef.getBase();
    }
    return undefined;
}

function seedFactsFromValue(
    pag: Pag,
    value: any,
    sourceTag: string,
    contextId: number,
    targetPath?: string[]
): TaintFact[] {
    const out: TaintFact[] = [];
    const seen = new Set<string>();
    const add = (fact: TaintFact): void => {
        if (seen.has(fact.id)) return;
        seen.add(fact.id);
        out.push(fact);
    };

    let pagNodes = pag.getNodesByValue(value);
    if ((!pagNodes || pagNodes.size === 0) && value instanceof Local) {
        try {
            pag.getOrNewNode(contextId, value, value.getDeclaringStmt?.() || undefined);
            pagNodes = pag.getNodesByValue(value);
        } catch {
            pagNodes = undefined;
        }
    }
    if ((!pagNodes || pagNodes.size === 0) && value instanceof ArkInstanceFieldRef) {
        const nestedField = resolveInstanceFieldRootAndPath(value);
        if (nestedField && nestedField.fieldPath.length > 1) {
            let rootNodes = pag.getNodesByValue(nestedField.root);
            if (!rootNodes || rootNodes.size === 0) {
                try {
                    pag.getOrNewNode(contextId, nestedField.root, nestedField.root.getDeclaringStmt?.() || undefined);
                    rootNodes = pag.getNodesByValue(nestedField.root);
                } catch {
                    rootNodes = undefined;
                }
            }
            if (rootNodes && rootNodes.size > 0) {
                let produced = false;
                const fieldPath = targetPath && targetPath.length > 0
                    ? [...nestedField.fieldPath, ...targetPath]
                    : [...nestedField.fieldPath];
                for (const rootNodeId of rootNodes.values()) {
                    const rootNode: any = pag.getNode(rootNodeId);
                    if (!rootNode) continue;
                    let hasPointTo = false;
                    for (const objId of rootNode.getPointTo()) {
                        hasPointTo = true;
                        produced = true;
                        const objNode: any = pag.getNode(objId);
                        if (!objNode) continue;
                        add(new TaintFact(objNode, sourceTag, contextId, [...fieldPath]));
                    }
                    if (!hasPointTo) {
                        produced = true;
                        add(new TaintFact(rootNode as any, sourceTag, contextId, [...fieldPath]));
                    }
                }
                if (produced) {
                    return out;
                }
            }
        }
        const base = value.getBase?.();
        let baseNodes = base ? pag.getNodesByValue(base) : undefined;
        if ((!baseNodes || baseNodes.size === 0) && base instanceof Local) {
            try {
                pag.getOrNewNode(contextId, base, base.getDeclaringStmt?.() || undefined);
                baseNodes = pag.getNodesByValue(base);
            } catch {
                baseNodes = undefined;
            }
        }
        const fieldName = value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.();
        if (baseNodes && baseNodes.size > 0 && fieldName) {
            const fieldPath = targetPath && targetPath.length > 0
                ? [fieldName, ...targetPath]
                : [fieldName];
            let produced = false;
            for (const baseNodeId of baseNodes.values()) {
                const baseNode: any = pag.getNode(baseNodeId);
                if (!baseNode) continue;
                let hasPointTo = false;
                for (const objId of baseNode.getPointTo()) {
                    hasPointTo = true;
                    produced = true;
                    const objNode: any = pag.getNode(objId);
                    if (!objNode) continue;
                    add(new TaintFact(objNode, sourceTag, contextId, [...fieldPath]));
                }
                if (!hasPointTo) {
                    produced = true;
                    add(new TaintFact(baseNode as any, sourceTag, contextId, [...fieldPath]));
                }
            }
            if (produced) {
                return out;
            }
        }
    }
    if (!pagNodes || pagNodes.size === 0) return out;

    if (targetPath && targetPath.length > 0) {
        let hasFieldFact = false;
        for (const nodeId of pagNodes.values()) {
            const rootNode: any = pag.getNode(nodeId);
            let hasPointTo = false;
            for (const objId of rootNode.getPointTo()) {
                hasPointTo = true;
                hasFieldFact = true;
                const objNode: any = pag.getNode(objId);
                add(new TaintFact(objNode, sourceTag, contextId, [...targetPath]));
            }
            if (!hasPointTo) {
                hasFieldFact = true;
                add(new TaintFact(rootNode as any, sourceTag, contextId, [...targetPath]));
            }
        }
        if (hasFieldFact) {
            return out;
        }
    }

    for (const nodeId of pagNodes.values()) {
        add(new TaintFact(pag.getNode(nodeId) as any, sourceTag, contextId));
    }
    return out;
}

function seedForwardedCallbackParamFacts(
    scene: Scene,
    pag: Pag,
    callbackMethod: ArkMethod,
    callbackParamLocal: Local,
    sourceTag: string,
    contextId: number,
    targetPath?: string[],
    activatedMethodSignatures?: Set<string>
): TaintFact[] {
    const out: TaintFact[] = [];
    const seen = new Set<string>();
    const add = (fact: TaintFact): void => {
        if (seen.has(fact.id)) return;
        seen.add(fact.id);
        out.push(fact);
    };

    const cfg = callbackMethod.getCfg();
    if (!cfg) return out;
    const aliasNames = collectAliasLocalNames(cfg.getStmts(), callbackParamLocal);
    aliasNames.add(callbackParamLocal.getName());

    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!invokeExpr) continue;

        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (!args || args.length === 0) continue;

        const calleeSig = invokeExpr.getMethodSignature?.().toString?.() || "";
        if (!calleeSig) continue;
        const calleeMethod = getMethodBySignature(scene, calleeSig);
        if (!calleeMethod) continue;
        activatedMethodSignatures?.add(calleeMethod.getSignature().toString());
        const calleeParams = getParameterLocals(calleeMethod);
        if (calleeParams.length === 0) continue;

        for (let idx = 0; idx < args.length; idx++) {
            const arg = args[idx];
            if (!(arg instanceof Local)) continue;
            if (!aliasNames.has(arg.getName())) continue;

            const targetParam = calleeParams.find(p => p.index === idx);
            if (!targetParam) continue;
            const facts = seedFactsFromValue(pag, targetParam.local, sourceTag, contextId, targetPath);
            for (const fact of facts) add(fact);
            const aliasFacts = seedLocalAliasFactsInMethod(
                pag,
                calleeMethod,
                targetParam.local,
                sourceTag,
                contextId,
                targetPath
            );
            for (const fact of aliasFacts) add(fact);
        }
    }

    return out;
}


function collectAliasLocalNames(stmts: any[], seedLocal: Local): Set<string> {
    const aliases = new Set<string>([seedLocal.getName()]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local) || !(right instanceof Local)) continue;
            if (!aliases.has(right.getName())) continue;
            if (aliases.has(left.getName())) continue;
            aliases.add(left.getName());
            changed = true;
        }
    }
    return aliases;
}

function seedLocalAliasFactsInMethod(
    pag: Pag,
    method: ArkMethod,
    seedLocal: Local,
    sourceTag: string,
    contextId: number,
    targetPath?: string[]
): TaintFact[] {
    const out: TaintFact[] = [];
    const seen = new Set<string>();
    const add = (fact: TaintFact): void => {
        if (seen.has(fact.id)) return;
        seen.add(fact.id);
        out.push(fact);
    };

    const cfg = method.getCfg();
    const body = method.getBody();
    if (!cfg || !body) return out;

    const aliasNames = collectAliasLocalNames(cfg.getStmts(), seedLocal);
    const allAliasNames = new Set<string>(aliasNames);
    aliasNames.delete(seedLocal.getName());

    const locals = [...body.getLocals().values()];
    for (const aliasName of aliasNames) {
        const local = locals.find(l => l.getName() === aliasName);
        if (!local) continue;
        const facts = seedFactsFromValue(pag, local, sourceTag, contextId, targetPath);
        for (const fact of facts) add(fact);
    }

    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkInstanceFieldRef)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof Local)) continue;
        if (!allAliasNames.has(right.getName())) continue;
        const facts = seedFactsFromValue(pag, left, sourceTag, contextId, targetPath);
        for (const fact of facts) add(fact);
        const classFacts = seedDeclaringClassFieldFacts(pag, method, left, sourceTag, contextId, targetPath);
        for (const fact of classFacts) add(fact);
    }

    return out;
}

function resolveInstanceFieldRootAndPath(
    value: ArkInstanceFieldRef,
): { root: Local; fieldPath: string[] } | undefined {
    const fieldPath: string[] = [];
    let current: any = value;
    while (current instanceof ArkInstanceFieldRef) {
        const fieldName = current.getFieldSignature?.().getFieldName?.() || current.getFieldName?.();
        if (!fieldName) return undefined;
        fieldPath.unshift(fieldName);
        current = current.getBase?.();
    }
    if (!(current instanceof Local)) return undefined;
    return { root: current, fieldPath };
}

function seedFactsFromNodeIds(
    pag: Pag,
    nodeIds: number[],
    sourceTag: string,
    contextId: number,
    targetPath?: string[],
): TaintFact[] {
    const out: TaintFact[] = [];
    const seen = new Set<string>();
    const add = (fact: TaintFact): void => {
        if (seen.has(fact.id)) return;
        seen.add(fact.id);
        out.push(fact);
    };
    for (const nodeId of nodeIds) {
        const rootNode: any = pag.getNode(nodeId);
        if (!rootNode) continue;
        if (targetPath && targetPath.length > 0) {
            let hasPointTo = false;
            for (const objId of rootNode.getPointTo?.() || []) {
                hasPointTo = true;
                const objNode: any = pag.getNode(objId);
                if (objNode) add(new TaintFact(objNode, sourceTag, contextId, [...targetPath]));
            }
            if (!hasPointTo) {
                add(new TaintFact(rootNode, sourceTag, contextId, [...targetPath]));
            }
            continue;
        }
        add(new TaintFact(rootNode, sourceTag, contextId));
    }
    return out;
}

function resolveCallbackMethodsFromRuleArg(
    scene: Scene,
    callbackArg: any,
    rule: SourceRule,
    callerMethod?: ArkMethod,
): ArkMethod[] {
    const fieldNames = normalizeCallbackFieldNames(rule);
    if (!fieldNames || fieldNames.length === 0) {
        return resolveCallbackMethodsFromArg(scene, callbackArg, callerMethod);
    }
    const out = new Map<string, ArkMethod>();
    for (const fieldName of fieldNames) {
        for (const method of resolveMethodsFromAnonymousObjectCarrierByField(scene, callbackArg, fieldName, {
            maxCandidates: 16,
            enableLocalBacktrace: true,
            maxBacktraceSteps: 6,
            maxVisitedDefs: 24,
        }) as ArkMethod[]) {
            const sig = method.getSignature?.().toString?.();
            if (!sig || out.has(sig)) continue;
            out.set(sig, method);
        }
    }
    return [...out.values()];
}

function seedDeclaringClassFieldFacts(
    pag: Pag,
    method: ArkMethod,
    fieldRef: ArkInstanceFieldRef,
    sourceTag: string,
    contextId: number,
    targetPath?: string[]
): TaintFact[] {
    const base = fieldRef.getBase?.();
    if (!(base instanceof Local) || base.getName() !== "this") {
        return [];
    }
    const fieldName = fieldRef.getFieldSignature?.().getFieldName?.() || "";
    if (!fieldName) {
        return [];
    }
    const fieldPath = targetPath && targetPath.length > 0
        ? [fieldName, ...targetPath]
        : [fieldName];
    const declaringClass = method.getDeclaringArkClass?.();
    const methods = declaringClass?.getMethods?.() || [];
    const out: TaintFact[] = [];
    const seen = new Set<string>();
    const add = (nodeId: number): void => {
        const node: any = pag.getNode(nodeId);
        if (!node) return;
        const fact = new TaintFact(node, sourceTag, contextId, [...fieldPath]);
        if (seen.has(fact.id)) return;
        seen.add(fact.id);
        out.push(fact);
    };
    for (const classMethod of methods) {
        for (const nodeId of collectMethodThisCarrierAndObjectNodeIds(pag, classMethod)) {
            add(nodeId);
        }
    }
    return out;
}

function seedDeclaringClassFieldNameFacts(
    pag: Pag,
    method: ArkMethod,
    fieldName: string,
    sourceTag: string,
    contextId: number,
    targetPath?: string[],
): TaintFact[] {
    const normalizedFieldName = String(fieldName || "").trim();
    if (!normalizedFieldName) {
        return [];
    }
    const fieldPath = targetPath && targetPath.length > 0
        ? [normalizedFieldName, ...targetPath]
        : [normalizedFieldName];
    const declaringClass = method.getDeclaringArkClass?.();
    const methods = declaringClass?.getMethods?.() || [];
    const out: TaintFact[] = [];
    const seen = new Set<string>();
    const add = (nodeId: number): void => {
        const node: any = pag.getNode(nodeId);
        if (!node) return;
        const fact = new TaintFact(node, sourceTag, contextId, [...fieldPath]);
        if (seen.has(fact.id)) return;
        seen.add(fact.id);
        out.push(fact);
    };
    for (const classMethod of methods) {
        for (const nodeId of collectMethodThisCarrierAndObjectNodeIds(pag, classMethod)) {
            add(nodeId);
        }
    }
    return out;
}

function collectBoundStateFieldNamesFromOptions(
    scene: Scene,
    optionsValue: any,
    optionPath: string[],
): string[] {
    const classSignature = String(optionsValue?.getType?.()?.getClassSignature?.()?.toString?.() || "");
    if (!classSignature) return [];

    const optionFieldName = optionPath.length > 0 ? optionPath[0] : "text";
    if (!optionFieldName) return [];

    const out = new Set<string>();
    for (const method of scene.getMethods()) {
        if (!isAnonymousOptionsInitializerFor(method, classSignature)) continue;
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        const boundLocalFieldNames = collectBoundThisLocalFieldNames(cfg.getStmts?.() || []);
        for (const stmt of cfg.getStmts?.() || []) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp?.();
            const right = stmt.getRightOp?.();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            if (!isThisFieldRef(left, optionFieldName)) continue;
            const boundFieldName = right instanceof ArkInstanceFieldRef
                ? (isBoundThisFieldRef(right)
                    ? (right.getFieldSignature?.().getFieldName?.() || right.getFieldName?.())
                    : undefined)
                : (right instanceof Local
                    ? boundLocalFieldNames.get(right.getName?.() || "")
                    : undefined);
            if (boundFieldName) out.add(boundFieldName);
        }
    }
    return [...out].sort((left, right) => left.localeCompare(right));
}

function collectBoundThisLocalFieldNames(stmts: any[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const stmt of stmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp?.();
        const right = stmt.getRightOp?.();
        if (!(left instanceof Local) || !(right instanceof ArkInstanceFieldRef)) continue;
        if (!isBoundThisFieldRef(right)) continue;
        const fieldName = right.getFieldSignature?.().getFieldName?.() || right.getFieldName?.();
        if (fieldName) out.set(left.getName(), fieldName);
    }
    return out;
}

function isAnonymousOptionsInitializerFor(method: ArkMethod, classSignature: string): boolean {
    const methodClassSignature = method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
    if (methodClassSignature !== classSignature) return false;
    const methodName = method.getName?.() || "";
    return methodName === "%instInit" || methodName.includes("%instInit");
}

function isThisFieldRef(fieldRef: ArkInstanceFieldRef, expectedFieldName: string): boolean {
    const baseName = fieldRef.getBase?.()?.getName?.() || "";
    const fieldName = fieldRef.getFieldSignature?.().getFieldName?.() || fieldRef.getFieldName?.();
    return baseName === "this" && fieldName === expectedFieldName;
}

function isBoundThisFieldRef(fieldRef: ArkInstanceFieldRef): boolean {
    const baseName = fieldRef.getBase?.()?.getName?.() || "";
    return baseName === "$$this";
}

function collectMethodThisCarrierAndObjectNodeIds(pag: Pag, method: any): Set<number> {
    const out = new Set<number>();
    const addThisLocal = (value: any): void => {
        const carrierNodes = pag.getNodesByValue(value);
        if (carrierNodes) {
            for (const nodeId of carrierNodes.values()) {
                out.add(Number(nodeId));
                const node: any = pag.getNode(nodeId);
                for (const objectNodeId of node?.getPointTo?.() || []) {
                    out.add(Number(objectNodeId));
                }
            }
        }
    };

    const body = method?.getBody?.();
    const bodyThis = body?.getLocals?.()?.get?.("this");
    if (bodyThis instanceof Local) {
        addThisLocal(bodyThis);
    }

    const cfg = method?.getCfg?.();
    if (!cfg) return out;
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local) || left.getName() !== "this") continue;
        addThisLocal(left);
    }
    return out;
}

function matchesScope(method: ArkMethod, scope?: RuleScopeConstraint): boolean {
    if (!scope) return true;
    const sig = method.getSignature().toString();
    const filePath = extractFilePathFromSignature(sig);
    const classText = method.getDeclaringArkClass()?.getName?.() || sig;
    const moduleText = filePath || sig;

    if (!matchStringConstraint(scope.file, filePath)) return false;
    if (!matchStringConstraint(scope.module, moduleText)) return false;
    if (!matchStringConstraint(scope.className, classText)) return false;
    if (!matchesMethodNameOrDecoratorScope(method, scope)) return false;
    return true;
}

function matchesMethodNameOrDecoratorScope(method: ArkMethod, scope: RuleScopeConstraint): boolean {
    const hasMethodNameScope = !!scope.methodName;
    const hasDecoratorScope = Array.isArray(scope.methodDecorators) && scope.methodDecorators.length > 0;
    const methodNameMatches = hasMethodNameScope
        ? matchStringConstraint(scope.methodName, method.getName())
        : true;
    if (methodNameMatches && !hasDecoratorScope) return true;
    if (methodNameMatches && hasMethodNameScope) return true;
    if (!hasDecoratorScope) return methodNameMatches;
    return methodHasAnyMatchingDecorator(method, scope.methodDecorators || []);
}

function methodHasAnyMatchingDecorator(method: ArkMethod, constraints: RuleStringConstraint[]): boolean {
    const decoratorKinds = (method.getDecorators?.() || [])
        .map((decorator: any) => normalizeDecoratorKind(decorator?.getKind?.()))
        .filter((kind: string | undefined): kind is string => !!kind);
    if (decoratorKinds.length === 0) return false;
    for (const constraint of constraints) {
        if (decoratorKinds.some(kind => matchStringConstraint(constraint, kind))) {
            return true;
        }
    }
    return false;
}

function normalizeDecoratorKind(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const normalized = raw.replace(/^@/, "").trim();
    if (!normalized) return undefined;
    return normalized.endsWith("()")
        ? normalized.slice(0, normalized.length - 2)
        : normalized;
}

function extractFilePathFromSignature(signature: string): string {
    const m = signature.match(/@([^:>]+):/);
    return m ? m[1].replace(/\\/g, "/") : signature;
}

function matchStringConstraint(constraint: RuleStringConstraint | undefined, text: string): boolean {
    if (!constraint) return true;
    const value = constraint.value || "";
    if (constraint.mode === "equals") return text === value;
    if (constraint.mode === "contains") return text.includes(value);
    try {
        return new RegExp(value).test(text);
    } catch {
        return false;
    }
}

function matchConstraintAgainstCandidates(
    constraint: RuleStringConstraint | undefined,
    candidates: string[],
): boolean {
    if (!constraint) return true;
    const seen = new Set<string>();
    for (const candidate of candidates) {
        const text = String(candidate || "").trim();
        if (!text || seen.has(text)) {
            continue;
        }
        seen.add(text);
        if (matchStringConstraint(constraint, text)) {
            return true;
        }
    }
    return false;
}

function toRecord(map: Map<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        out[k] = v;
    }
    return out;
}
