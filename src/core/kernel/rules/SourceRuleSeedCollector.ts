import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { resolveCallbackRegistrationsFromStmt } from "../../substrate/queries/CallbackBindingQuery";
import { getMethodBySignature } from "../contracts/MethodLookup";
import { TaintFact } from "../model/TaintFact";
import {
    SourceRule,
    SourceRuleKind,
} from "../../rules/RuleSchema";
import {
    resolvePromiseFulfillmentSourceNodeIdsFromInvoke,
    resolvePromiseRejectionSourceNodeIdsFromInvoke,
} from "../handoff/ExecutionHandoffContractBindingResolver";
import { hasApiEffectIdentity } from "../../api/ApiOccurrenceIdentity";
import type { ApiEffectRuntimeIndexLike, ApiEffectSite } from "../../api/effects";
import type { SemanticEffectSite } from "../../api/effects/SemanticEffectSite";
import type { AssetEndpoint, CallbackLocator } from "../../assets/schema";
import {
    isConsumableSemanticEndpointProjection,
    projectSemanticEffectEndpoint,
    type SemanticEndpointProjection,
    type SemanticEndpointResolutionRecord,
} from "../contracts/PagNodeResolution";

export interface SourceRuleSeedCollectionArgs {
    scene: Scene;
    pag: Pag;
    sourceRules: SourceRule[];
    emptyContextId: number;
    allowedMethodSignatures?: Set<string>;
    apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike;
}

export interface SourceRuleSeedCollectionResult {
    facts: TaintFact[];
    seededLocals: string[];
    sourceRuleHits: Record<string, number>;
    activatedMethodSignatures: string[];
    sourceSeedAudit: SourceRuleSeedAuditEntry[];
    sourceRuleZeroHitAudit: SourceRuleZeroHitAuditEntry[];
    endpointResolutionAudit: SemanticEndpointResolutionRecord[];
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
    effectSiteId?: string;
    occurrenceId?: string;
    rawOccurrenceId?: string;
    canonicalApiId?: string;
    effectAssetId?: string;
    reachableGapChain?: SourceReachabilityGapChain;
}

export interface SourceReachabilityGapChain {
    status: "blocked";
    reason: string;
    targetMethodSignature: string;
    targetAllowed: boolean;
    sourceRuleCallsite: {
        calleeSignature: string;
        stmtText: string;
        line: number;
    };
    evidence: string[];
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
    const endpointResolutionAudit: SemanticEndpointResolutionRecord[] = [];
    const activatedMethodSignatures = new Set<string>();
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

    const canApplyRuleAtSite = (rule: SourceRule, siteKey: string): boolean => {
        void rule;
        void siteKey;
        return true;
    };
    const markRuleAppliedAtSite = (rule: SourceRule, siteKey: string): void => {
        void rule;
        void siteKey;
    };

    const orderedSourceRules = [...args.sourceRules].sort(compareSourceRuleId);

    for (const rule of orderedSourceRules) {
        if (rule.enabled === false) continue;
        const kind = resolveSourceRuleKind(rule);
        if (hasApiEffectIdentity(rule) && isApiOccurrenceBackedSourceKind(kind)) {
            collectApiEffectSourceRuleSeeds({
                rule,
                args,
                methods,
                pushFact,
                canApplyRuleAtSite,
                markRuleAppliedAtSite,
                getCachedParameterLocals,
                activatedMethodSignatures,
                endpointResolutionAudit,
            });
            continue;
        }
        continue;
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
            args.apiEffectRuntimeIndex,
        ),
        endpointResolutionAudit,
    };
}

