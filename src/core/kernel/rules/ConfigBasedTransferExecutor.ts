import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkNormalBinopExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { TaintFact } from "../model/TaintFact";
import { TaintTracker } from "../model/TaintTracker";
import { toContainerFieldKey } from "../model/ContainerSlotKeys";
import {
    collectParameterAssignStmts,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates,
    resolveConcreteReceiverOwnerName,
    resolveMethodsFromCallable,
} from "../../substrate/queries/CalleeResolver";
import { resolveCallbackRegistrationsFromStmt } from "../../substrate/queries/CallbackBindingQuery";
import {
    formatSemanticEndpointPath,
    isConsumableSemanticEndpointProjection,
    projectSemanticEffectEndpoint,
    resolveExistingPagNodes,
    type SemanticEndpointProjection,
} from "../contracts/PagNodeResolution";
import {
    RuleEndpoint,
    RuleSlotWriteMode,
    TransferRule,
    normalizeEndpoint,
} from "../../rules/RuleSchema";
import { hasApiEffectIdentity, type ResolvedEndpointBinding } from "../../api/ApiOccurrenceIdentity";
import type { ApiEffectRuntimeIndexLike } from "../../api/effects";
import type { SemanticEffectSite } from "../../api/effects/SemanticEffectSite";
import type { AssetEndpoint, CallbackLocator } from "../../assets/schema";
import { resolveSdkImportScopeCandidates } from "../../substrate/queries/SdkProvenance";
import {
    resolvePromiseFulfillmentSourceNodeIdsFromInvoke,
    resolvePromiseRejectionSourceNodeIdsFromInvoke,
} from "../handoff/ExecutionHandoffContractBindingResolver";
import type {
    EndpointDescriptor,
    InvokeSite,
    RuntimeRule,
    RuntimeRuleBucketIndex,
    SceneRuleCacheStats,
    TransferNoCandidateCallsite,
    SharedSceneRuleCache,
    TransferExecutionResult,
    TransferExecutionStats,
    TransferExecutionWithStats,
    TransferEndpointConsumption,
    TransferSemanticSiteConsumption,
} from "./TransferTypes";
import { buildNoCandidateCallsiteRecord } from "./NoCandidateSurface";

export type {
    EndpointDescriptor,
    InvokeSite,
    RuntimeRule,
    RuntimeRuleBucketIndex,
    SceneRuleCacheStats,
    TransferNoCandidateCallsite,
    SharedSceneRuleCache,
    TransferExecutionResult,
    TransferExecutionStats,
    TransferExecutionWithStats,
    TransferEndpointConsumption,
    TransferSemanticSiteConsumption,
} from "./TransferTypes";

type ProjectedEndpointDescriptor = EndpointDescriptor & {
    semanticSite?: SemanticEffectSite;
    endpointSpec?: AssetEndpoint;
    pathFromSemanticSite?: SemanticEffectSite;
    pathFromEndpointSpec?: AssetEndpoint;
};

type TransferProjectionEvidence = "node" | "carrier" | "node-or-carrier" | "value-with-node-or-carrier";

type CallbackParameterLocalInfo = {
    index: number;
    local: Local;
    refText: string;
    hiddenClosureCarrier: boolean;
};

export class ConfigBasedTransferExecutor {
    private static sceneRuleCache = new WeakMap<Scene, Map<string, SharedSceneRuleCache>>();
    private static readonly sceneRuleCacheStats: SceneRuleCacheStats = {
        hitCount: 0,
        missCount: 0,
        disabledCount: 0,
    };
    private readonly perfMode: "optimized" | "baseline";
    private readonly runtimeRules: RuntimeRule[];
    private readonly ruleBuckets: RuntimeRuleBucketIndex;
    private stmtOwner: Map<any, any>;
    private invokeSiteByStmt: Map<any, InvokeSite>;
    private siteRuleCandidateIndex: Map<any, RuntimeRule[]>;
    private readonly initializerMethodsForTypeCache = new Map<string, any[]>();
    private readonly initializerLocalNamesForValueCache = new WeakMap<object, string[]>();
    private readonly ruleExecutionDedupCache = new Set<string>();
    private readonly stmtRuntimeKeyId = new WeakMap<object, number>();
    private stmtRuntimeKeySeq = 1;
    private readonly callbackParameterLocalCache = new WeakMap<object, CallbackParameterLocalInfo[]>();
    private readonly scene?: Scene;
    private readonly apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike;
    private paramArgAliasMap: Map<Local, any[]>;
    private acceptedTransferInvokeSites?: InvokeSite[];

    public static clearSceneRuleCache(): void {
        ConfigBasedTransferExecutor.sceneRuleCache = new WeakMap<Scene, Map<string, SharedSceneRuleCache>>();
    }

    public static resetSceneRuleCacheStats(): void {
        ConfigBasedTransferExecutor.sceneRuleCacheStats.hitCount = 0;
        ConfigBasedTransferExecutor.sceneRuleCacheStats.missCount = 0;
        ConfigBasedTransferExecutor.sceneRuleCacheStats.disabledCount = 0;
    }

    public static getSceneRuleCacheStats(): SceneRuleCacheStats {
        return {
            hitCount: ConfigBasedTransferExecutor.sceneRuleCacheStats.hitCount,
            missCount: ConfigBasedTransferExecutor.sceneRuleCacheStats.missCount,
            disabledCount: ConfigBasedTransferExecutor.sceneRuleCacheStats.disabledCount,
        };
    }

    constructor(rules: TransferRule[] = [], scene?: Scene, apiEffectRuntimeIndex?: ApiEffectRuntimeIndexLike) {
        this.scene = scene;
        this.apiEffectRuntimeIndex = apiEffectRuntimeIndex;
        this.perfMode = this.resolvePerfModeFromEnv();
        this.stmtOwner = new Map<any, any>();
        this.invokeSiteByStmt = new Map<any, InvokeSite>();
        this.siteRuleCandidateIndex = new Map<any, RuntimeRule[]>();
        this.paramArgAliasMap = new Map<Local, any[]>();

        if (scene) {
            const cacheEnabled = this.isSceneRuleCacheEnabled() && !apiEffectRuntimeIndex;
            const cacheKey = this.buildSceneRuleCacheKey(rules || []);
            if (cacheEnabled) {
                const shared = this.getSharedSceneRuleCache(scene, cacheKey);
                if (shared) {
                    ConfigBasedTransferExecutor.sceneRuleCacheStats.hitCount++;
                    this.runtimeRules = shared.runtimeRules;
                    this.ruleBuckets = shared.ruleBuckets;
                    this.stmtOwner = shared.stmtOwner;
                    this.invokeSiteByStmt = shared.invokeSiteByStmt;
                    this.siteRuleCandidateIndex = shared.siteRuleCandidateIndex;
                    this.paramArgAliasMap = shared.paramArgAliasMap || new Map<Local, any[]>();
                    return;
                }
                ConfigBasedTransferExecutor.sceneRuleCacheStats.missCount++;
            } else {
                ConfigBasedTransferExecutor.sceneRuleCacheStats.disabledCount++;
            }

            this.runtimeRules = this.compileRules(rules || []);
            this.ruleBuckets = this.buildRuleBucketIndex(this.runtimeRules);
            for (const method of scene.getMethods()) {
                const cfg = method.getCfg();
                if (!cfg) continue;
                for (const stmt of cfg.getStmts()) {
                    this.stmtOwner.set(stmt, method);
                }
            }
            if (this.perfMode === "optimized") {
                this.prebuildInvokeSiteIndex();
                this.prebuildSiteRuleCandidateIndex();
            }
            this.paramArgAliasMap = this.buildParamArgAliasMap(scene);

            if (cacheEnabled) {
                this.setSharedSceneRuleCache(scene, cacheKey, {
                    runtimeRules: this.runtimeRules,
                    ruleBuckets: this.ruleBuckets,
                    stmtOwner: this.stmtOwner,
                    invokeSiteByStmt: this.invokeSiteByStmt,
                    siteRuleCandidateIndex: this.siteRuleCandidateIndex,
                    paramArgAliasMap: this.paramArgAliasMap,
                });
            }
            return;
        }

        this.runtimeRules = this.compileRules(rules || []);
        this.ruleBuckets = this.buildRuleBucketIndex(this.runtimeRules);
    }

    private getSharedSceneRuleCache(scene: Scene, key: string): SharedSceneRuleCache | undefined {
        const sceneMap = ConfigBasedTransferExecutor.sceneRuleCache.get(scene);
        if (!sceneMap) return undefined;
        return sceneMap.get(key);
    }

    private setSharedSceneRuleCache(scene: Scene, key: string, cache: SharedSceneRuleCache): void {
        let sceneMap = ConfigBasedTransferExecutor.sceneRuleCache.get(scene);
        if (!sceneMap) {
            sceneMap = new Map<string, SharedSceneRuleCache>();
            ConfigBasedTransferExecutor.sceneRuleCache.set(scene, sceneMap);
        }
        sceneMap.set(key, cache);
    }

