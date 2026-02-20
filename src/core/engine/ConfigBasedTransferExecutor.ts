import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { TaintFact } from "../TaintFact";
import { TaintTracker } from "../TaintTracker";
import {
    RuleEndpoint,
    RuleScopeConstraint,
    RuleStringConstraint,
    TransferRule
} from "../rules/RuleSchema";
import type {
    EndpointDescriptor,
    InvokeSite,
    MethodEntityIndex,
    RuleMatchKind,
    RuntimeRule,
    RuntimeRuleBucketIndex,
    SceneRuleCacheStats,
    SharedSceneRuleCache,
    TransferExecutionResult,
    TransferExecutionStats,
    TransferExecutionWithStats,
} from "./TransferTypes";

export type {
    EndpointDescriptor,
    InvokeSite,
    MethodEntityIndex,
    RuleMatchKind,
    RuntimeRule,
    RuntimeRuleBucketIndex,
    SceneRuleCacheStats,
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
        this.perfMode = this.resolvePerfModeFromEnv();
        this.stmtOwner = new Map<any, any>();
        this.invokeSiteByStmt = new Map<any, InvokeSite>();
        this.siteRuleCandidateIndex = new Map<any, RuntimeRule[]>();

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

            if (cacheEnabled) {
                this.setSharedSceneRuleCache(scene, cacheKey, {
                    runtimeRules: this.runtimeRules,
                    ruleBuckets: this.ruleBuckets,
                    stmtOwner: this.stmtOwner,
                    invokeSiteByStmt: this.invokeSiteByStmt,
                    siteRuleCandidateIndex: this.siteRuleCandidateIndex,
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

    private buildSceneRuleCacheKey(rules: TransferRule[]): string {
        const normalizedRules = rules.map((rule, index) => ({
            idx: index,
            id: rule.id || "",
            matchKind: rule.match?.kind || "",
            matchValue: rule.match?.value || "",
            from: rule.from || "",
            to: rule.to || "",
            fromRefEndpoint: rule.fromRef?.endpoint || "",
            fromRefPath: (rule.fromRef?.path || []).join("."),
            toRefEndpoint: rule.toRef?.endpoint || "",
            toRefPath: (rule.toRef?.path || []).join("."),
            invokeKind: rule.invokeKind || "",
            argCount: rule.argCount === undefined ? "" : String(rule.argCount),
            typeHint: rule.typeHint || "",
            scope: JSON.stringify(rule.scope || {}),
        }));
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
        for (const site of sites) {
            const candidateRules = this.resolveCandidateRulesForSite(site);
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
        stats.elapsedMs = this.elapsedMsSince(t0);
        return { results, stats };
    }

    private compileRules(rules: TransferRule[], index?: MethodEntityIndex): RuntimeRule[] {
        const out: RuntimeRule[] = [];
        for (const rule of rules) {
            let matchRegex: RegExp | undefined;
            let normalizedMatchValue: string | undefined;
            let exactSignatureMatch: string | undefined;
            let exactCalleeSignatureMatch: string | undefined;
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
            } else if (kind === "callee_signature_equals") {
                exactCalleeSignatureMatch = this.resolveExactSignatureMatch(rawValue, index);
            } else if (kind === "declaring_class_equals") {
                exactDeclaringClassMatch = this.resolveExactDeclaringClassMatch(rawValue, index);
            }

            out.push({
                rule,
                matchRegex,
                normalizedMatchValue,
                exactSignatureMatch,
                exactCalleeSignatureMatch,
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
        const seenNames = new Set<string>();
        for (const rawNode of pag.getNodesIter()) {
            const node = rawNode as PagNode;
            const value = node.getValue();
            if (!(value instanceof Local)) continue;
            const pts = node.getPointTo();
            if (!pts || !pts.contains || !pts.contains(objectId)) continue;
            const key = value.getName();
            if (seenNames.has(key)) continue;
            seenNames.add(key);
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
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr) && !(invokeExpr instanceof ArkStaticInvokeExpr)) return undefined;

        const signature = invokeExpr.getMethodSignature?.()?.toString?.() || "";
        const methodNameFromSig = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
        let methodName = methodNameFromSig;
        if (!methodName && signature) {
            const match = signature.match(/\.([A-Za-z0-9_$]+)\(/);
            methodName = match ? match[1] : "";
        }

        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const baseValue = invokeExpr instanceof ArkInstanceInvokeExpr ? invokeExpr.getBase() : undefined;
        const resultValue = stmt instanceof ArkAssignStmt ? stmt.getLeftOp() : undefined;

        const owner = this.stmtOwner.get(stmt);
        const callerMethodName = owner?.getName?.() || "<unknown>";
        const callerSignature = owner?.getSignature?.()?.toString?.() || "";
        const callerFilePath = this.extractFilePathFromSignature(callerSignature);
        const callerClassText = owner?.getDeclaringArkClass?.()?.getName?.() || callerSignature;

        return {
            stmt,
            invokeExpr,
            signature,
            methodName,
            calleeSignature: signature,
            calleeMethodName: methodName,
            calleeFilePath: this.extractFilePathFromSignature(signature),
            calleeClassText: invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || signature,
            calleeClassName: invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.getClassName?.() || "",
            baseValue,
            resultValue,
            args,
            invokeKind: invokeExpr instanceof ArkInstanceInvokeExpr ? "instance" : "static",
            callerMethodName,
            callerSignature,
            callerFilePath,
            callerClassText,
        };
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

    private elapsedMsSince(t0: bigint): number {
        const dtNs = process.hrtime.bigint() - t0;
        return Number(dtNs) / 1_000_000;
    }

    private collectBucketCandidatesForSite(site: InvokeSite): RuntimeRule[] {
        const out: RuntimeRule[] = [];
        const seen = new Set<RuntimeRule>();
        this.appendRuntimeRules(out, seen, this.ruleBuckets.universal);
        this.appendRuntimeRulesByKey(out, seen, this.ruleBuckets.methodNameEquals, site.methodName);
        this.appendRuntimeRulesByKey(out, seen, this.ruleBuckets.signatureEquals, site.signature);
        this.appendRuntimeRulesByKey(out, seen, this.ruleBuckets.calleeSignatureEquals, site.calleeSignature);
        this.appendRuntimeRulesByKey(out, seen, this.ruleBuckets.declaringClassEquals, site.calleeClassText);
        this.appendRuntimeRulesByKey(out, seen, this.ruleBuckets.declaringClassEquals, site.calleeClassName);
        return out;
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
            || kind === "callee_signature_equals"
            || kind === "declaring_class_equals";
    }

    private hasConstrainedSignals(rule: TransferRule): boolean {
        if (rule.invokeKind && rule.invokeKind !== "any") return true;
        if (rule.argCount !== undefined) return true;
        if (rule.typeHint && rule.typeHint.trim().length > 0) return true;
        if (rule.scope) {
            if (rule.scope.file || rule.scope.module || rule.scope.className || rule.scope.methodName) {
                return true;
            }
        }
        return false;
    }

    private matchesRuleStatic(runtimeRule: RuntimeRule, site: InvokeSite): boolean {
        const rule = runtimeRule.rule;
        if (!this.matchesInvokeShape(rule, site)) return false;
        if (!this.matchesScope(rule.scope, site)) return false;

        const value = rule.match.value || "";
        switch (rule.match.kind) {
            case "signature_contains":
                return site.signature.includes(value);
            case "signature_equals":
                return this.exactTextMatch(
                    site.signature,
                    runtimeRule.exactSignatureMatch,
                    runtimeRule.normalizedMatchValue
                );
            case "signature_regex":
                return runtimeRule.matchRegex ? runtimeRule.matchRegex.test(site.signature) : false;
            case "callee_signature_equals":
                return this.exactTextMatch(
                    site.calleeSignature,
                    runtimeRule.exactCalleeSignatureMatch,
                    runtimeRule.normalizedMatchValue
                );
            case "declaring_class_equals": {
                if (runtimeRule.exactDeclaringClassMatch) {
                    if (site.calleeClassText === runtimeRule.exactDeclaringClassMatch) return true;
                    if (site.calleeClassName === runtimeRule.exactDeclaringClassMatch) return true;
                }
                const normalized = runtimeRule.normalizedMatchValue || "";
                return this.normalizeForExactMatch(site.calleeClassText) === normalized
                    || this.normalizeForExactMatch(site.calleeClassName) === normalized;
            }
            case "method_name_equals":
                return site.methodName === value;
            case "method_name_regex":
                return runtimeRule.matchRegex ? runtimeRule.matchRegex.test(site.methodName) : false;
            case "local_name_regex":
                return true;
            default:
                return false;
        }
    }

    private matchesLocalNameRegexRule(runtimeRule: RuntimeRule, site: InvokeSite, fact: TaintFact): boolean {
        if (!runtimeRule.matchRegex) return false;
        const factValue = fact.node.getValue();
        if (factValue instanceof Local && runtimeRule.matchRegex.test(factValue.getName())) {
            return true;
        }
        const fromDescriptor = this.resolveFromDescriptor(runtimeRule.rule);
        const endpointValues = this.resolveEndpointValues(fromDescriptor.endpoint, site);
        for (const endpointValue of endpointValues) {
            if (endpointValue instanceof Local && runtimeRule.matchRegex.test(endpointValue.getName())) {
                return true;
            }
        }
        return false;
    }

    private matchesInvokeShape(rule: TransferRule, site: InvokeSite): boolean {
        if (rule.invokeKind && rule.invokeKind !== "any" && rule.invokeKind !== site.invokeKind) {
            return false;
        }
        if (rule.argCount !== undefined && rule.argCount !== site.args.length) {
            return false;
        }
        if (rule.typeHint && rule.typeHint.trim().length > 0) {
            const hint = rule.typeHint.trim().toLowerCase();
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
        if (!this.matchStringConstraint(scope.file, site.calleeFilePath)) return false;
        if (!this.matchStringConstraint(scope.module, site.calleeSignature || site.calleeFilePath)) return false;
        if (!this.matchStringConstraint(scope.className, site.calleeClassText)) return false;
        if (!this.matchStringConstraint(scope.methodName, site.calleeMethodName)) return false;
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

    private resolveFromDescriptor(rule: TransferRule): EndpointDescriptor {
        return {
            endpoint: rule.fromRef?.endpoint || rule.from,
            path: rule.fromRef?.path,
        };
    }

    private resolveToDescriptor(rule: TransferRule): EndpointDescriptor {
        return {
            endpoint: rule.toRef?.endpoint || rule.to,
            path: rule.toRef?.path,
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

        if (descriptor.path && descriptor.path.length > 0) {
            for (const endpointValue of endpointValues) {
                const objectIds = this.resolveObjectIdsFromValue(endpointValue, pag);
                for (const objId of objectIds) {
                    if (objId === fact.node.getID() && this.samePath(fact.field, descriptor.path)) return true;
                    if (tracker?.isTaintedAnyContext(objId, descriptor.path)) return true;
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

        if (descriptor.path && descriptor.path.length > 0) {
            for (const endpointValue of endpointValues) {
                const objectIds = this.resolveObjectIdsFromValue(endpointValue, pag);
                for (const objId of objectIds) {
                    const objNode = pag.getNode(objId) as PagNode;
                    addFact(new TaintFact(objNode, source, contextID, [...descriptor.path]));
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
            calleeSignatureEquals: new Map(),
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

            if (kind === "callee_signature_equals") {
                const key = this.normalizeForExactMatch(
                    runtimeRule.exactCalleeSignatureMatch || runtimeRule.normalizedMatchValue || runtimeRule.rule.match.value || ""
                );
                if (!key) {
                    buckets.universal.push(runtimeRule);
                    continue;
                }
                this.addRuleToBucket(buckets.calleeSignatureEquals, key, runtimeRule);
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
}
