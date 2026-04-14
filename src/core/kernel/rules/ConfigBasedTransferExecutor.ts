import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkNormalBinopExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { TaintFact } from "../model/TaintFact";
import { TaintTracker } from "../model/TaintTracker";
import { toContainerFieldKey } from "../model/ContainerSlotKeys";
import {
    collectParameterAssignStmts,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates,
    resolveMethodsFromCallable,
} from "../../substrate/queries/CalleeResolver";
import {
    RuleEndpoint,
    RuleScopeConstraint,
    RuleStringConstraint,
    TransferRule,
    normalizeEndpoint,
} from "../../rules/RuleSchema";
import type {
    EndpointDescriptor,
    InvokeSite,
    MethodEntityIndex,
    RuleMatchKind,
    RuntimeRule,
    RuntimeRuleBucketIndex,
    SceneRuleCacheStats,
    TransferNoCandidateCallsite,
    SharedSceneRuleCache,
    TransferExecutionResult,
    TransferExecutionStats,
    TransferExecutionWithStats,
} from "./TransferTypes";
import { buildNoCandidateCallsiteRecord } from "./NoCandidateSurface";

export type {
    EndpointDescriptor,
    InvokeSite,
    MethodEntityIndex,
    RuleMatchKind,
    RuntimeRule,
    RuntimeRuleBucketIndex,
    SceneRuleCacheStats,
    TransferNoCandidateCallsite,
    SharedSceneRuleCache,
    TransferExecutionResult,
    TransferExecutionStats,
    TransferExecutionWithStats,
} from "./TransferTypes";

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
    private readonly objectAliasLocalCache = new Map<number, Local[]>();
    private readonly ruleExecutionDedupCache = new Set<string>();
    private readonly stmtRuntimeKeyId = new WeakMap<object, number>();
    private stmtRuntimeKeySeq = 1;
    private readonly scene?: Scene;
    private paramArgAliasMap: Map<Local, any[]>;

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

    constructor(rules: TransferRule[] = [], scene?: Scene) {
        this.scene = scene;
        this.perfMode = this.resolvePerfModeFromEnv();
        this.stmtOwner = new Map<any, any>();
        this.invokeSiteByStmt = new Map<any, InvokeSite>();
        this.siteRuleCandidateIndex = new Map<any, RuntimeRule[]>();
        this.paramArgAliasMap = new Map<Local, any[]>();

        if (scene) {
            const cacheEnabled = this.isSceneRuleCacheEnabled();
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

            const methodEntityIndex = this.buildMethodEntityIndex(scene);
            this.runtimeRules = this.compileRules(rules || [], methodEntityIndex);
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
                matchKind: rule.match?.kind || "",
                matchValue: rule.match?.value || "",
                fromEndpoint: fromN.endpoint,
                fromPath: fromN.path ?? [],
                fromPathFrom: fromN.pathFrom || "",
                fromSlotKind: fromN.slotKind || "",
                toEndpoint: toN.endpoint,
                toPath: toN.path ?? [],
                toPathFrom: toN.pathFrom || "",
                toSlotKind: toN.slotKind || "",
                invokeKind: rule.match?.invokeKind || "",
                argCount: rule.match?.argCount === undefined ? "" : String(rule.match.argCount),
                typeHint: rule.match?.typeHint || "",
                scope: JSON.stringify(rule.scope || {}),
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

        const sites = this.collectInvokeSitesFromFact(taintedFact, pag);
        stats.invokeSiteCount = sites.length;
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
                const noCandidate = buildNoCandidateCallsiteRecord(site, owner);
                const key = `${noCandidate.calleeSignature}|${noCandidate.method}|${noCandidate.invokeKind}|${noCandidate.argCount}|${noCandidate.sourceFile}`;
                const existing = noCandidateCallsiteMap.get(key);
                if (existing) {
                    existing.count += 1;
                } else {
                    noCandidateCallsiteMap.set(key, noCandidate);
                }
            }
            for (const runtimeRule of candidateRules) {
                stats.ruleCheckCount++;

                if (this.perfMode === "optimized") {
                    const dedupKey = this.buildRuleExecutionDedupKey(taintedFact.id, site, runtimeRule.rule.id);
                    if (this.ruleExecutionDedupCache.has(dedupKey)) {
                        stats.dedupSkipCount++;
                        continue;
                    }
                    this.ruleExecutionDedupCache.add(dedupKey);
                }

                if (runtimeRule.rule.match.kind === "local_name_regex") {
                    if (!this.matchesLocalNameRegexRule(runtimeRule, site, taintedFact)) continue;
                    stats.ruleMatchCount++;
                } else {
                    // Non-local match kinds are pre-filtered by callsite candidate index.
                    stats.ruleMatchCount++;
                }

                const fromDescriptor = this.resolveFromDescriptor(runtimeRule.rule);
                stats.endpointCheckCount++;
                if (!this.endpointMatchesFact(fromDescriptor, site, taintedFact, pag, tracker)) continue;
                stats.endpointMatchCount++;

                const toDescriptor = this.resolveToDescriptor(runtimeRule.rule);
                const targetFacts = this.resolveTargetFacts(toDescriptor, site, taintedFact.source, taintedFact.contextID, pag);
                for (const fact of targetFacts) {
                    const resultKey = `${runtimeRule.rule.id}|${site.signature}|${fact.id}`;
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

    private compileRules(rules: TransferRule[], index?: MethodEntityIndex): RuntimeRule[] {
        const out: RuntimeRule[] = [];
        for (const rule of rules) {
            let matchRegex: RegExp | undefined;
            let normalizedMatchValue: string | undefined;
            let exactSignatureMatch: string | undefined;
            let exactDeclaringClassMatch: string | undefined;
            const kind = rule.match.kind;
            const rawValue = typeof rule.match.value === "string" ? rule.match.value : "";
            normalizedMatchValue = this.normalizeForExactMatch(rawValue);

            if (
                (kind === "signature_regex" || kind === "method_name_regex" || kind === "local_name_regex")
                && typeof rule.match.value === "string"
            ) {
                try {
                    matchRegex = new RegExp(rule.match.value);
                } catch {
                    continue;
                }
            }

            if (kind === "signature_equals") {
                exactSignatureMatch = this.resolveExactSignatureMatch(rawValue, index);
            } else if (kind === "declaring_class_equals") {
                exactDeclaringClassMatch = this.resolveExactDeclaringClassMatch(rawValue, index);
            }

            out.push({
                rule,
                matchRegex,
                normalizedMatchValue,
                exactSignatureMatch,
                exactDeclaringClassMatch,
            });
        }
        return out;
    }

    private collectInvokeSitesFromFact(fact: TaintFact, pag: Pag): InvokeSite[] {
        const value = fact.node.getValue();
        if (value instanceof Local) {
            return this.collectInvokeSitesForLocal(value);
        }

        const objectId = fact.node.getID();
        const aliases = this.collectAliasLocalsForObject(objectId, pag);
        const out: InvokeSite[] = [];
        const seen = new Set<any>();
        for (const local of aliases) {
            const localSites = this.collectInvokeSitesForLocal(local);
            for (const site of localSites) {
                if (seen.has(site.stmt)) continue;
                seen.add(site.stmt);
                out.push(site);
            }
        }
        return out;
    }

    private collectAliasLocalsForObject(objectId: number, pag: Pag): Local[] {
        const cached = this.objectAliasLocalCache.get(objectId);
        if (cached) return cached;

        const out: Local[] = [];
        const seenLocals = new Set<string>();
        for (const rawNode of pag.getNodesIter()) {
            const node = rawNode as PagNode;
            const value = node.getValue();
            if (!(value instanceof Local)) continue;
            const pts = node.getPointTo();
            if (!pts || !pts.contains || !pts.contains(objectId)) continue;
            const methodSig = value.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
            const key = `${methodSig}::${value.getName()}`;
            if (seenLocals.has(key)) continue;
            seenLocals.add(key);
            out.push(value);
        }
        this.objectAliasLocalCache.set(objectId, out);
        return out;
    }

    private collectInvokeSitesForLocal(local: Local): InvokeSite[] {
        const out: InvokeSite[] = [];
        const seenStmts = new Set<any>();

        const pushInvokeSiteByStmt = (stmt: any): void => {
            if (!stmt) return;
            if (seenStmts.has(stmt)) return;
            const site = this.getOrCreateInvokeSite(stmt);
            if (!site) return;
            seenStmts.add(stmt);
            out.push(site);
        };

        for (const stmt of local.getUsedStmts()) {
            pushInvokeSiteByStmt(stmt);
        }

        const declStmt = local.getDeclaringStmt();
        if (declStmt instanceof ArkAssignStmt) {
            const rightOp = declStmt.getRightOp();
            if (rightOp instanceof ArkInstanceInvokeExpr || rightOp instanceof ArkStaticInvokeExpr) {
                pushInvokeSiteByStmt(declStmt);
            }
        }

        return out;
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

        return {
            stmt,
            invokeExpr,
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
            return this.applyFamilyTierPriority(this.applyRuleMatchPriority(allMatched));
        }

        const stmt = site.stmt;
        if (stmt && this.siteRuleCandidateIndex.has(stmt)) {
            return this.siteRuleCandidateIndex.get(stmt)!;
        }

        const roughCandidates = this.collectBucketCandidatesForSite(site);
        const staticMatched = roughCandidates.filter(runtimeRule => this.matchesRuleStatic(runtimeRule, site));
        const candidates = this.applyFamilyTierPriority(this.applyRuleMatchPriority(staticMatched));

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
        const out: RuntimeRule[] = [];
        const seen = new Set<RuntimeRule>();
        this.appendRuntimeRules(out, seen, this.ruleBuckets.universal);
        this.appendRuntimeRulesByTexts(
            out,
            seen,
            this.ruleBuckets.methodNameEquals,
            [site.methodName, ...(site.candidateMethodNames || [])]
        );
        this.appendRuntimeRulesByTexts(
            out,
            seen,
            this.ruleBuckets.signatureEquals,
            [site.signature, ...(site.candidateSignatures || [])]
        );
        this.appendRuntimeRulesByTexts(
            out,
            seen,
            this.ruleBuckets.declaringClassEquals,
            [site.calleeClassText, site.calleeClassName, ...(site.candidateClassTexts || []), ...(site.candidateClassNames || [])]
        );
        return out;
    }

    private appendRuntimeRulesByTexts(
        out: RuntimeRule[],
        seen: Set<RuntimeRule>,
        bucket: Map<string, RuntimeRule[]>,
        texts: string[]
    ): void {
        for (const text of this.uniqueTexts(texts)) {
            this.appendRuntimeRulesByKey(out, seen, bucket, text);
        }
    }

    private appendRuntimeRulesByKey(
        out: RuntimeRule[],
        seen: Set<RuntimeRule>,
        bucket: Map<string, RuntimeRule[]>,
        keyText: string
    ): void {
        if (!keyText) return;
        this.appendRuntimeRules(out, seen, bucket.get(keyText));
        const normalizedKey = this.normalizeForExactMatch(keyText);
        if (normalizedKey !== keyText) {
            this.appendRuntimeRules(out, seen, bucket.get(normalizedKey));
        }
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
        if (staticMatched.length <= 1) return staticMatched;
        const exact: RuntimeRule[] = [];
        const constrained: RuntimeRule[] = [];
        const fuzzy: RuntimeRule[] = [];

        for (const runtimeRule of staticMatched) {
            if (this.isExactMatchKind(runtimeRule.rule.match.kind)) {
                exact.push(runtimeRule);
                continue;
            }
            if (this.hasConstrainedSignals(runtimeRule.rule)) {
                constrained.push(runtimeRule);
                continue;
            }
            fuzzy.push(runtimeRule);
        }

        if (exact.length > 0) return exact;
        if (constrained.length > 0) return constrained;
        return fuzzy;
    }

    private isExactMatchKind(kind: RuleMatchKind): boolean {
        return kind === "signature_equals"
            || kind === "declaring_class_equals";
    }

    private hasConstrainedSignals(rule: TransferRule): boolean {
        const m = rule.match;
        if (m.invokeKind && m.invokeKind !== "any") return true;
        if (m.argCount !== undefined) return true;
        if (m.typeHint && m.typeHint.trim().length > 0) return true;
        if (rule.scope) {
            if (rule.scope.file || rule.scope.module || rule.scope.className || rule.scope.methodName) {
                return true;
            }
        }
        return false;
    }

    private resolveRuleFamily(rule: TransferRule): string | undefined {
        const family = typeof rule.family === "string" ? rule.family.trim() : "";
        return family.length > 0 ? family : undefined;
    }

    private resolveRuleTierWeight(rule: TransferRule): number {
        if (rule.tier === "A") return 3;
        if (rule.tier === "B") return 2;
        if (rule.tier === "C") return 1;
        return 0;
    }

    private applyFamilyTierPriority(staticMatched: RuntimeRule[]): RuntimeRule[] {
        if (staticMatched.length <= 1) return staticMatched;

        const bestTierByFamily = new Map<string, number>();
        for (const runtimeRule of staticMatched) {
            const family = this.resolveRuleFamily(runtimeRule.rule);
            if (!family) continue;
            const tier = this.resolveRuleTierWeight(runtimeRule.rule);
            const best = bestTierByFamily.get(family) || 0;
            if (tier > best) bestTierByFamily.set(family, tier);
        }

        if (bestTierByFamily.size === 0) return staticMatched;

        return staticMatched.filter(runtimeRule => {
            const family = this.resolveRuleFamily(runtimeRule.rule);
            if (!family) return true;
            const best = bestTierByFamily.get(family);
            if (best === undefined) return true;
            return this.resolveRuleTierWeight(runtimeRule.rule) >= best;
        });
    }

    private matchesRuleStatic(runtimeRule: RuntimeRule, site: InvokeSite): boolean {
        const rule = runtimeRule.rule;
        if (!this.matchesTierCFallbackGate(rule)) return false;
        if (!this.matchesInvokeShape(rule, site)) return false;
        if (!this.matchesScope(rule.scope, site)) return false;

        const value = rule.match.value || "";
        const signatureTexts = this.resolveSignatureTexts(site);
        const methodNameTexts = this.resolveMethodNameTexts(site);
        const classTexts = this.resolveDeclaringClassTexts(site);
        switch (rule.match.kind) {
            case "signature_contains":
                return signatureTexts.some(text => text.includes(value));
            case "signature_equals":
                return signatureTexts.some(text => this.exactTextMatch(
                    text,
                    runtimeRule.exactSignatureMatch,
                    runtimeRule.normalizedMatchValue
                ));
            case "signature_regex":
                return runtimeRule.matchRegex ? signatureTexts.some(text => this.regexTest(runtimeRule.matchRegex!, text)) : false;
            case "declaring_class_equals": {
                if (runtimeRule.exactDeclaringClassMatch) {
                    if (classTexts.some(text => text === runtimeRule.exactDeclaringClassMatch)) return true;
                }
                const normalized = runtimeRule.normalizedMatchValue || "";
                return classTexts.some(text => this.normalizeForExactMatch(text) === normalized);
            }
            case "method_name_equals":
                return methodNameTexts.some(name => name === value);
            case "method_name_regex":
                return runtimeRule.matchRegex ? methodNameTexts.some(name => this.regexTest(runtimeRule.matchRegex!, name)) : false;
            case "local_name_regex":
                return true;
            default:
                return false;
        }
    }

    private matchesTierCFallbackGate(rule: TransferRule): boolean {
        if (rule.tier !== "C") return true;
        if (rule.match.kind !== "method_name_equals") return true;
        const family = typeof rule.family === "string" ? rule.family.trim() : "";
        if (!family) return false;
        if (!rule.match.invokeKind || rule.match.invokeKind === "any") return false;
        if (rule.match.argCount === undefined) return false;
        if (!this.hasScopeAnchor(rule.scope)) return false;
        return true;
    }

    private hasScopeAnchor(scope: RuleScopeConstraint | undefined): boolean {
        if (!scope) return false;
        return !!(scope.file || scope.module || scope.className || scope.methodName);
    }

    private matchesLocalNameRegexRule(runtimeRule: RuntimeRule, site: InvokeSite, fact: TaintFact): boolean {
        if (!runtimeRule.matchRegex) return false;
        const factValue = fact.node.getValue();
        if (factValue instanceof Local && this.regexTest(runtimeRule.matchRegex, factValue.getName())) {
            return true;
        }
        const fromDescriptor = this.resolveFromDescriptor(runtimeRule.rule);
        const endpointValues = this.resolveEndpointValues(fromDescriptor.endpoint, site);
        for (const endpointValue of endpointValues) {
            if (endpointValue instanceof Local && this.regexTest(runtimeRule.matchRegex, endpointValue.getName())) {
                return true;
            }
        }
        return false;
    }

    private matchesInvokeShape(rule: TransferRule, site: InvokeSite): boolean {
        const m = rule.match;
        if (m.invokeKind && m.invokeKind !== "any" && m.invokeKind !== site.invokeKind) {
            return false;
        }
        if (m.argCount !== undefined && m.argCount !== site.args.length) {
            return false;
        }
        if (m.typeHint && m.typeHint.trim().length > 0) {
            const hint = m.typeHint.trim().toLowerCase();
            const declaringClass = site.invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
            const baseText = site.baseValue?.toString?.() || "";
            const ptrText = site.invokeExpr instanceof ArkPtrInvokeExpr ? (site.invokeExpr.toString?.() || "") : "";
            const haystack = `${site.signature} ${declaringClass} ${baseText} ${ptrText}`.toLowerCase();
            if (!haystack.includes(hint)) {
                return false;
            }
        }
        return true;
    }

    private matchesScope(scope: RuleScopeConstraint | undefined, site: InvokeSite): boolean {
        if (!scope) return true;
        const fileTexts = this.resolveCalleeFilePathTexts(site);
        const signatureTexts = this.resolveSignatureTexts(site);
        const classTexts = this.resolveDeclaringClassTexts(site);
        const methodTexts = this.resolveMethodNameTexts(site);
        if (!this.matchConstraintOnAnyText(scope.file, fileTexts)) return false;
        if (!this.matchConstraintOnAnyText(scope.module, [...signatureTexts, ...fileTexts])) return false;
        if (!this.matchConstraintOnAnyText(scope.className, classTexts)) return false;
        if (!this.matchConstraintOnAnyText(scope.methodName, methodTexts)) return false;
        return true;
    }

    private matchStringConstraint(constraint: RuleStringConstraint | undefined, text: string): boolean {
        if (!constraint) return true;
        if (constraint.mode === "equals") return text === constraint.value;
        if (constraint.mode === "contains") return text.includes(constraint.value);
        try {
            return new RegExp(constraint.value).test(text);
        } catch {
            return false;
        }
    }

    private matchConstraintOnAnyText(constraint: RuleStringConstraint | undefined, texts: string[]): boolean {
        if (!constraint) return true;
        const uniqueTexts = this.uniqueTexts(texts);
        if (uniqueTexts.length === 0) return false;
        return uniqueTexts.some(text => this.matchStringConstraint(constraint, text));
    }

    private resolveSignatureTexts(site: InvokeSite): string[] {
        return this.uniqueTexts([site.signature, site.calleeSignature, ...(site.candidateSignatures || [])]);
    }

    private resolveMethodNameTexts(site: InvokeSite): string[] {
        return this.uniqueTexts([site.methodName, site.calleeMethodName, ...(site.candidateMethodNames || [])]);
    }

    private resolveDeclaringClassTexts(site: InvokeSite): string[] {
        return this.uniqueTexts([
            site.calleeClassText,
            site.calleeClassName,
            ...(site.candidateClassTexts || []),
            ...(site.candidateClassNames || []),
        ]);
    }

    private resolveCalleeFilePathTexts(site: InvokeSite): string[] {
        return this.uniqueTexts([site.calleeFilePath, ...(site.candidateFilePaths || [])]);
    }

    private resolveFromDescriptor(rule: TransferRule): EndpointDescriptor {
        const n = normalizeEndpoint(rule.from);
        return {
            endpoint: n.endpoint,
            pathFrom: n.pathFrom,
            slotKind: n.slotKind,
        };
    }

    private resolveToDescriptor(rule: TransferRule): EndpointDescriptor {
        const n = normalizeEndpoint(rule.to);
        return {
            endpoint: n.endpoint,
            pathFrom: n.pathFrom,
            slotKind: n.slotKind,
        };
    }

    private endpointMatchesFact(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        fact: TaintFact,
        pag: Pag,
        tracker?: TaintTracker
    ): boolean {
        const endpointValues = this.resolveEndpointValues(descriptor.endpoint, site);
        if (endpointValues.length === 0) return false;

        const resolvedPath = this.resolveDescriptorFieldPath(descriptor, site);
        if (descriptor.pathFrom) {
            if (!resolvedPath) return false;
            for (const endpointValue of endpointValues) {
                const carrierIds = this.resolveCarrierNodeIdsFromValue(endpointValue, pag);
                for (const carrierId of carrierIds) {
                    if (carrierId === fact.node.getID() && this.samePath(fact.field, resolvedPath)) return true;
                    if (tracker?.isTaintedAnyContext(carrierId, resolvedPath)) return true;
                }
            }
            return false;
        }

        if (fact.field && fact.field.length > 0) {
            return false;
        }

        for (const endpointValue of endpointValues) {
            const nodes = pag.getNodesByValue(endpointValue);
            if (nodes && nodes.size > 0) {
                for (const nodeId of nodes.values()) {
                    if (nodeId === fact.node.getID()) {
                        return true;
                    }
                    const node = pag.getNode(nodeId) as PagNode;
                    const pts = node.getPointTo();
                    if (pts && pts.contains && pts.contains(fact.node.getID())) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private resolveTargetFacts(
        descriptor: EndpointDescriptor,
        site: InvokeSite,
        source: string,
        contextID: number,
        pag: Pag
    ): TaintFact[] {
        const out: TaintFact[] = [];
        const seen = new Set<string>();
        const endpointValues = this.resolveEndpointValues(descriptor.endpoint, site);
        if (endpointValues.length === 0) return out;

        const addFact = (fact: TaintFact): void => {
            if (seen.has(fact.id)) return;
            seen.add(fact.id);
            out.push(fact);
        };

        const resolvedPath = this.resolveDescriptorFieldPath(descriptor, site);
        if (descriptor.pathFrom) {
            if (!resolvedPath) return out;
            for (const endpointValue of endpointValues) {
                const carrierIds = this.resolveCarrierNodeIdsFromValue(endpointValue, pag);
                for (const carrierId of carrierIds) {
                    const carrierNode = pag.getNode(carrierId) as PagNode;
                    addFact(new TaintFact(carrierNode, source, contextID, [...resolvedPath]));
                }
            }
            return out;
        }

        for (const endpointValue of endpointValues) {
            const targetNodes = pag.getNodesByValue(endpointValue);
            if (!targetNodes) continue;
            for (const nodeId of targetNodes.values()) {
                const node = pag.getNode(nodeId) as PagNode;
                addFact(new TaintFact(node, source, contextID));
            }
        }
        return out;
    }

    private resolveEndpointValues(endpoint: RuleEndpoint, site: InvokeSite): any[] {
        if (endpoint === "base") return site.baseValue !== undefined ? [site.baseValue] : [];
        if (endpoint === "result") return site.resultValue !== undefined ? [site.resultValue] : [];
        const argIndex = this.parseArgIndex(endpoint);
        if (argIndex === null) return [];
        const value = site.args[argIndex];
        return value !== undefined ? [value] : [];
    }

    private resolveObjectIdsFromValue(value: any, pag: Pag): number[] {
        const out: number[] = [];
        const seen = new Set<number>();
        const nodes = pag.getNodesByValue(value);
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

    private resolveCarrierNodeIdsFromValue(value: any, pag: Pag): number[] {
        const objectIds = this.resolveObjectIdsFromValue(value, pag);
        if (objectIds.length > 0) return objectIds;
        const out: number[] = [];
        const seen = new Set<number>();
        const nodes = pag.getNodesByValue(value);
        if (!nodes || nodes.size === 0) return out;
        for (const nodeId of nodes.values()) {
            if (seen.has(nodeId)) continue;
            seen.add(nodeId);
            out.push(nodeId);
        }
        return out;
    }

    private resolveDescriptorFieldPath(descriptor: EndpointDescriptor, site: InvokeSite): string[] | undefined {
        if (!descriptor.pathFrom || !descriptor.slotKind) return undefined;
        const pathValues = this.resolveEndpointValues(descriptor.pathFrom, site);
        if (pathValues.length === 0) return undefined;
        const key = this.resolveRuntimePathKey(pathValues[0]);
        if (key === undefined) return undefined;
        return [toContainerFieldKey(`${descriptor.slotKind}:${key}`)];
    }

    private resolveRuntimePathKey(value: any): string | undefined {
        if (value instanceof Constant) {
            return this.normalizeLiteral(value.toString());
        }

        if (value instanceof Local) {
            const decl = value.getDeclaringStmt?.();
            if (decl instanceof ArkAssignStmt) {
                const right = decl.getRightOp?.();
                if (right instanceof Constant) {
                    return this.normalizeLiteral(right.toString());
                }
                if (right instanceof ArkNormalBinopExpr) {
                    const n1 = this.resolveNumber(right.getOp1());
                    const n2 = this.resolveNumber(right.getOp2());
                    if (n1 !== undefined && n2 !== undefined) {
                        const op = right.getOperator();
                        if (op === "+") return String(n1 + n2);
                        if (op === "-") return String(n1 - n2);
                        if (op === "*") return String(n1 * n2);
                        if (op === "/" && n2 !== 0) return String(n1 / n2);
                    }
                }
            }
            return value.getName?.();
        }

        return undefined;
    }

    private resolveNumber(value: any): number | undefined {
        const key = this.resolveRuntimePathKey(value);
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

    private parseArgIndex(endpoint: RuleEndpoint): number | null {
        const match = /^arg(\d+)$/.exec(endpoint);
        if (!match) return null;
        const index = Number(match[1]);
        if (!Number.isFinite(index) || index < 0) return null;
        return index;
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

    private buildMethodEntityIndex(scene: Scene): MethodEntityIndex {
        const signatures = new Set<string>();
        const declaringClasses = new Set<string>();
        const declaringClassNames = new Set<string>();
        for (const method of scene.getMethods()) {
            const signature = method.getSignature?.()?.toString?.();
            if (signature) signatures.add(signature);

            const classSignature = method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.();
            if (classSignature) declaringClasses.add(classSignature);

            const className = method.getDeclaringArkClass?.()?.getName?.();
            if (className) declaringClassNames.add(className);
        }
        return {
            signatures,
            declaringClasses,
            declaringClassNames,
        };
    }

    private resolveExactSignatureMatch(value: string, index?: MethodEntityIndex): string | undefined {
        const candidate = value.trim();
        if (!candidate) return undefined;
        if (index && index.signatures.has(candidate)) return candidate;
        return candidate;
    }

    private resolveExactDeclaringClassMatch(value: string, index?: MethodEntityIndex): string | undefined {
        const candidate = value.trim();
        if (!candidate) return undefined;
        if (index && (index.declaringClasses.has(candidate) || index.declaringClassNames.has(candidate))) {
            return candidate;
        }
        return candidate;
    }

    private normalizeForExactMatch(value: string): string {
        return value.trim();
    }

    private buildRuleBucketIndex(rules: RuntimeRule[]): RuntimeRuleBucketIndex {
        const buckets: RuntimeRuleBucketIndex = {
            universal: [],
            methodNameEquals: new Map(),
            signatureEquals: new Map(),
            declaringClassEquals: new Map(),
        };

        for (const runtimeRule of rules) {
            const kind = runtimeRule.rule.match.kind;
            if (kind === "method_name_equals") {
                const key = this.normalizeForExactMatch(runtimeRule.rule.match.value || "");
                if (!key) {
                    buckets.universal.push(runtimeRule);
                    continue;
                }
                this.addRuleToBucket(buckets.methodNameEquals, key, runtimeRule);
                continue;
            }

            if (kind === "signature_equals") {
                const key = this.normalizeForExactMatch(
                    runtimeRule.exactSignatureMatch || runtimeRule.normalizedMatchValue || runtimeRule.rule.match.value || ""
                );
                if (!key) {
                    buckets.universal.push(runtimeRule);
                    continue;
                }
                this.addRuleToBucket(buckets.signatureEquals, key, runtimeRule);
                continue;
            }

            if (kind === "declaring_class_equals") {
                const key = this.normalizeForExactMatch(
                    runtimeRule.exactDeclaringClassMatch || runtimeRule.normalizedMatchValue || runtimeRule.rule.match.value || ""
                );
                if (!key) {
                    buckets.universal.push(runtimeRule);
                    continue;
                }
                this.addRuleToBucket(buckets.declaringClassEquals, key, runtimeRule);
                continue;
            }

            buckets.universal.push(runtimeRule);
        }

        return buckets;
    }

    private addRuleToBucket(bucket: Map<string, RuntimeRule[]>, key: string, runtimeRule: RuntimeRule): void {
        const normalizedKey = this.normalizeForExactMatch(key);
        if (!normalizedKey) return;
        const list = bucket.get(normalizedKey);
        if (list) {
            list.push(runtimeRule);
        } else {
            bucket.set(normalizedKey, [runtimeRule]);
        }
    }

    private exactTextMatch(
        text: string,
        exactValue: string | undefined,
        normalizedFallback: string | undefined
    ): boolean {
        if (exactValue && text === exactValue) return true;
        if (!normalizedFallback) return false;
        return this.normalizeForExactMatch(text) === normalizedFallback;
    }

    private regexTest(regex: RegExp, text: string): boolean {
        regex.lastIndex = 0;
        return regex.test(text);
    }
}