    private buildParamArgAliasMap(scene: Scene): Map<Local, any[]> {
        const aliasSets = new Map<Local, Set<any>>();
        const methodsBySignature = new Map<string, any>();
        for (const method of scene.getMethods()) {
            const sig = method.getSignature?.()?.toString?.();
            if (!sig) continue;
            methodsBySignature.set(sig, method);
        }

        for (const caller of scene.getMethods()) {
            const cfg = caller.getCfg?.();
            if (!cfg) continue;
            for (const stmt of cfg.getStmts()) {
                if (!stmt?.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
                const invokeExpr = stmt.getInvokeExpr?.();
                if (!invokeExpr) continue;
                const calleeSig = invokeExpr.getMethodSignature?.()?.toString?.() || "";
                if (!calleeSig) continue;
                const callee = methodsBySignature.get(calleeSig);
                if (!callee) continue;
                const paramStmts = collectParameterAssignStmts(callee);
                if (paramStmts.length === 0) continue;
                const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
                const argParamPairs = mapInvokeArgsToParamAssigns(invokeExpr, args, paramStmts);
                for (const pair of argParamPairs) {
                    const leftOp = pair.paramStmt.getLeftOp?.();
                    if (!(leftOp instanceof Local)) continue;
                    let values = aliasSets.get(leftOp);
                    if (!values) {
                        values = new Set<any>();
                        aliasSets.set(leftOp, values);
                    }
                    values.add(pair.arg);
                }
            }
        }

        const aliasMap = new Map<Local, any[]>();
        for (const [local, values] of aliasSets.entries()) {
            aliasMap.set(local, [...values]);
        }
        return aliasMap;
    }

    private buildSceneRuleCacheKey(rules: TransferRule[]): string {
        const normalizedRules = rules.map((rule, index) => {
            const fromN = normalizeEndpoint(rule.from);
            const toN = normalizeEndpoint(rule.to);
            return {
                idx: index,
                id: rule.id || "",
                fromEndpoint: fromN.endpoint,
                fromPath: fromN.path ?? [],
                fromPathFrom: fromN.pathFrom || "",
                fromSlotKind: fromN.slotKind || "",
                fromSlotWriteMode: fromN.slotWriteMode || "",
                fromTaintScope: fromN.taintScope || "",
                toEndpoint: toN.endpoint,
                toPath: toN.path ?? [],
                toPathFrom: toN.pathFrom || "",
                toSlotKind: toN.slotKind || "",
                toSlotWriteMode: toN.slotWriteMode || "",
                toTaintScope: toN.taintScope || "",
                apiAssetId: rule.apiEffect.assetId,
                canonicalApiId: rule.apiEffect.canonicalApiId,
                apiSurfaceId: rule.apiEffect.surfaceId,
                apiBindingId: rule.apiEffect.bindingId,
                apiEffectTemplateId: rule.apiEffect.effectTemplateId,
            };
        });
        return `${this.perfMode}|${JSON.stringify(normalizedRules)}`;
    }

    public executeFromTaintedLocal(
        taintedLocal: Local,
        source: string,
        contextID: number,
        pag: Pag,
        tracker?: TaintTracker
    ): TransferExecutionResult[] {
        const localNodes = pag.getNodesByValue(taintedLocal);
        if (!localNodes || localNodes.size === 0) return [];
        const nodeId = localNodes.values().next().value as number;
        const fact = new TaintFact(pag.getNode(nodeId) as PagNode, source, contextID);
        return this.executeFromTaintedFact(fact, pag, tracker);
    }

    public executeFromTaintedFact(
        taintedFact: TaintFact,
        pag: Pag,
        tracker?: TaintTracker
    ): TransferExecutionResult[] {
        return this.executeFromTaintedFactWithStats(taintedFact, pag, tracker).results;
    }

    public executeFromTaintedFactWithStats(
        taintedFact: TaintFact,
        pag: Pag,
        tracker?: TaintTracker
    ): TransferExecutionWithStats {
        const stats = this.createEmptyStats();
        if (this.runtimeRules.length === 0) {
            return { results: [], stats };
        }

        const t0 = process.hrtime.bigint();
        stats.factCount = 1;

        const sites = this.collectAcceptedTransferInvokeSites();
        stats.invokeSiteCount = sites.length;
        stats.siteConsumptions.push(...this.collectNoAcceptedTransferSiteConsumptions());
        if (sites.length === 0) {
            stats.elapsedMs = this.elapsedMsSince(t0);
            return { results: [], stats };
        }

        const results: TransferExecutionResult[] = [];
        const seenResultFacts = new Set<string>();
        const noCandidateCallsiteMap = new Map<string, TransferNoCandidateCallsite>();
        for (const site of sites) {
            const candidateRules = this.resolveCandidateRulesForSite(site);
            if (candidateRules.length === 0) {
                const owner = this.stmtOwner.get(site.stmt);
                const noCandidate = buildNoCandidateCallsiteRecord(site, owner, this.apiEffectRuntimeIndex);
                const key = `${noCandidate.canonicalApiId || ""}|${noCandidate.calleeSignature}|${noCandidate.method}|${noCandidate.invokeKind}|${noCandidate.argCount}|${noCandidate.sourceFile}`;
                const existing = noCandidateCallsiteMap.get(key);
                if (existing) {
                    existing.count += 1;
                } else {
                    noCandidateCallsiteMap.set(key, noCandidate);
                }
            }
            for (const runtimeRule of candidateRules) {
                let consumption: TransferSemanticSiteConsumption | undefined;
                stats.ruleCheckCount++;

                if (this.perfMode === "optimized") {
                    const dedupKey = this.buildRuleExecutionDedupKey(taintedFact.taintId, site, runtimeRule.rule.id);
                    if (this.ruleExecutionDedupCache.has(dedupKey)) {
                        stats.dedupSkipCount++;
                        continue;
                    }
                    this.ruleExecutionDedupCache.add(dedupKey);
                }

                // Exact match kinds are pre-filtered by callsite candidate index.
                stats.ruleMatchCount++;

                const descriptors = this.resolveTransferDescriptorsForSite(runtimeRule.rule, site);
                if (!descriptors) continue;
                const fromDescriptor = descriptors.from;
                stats.endpointCheckCount++;
                const fromEvaluation = this.evaluateEndpointMatchesFact(fromDescriptor, site, taintedFact, pag, tracker);
                consumption = this.createTransferSiteConsumption(runtimeRule.rule, site, {
                    scheduled: true,
                    fromMatched: fromEvaluation.matched,
                    toProjected: false,
                    resultCount: 0,
                    blockedReason: fromEvaluation.matched ? undefined : "from_endpoint_not_matched",
                    fromEndpoint: fromEvaluation.endpoint,
                }, descriptors);
                if (!fromEvaluation.matched) {
                    stats.siteConsumptions.push(consumption);
                    continue;
                }
                stats.endpointMatchCount++;

                const toDescriptor = descriptors.to;
                const targetResolution = this.resolveTargetFactsWithConsumption(toDescriptor, site, taintedFact.source, taintedFact.contextID, pag);
                const targetFacts = targetResolution.facts;
                consumption.toEndpoint = targetResolution.endpoint;
                consumption.toProjected = targetFacts.length > 0;
                consumption.resultCount = targetFacts.length;
                if (targetFacts.length === 0) {
                    consumption.blockedReason = "to_endpoint_unresolved";
                    stats.siteConsumptions.push(consumption);
                    continue;
                }
                stats.siteConsumptions.push(consumption);
                for (const fact of targetFacts) {
                    const resultKey = `${runtimeRule.rule.id}|${site.signature}|${fact.taintId}`;
                    if (seenResultFacts.has(resultKey)) continue;
                    seenResultFacts.add(resultKey);
                    results.push({
                        ruleId: runtimeRule.rule.id,
                        callSignature: site.signature,
                        to: toDescriptor.endpoint,
                        fact,
                    });
                }
            }
        }

        stats.resultCount = results.length;
        stats.noCandidateCallsites = [...noCandidateCallsiteMap.values()]
            .sort((a, b) => b.count - a.count || a.calleeSignature.localeCompare(b.calleeSignature))
            .slice(0, 64);
        stats.elapsedMs = this.elapsedMsSince(t0);
        return { results, stats };
    }

    private compileRules(rules: TransferRule[]): RuntimeRule[] {
        const out: RuntimeRule[] = [];
        for (const rule of rules) {
            if (!hasApiEffectIdentity(rule)) continue;
            out.push({ rule });
        }
        return out;
    }

    private collectAcceptedTransferInvokeSites(): InvokeSite[] {
        if (this.acceptedTransferInvokeSites) {
            return this.acceptedTransferInvokeSites;
        }
        const out: InvokeSite[] = [];
        const seen = new Set<any>();
        if (!this.apiEffectRuntimeIndex) {
            this.acceptedTransferInvokeSites = out;
            return out;
        }
        for (const runtimeRule of this.runtimeRules) {
            if (!hasApiEffectIdentity(runtimeRule.rule)) continue;
            for (const effectSite of this.apiEffectRuntimeIndex.getSitesForRule(runtimeRule.rule, "transfer")) {
                if (!effectSite.effect.acceptedForPropagation) continue;
                if (!effectSite.stmt) continue;
                const site = this.getOrCreateInvokeSite(effectSite.stmt);
                if (!site) continue;
                if (!this.resolveTransferDescriptorsForSite(runtimeRule.rule, site)) continue;
                if (seen.has(site.stmt)) continue;
                seen.add(site.stmt);
                out.push(site);
            }
        }
        this.acceptedTransferInvokeSites = out;
        return out;
    }

    private collectNoAcceptedTransferSiteConsumptions(): TransferSemanticSiteConsumption[] {
        const out: TransferSemanticSiteConsumption[] = [];
        for (const runtimeRule of this.runtimeRules) {
            const rule = runtimeRule.rule;
            if (!hasApiEffectIdentity(rule)) continue;
            const effectSites = this.apiEffectRuntimeIndex?.getSitesForRule(rule, "transfer") || [];
            let hasAcceptedConsumableSite = false;
            let hasAcceptedStmt = false;
            for (const effectSite of effectSites) {
                if (!effectSite.effect.acceptedForPropagation || !effectSite.stmt) continue;
                hasAcceptedStmt = true;
                const site = this.getOrCreateInvokeSite(effectSite.stmt);
                if (!site) continue;
                if (!this.resolveTransferDescriptorsForSite(rule, site)) continue;
                hasAcceptedConsumableSite = true;
                break;
            }
            if (hasAcceptedConsumableSite) continue;
            out.push(this.createTransferSiteConsumption(rule, undefined, {
                scheduled: false,
                fromMatched: false,
                toProjected: false,
                resultCount: 0,
                blockedReason: !this.apiEffectRuntimeIndex
                    ? "no_api_effect_runtime_index"
                    : effectSites.length === 0
                        ? "no_transfer_effect_site"
                        : hasAcceptedStmt
                            ? "accepted_transfer_site_endpoint_unresolved"
                            : "no_accepted_transfer_site",
            }));
        }
        return out;
    }

    private createTransferSiteConsumption(
        rule: TransferRule,
        site: InvokeSite | undefined,
        state: Pick<TransferSemanticSiteConsumption, "scheduled" | "fromMatched" | "toProjected" | "resultCount" | "blockedReason">
            & { fromEndpoint?: TransferEndpointConsumption; toEndpoint?: TransferEndpointConsumption },
        descriptors?: { from: EndpointDescriptor; to: EndpointDescriptor },
    ): TransferSemanticSiteConsumption {
        const semanticSite = this.primarySemanticSiteForTransferDescriptors(descriptors);
        return {
            ruleId: rule.id,
            canonicalApiId: rule.apiEffect.canonicalApiId,
            effectSiteId: semanticSite?.effectSiteId,
            occurrenceId: semanticSite?.occurrenceId,
            rawOccurrenceId: semanticSite?.rawOccurrenceId,
            effectAssetId: semanticSite?.effectAssetId || rule.apiEffect.assetId,
            surfaceId: semanticSite?.surfaceId || rule.apiEffect.surfaceId,
            bindingId: semanticSite?.bindingId || rule.apiEffect.bindingId,
            effectTemplateId: semanticSite?.effectTemplateId || rule.apiEffect.effectTemplateId,
            callSignature: site?.signature,
            callerSignature: site?.callerSignature,
            method: site?.methodName,
            invokeKind: site?.invokeKind,
            sourceFile: site?.callerFilePath || (site ? this.extractFilePathFromSignature(site.callerSignature || site.signature) : undefined),
            scheduled: state.scheduled,
            fromMatched: state.fromMatched,
            toProjected: state.toProjected,
            resultCount: state.resultCount,
            blockedReason: state.blockedReason,
            fromEndpoint: state.fromEndpoint,
            toEndpoint: state.toEndpoint,
        };
    }

    private primarySemanticSiteForTransferDescriptors(
        descriptors?: { from: EndpointDescriptor; to: EndpointDescriptor },
    ): SemanticEffectSite | undefined {
        if (!descriptors) return undefined;
        return (descriptors.from as ProjectedEndpointDescriptor).semanticSite
            || (descriptors.to as ProjectedEndpointDescriptor).semanticSite;
    }

    private objectInitializerContainsLocal(value: any, local: Local): boolean {
        const sourceName = local.getName?.();
        if (!sourceName) return false;
        return this.collectObjectInitializerLocalNames(value).includes(sourceName);
    }

    private collectObjectInitializerLocalNames(value: any): string[] {
        if (!(value instanceof Local)) return [];
        const cached = this.initializerLocalNamesForValueCache.get(value);
        if (cached) return cached;

        const typeText = String(value.getType?.() || "");
        if (!typeText) {
            this.initializerLocalNamesForValueCache.set(value, []);
            return [];
        }
        const out = new Set<string>();
        for (const method of this.resolveInitializerMethodsForType(typeText)) {
            const cfg = method.getCfg?.();
            if (!cfg) continue;
            for (const stmt of cfg.getStmts()) {
                const right = stmt.getRightOp?.();
                if (right instanceof Local) {
                    const localName = right.getName?.();
                    if (localName) out.add(localName);
                }
            }
        }
        const localNames = [...out.values()];
        this.initializerLocalNamesForValueCache.set(value, localNames);
        return localNames;
    }

    private resolveInitializerMethodsForType(typeText: string): any[] {
        if (!this.scene) return [];
        const cached = this.initializerMethodsForTypeCache.get(typeText);
        if (cached) return cached;
        const methods = this.scene.getMethods().filter(method => {
            const name = method.getName?.();
            if (name !== "%instInit" && name !== "constructor") return false;
            const sig = method.getSignature?.()?.toString?.() || "";
            return sig.includes(typeText);
        });
        this.initializerMethodsForTypeCache.set(typeText, methods);
        return methods;
    }

    private prebuildInvokeSiteIndex(): void {
        for (const stmt of this.stmtOwner.keys()) {
            this.getOrCreateInvokeSite(stmt);
        }
    }

    private prebuildSiteRuleCandidateIndex(): void {
        for (const site of this.invokeSiteByStmt.values()) {
            this.resolveCandidateRulesForSite(site);
        }
    }

    private getOrCreateInvokeSite(stmt: any): InvokeSite | undefined {
        if (!stmt) return undefined;
        const cached = this.invokeSiteByStmt.get(stmt);
        if (cached) return cached;
        const built = this.buildInvokeSite(stmt);
        if (!built) return undefined;
        this.invokeSiteByStmt.set(stmt, built);
        return built;
    }

    private buildInvokeSite(stmt: any): InvokeSite | undefined {
        if (!stmt || !stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) return undefined;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)
            && !(invokeExpr instanceof ArkStaticInvokeExpr)
            && !(invokeExpr instanceof ArkPtrInvokeExpr)) return undefined;

