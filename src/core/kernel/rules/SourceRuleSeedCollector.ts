import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { resolveCallbackRegistrationsFromStmt } from "../../substrate/queries/CallbackBindingQuery";
import { resolveMethodsFromCallable } from "../../substrate/queries/CalleeResolver";
import { resolveSdkImportScopeCandidates } from "../../substrate/queries/SdkProvenance";
import { getMethodBySignature } from "../contracts/MethodLookup";
import { TaintFact } from "../model/TaintFact";
import {
    normalizeEndpoint,
    RuleEndpoint,
    RuleEndpointOrRef,
    RuleInvokeKind,
    RuleScopeConstraint,
    RuleStringConstraint,
    SourceRule,
    SourceRuleKind,
} from "../../rules/RuleSchema";

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
}

export function collectSourceRuleSeeds(args: SourceRuleSeedCollectionArgs): SourceRuleSeedCollectionResult {
    const methods = resolveSourceScopeMethods(args.scene, args.allowedMethodSignatures);
    const facts: TaintFact[] = [];
    const seededLocals = new Set<string>();
    const seenFactIds = new Set<string>();
    const sourceRuleHits = new Map<string, number>();
    const activatedMethodSignatures = new Set<string>();
    const bestTierBySiteFamily = new Map<string, number>();

    const pushFact = (fact: TaintFact, label: string, ruleId: string): boolean => {
        if (seenFactIds.has(fact.id)) return false;
        seenFactIds.add(fact.id);
        facts.push(fact);
        seededLocals.add(label);
        sourceRuleHits.set(ruleId, (sourceRuleHits.get(ruleId) || 0) + 1);
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
        const sourceTag = `source_rule:${rule.id}`;

        for (const method of methods) {
            if (!matchesScope(method, rule.scope)) continue;

            if (kind === "seed_local_name" || kind === "entry_param") {
                const body = method.getBody();
                if (!body) continue;
                const paramLocals = getParameterLocals(method);
                const methodParameters = method.getParameters?.() || [];

                for (const local of body.getLocals().values()) {
                    const localName = local.getName();
                    const param = paramLocals.find(p => p.local.getName() === localName);
                    const paramIndex = param ? param.index : undefined;
                    const parameter = paramIndex !== undefined ? methodParameters[paramIndex] : undefined;

                    if (!matchesSourceLocalRule(rule, kind, method, localName, paramIndex, parameter)) continue;

                    const localFacts = seedFactsFromValue(args.pag, local, sourceTag, args.emptyContextId, target.path);
                    let applied = false;
                    const siteKey = `${method.getSignature().toString()}|local:${localName}`;
                    if (!canApplyRuleAtSite(rule, siteKey)) continue;
                    for (const fact of localFacts) {
                        if (pushFact(fact, `${method.getName()}:${localName}`, rule.id)) {
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

                    const callFacts = seedFactsFromValue(args.pag, targetValue, sourceTag, args.emptyContextId, target.path);
                    let applied = false;
                    const line = stmt.getOriginPositionInfo?.().getLineNo?.() ?? -1;
                    const siteKey = `${method.getSignature().toString()}|call:${calleeSignature}|line:${line}`;
                    if (!canApplyRuleAtSite(rule, siteKey)) continue;
                    for (const fact of callFacts) {
                        if (pushFact(fact, `${method.getName()}:line${line}`, rule.id)) {
                            applied = true;
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
                    const registrations = resolveCallbackRegistrationsFromStmt(
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
                                reason: `Source callback registration ${calleeName || calleeSignature} from ${sourceMethod.getName()}`,
                            };
                        }
                    );

                    for (const registration of registrations) {
                        activatedMethodSignatures.add(registration.callbackMethod.getSignature().toString());
                        const callbackParams = getParameterLocals(registration.callbackMethod);
                        const callbackParam = callbackParams.find(p => p.index === targetParamIndex);
                        if (!callbackParam) continue;

                        const line = registration.registrationInvokeExpr?.getOriginPositionInfo?.().getLineNo?.()
                            ?? registration.registrationMethod.getCfg?.()?.getStmts?.()?.[0]?.getOriginPositionInfo?.().getLineNo?.()
                            ?? -1;
                        const siteKey = `${method.getSignature().toString()}|callback:${registration.registrationSignature}|line:${line}|cbArg:${registration.callbackArgIndex}`;
                        if (!canApplyRuleAtSite(rule, siteKey)) continue;
                        let applied = false;

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
                                rule.id
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
                                rule.id
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
                                rule.id
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

                    const readFacts = seedFactsFromValue(args.pag, targetValue, sourceTag, args.emptyContextId, undefined);
                    let applied = false;
                    const line = stmt.getOriginPositionInfo?.().getLineNo?.() ?? -1;
                    const siteKey = `${method.getSignature().toString()}|field:${fieldSignature}|line:${line}`;
                    if (!canApplyRuleAtSite(rule, siteKey)) continue;
                    for (const fact of readFacts) {
                        if (pushFact(fact, `${method.getName()}:${fieldName}`, rule.id)) {
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
    };
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

function getParameterLocals(method: ArkMethod): Array<{ index: number; local: Local }> {
    const out: Array<{ index: number; local: Local }> = [];
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
        });
    }
    out.sort((a, b) => a.index - b.index);
    return out;
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
): { endpoint?: RuleEndpoint; path?: string[] } {
    const norm = normalizeEndpoint(rule.target);
    return {
        endpoint: norm.endpoint ?? defaultEndpointForSourceKind(kind),
        path: norm.path,
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
        case "local_name_regex":
            try {
                return new RegExp(value).test(localName);
            } catch {
                return false;
            }
        case "method_name_equals":
            return methodName === value;
        case "method_name_regex":
            try {
                return new RegExp(value).test(methodName);
            } catch {
                return false;
            }
        case "signature_contains":
            return methodSignature.includes(value);
        case "signature_equals":
            return exactTextMatch(methodSignature, value);
        case "signature_regex":
            try {
                return new RegExp(value).test(methodSignature);
            } catch {
                return false;
            }
        case "declaring_class_equals":
            return exactDeclaringClassMatch(classSignature, className, value);
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
    if (!matchesInvokeShape(rule, invokeExpr, calleeSignature)) return false;
    if (!matchesInvokeCalleeScope(rule.calleeScope, invokeExpr, calleeSignature, calleeName, sourceMethod)) return false;

    const value = rule.match.value || "";
    const normalizedCalleeSignature = normalizeInvokeSignatureForRuleMatch(calleeSignature);
    const normalizedValue = normalizeInvokeSignatureForRuleMatch(value);
    switch (rule.match.kind) {
        case "method_name_equals":
            return calleeName === value;
        case "method_name_regex":
            try {
                return new RegExp(value).test(calleeName);
            } catch {
                return false;
            }
        case "signature_contains":
            return calleeSignature.includes(value)
                || normalizedCalleeSignature.includes(normalizedValue);
        case "signature_equals":
            return exactTextMatch(calleeSignature, value)
                || exactTextMatch(normalizedCalleeSignature, normalizedValue);
        case "signature_regex":
            try {
                const re = new RegExp(value);
                return re.test(calleeSignature) || re.test(normalizedCalleeSignature);
            } catch {
                return false;
            }
        case "declaring_class_equals": {
            const classSignature = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
            const className = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.getClassName?.() || "";
            return exactDeclaringClassMatch(classSignature, className, value);
        }
        case "local_name_regex": {
            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const argTexts = args.map((a: any) => a?.toString?.() || "");
            if (invokeExpr instanceof ArkInstanceInvokeExpr) {
                argTexts.push(invokeExpr.getBase()?.toString?.() || "");
            }
            try {
                const re = new RegExp(value);
                return argTexts.some((text: string) => re.test(text));
            } catch {
                return false;
            }
        }
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
    if (!matchStringConstraint(scope.methodName, calleeName)) return false;

    const fallback = resolveSdkImportScopeCandidates(sourceMethod, invokeExpr);
    if (!matchConstraintAgainstCandidates(scope.file, [fileText, ...fallback.fileTexts])) return false;
    if (!matchConstraintAgainstCandidates(scope.module, [moduleText, ...fallback.moduleTexts])) return false;
    if (!matchConstraintAgainstCandidates(scope.className, [classText, ...fallback.classTexts])) return false;
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
        case "method_name_regex":
            try {
                return new RegExp(value).test(method.getName());
            } catch {
                return false;
            }
        case "signature_contains":
            return fieldSignature.includes(value) || methodSignature.includes(value);
        case "signature_equals":
            return exactTextMatch(fieldSignature, value) || exactTextMatch(methodSignature, value);
        case "signature_regex":
            try {
                const re = new RegExp(value);
                return re.test(fieldSignature) || re.test(methodSignature);
            } catch {
                return false;
            }
        case "declaring_class_equals":
            return exactDeclaringClassMatch(classSignature, className, value);
        case "local_name_regex":
            try {
                const re = new RegExp(value);
                return re.test(leftText) || re.test(fieldName);
            } catch {
                return false;
            }
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
    if (!matchStringConstraint(scope.methodName, fieldName)) return false;

    const syntheticInvoke = {
        getBase: () => fieldRef.getBase?.(),
        getMethodSignature: () => undefined,
    };
    const fallback = resolveSdkImportScopeCandidates(sourceMethod, syntheticInvoke);
    if (!matchConstraintAgainstCandidates(scope.file, [fileText, ...fallback.fileTexts])) return false;
    if (!matchConstraintAgainstCandidates(scope.module, [moduleText, ...fallback.moduleTexts])) return false;
    if (!matchConstraintAgainstCandidates(scope.className, [classText, ...fallback.classTexts])) return false;
    return true;
}

function matchesInvokeShape(rule: SourceRule, invokeExpr: any, calleeSignature: string): boolean {
    const invokeKind = rule.match.invokeKind;
    if (invokeKind && invokeKind !== "any") {
        const actualKind: RuleInvokeKind = invokeExpr instanceof ArkInstanceInvokeExpr ? "instance" : "static";
        if (actualKind !== invokeKind) return false;
    }

    if (rule.match.argCount !== undefined) {
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length !== rule.match.argCount) return false;
    }

    const typeHint = rule.match.typeHint;
    if (typeHint && typeHint.trim().length > 0) {
        const hint = typeHint.trim().toLowerCase();
        const declaringClass = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
        const baseText = invokeExpr instanceof ArkInstanceInvokeExpr ? (invokeExpr.getBase()?.toString?.() || "") : "";
        const ptrText = invokeExpr instanceof ArkPtrInvokeExpr ? (invokeExpr.toString?.() || "") : "";
        const haystack = `${calleeSignature} ${declaringClass} ${baseText} ${ptrText}`.toLowerCase();
        if (!haystack.includes(hint)) return false;
    }

    return true;
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
            const callbackMethods = resolveCallbackMethodsFromArg(scene, callArgs[idx], callerMethod);
            return callbackMethods.length > 0;
        });
        if (resolvedExplicit.length > 0) {
            return resolvedExplicit;
        }
    }

    const inferred: number[] = [];
    for (let i = 0; i < callArgs.length; i++) {
        const arg = callArgs[i];
        const callbackMethods = resolveCallbackMethodsFromArg(scene, arg, callerMethod);
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
        const base = value.getBase?.();
        const baseNodes = base ? pag.getNodesByValue(base) : undefined;
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
            for (const objId of rootNode.getPointTo()) {
                hasFieldFact = true;
                const objNode: any = pag.getNode(objId);
                add(new TaintFact(objNode, sourceTag, contextId, [...targetPath]));
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
    aliasNames.delete(seedLocal.getName());
    if (aliasNames.size === 0) return out;

    const locals = [...body.getLocals().values()];
    for (const aliasName of aliasNames) {
        const local = locals.find(l => l.getName() === aliasName);
        if (!local) continue;
        const facts = seedFactsFromValue(pag, local, sourceTag, contextId, targetPath);
        for (const fact of facts) add(fact);
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
    if (!matchStringConstraint(scope.methodName, method.getName())) return false;
    return true;
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