function buildSourceRuleZeroHitAudit(
    scene: Scene,
    sourceRules: SourceRule[],
    sourceRuleHits: Map<string, number>,
    allowedMethodSignatures?: Set<string>,
    apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike,
): SourceRuleZeroHitAuditEntry[] {
    void scene;
    const out: SourceRuleZeroHitAuditEntry[] = [];
    for (const rule of sourceRules) {
        const ruleId = typeof rule?.id === "string" ? rule.id.trim() : "";
        if (!ruleId || rule.enabled === false) continue;
        if ((sourceRuleHits.get(ruleId) || 0) > 0) continue;
        const kind = resolveSourceRuleKind(rule);
        if (!hasApiEffectIdentity(rule) || !isApiOccurrenceBackedSourceKind(kind)) {
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
        const sites = apiEffectRuntimeIndex?.getSitesForRule(rule, "source") || [];
        const matchedCallsiteCount = sites.length;
        let matchedAllowedCallsiteCount = 0;
        let matchedExcludedCallsiteCount = 0;
        for (const site of sites) {
            const methodSignature = site.method.getSignature?.()?.toString?.() || "";
            const allowed = !allowedMethodSignatures || allowedMethodSignatures.has(methodSignature);
            if (allowed) {
                matchedAllowedCallsiteCount += 1;
            } else {
                matchedExcludedCallsiteCount += 1;
            }
            if (samples.length < 5) {
                const semanticSite = selectSourceSemanticEffectSite(site);
                samples.push({
                    methodSignature,
                    calleeSignature: site.calleeSignature || site.resolvedOccurrence?.canonicalApiId || "",
                    stmtText: site.stmt?.toString?.() || "",
                    line: site.stmt?.getOriginPositionInfo?.()?.getLineNo?.() ?? -1,
                    allowed,
                    effectSiteId: semanticSite?.effectSiteId,
                    occurrenceId: semanticSite?.occurrenceId || site.resolvedOccurrence?.occurrenceId,
                    rawOccurrenceId: semanticSite?.rawOccurrenceId || site.rawOccurrence?.rawOccurrenceId,
                    canonicalApiId: semanticSite?.canonicalApiId || site.resolvedOccurrence?.canonicalApiId,
                    effectAssetId: semanticSite?.effectAssetId,
                    reachableGapChain: allowed ? undefined : buildSourceReachabilityGapChain(methodSignature, site),
                });
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

function selectSourceSemanticEffectSite(site: ApiEffectSite): SemanticEffectSite | undefined {
    return site.semanticEffectSites.find(item => item.capability === "source")
        || site.semanticEffectSites[0];
}

function buildSourceReachabilityGapChain(
    targetMethodSignature: string,
    site: ApiEffectSite,
): SourceReachabilityGapChain {
    return {
        status: "blocked",
        reason: "accepted_source_site_method_not_in_allowed_reachable_fixed_point",
        targetMethodSignature,
        targetAllowed: false,
        sourceRuleCallsite: {
            calleeSignature: site.calleeSignature || site.resolvedOccurrence?.canonicalApiId || "",
            stmtText: site.stmt?.toString?.() || "",
            line: site.stmt?.getOriginPositionInfo?.()?.getLineNo?.() ?? -1,
        },
        evidence: [
            "accepted_api_effect_source_site",
            "allowed_method_filter_active",
            "target_method_absent_from_allowed_set",
        ],
    };
}

interface ApiEffectSourceSeedContext {
    rule: SourceRule;
    args: SourceRuleSeedCollectionArgs;
    methods: ArkMethod[];
    pushFact: (fact: TaintFact, label: string, ruleId: string, activationMethod?: ArkMethod) => boolean;
    canApplyRuleAtSite: (rule: SourceRule, siteKey: string) => boolean;
    markRuleAppliedAtSite: (rule: SourceRule, siteKey: string) => void;
    getCachedParameterLocals: (method: ArkMethod) => ParameterLocalInfo[];
    activatedMethodSignatures: Set<string>;
    endpointResolutionAudit: SemanticEndpointResolutionRecord[];
}

function isApiOccurrenceBackedSourceKind(kind: SourceRuleKind): boolean {
    return kind === "call_return"
        || kind === "call_arg"
        || kind === "field_read"
        || kind === "callback_param"
        || kind === "bound_state";
}

function collectApiEffectSourceRuleSeeds(ctx: ApiEffectSourceSeedContext): void {
    const sites = ctx.args.apiEffectRuntimeIndex?.getSitesForRule(ctx.rule, "source") || [];
    if (sites.length === 0) return;
    const allowedMethodSignatures = new Set(ctx.methods.map(method => method.getSignature().toString()));

    for (const site of sites) {
        if (!site.effect.acceptedForPropagation) continue;
        const methodSignature = site.method.getSignature?.()?.toString?.() || "";
        if (!allowedMethodSignatures.has(methodSignature)) continue;

        let appliedAtSite = false;
        for (const semanticSite of site.semanticEffectSites) {
            if (semanticSite.capability !== "source") continue;
            if (seedApiEffectSourceEndpoint(ctx, site, semanticSite)) {
                appliedAtSite = true;
            }
        }
        if (appliedAtSite) {
            const siteKey = apiEffectSourceSiteKey(site);
            ctx.markRuleAppliedAtSite(ctx.rule, siteKey);
        }
    }
}

function seedApiEffectSourceEndpoint(
    ctx: ApiEffectSourceSeedContext,
    site: ApiEffectSite,
    semanticSite: SemanticEffectSite,
): boolean {
    const endpoint = semanticSite.endpointSpec;
    if (ctx.rule.sourceKind === "bound_state") {
        return seedApiEffectBoundStateSource(ctx, site, semanticSite);
    }

    const base = endpoint.base;
    if (base.kind === "callbackArg") {
        return seedApiEffectCallbackArgSource(ctx, site, semanticSite);
    }
    if (base.kind === "promiseResult") {
        return seedApiEffectPromiseResultSource(ctx, site, semanticSite);
    }
    if (base.kind === "promiseRejected") {
        return seedApiEffectPromiseRejectedSource(ctx, site, semanticSite);
    }

    const projection = projectSourceEndpoint(ctx, site, semanticSite);
    if (!isExactSourceEndpointProjection(projection)) return false;

    const siteKey = apiEffectSourceSiteKey(site);
    if (!ctx.canApplyRuleAtSite(ctx.rule, siteKey)) return false;
    const label = apiEffectSourceLabel(site, base.kind);
    const sourceTag = sourceTagForOccurrence(ctx.rule.id, siteKey, label);
    let applied = false;
    const facts = seedFactsFromProjection(
        ctx.args.pag,
        projection,
        sourceTag,
        ctx.args.emptyContextId,
    );
    for (const fact of facts) {
        if (ctx.pushFact(fact, `${site.method.getName()}:${label}`, ctx.rule.id, site.method)) {
            applied = true;
        }
    }
    const targetValue = projection.values[0];
    if (targetValue instanceof Local) {
        const aliasFacts = seedLocalAliasFactsInMethod(
            ctx.args.pag,
            site.method,
            targetValue,
            sourceTag,
            ctx.args.emptyContextId,
            endpoint.accessPath,
        );
        for (const fact of aliasFacts) {
            if (ctx.pushFact(fact, `${site.method.getName()}:${label}:alias`, ctx.rule.id, site.method)) {
                applied = true;
            }
        }
    }
    return applied;
}

function seedApiEffectBoundStateSource(
    ctx: ApiEffectSourceSeedContext,
    site: ApiEffectSite,
    semanticSite: SemanticEffectSite,
): boolean {
    const endpoint = semanticSite.endpointSpec;
    const projection = projectSourceEndpoint(ctx, site, semanticSite);
    if (!isExactSourceEndpointProjection(projection)) return false;
    const boundFieldNames = collectBoundStateFieldNamesFromEndpointOptions(ctx.args.scene, site, endpoint);
    if (boundFieldNames.length === 0) return false;
    const siteKey = apiEffectSourceSiteKey(site);
    if (!ctx.canApplyRuleAtSite(ctx.rule, siteKey)) return false;
    let applied = false;
    for (const fieldName of boundFieldNames) {
        const sourceTag = sourceTagForOccurrence(
            ctx.rule.id,
            `${siteKey}|field:${fieldName}`,
            `bound:${fieldName}:${apiEffectSourceLabel(site, "arg")}`,
        );
        const facts = seedDeclaringClassFieldNameFacts(
            ctx.args.pag,
            site.method,
            fieldName,
            sourceTag,
            ctx.args.emptyContextId,
        );
        for (const fact of facts) {
            if (ctx.pushFact(fact, `${site.method.getName()}:${fieldName}@bound_state`, ctx.rule.id, site.method)) {
                applied = true;
            }
        }
    }
    return applied;
}

function collectBoundStateFieldNamesFromEndpointOptions(
    scene: Scene,
    site: ApiEffectSite,
    endpoint: AssetEndpoint,
): string[] {
    const fieldNames = new Set<string>();
    const optionValues = resolveBoundStateOptionValues(site, endpoint);
    for (const optionsValue of optionValues) {
        for (const fieldName of collectBoundStateFieldNamesFromOptions(
            scene,
            optionsValue,
            endpoint.accessPath || [],
        )) {
            fieldNames.add(fieldName);
        }
    }
    return [...fieldNames].sort((left, right) => left.localeCompare(right));
}

function resolveBoundStateOptionValues(site: ApiEffectSite, endpoint: AssetEndpoint): any[] {
    const base = endpoint.base;
    if (base.kind === "arg") {
        const args = site.invokeExpr?.getArgs?.() || [];
        const index = base.index;
        if (!Number.isInteger(index) || index < 0 || index >= args.length) return [];
        const value = args[index];
        return value === undefined || value === null ? [] : [value];
    }
    if (base.kind === "receiver") {
        const value = site.invokeExpr?.getBase?.();
        return value === undefined || value === null ? [] : [value];
    }
    return [];
}

function seedApiEffectPromiseResultSource(
    ctx: ApiEffectSourceSeedContext,
    site: ApiEffectSite,
    semanticSite: SemanticEffectSite,
): boolean {
    if (!site.invokeExpr) return false;
    const nodeIds = resolvePromiseFulfillmentSourceNodeIdsFromInvoke(
        ctx.args.scene,
        ctx.args.pag,
        site.invokeExpr,
    );
    const projection = projectSourceEndpoint(ctx, site, semanticSite, {
        semanticNodeIds: nodeIds.length > 0 ? nodeIds : undefined,
    });
    if (!isExactSourceEndpointProjection(projection)) return false;
    const siteKey = apiEffectSourceSiteKey(site);
    if (!ctx.canApplyRuleAtSite(ctx.rule, siteKey)) return false;
    const sourceTag = sourceTagForOccurrence(ctx.rule.id, siteKey, apiEffectSourceLabel(site, "promiseResult"));
    let applied = false;
    const facts = seedFactsFromNodeIds(
        ctx.args.pag,
        projection.nodeIds,
        sourceTag,
        ctx.args.emptyContextId,
        semanticSite.endpointSpec.accessPath,
    );
    for (const fact of facts) {
        if (ctx.pushFact(fact, `${site.method.getName()}:promiseResult`, ctx.rule.id, site.method)) {
            applied = true;
        }
    }
    return applied;
}

function seedApiEffectPromiseRejectedSource(
    ctx: ApiEffectSourceSeedContext,
    site: ApiEffectSite,
    semanticSite: SemanticEffectSite,
): boolean {
    if (!site.invokeExpr) return false;
    const nodeIds = resolvePromiseRejectionSourceNodeIdsFromInvoke(
        ctx.args.scene,
        ctx.args.pag,
        site.invokeExpr,
    );
    const projection = projectSourceEndpoint(ctx, site, semanticSite, {
        semanticNodeIds: nodeIds.length > 0 ? nodeIds : undefined,
    });
    if (!isExactSourceEndpointProjection(projection)) return false;
    const siteKey = apiEffectSourceSiteKey(site);
    if (!ctx.canApplyRuleAtSite(ctx.rule, siteKey)) return false;
    const sourceTag = sourceTagForOccurrence(ctx.rule.id, siteKey, apiEffectSourceLabel(site, "promiseRejected"));
    let applied = false;
    const facts = seedFactsFromNodeIds(
        ctx.args.pag,
        projection.nodeIds,
        sourceTag,
        ctx.args.emptyContextId,
        semanticSite.endpointSpec.accessPath,
    );
    for (const fact of facts) {
        if (ctx.pushFact(fact, `${site.method.getName()}:promiseRejected`, ctx.rule.id, site.method)) {
            applied = true;
        }
    }
    return applied;
}

function seedApiEffectCallbackArgSource(
    ctx: ApiEffectSourceSeedContext,
    site: ApiEffectSite,
    semanticSite: SemanticEffectSite,
): boolean {
    const endpoint = semanticSite.endpointSpec;
    const base = endpoint.base;
    if (base.kind !== "callbackArg") return false;
    const callbackSpec = callbackRegistrationSpecFromLocator(base.callback);
    if (!callbackSpec) return false;
    const registrations = resolveCallbackRegistrationsFromStmt(
        site.stmt,
        ctx.args.scene,
        site.method,
        () => ({
            callbackArgIndexes: callbackSpec.callbackArgIndexes,
            callbackFieldNames: callbackSpec.callbackFieldNames,
            reason: `Source callback registration from ${site.effect.identity.canonicalApiId}`,
        }),
    );
    if (registrations.length === 0) return false;

    let applied = false;
    for (const registration of registrations) {
        ctx.activatedMethodSignatures.add(registration.callbackMethod.getSignature().toString());
        const callbackParams = ctx.getCachedParameterLocals(registration.callbackMethod);
        const callbackParam = resolveCallbackUserParam(callbackParams, base.argIndex);
        if (!callbackParam) continue;
        const projection = projectSourceEndpoint(ctx, site, semanticSite, {
            resolveCallbackArgumentValues: () => [callbackParam.local],
        });
        if (!isExactSourceEndpointProjection(projection)) continue;
        const line = registration.registrationInvokeExpr?.getOriginPositionInfo?.().getLineNo?.()
            ?? registration.registrationMethod.getCfg?.()?.getStmts?.()?.[0]?.getOriginPositionInfo?.().getLineNo?.()
            ?? -1;
        const siteKey = `${apiEffectSourceSiteKey(site)}|callback:${registration.registrationSignature}|line:${line}|cbArg:${registration.callbackArgIndex}|param:${base.argIndex}`;
        if (!ctx.canApplyRuleAtSite(ctx.rule, siteKey)) continue;
        const sourceTag = sourceTagForOccurrence(
            ctx.rule.id,
            siteKey,
            `callback:arg${base.argIndex}:line${line}`,
        );

        const callbackFacts = seedFactsFromProjection(
            ctx.args.pag,
            projection,
            sourceTag,
            ctx.args.emptyContextId,
        );
        for (const fact of callbackFacts) {
            if (ctx.pushFact(
                fact,
                `${registration.callbackMethod.getName()}:arg${base.argIndex}@${registration.registrationMethodName || "callback"}#cbArg${registration.callbackArgIndex}`,
                ctx.rule.id,
                registration.callbackMethod,
            )) {
                applied = true;
            }
        }

        const aliasFacts = seedLocalAliasFactsInMethod(
            ctx.args.pag,
            registration.callbackMethod,
            callbackParam.local,
            sourceTag,
            ctx.args.emptyContextId,
            endpoint.accessPath,
        );
        for (const fact of aliasFacts) {
            if (ctx.pushFact(
                fact,
                `${registration.callbackMethod.getName()}:arg${base.argIndex}->alias#cbArg${registration.callbackArgIndex}`,
                ctx.rule.id,
                registration.callbackMethod,
            )) {
                applied = true;
            }
        }

        const forwardedFacts = seedForwardedCallbackParamFacts(
            ctx.args.scene,
            ctx.args.pag,
            registration.callbackMethod,
            callbackParam.local,
            sourceTag,
            ctx.args.emptyContextId,
            endpoint.accessPath,
            ctx.activatedMethodSignatures,
        );
        for (const fact of forwardedFacts) {
            if (ctx.pushFact(
                fact,
                `${registration.callbackMethod.getName()}:arg${base.argIndex}->forward#cbArg${registration.callbackArgIndex}`,
                ctx.rule.id,
                registration.callbackMethod,
            )) {
                applied = true;
            }
        }
    }
    return applied;
}

function callbackRegistrationSpecFromLocator(
    locator: CallbackLocator,
): { callbackArgIndexes: number[]; callbackFieldNames?: string[] } | undefined {
    if (locator.kind === "arg") {
        return { callbackArgIndexes: [locator.index] };
    }
    if (locator.kind === "option") {
        const base = locator.base?.base;
        if (base?.kind !== "arg") return undefined;
        const fieldName = locator.accessPath?.[locator.accessPath.length - 1];
        if (!fieldName) return undefined;
        return {
            callbackArgIndexes: [base.index],
            callbackFieldNames: [fieldName],
        };
    }
    return undefined;
}

function projectSourceEndpoint(
    ctx: ApiEffectSourceSeedContext,
    site: ApiEffectSite,
    semanticSite: SemanticEffectSite,
    extra?: Partial<Pick<Parameters<typeof projectSemanticEffectEndpoint>[0], "semanticNodeIds" | "resolveCallbackArgumentValues">>,
): SemanticEndpointProjection {
    const projection = projectSemanticEffectEndpoint({
        pag: ctx.args.pag,
        semanticSite,
        stmt: site.stmt,
        invokeExpr: site.invokeExpr,
        fieldRef: site.fieldRef,
        contextId: ctx.args.emptyContextId,
        // Source endpoints are already gated by accepted canonical identity and exact
        // endpoint projection. If Arkanalyzer's PAG has no preexisting node for that
        // exact endpoint value, materialize it so the proven source can seed the solver.
        allowNodeCreation: true,
        exactMaterializationEvidence: {
            kind: "semantic_effect_endpoint_ir",
            reason: `accepted source endpoint ${semanticSite.effectSiteId}`,
            endpointBindingRef: semanticSite.endpointBindingRef,
        },
        consumer: "source",
        semanticNodeIds: extra?.semanticNodeIds,
        resolveCallbackArgumentValues: extra?.resolveCallbackArgumentValues,
    });
    ctx.endpointResolutionAudit.push(projection.record);
    return projection;
}

function isExactSourceEndpointProjection(projection: SemanticEndpointProjection): boolean {
    return isConsumableSemanticEndpointProjection(projection);
}

function apiEffectSourceSiteKey(site: ApiEffectSite): string {
    return `${site.effect.effectInstanceId}|${site.effect.occurrenceId}|${site.rawOccurrence.rawOccurrenceId}`;
}

function apiEffectSourceLabel(site: ApiEffectSite, endpointKind: string): string {
    const member = site.memberName || site.rawOccurrence.ir.memberName || "api";
    const line = site.rawOccurrence.sourceLocation?.line ?? -1;
    return `${endpointKind}:${member}:line${line}`;
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

function compareSourceRuleId(left: SourceRule, right: SourceRule): number {
    return String(left.id || "").localeCompare(String(right.id || ""));
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
    if ((!pagNodes || pagNodes.size === 0) && value instanceof ArkInstanceFieldRef) {
        const nestedField = resolveInstanceFieldRootAndPath(value);
        if (nestedField && nestedField.fieldPath.length > 1) {
            let rootNodes = pag.getNodesByValue(nestedField.root);
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

function seedFactsFromProjection(
    pag: Pag,
    projection: SemanticEndpointProjection,
    sourceTag: string,
    contextId: number,
): TaintFact[] {
    if (!isExactSourceEndpointProjection(projection)) return [];
    if (projection.fieldPath && projection.fieldPath.length > 0) {
        return seedFactsFromNodeIds(
            pag,
            projection.carrierNodeIds,
            sourceTag,
            contextId,
            projection.fieldPath,
        );
    }
    return seedFactsFromNodeIds(
        pag,
        projection.nodeIds,
        sourceTag,
        contextId,
    );
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

function toRecord(map: Map<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        out[k] = v;
    }
    return out;
}