        const rawSignature = invokeExpr.getMethodSignature?.()?.toString?.() || "";
        const methodNameFromSig = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
        let methodName = methodNameFromSig;
        if (!methodName && rawSignature) {
            const match = rawSignature.match(/\.([A-Za-z0-9_$]+)\(/);
            methodName = match ? match[1] : "";
        }
        const resolvedCalleeMeta = this.resolveStructuralCalleeMetadata(invokeExpr);
        const signature = this.selectPrimaryInvokeText(rawSignature, resolvedCalleeMeta.signatures);
        methodName = this.selectPrimaryInvokeText(methodName, resolvedCalleeMeta.methodNames);

        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const baseValue = (invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkPtrInvokeExpr)
            ? (invokeExpr as any).getBase?.()
            : undefined;
        const resultValue = stmt instanceof ArkAssignStmt ? stmt.getLeftOp() : undefined;

        const owner = this.stmtOwner.get(stmt);
        const callerMethodName = owner?.getName?.() || "<unknown>";
        const callerSignature = owner?.getSignature?.()?.toString?.() || "";
        const callerFilePath = this.extractFilePathFromSignature(callerSignature);
        const callerClassText = owner?.getDeclaringArkClass?.()?.getName?.() || callerSignature;
        const rawCalleeClassText = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || signature;
        const rawCalleeClassName = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.getClassName?.() || "";
        const calleeClassText = this.selectPrimaryInvokeText(rawCalleeClassText, resolvedCalleeMeta.classTexts);
        const calleeClassName = this.selectPrimaryInvokeText(rawCalleeClassName, resolvedCalleeMeta.classNames);
        const calleeFilePath = this.selectPrimaryInvokeText(
            this.extractFilePathFromSignature(signature),
            resolvedCalleeMeta.filePaths
        );
        const importScopeCandidates = resolveSdkImportScopeCandidates(owner, invokeExpr);
        const receiverOwnerName = this.scene && (invokeExpr instanceof ArkInstanceInvokeExpr || invokeExpr instanceof ArkPtrInvokeExpr)
            ? resolveConcreteReceiverOwnerName(this.scene, invokeExpr)
            : undefined;

        return {
            stmt,
            invokeExpr,
            callerMethod: owner,
            signature,
            methodName,
            calleeSignature: signature,
            calleeMethodName: methodName,
            calleeFilePath,
            calleeClassText,
            calleeClassName,
            candidateSignatures: resolvedCalleeMeta.signatures,
            candidateMethodNames: resolvedCalleeMeta.methodNames,
            candidateClassTexts: resolvedCalleeMeta.classTexts,
            candidateClassNames: resolvedCalleeMeta.classNames,
            candidateFilePaths: resolvedCalleeMeta.filePaths,
            scopeClassTexts: this.uniqueTexts([
                ...(importScopeCandidates.classTexts || []),
                receiverOwnerName,
                baseValue?.toString?.(),
            ]),
            scopeModuleTexts: importScopeCandidates.moduleTexts,
            scopeFileTexts: importScopeCandidates.fileTexts,
            baseValue,
            resultValue,
            args,
            invokeKind: invokeExpr instanceof ArkStaticInvokeExpr ? "static" : "instance",
            callerMethodName,
            callerSignature,
            callerFilePath,
            callerClassText,
        };
    }

    private resolveStructuralCalleeMetadata(invokeExpr: any): {
        signatures: string[];
        methodNames: string[];
        classTexts: string[];
        classNames: string[];
        filePaths: string[];
    } {
        if (!this.isStructuralCalleeResolveEnabled()) {
            return {
                signatures: [],
                methodNames: [],
                classTexts: [],
                classNames: [],
                filePaths: [],
            };
        }
        if (!this.scene) {
            return {
                signatures: [],
                methodNames: [],
                classTexts: [],
                classNames: [],
                filePaths: [],
            };
        }

        const shouldResolve = invokeExpr instanceof ArkPtrInvokeExpr;
        if (!shouldResolve) {
            return {
                signatures: [],
                methodNames: [],
                classTexts: [],
                classNames: [],
                filePaths: [],
            };
        }

        try {
            const methodBySig = new Map<string, any>();
            const addMethod = (method: any): void => {
                if (!method) return;
                const sig = method.getSignature?.()?.toString?.();
                if (!sig || methodBySig.has(sig)) return;
                methodBySig.set(sig, method);
            };

            const directCandidates = resolveCalleeCandidates(this.scene, invokeExpr, {
                maxNameMatchCandidates: 4,
            });
            for (const item of directCandidates) {
                addMethod(item.method);
            }

            if (invokeExpr instanceof ArkPtrInvokeExpr) {
                const callableValue = invokeExpr.getFuncPtrLocal?.();
                const baseMethods = resolveMethodsFromCallable(this.scene, callableValue, {
                    maxCandidates: 4,
                    enableLocalBacktrace: true,
                });
                for (const method of baseMethods) {
                    addMethod(method);
                }

                if (callableValue instanceof Local) {
                    const aliasedValues = this.paramArgAliasMap.get(callableValue) || [];
                    for (const aliasedValue of aliasedValues) {
                        const aliasedMethods = resolveMethodsFromCallable(this.scene, aliasedValue, {
                            maxCandidates: 4,
                            enableLocalBacktrace: true,
                        });
                        for (const method of aliasedMethods) {
                            addMethod(method);
                        }
                    }
                }
            }

            const resolvedMethods = [...methodBySig.values()];
            const signatures = this.uniqueTexts(resolvedMethods
                .map(method => method.getSignature?.()?.toString?.() || ""));
            const methodNames = this.uniqueTexts([
                ...directCandidates.map(item => item.method?.getName?.() || ""),
                ...resolvedMethods.map(method => method.getName?.() || ""),
            ]);
            const classTexts = this.uniqueTexts(resolvedMethods
                .map(method => method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || ""));
            const classNames = this.uniqueTexts(resolvedMethods
                .map(method => method.getDeclaringArkClass?.()?.getName?.() || ""));
            const filePaths = this.uniqueTexts(signatures.map(sig => this.extractFilePathFromSignature(sig)));
            return { signatures, methodNames, classTexts, classNames, filePaths };
        } catch {
            return {
                signatures: [],
                methodNames: [],
                classTexts: [],
                classNames: [],
                filePaths: [],
            };
        }
    }

    private uniqueTexts(items: string[]): string[] {
        const out: string[] = [];
        const seen = new Set<string>();
        for (const raw of items) {
            const text = String(raw || "").trim();
            if (!text || seen.has(text)) continue;
            seen.add(text);
            out.push(text);
        }
        return out;
    }

    private isUnknownInvokeSignature(signature: string): boolean {
        const text = String(signature || "");
        return !text || text.includes("%unk");
    }

    private selectPrimaryInvokeText(primary: string, candidates: string[]): string {
        const normalizedPrimary = String(primary || "").trim();
        if (normalizedPrimary && !this.isUnknownInvokeSignature(normalizedPrimary)) {
            return normalizedPrimary;
        }
        if (candidates.length > 0) return candidates[0];
        return normalizedPrimary;
    }

    private resolveCandidateRulesForSite(site: InvokeSite): RuntimeRule[] {
        if (this.perfMode === "baseline") {
            const allMatched = this.runtimeRules.filter(runtimeRule => this.matchesRuleStatic(runtimeRule, site));
            return this.applyRuleMatchPriority(allMatched);
        }

        const stmt = site.stmt;
        if (stmt && this.siteRuleCandidateIndex.has(stmt)) {
            return this.siteRuleCandidateIndex.get(stmt)!;
        }

        const roughCandidates = this.collectBucketCandidatesForSite(site);
        const staticMatched = roughCandidates.filter(runtimeRule => this.matchesRuleStatic(runtimeRule, site));
        const candidates = this.applyRuleMatchPriority(staticMatched);

        if (stmt) {
            this.siteRuleCandidateIndex.set(stmt, candidates);
        }
        return candidates;
    }

    private resolvePerfModeFromEnv(): "optimized" | "baseline" {
        const raw = String(process.env.ARKTAINT_TRANSFER_PERF_MODE || "").trim().toLowerCase();
        return raw === "baseline" ? "baseline" : "optimized";
    }

    private isSceneRuleCacheEnabled(): boolean {
        const raw = String(process.env.ARKTAINT_TRANSFER_SCENE_CACHE || "").trim().toLowerCase();
        return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "disable" && raw !== "disabled";
    }

    private isStructuralCalleeResolveEnabled(): boolean {
        const raw = String(process.env.ARKTAINT_TRANSFER_STRUCTURAL_CALLEE || "").trim().toLowerCase();
        return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "disable" && raw !== "disabled";
    }

    private elapsedMsSince(t0: bigint): number {
        const dtNs = process.hrtime.bigint() - t0;
        return Number(dtNs) / 1_000_000;
    }

    private collectBucketCandidatesForSite(site: InvokeSite): RuntimeRule[] {
        void site;
        const out: RuntimeRule[] = [];
        const seen = new Set<RuntimeRule>();
        this.appendRuntimeRules(out, seen, this.ruleBuckets.universal);
        return out;
    }

    private appendRuntimeRules(
        out: RuntimeRule[],
        seen: Set<RuntimeRule>,
        rules: RuntimeRule[] | undefined
    ): void {
        if (!rules || rules.length === 0) return;
        for (const runtimeRule of rules) {
            if (seen.has(runtimeRule)) continue;
            seen.add(runtimeRule);
            out.push(runtimeRule);
        }
    }

    private applyRuleMatchPriority(staticMatched: RuntimeRule[]): RuntimeRule[] {
        return staticMatched;
    }

    private matchesRuleStatic(runtimeRule: RuntimeRule, site: InvokeSite): boolean {
        const rule = runtimeRule.rule;
        if (!hasApiEffectIdentity(rule)) return false;
        return !!this.apiEffectRuntimeIndex?.hasRuleSiteAtStmt(rule, site.stmt, "transfer");
    }

    private resolveTransferDescriptorsForSite(
        rule: TransferRule,
        site: InvokeSite,
    ): { from: EndpointDescriptor; to: EndpointDescriptor } | undefined {
        if (!hasApiEffectIdentity(rule)) return undefined;
        const effectSite = this.apiEffectRuntimeIndex
            ?.getSitesForRule(rule, "transfer")
            .find(item => item.stmt === site.stmt && item.effect.acceptedForPropagation);
        if (!effectSite) return undefined;
        const fromBinding = effectSite.effect.endpointBindings.find(binding => binding.valueRef === "from" && binding.status === "exact");
        const toBinding = effectSite.effect.endpointBindings.find(binding => binding.valueRef === "to" && binding.status === "exact");
        if (!fromBinding || !toBinding) return undefined;
        const from = this.endpointDescriptorFromResolvedEndpointBinding(
            fromBinding,
            this.semanticSiteForEndpointBinding(effectSite, fromBinding),
        );
        const to = this.endpointDescriptorFromResolvedEndpointBinding(
            toBinding,
            this.semanticSiteForEndpointBinding(effectSite, toBinding),
        );
        if (!from || !to) return undefined;
        return { from, to };
    }

    private endpointDescriptorFromResolvedEndpointBinding(
        binding: ResolvedEndpointBinding,
        semanticSite?: SemanticEffectSite,
    ): EndpointDescriptor | undefined {
        if (!semanticSite) return undefined;
        const descriptor = this.endpointDescriptorFromAssetEndpoint(binding.endpoint);
        if (!descriptor) return undefined;
        const projectedDescriptor = descriptor as ProjectedEndpointDescriptor;
        projectedDescriptor.semanticSite = semanticSite;
        projectedDescriptor.endpointSpec = semanticSite.endpointSpec || binding.endpoint;
        if (binding.pathFrom) {
            const pathFrom = this.endpointDescriptorFromAssetEndpoint(binding.pathFrom);
            if (!pathFrom) return undefined;
            descriptor.pathFrom = pathFrom.endpoint;
            projectedDescriptor.pathFromEndpointSpec = binding.pathFrom;
            projectedDescriptor.pathFromSemanticSite = this.pathFromSemanticSite(semanticSite, binding.pathFrom);
        }
        if (binding.slotKind) descriptor.slotKind = binding.slotKind;
        if (binding.slotWriteMode) descriptor.slotWriteMode = binding.slotWriteMode;
        if (binding.taintScope) descriptor.taintScope = binding.taintScope;
        return descriptor;
    }

    private semanticSiteForEndpointBinding(effectSite: { semanticEffectSites: readonly SemanticEffectSite[] }, binding: ResolvedEndpointBinding): SemanticEffectSite | undefined {
        return effectSite.semanticEffectSites.find(site =>
            site.endpointBindingRef === binding.valueRef && site.endpointSpec === binding.endpoint,
        ) || effectSite.semanticEffectSites.find(site => site.endpointBindingRef === binding.valueRef);
    }

    private pathFromSemanticSite(semanticSite: SemanticEffectSite, endpointSpec: AssetEndpoint): SemanticEffectSite {
        return {
            ...semanticSite,
            effectSiteId: `${semanticSite.effectSiteId}:pathFrom:${formatSemanticEndpointPath(endpointSpec)}`,
            endpointSpec,
            endpointBindingRef: semanticSite.endpointBindingRef
                ? `${semanticSite.endpointBindingRef}:pathFrom`
                : "pathFrom",
        };
    }

    private endpointDescriptorFromAssetEndpoint(endpoint: AssetEndpoint): EndpointDescriptor | undefined {
        let ruleEndpoint: RuleEndpoint;
        switch (endpoint.base.kind) {
            case "receiver":
                ruleEndpoint = "base";
                break;
            case "return":
            case "promiseResult":
            case "promiseRejected":
            case "constructorResult":
            case "callbackReturn":
                ruleEndpoint = "result";
                break;
            case "arg":
                ruleEndpoint = `arg${endpoint.base.index}` as RuleEndpoint;
                break;
            case "rest":
                ruleEndpoint = `arg${endpoint.base.startIndex}` as RuleEndpoint;
                break;
            case "callbackArg":
                ruleEndpoint = `arg${endpoint.base.argIndex}` as RuleEndpoint;
                break;
            default:
                return undefined;
        }
        const descriptor: EndpointDescriptor = {
            endpoint: ruleEndpoint,
            path: endpoint.accessPath,
            taintScope: endpoint.taintScope,
        };
        if (endpoint.base.kind === "return") descriptor.semanticEndpointKind = "return";
        if (endpoint.base.kind === "promiseResult") descriptor.semanticEndpointKind = "promiseResult";
        if (endpoint.base.kind === "promiseRejected") descriptor.semanticEndpointKind = "promiseRejected";
        if (endpoint.base.kind === "constructorResult") descriptor.semanticEndpointKind = "constructorResult";
        if (endpoint.base.kind === "callbackReturn") descriptor.semanticEndpointKind = "callbackReturn";
        if (endpoint.base.kind === "rest") descriptor.semanticEndpointKind = "rest";
        return descriptor;
    }

    private projectDescriptorEndpoint(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        pag: Pag,
        allowNodeCreation: boolean,
        contextID?: number,
    ): SemanticEndpointProjection | undefined {
        const projectedDescriptor = descriptor as ProjectedEndpointDescriptor;
        if (!projectedDescriptor.semanticSite || !projectedDescriptor.endpointSpec) return undefined;
        const semanticNodeIds = this.resolveSemanticNodeIdsForEndpointSpec(projectedDescriptor.endpointSpec, site, pag);
        const resolveCallbackArgumentValues = this.callbackArgumentValueResolverForEndpoint(projectedDescriptor.endpointSpec, site);
        return projectSemanticEffectEndpoint({
            pag,
            semanticSite: projectedDescriptor.semanticSite,
            endpointSpec: projectedDescriptor.endpointSpec,
            stmt: site.stmt,
            invokeExpr: site.invokeExpr,
            contextId: contextID,
            allowNodeCreation,
            consumer: "transfer",
            semanticNodeIds: semanticNodeIds && semanticNodeIds.length > 0 ? semanticNodeIds : undefined,
            resolveCallbackArgumentValues,
        });
    }

    private projectExactTransferEndpoint(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        pag: Pag,
        allowNodeCreation: boolean,
        contextID: number | undefined,
        requiredEvidence: TransferProjectionEvidence,
    ): SemanticEndpointProjection | undefined {
        const projection = this.projectDescriptorEndpoint(descriptor, site, pag, allowNodeCreation, contextID);
        return this.projectionHasExactTransferEvidence(projection, requiredEvidence) ? projection : undefined;
    }

    private projectTransferEndpointForConsumption(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        pag: Pag,
        allowNodeCreation: boolean,
        contextID: number | undefined,
        requiredEvidence: TransferProjectionEvidence,
    ): { projection?: SemanticEndpointProjection; endpoint: TransferEndpointConsumption } {
        const projection = this.projectDescriptorEndpoint(descriptor, site, pag, allowNodeCreation, contextID);
        const exactProjection = this.projectionHasExactTransferEvidence(projection, requiredEvidence)
            ? projection
            : undefined;
        return {
            projection: exactProjection,
            endpoint: this.transferEndpointConsumptionFromProjection(descriptor, projection),
        };
    }

    private transferEndpointConsumptionFromProjection(
        descriptor: EndpointDescriptor,
        projection: SemanticEndpointProjection | undefined,
    ): TransferEndpointConsumption {
        const projectedDescriptor = descriptor as ProjectedEndpointDescriptor;
        const endpointPath = projection?.endpointPath
            || (projectedDescriptor.endpointSpec
                ? formatSemanticEndpointPath(projectedDescriptor.endpointSpec)
                : descriptor.endpoint);
        return {
            endpoint: descriptor.endpoint,
            endpointPath,
            status: projection?.status || "no_runtime_endpoint",
            reason: projection?.reason || "endpoint_projection_missing",
            nodeIds: projection ? [...projection.nodeIds] : [],
            carrierNodeIds: projection ? [...projection.carrierNodeIds] : [],
            fieldPath: projection?.fieldPath ? [...projection.fieldPath] : undefined,
            materializedExact: projection?.materializedExact || false,
        };
    }

    private projectExactPathFromEndpoint(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        pag: Pag,
        contextID?: number,
    ): SemanticEndpointProjection | undefined {
        const projectedDescriptor = descriptor as ProjectedEndpointDescriptor;
        if (!projectedDescriptor.pathFromSemanticSite || !projectedDescriptor.pathFromEndpointSpec) return undefined;
        const semanticNodeIds = this.resolveSemanticNodeIdsForEndpointSpec(projectedDescriptor.pathFromEndpointSpec, site, pag);
        const resolveCallbackArgumentValues = this.callbackArgumentValueResolverForEndpoint(projectedDescriptor.pathFromEndpointSpec, site);
        const projection = projectSemanticEffectEndpoint({
            pag,
            semanticSite: projectedDescriptor.pathFromSemanticSite,
            endpointSpec: projectedDescriptor.pathFromEndpointSpec,
            stmt: site.stmt,
            invokeExpr: site.invokeExpr,
            contextId: contextID,
            allowNodeCreation: true,
            consumer: "transfer",
            semanticNodeIds: semanticNodeIds && semanticNodeIds.length > 0 ? semanticNodeIds : undefined,
            resolveCallbackArgumentValues,
        });
        return this.projectionHasExactTransferEvidence(projection, "value-with-node-or-carrier")
            ? projection
            : undefined;
    }

    private callbackArgumentValueResolverForEndpoint(
        endpoint: AssetEndpoint,
        site: InvokeSite,
    ): ((callback: CallbackLocator, argIndex: number) => Iterable<any>) | undefined {
        if (endpoint.base.kind !== "callbackArg") return undefined;
        if (!this.scene || !site.callerMethod) return undefined;
        return (callback: CallbackLocator, argIndex: number): Iterable<any> =>
            this.resolveCallbackArgumentValues(callback, argIndex, site);
    }

    private resolveCallbackArgumentValues(
        callback: CallbackLocator,
        argIndex: number,
        site: InvokeSite,
    ): any[] {
        if (!this.scene || !site.callerMethod) return [];
        const callbackSpec = this.callbackRegistrationSpecFromLocator(callback);
        if (!callbackSpec) return [];
        const registrations = resolveCallbackRegistrationsFromStmt(
            site.stmt,
            this.scene,
            site.callerMethod,
            () => ({
                callbackArgIndexes: callbackSpec.callbackArgIndexes,
                callbackFieldNames: callbackSpec.callbackFieldNames,
                reason: `Transfer callback registration from ${site.calleeSignature || site.signature}`,
            }),
        );
        if (registrations.length === 0) return [];
        const out: any[] = [];
        const seen = new Set<string>();
        for (const registration of registrations) {
            const callbackParams = this.getCallbackParameterLocals(registration.callbackMethod);
            const callbackParam = this.resolveCallbackUserParam(callbackParams, argIndex);
            if (!callbackParam) continue;
            const key = callbackParam.local.getName?.() || callbackParam.local.toString?.() || String(out.length);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(callbackParam.local);
        }
        return out;
    }

    private callbackRegistrationSpecFromLocator(
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

    private getCallbackParameterLocals(method: any): CallbackParameterLocalInfo[] {
        const cached = this.callbackParameterLocalCache.get(method);
        if (cached) return cached;
        const out: CallbackParameterLocalInfo[] = [];
        const cfg = method?.getCfg?.();
        if (!cfg) {
            this.callbackParameterLocalCache.set(method, out);
            return out;
        }
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            if (!(stmt.getRightOp() instanceof ArkParameterRef)) continue;
            const leftOp = stmt.getLeftOp();
            if (!(leftOp instanceof Local)) continue;
            const refText = stmt.getRightOp().toString();
            const match = refText.match(/parameter(\d+)/);
            if (!match) continue;
            out.push({
                index: Number(match[1]),
                local: leftOp,
                refText,
                hiddenClosureCarrier: this.isHiddenClosureCarrierParam(leftOp, refText),
            });
        }
        out.sort((left, right) => left.index - right.index);
        this.callbackParameterLocalCache.set(method, out);
        return out;
    }

    private isHiddenClosureCarrierParam(local: Local, refText: string): boolean {
        const localName = local.getName?.() || "";
        if (/^%closures\d*$/.test(localName)) return true;
        return /parameter\d+\s*:\s*\[[^\]]+\]/.test(refText);
    }

    private resolveCallbackUserParam(
        callbackParams: CallbackParameterLocalInfo[],
        userParamIndex: number,
    ): CallbackParameterLocalInfo | undefined {
        if (!Number.isInteger(userParamIndex) || userParamIndex < 0) return undefined;
        const visibleParams = callbackParams.filter(param => !param.hiddenClosureCarrier);
        if (visibleParams.length > 0) {
            return visibleParams[userParamIndex];
        }
        return callbackParams.find(param => param.index === userParamIndex);
    }

    private projectionHasExactTransferEvidence(
        projection: SemanticEndpointProjection | undefined,
        requiredEvidence: TransferProjectionEvidence,
    ): projection is SemanticEndpointProjection {
        if (!projection) return false;
        if (!isConsumableSemanticEndpointProjection(projection)) return false;
        const hasNode = projection.nodeIds.length > 0;
        const hasCarrier = projection.carrierNodeIds.length > 0;
        switch (requiredEvidence) {
            case "node":
                return hasNode;
            case "carrier":
                return hasCarrier;
            case "node-or-carrier":
                return hasNode || hasCarrier;
            case "value-with-node-or-carrier":
                return projection.values.length > 0 && (hasNode || hasCarrier);
        }
    }

    private resolveSemanticNodeIdsForEndpointSpec(
        endpoint: AssetEndpoint,
        site: InvokeSite,
        pag: Pag,
    ): number[] | undefined {
        if (endpoint.base.kind !== "promiseResult" && endpoint.base.kind !== "promiseRejected") return undefined;
        if (!this.scene || !site.invokeExpr) return undefined;
        return endpoint.base.kind === "promiseRejected"
            ? resolvePromiseRejectionSourceNodeIdsFromInvoke(this.scene, pag, site.invokeExpr)
            : resolvePromiseFulfillmentSourceNodeIdsFromInvoke(this.scene, pag, site.invokeExpr);
    }

    private endpointMatchesFact(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        fact: TaintFact,
        pag: Pag,
        tracker?: TaintTracker
    ): boolean {
        return this.evaluateEndpointMatchesFact(descriptor, site, fact, pag, tracker).matched;
    }

    private evaluateEndpointMatchesFact(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        fact: TaintFact,
        pag: Pag,
        tracker?: TaintTracker
    ): { matched: boolean; endpoint: TransferEndpointConsumption } {
        if (descriptor.semanticEndpointKind === "promiseResult" || descriptor.semanticEndpointKind === "promiseRejected") {
            const projection = this.projectTransferEndpointForConsumption(descriptor, site, pag, false, undefined, "carrier");
            const matched = !!projection.projection
                && this.carrierIdsMatchFactForDescriptor(projection.projection.carrierNodeIds, descriptor, site, fact, pag, tracker);
            return { matched, endpoint: projection.endpoint };
        }

        const projection = this.projectTransferEndpointForConsumption(descriptor, site, pag, false, undefined, "node-or-carrier");
        if (!projection.projection) return { matched: false, endpoint: projection.endpoint };
        const endpointValues = projection.projection.values;
        if (endpointValues.length === 0) return { matched: false, endpoint: projection.endpoint };

        const resolvedPath = this.resolveDescriptorFieldPath(descriptor, site, pag, fact.contextID);
        if (descriptor.path && descriptor.path.length > 0) {
            for (const endpointValue of endpointValues) {
                const carrierIds = this.resolveCarrierNodeIdsFromValue(endpointValue, pag, site.stmt);
                for (const carrierId of carrierIds) {
                    if (carrierId === fact.node.getID() && this.samePath(fact.field, descriptor.path)) {
                        return { matched: true, endpoint: projection.endpoint };
                    }
                    if (tracker?.isTaintedAnyContext(carrierId, descriptor.path)) {
                        return { matched: true, endpoint: projection.endpoint };
                    }
                }
            }
            return { matched: false, endpoint: projection.endpoint };
        }
        if (descriptor.pathFrom) {
            if (!resolvedPath) return { matched: false, endpoint: projection.endpoint };
            for (const endpointValue of endpointValues) {
                const carrierIds = this.resolveCarrierNodeIdsFromValue(endpointValue, pag, site.stmt);
                for (const carrierId of carrierIds) {
                    if (carrierId === fact.node.getID() && this.samePath(fact.field, resolvedPath)) {
                        return {
                            matched: this.isPathDerivedSlotCurrentForFact(descriptor, site, fact, carrierId, resolvedPath, pag, tracker),
                            endpoint: projection.endpoint,
                        };
                    }
                    if (tracker?.isTaintedAnyContext(carrierId, resolvedPath)
                        && tracker.getSourcesAnyContext(carrierId, resolvedPath).includes(fact.source)) {
                        return {
                            matched: this.isPathDerivedSlotCurrentForFact(descriptor, site, fact, carrierId, resolvedPath, pag, tracker),
                            endpoint: projection.endpoint,
                        };
                    }
                }
            }
            return { matched: false, endpoint: projection.endpoint };
        }
        if (descriptor.taintScope === "contained-values") {
            for (const endpointValue of endpointValues) {
                const carrierIds = this.resolveCarrierNodeIdsFromValue(endpointValue, pag, site.stmt);
                const factValue = fact.node.getValue();
                if (factValue instanceof Local && this.objectInitializerContainsLocal(endpointValue, factValue)) {
                    return { matched: true, endpoint: projection.endpoint };
                }
                for (const carrierId of carrierIds) {
                    if (carrierId === fact.node.getID()) return { matched: true, endpoint: projection.endpoint };
                    if (tracker?.hasAnyFieldTaintAnyContext(carrierId)
                        && tracker.getFieldSourcesAnyContext(carrierId).some(item => item.source === fact.source)) {
                        return { matched: true, endpoint: projection.endpoint };
                    }
                    const node = pag.getNode(carrierId) as PagNode;
                    const pts = node.getPointTo();
                    if (pts && pts.contains && pts.contains(fact.node.getID())) {
                        return { matched: true, endpoint: projection.endpoint };
                    }
                }
            }
            return { matched: false, endpoint: projection.endpoint };
        }

        if (fact.field && fact.field.length > 0) {
            return { matched: false, endpoint: projection.endpoint };
        }

        for (const nodeId of projection.projection.nodeIds) {
            if (nodeId === fact.node.getID()) return { matched: true, endpoint: projection.endpoint };
            const node = pag.getNode(nodeId) as PagNode;
            const pts = node.getPointTo();
            if (pts && pts.contains && pts.contains(fact.node.getID())) {
                return { matched: true, endpoint: projection.endpoint };
            }
        }
        return { matched: false, endpoint: projection.endpoint };
    }

    private resolveTargetFacts(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        source: string,
        contextID: number,
        pag: Pag
    ): TaintFact[] {
        return this.resolveTargetFactsWithConsumption(descriptor, site, source, contextID, pag).facts;
    }

    private resolveTargetFactsWithConsumption(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        source: string,
        contextID: number,
        pag: Pag
    ): { facts: TaintFact[]; endpoint: TransferEndpointConsumption } {
        const out: TaintFact[] = [];
        const seen = new Set<string>();
        const addFact = (fact: TaintFact): void => {
            if (seen.has(fact.taintId)) return;
            seen.add(fact.taintId);
            out.push(fact);
        };

        const resolvedPath = this.resolveDescriptorFieldPath(descriptor, site, pag, contextID);
        if (descriptor.semanticEndpointKind === "promiseResult" || descriptor.semanticEndpointKind === "promiseRejected") {
            const projection = this.projectTransferEndpointForConsumption(descriptor, site, pag, false, undefined, "carrier");
            if (!projection.projection) return { facts: out, endpoint: projection.endpoint };
            const fieldPath = descriptor.path && descriptor.path.length > 0
                ? descriptor.path
                : resolvedPath;
            for (const carrierId of projection.projection.carrierNodeIds) {
                const carrierNode = pag.getNode(carrierId) as PagNode;
                addFact(new TaintFact(carrierNode, source, contextID, fieldPath ? [...fieldPath] : undefined));
            }
            return { facts: out, endpoint: projection.endpoint };
        }

        const projection = this.projectTransferEndpointForConsumption(descriptor, site, pag, true, contextID, "node-or-carrier");
        if (!projection.projection) return { facts: out, endpoint: projection.endpoint };
        const endpointValues = projection.projection.values;

        if (descriptor.path && descriptor.path.length > 0) {
            if (endpointValues.length === 0) return { facts: out, endpoint: projection.endpoint };
            for (const endpointValue of endpointValues) {
                const carrierIds = this.resolveCarrierNodeIdsFromValue(endpointValue, pag, site.stmt);
                for (const carrierId of carrierIds) {
                    const carrierNode = pag.getNode(carrierId) as PagNode;
                    addFact(new TaintFact(carrierNode, source, contextID, [...descriptor.path]));
                }
            }
            return { facts: out, endpoint: projection.endpoint };
        }
        if (descriptor.pathFrom) {
            if (!resolvedPath) return { facts: out, endpoint: projection.endpoint };
            if (endpointValues.length === 0) return { facts: out, endpoint: projection.endpoint };
            for (const endpointValue of endpointValues) {
                const carrierIds = this.resolveCarrierNodeIdsFromValue(endpointValue, pag, site.stmt);
                for (const carrierId of carrierIds) {
                    const carrierNode = pag.getNode(carrierId) as PagNode;
                    addFact(new TaintFact(carrierNode, source, contextID, [...resolvedPath]));
                }
            }
            return { facts: out, endpoint: projection.endpoint };
        }

        for (const nodeId of projection.projection.nodeIds) {
            const node = pag.getNode(nodeId) as PagNode;
            addFact(new TaintFact(node, source, contextID));
        }
        return { facts: out, endpoint: projection.endpoint };
    }

    private resolveSemanticEndpointCarrierNodeIds(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        pag: Pag,
    ): number[] | undefined {
        if (descriptor.semanticEndpointKind !== "promiseResult" && descriptor.semanticEndpointKind !== "promiseRejected") return undefined;
        const projection = this.projectExactTransferEndpoint(descriptor, site, pag, false, undefined, "carrier");
        return projection ? projection.carrierNodeIds : [];
    }

    private resolveNodesByValue(value: any, pag: Pag, anchorStmt?: any): Map<number, number> | undefined {
        return pag.getNodesByValue(value) || resolveExistingPagNodes(pag, value, anchorStmt);
    }

    private resolveObjectIdsFromValue(value: any, pag: Pag, anchorStmt?: any): number[] {
        const out: number[] = [];
        const seen = new Set<number>();
        const nodes = this.resolveNodesByValue(value, pag, anchorStmt);
        if (!nodes || nodes.size === 0) return out;
        for (const nodeId of nodes.values()) {
            const node = pag.getNode(nodeId) as PagNode;
            const pts = node.getPointTo();
            if (!pts) continue;
            for (const objId of pts) {
                if (seen.has(objId)) continue;
                seen.add(objId);
                out.push(objId);
            }
        }
        return out;
    }

    private resolveCarrierNodeIdsFromValue(value: any, pag: Pag, anchorStmt?: any): number[] {
        const objectIds = this.resolveObjectIdsFromValue(value, pag, anchorStmt);
        if (objectIds.length > 0) return objectIds;
        const out: number[] = [];
        const seen = new Set<number>();
        const nodes = this.resolveNodesByValue(value, pag, anchorStmt);
        if (!nodes || nodes.size === 0) return out;
        for (const nodeId of nodes.values()) {
            if (seen.has(nodeId)) continue;
            seen.add(nodeId);
            out.push(nodeId);
        }
        return out;
    }

    private resolveDescriptorFieldPath(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        pag: Pag,
        contextID?: number,
    ): string[] | undefined {
        if (!descriptor.pathFrom || !descriptor.slotKind) return undefined;
        const pathFromProjection = this.projectExactPathFromEndpoint(descriptor, site, pag, contextID);
        const pathValue = pathFromProjection?.values[0];
        if (pathValue === undefined || pathValue === null) return undefined;
        const key = this.resolveRuntimePathKey(pathValue, descriptor.slotKind, pag, site.stmt);
        if (key === undefined) return undefined;
        return [toContainerFieldKey(`${descriptor.slotKind}:${key}`)];
    }

    private isPathDerivedSlotCurrentForFact(
        readDescriptor: EndpointDescriptor,
        readSite: InvokeSite,
        fact: TaintFact,
        carrierId: number,
        fieldPath: string[],
        pag: Pag,
        tracker?: TaintTracker,
    ): boolean {
        if (!tracker || !readDescriptor.pathFrom || !readDescriptor.slotKind) return true;

        const writes = this.findPathDerivedSlotWritesBefore(
            readSite,
            carrierId,
            fieldPath,
            pag,
        );
        if (writes.length === 0) return true;

        const history = writes.map(write => {
            const descriptors = this.resolveTransferDescriptorsForSite(write.rule.rule, write.site);
            if (!descriptors) {
                return {
                    slotWriteMode: "replace" as RuleSlotWriteMode,
                    sourceStatus: "unknown" as const,
                };
            }
            return {
                slotWriteMode: descriptors.to.slotWriteMode || ("replace" as RuleSlotWriteMode),
                sourceStatus: this.endpointHasSourceForSite(
                    descriptors.from,
                    write.site,
                    fact.source,
                    pag,
                    tracker,
                    fact,
                ),
            };
        });
        return this.isPathDerivedSlotCurrentForWriteHistory(history);
    }

    private findPathDerivedSlotWritesBefore(
        readSite: InvokeSite,
        carrierId: number,
        fieldPath: string[],
        pag: Pag,
    ): Array<{ site: InvokeSite; rule: RuntimeRule }> {
        const method = this.stmtOwner.get(readSite.stmt);
        const cfg = method?.getCfg?.();
        const rawStmts = cfg?.getStmts?.();
        if (!rawStmts) return [];
        const stmts = Array.from(rawStmts as Iterable<any>);

        const writes: Array<{ site: InvokeSite; rule: RuntimeRule }> = [];
        for (const stmt of stmts) {
            if (stmt === readSite.stmt) break;
            const site = this.getOrCreateInvokeSite(stmt);
            if (!site) continue;
            for (const runtimeRule of this.resolveCandidateRulesForSite(site)) {
                const descriptors = this.resolveTransferDescriptorsForSite(runtimeRule.rule, site);
                if (!descriptors) continue;
                const toDescriptor = descriptors.to;
                if (!toDescriptor.pathFrom || !toDescriptor.slotKind) continue;
                const toPath = this.resolveDescriptorFieldPath(toDescriptor, site, pag);
                if (!this.samePath(toPath, fieldPath)) continue;
                if (!this.siteTargetsCarrier(toDescriptor, site, carrierId, pag)) continue;
                writes.push({ site, rule: runtimeRule });
            }
        }
        return writes;
    }

    private isPathDerivedSlotCurrentForWriteHistory(
        writes: Array<{ slotWriteMode?: RuleSlotWriteMode; sourceStatus: "tainted" | "clean" | "unknown" }>,
    ): boolean {
        if (writes.length === 0) return true;
        let current = false;
        for (const write of writes) {
            const mode = write.slotWriteMode || "replace";
            if (mode === "append") {
                if (write.sourceStatus === "tainted") current = true;
                continue;
            }
            current = write.sourceStatus === "tainted";
        }
        return current;
    }

    private siteTargetsCarrier(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        carrierId: number,
        pag: Pag,
    ): boolean {
        const semanticCarrierIds = this.resolveSemanticEndpointCarrierNodeIds(descriptor, site, pag);
        if (semanticCarrierIds !== undefined) {
            return semanticCarrierIds.includes(carrierId);
        }
        const projection = this.projectExactTransferEndpoint(descriptor, site, pag, false, undefined, "carrier");
        return !!projection && projection.carrierNodeIds.includes(carrierId);
    }

    private carrierIdsMatchFactForDescriptor(
        carrierIds: number[],
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        fact: TaintFact,
        pag: Pag,
        tracker?: TaintTracker,
    ): boolean {
        if (carrierIds.length === 0) return false;
        const resolvedPath = this.resolveDescriptorFieldPath(descriptor, site, pag, fact.contextID);
        const fieldPath = descriptor.path && descriptor.path.length > 0
            ? descriptor.path
            : resolvedPath;
        for (const carrierId of carrierIds) {
            if (fieldPath && fieldPath.length > 0) {
                if (carrierId === fact.node.getID() && this.samePath(fact.field, fieldPath)) return true;
                if (tracker?.isTaintedAnyContext(carrierId, fieldPath)) return true;
                continue;
            }
            if (carrierId === fact.node.getID()) return true;
            if (tracker?.isTaintedAnyContext(carrierId)) return true;
            const node = pag.getNode(carrierId) as PagNode;
            const pts = node?.getPointTo?.();
            if (pts && pts.contains && pts.contains(fact.node.getID())) return true;
        }
        return false;
    }

    private endpointHasSourceForSite(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        source: string,
        pag: Pag,
        tracker: TaintTracker,
        fact?: TaintFact,
    ): "tainted" | "clean" | "unknown" {
        const semanticCarrierIds = this.resolveSemanticEndpointCarrierNodeIds(descriptor, site, pag);
        if (semanticCarrierIds !== undefined) {
            if (semanticCarrierIds.length === 0) return "unknown";
            const resolvedPath = this.resolveDescriptorFieldPath(descriptor, site, pag, fact?.contextID);
            const fieldPath = descriptor.path && descriptor.path.length > 0
                ? descriptor.path
                : resolvedPath;
            for (const carrierId of semanticCarrierIds) {
                const sources = fieldPath && fieldPath.length > 0
                    ? tracker.getSourcesAnyContext(carrierId, fieldPath)
                    : tracker.getSourcesAnyContext(carrierId);
                if (sources.includes(source)) return "tainted";
            }
            return "clean";
        }
        const projection = this.projectExactTransferEndpoint(descriptor, site, pag, false, undefined, "node-or-carrier");
        if (!projection) return "unknown";
        const endpointValues = projection.values;
        if (endpointValues.length === 0) return "unknown";

        const resolvedPath = this.resolveDescriptorFieldPath(descriptor, site, pag, fact?.contextID);
        const fieldPath = descriptor.path && descriptor.path.length > 0
            ? descriptor.path
            : resolvedPath;

        let sawResolvedCarrier = false;
        let sawContainedPayloadEndpoint = false;
        for (const endpointValue of endpointValues) {
            if (endpointValue instanceof Constant) {
                sawResolvedCarrier = true;
                continue;
            }
            if (descriptor.taintScope === "contained-values") {
                sawContainedPayloadEndpoint = true;
                const factValue = fact?.node.getValue();
                if (factValue instanceof Local && this.objectInitializerContainsLocal(endpointValue, factValue)) {
                    return "tainted";
                }
            }
            const carrierIds = this.resolveCarrierNodeIdsFromValue(endpointValue, pag);
            if (carrierIds.length === 0) return "unknown";
            sawResolvedCarrier = true;
            for (const carrierId of carrierIds) {
                if (descriptor.taintScope === "contained-values") {
                    if (tracker.getFieldSourcesAnyContext(carrierId).some(item => item.source === source)) {
                        return "tainted";
                    }
                    continue;
                }
                const sources = fieldPath && fieldPath.length > 0
                    ? tracker.getSourcesAnyContext(carrierId, fieldPath)
                    : tracker.getSourcesAnyContext(carrierId);
                if (sources.includes(source)) return "tainted";
            }
        }

        return sawContainedPayloadEndpoint ? "unknown" : (sawResolvedCarrier ? "clean" : "unknown");
    }

    private resolveRuntimePathKey(value: any, slotKind?: string, pag?: Pag, anchorStmt?: any): string | undefined {
        if (value instanceof Constant) {
            const literal = this.normalizeLiteral(value.toString());
            if (slotKind === "sql-table") {
                return this.extractSqlTableName(literal) || literal;
            }
            return literal;
        }

        if (value instanceof Local) {
            const decl = value.getDeclaringStmt?.();
            if (decl instanceof ArkAssignStmt) {
                const right = decl.getRightOp?.();
                if (right instanceof Constant) {
                    const literal = this.normalizeLiteral(right.toString());
                    if (slotKind === "sql-table") {
                        return this.extractSqlTableName(literal) || literal;
                    }
                    return literal;
                }
                if (right instanceof ArkNormalBinopExpr) {
                    const n1 = this.resolveNumber(right.getOp1(), pag, anchorStmt);
                    const n2 = this.resolveNumber(right.getOp2(), pag, anchorStmt);
                    if (n1 !== undefined && n2 !== undefined) {
                        const op = right.getOperator();
                        if (op === "+") return String(n1 + n2);
                        if (op === "-") return String(n1 - n2);
                        if (op === "*") return String(n1 * n2);
                        if (op === "/" && n2 !== 0) return String(n1 / n2);
                    }
                }
            }
            return this.resolveRuntimeIdentityPathKey(value, pag, anchorStmt);
        }

        return undefined;
    }

    private resolveRuntimeIdentityPathKey(value: any, pag?: Pag, anchorStmt?: any): string | undefined {
        if (!pag) return undefined;
        const objectIds = this.resolveObjectIdsFromValue(value, pag, anchorStmt);
        if (objectIds.length > 0) {
            return `object:${objectIds.slice().sort((a, b) => a - b).join(",")}`;
        }
        const nodeIds = this.resolveNodesByValue(value, pag, anchorStmt);
        if (!nodeIds || nodeIds.size === 0) return undefined;
        return `node:${[...nodeIds.values()].sort((a, b) => a - b).join(",")}`;
    }

    private extractSqlTableName(sql: string): string | undefined {
        const normalized = sql.replace(/\s+/g, " ").trim();
        const match = /\bfrom\s+([A-Za-z_][A-Za-z0-9_.$]*)\b/i.exec(normalized);
        if (!match) return undefined;
        return match[1].replace(/^["'`]/, "").replace(/["'`]$/, "");
    }

    private resolveNumber(value: any, pag?: Pag, anchorStmt?: any): number | undefined {
        const key = this.resolveRuntimePathKey(value, undefined, pag, anchorStmt);
        if (key === undefined) return undefined;
        const n = Number(key);
        return Number.isNaN(n) ? undefined : n;
    }

    private normalizeLiteral(text: string): string {
        return text.replace(/^['"`]/, "").replace(/['"`]$/, "");
    }

    private samePath(a?: string[], b?: string[]): boolean {
        if (!a || !b) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    private extractFilePathFromSignature(signature: string): string {
        const m = signature.match(/@([^:>]+):/);
        return m ? m[1].replace(/\\/g, "/") : signature;
    }

    private createEmptyStats(): TransferExecutionStats {
        return {
            factCount: 0,
            invokeSiteCount: 0,
            ruleCheckCount: 0,
            ruleMatchCount: 0,
            endpointCheckCount: 0,
            endpointMatchCount: 0,
            dedupSkipCount: 0,
            resultCount: 0,
            elapsedMs: 0,
            noCandidateCallsites: [],
            siteConsumptions: [],
        };
    }

    private buildRuleExecutionDedupKey(factId: string, site: InvokeSite, ruleId: string): string {
        const siteKey = this.getSiteRuntimeKey(site);
        return `${factId}|${siteKey}|${ruleId}`;
    }

    private getSiteRuntimeKey(site: InvokeSite): string {
        const stmt = site.stmt;
        if (stmt && typeof stmt === "object") {
            const obj = stmt as object;
            let id = this.stmtRuntimeKeyId.get(obj);
            if (!id) {
                id = this.stmtRuntimeKeySeq++;
                this.stmtRuntimeKeyId.set(obj, id);
            }
            return `stmt#${id}`;
        }
        return `${site.callerSignature}|${site.signature}|${site.methodName}`;
    }

    private buildRuleBucketIndex(rules: RuntimeRule[]): RuntimeRuleBucketIndex {
        const buckets: RuntimeRuleBucketIndex = {
            universal: [],
        };

        for (const runtimeRule of rules) {
            buckets.universal.push(runtimeRule);
        }

        return buckets;
    }

    private regexTest(regex: RegExp, text: string): boolean {
        regex.lastIndex = 0;
        return regex.test(text);
    }
}
