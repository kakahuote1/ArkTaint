import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagInstanceFieldNode, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkInvokeStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { TaintTracker } from "../TaintTracker";
import { TaintFlow } from "../TaintFlow";
import {
    RuleEndpoint,
    RuleInvokeKind,
    RuleScopeConstraint,
    RuleStringConstraint,
    SanitizerRule
} from "../rules/RuleSchema";

export interface SinkDetectOptions {
    targetEndpoint?: RuleEndpoint;
    targetPath?: string[];
    invokeKind?: RuleInvokeKind;
    argCount?: number;
    typeHint?: string;
    signatureMatchMode?: "contains" | "equals";
    fieldToVarIndex?: Map<string, Set<number>>;
    allowedMethodSignatures?: Set<string>;
    sanitizerRules?: SanitizerRule[];
    onProfile?: (profile: SinkDetectProfile) => void;
}

interface SinkCandidate {
    value: any;
    kind: "arg" | "base" | "result";
    endpoint: string;
}

interface FieldPathDetectResult {
    source: string;
    nodeId?: number;
    fieldPath?: string[];
}

interface IndexedInvokeSite {
    method: any;
    stmt: any;
    invokeExpr: any;
    calleeSignature: string;
}

interface SinkCallsiteIndex {
    methodCount: number;
    reachableMethodCount: number;
    stmtCount: number;
    invokeStmtCount: number;
    sites: IndexedInvokeSite[];
    signatureMatchCache: Map<string, IndexedInvokeSite[]>;
}

const sinkCallsiteIndexCache: WeakMap<Scene, Map<string, SinkCallsiteIndex>> = new WeakMap();

export interface SinkDetectProfile {
    detectCallCount: number;
    methodsVisited: number;
    reachableMethodsVisited: number;
    stmtsVisited: number;
    invokeStmtsVisited: number;
    signatureMatchedInvokeCount: number;
    constraintRejectedInvokeCount: number;
    sinksChecked: number;
    candidateCount: number;
    taintCheckCount: number;
    cfgGuardCheckCount: number;
    cfgGuardSkipCount: number;
    defReachabilityCheckCount: number;
    fieldPathCheckCount: number;
    fieldPathHitCount: number;
    sanitizerGuardCheckCount: number;
    sanitizerGuardHitCount: number;
    signatureMatchMs: number;
    candidateResolveMs: number;
    cfgGuardMs: number;
    taintEvalMs: number;
    sanitizerGuardMs: number;
    traversalMs: number;
    totalMs: number;
}

export function createEmptySinkDetectProfile(): SinkDetectProfile {
    return {
        detectCallCount: 0,
        methodsVisited: 0,
        reachableMethodsVisited: 0,
        stmtsVisited: 0,
        invokeStmtsVisited: 0,
        signatureMatchedInvokeCount: 0,
        constraintRejectedInvokeCount: 0,
        sinksChecked: 0,
        candidateCount: 0,
        taintCheckCount: 0,
        cfgGuardCheckCount: 0,
        cfgGuardSkipCount: 0,
        defReachabilityCheckCount: 0,
        fieldPathCheckCount: 0,
        fieldPathHitCount: 0,
        sanitizerGuardCheckCount: 0,
        sanitizerGuardHitCount: 0,
        signatureMatchMs: 0,
        candidateResolveMs: 0,
        cfgGuardMs: 0,
        taintEvalMs: 0,
        sanitizerGuardMs: 0,
        traversalMs: 0,
        totalMs: 0,
    };
}

export function mergeSinkDetectProfiles(base: SinkDetectProfile, extra: SinkDetectProfile): SinkDetectProfile {
    return {
        detectCallCount: base.detectCallCount + extra.detectCallCount,
        methodsVisited: base.methodsVisited + extra.methodsVisited,
        reachableMethodsVisited: base.reachableMethodsVisited + extra.reachableMethodsVisited,
        stmtsVisited: base.stmtsVisited + extra.stmtsVisited,
        invokeStmtsVisited: base.invokeStmtsVisited + extra.invokeStmtsVisited,
        signatureMatchedInvokeCount: base.signatureMatchedInvokeCount + extra.signatureMatchedInvokeCount,
        constraintRejectedInvokeCount: base.constraintRejectedInvokeCount + extra.constraintRejectedInvokeCount,
        sinksChecked: base.sinksChecked + extra.sinksChecked,
        candidateCount: base.candidateCount + extra.candidateCount,
        taintCheckCount: base.taintCheckCount + extra.taintCheckCount,
        cfgGuardCheckCount: base.cfgGuardCheckCount + extra.cfgGuardCheckCount,
        cfgGuardSkipCount: base.cfgGuardSkipCount + extra.cfgGuardSkipCount,
        defReachabilityCheckCount: base.defReachabilityCheckCount + extra.defReachabilityCheckCount,
        fieldPathCheckCount: base.fieldPathCheckCount + extra.fieldPathCheckCount,
        fieldPathHitCount: base.fieldPathHitCount + extra.fieldPathHitCount,
        sanitizerGuardCheckCount: base.sanitizerGuardCheckCount + extra.sanitizerGuardCheckCount,
        sanitizerGuardHitCount: base.sanitizerGuardHitCount + extra.sanitizerGuardHitCount,
        signatureMatchMs: base.signatureMatchMs + extra.signatureMatchMs,
        candidateResolveMs: base.candidateResolveMs + extra.candidateResolveMs,
        cfgGuardMs: base.cfgGuardMs + extra.cfgGuardMs,
        taintEvalMs: base.taintEvalMs + extra.taintEvalMs,
        sanitizerGuardMs: base.sanitizerGuardMs + extra.sanitizerGuardMs,
        traversalMs: base.traversalMs + extra.traversalMs,
        totalMs: base.totalMs + extra.totalMs,
    };
}

export function detectSinks(
    scene: Scene,
    cg: CallGraph,
    pag: Pag,
    tracker: TaintTracker,
    sinkSignature: string,
    log: (msg: string) => void,
    options: SinkDetectOptions = {}
): TaintFlow[] {
    const detectStart = process.hrtime.bigint();
    const profile = createEmptySinkDetectProfile();
    profile.detectCallCount = 1;
    const flows: TaintFlow[] = [];
    if (!cg) {
        profile.totalMs = elapsedMsSince(detectStart);
        options.onProfile?.(profile);
        return flows;
    }
    const fieldToVarIndex = options.targetPath && options.targetPath.length > 0
        ? (options.fieldToVarIndex || buildFieldToVarIndexFromPag(pag))
        : undefined;
    let fallbackFieldToVarIndex: Map<string, Set<number>> | undefined;

    log(`\n=== Detecting sinks for: "${sinkSignature}" ===`);
    let sinksChecked = 0;

    const index = getOrBuildSinkCallsiteIndex(scene, options.allowedMethodSignatures);
    profile.methodsVisited += index.methodCount;
    profile.reachableMethodsVisited += index.reachableMethodCount;
    profile.stmtsVisited += index.stmtCount;
    profile.invokeStmtsVisited += index.invokeStmtCount;
    const matchedSites = getOrBuildSignatureMatchedSites(index, sinkSignature, options.signatureMatchMode || "contains");
    profile.signatureMatchedInvokeCount += matchedSites.length;

    for (const site of matchedSites) {
        const method = site.method;
        const stmt = site.stmt;
        const invokeExpr = site.invokeExpr;
        const calleeSignature = site.calleeSignature;
        log(`Checking method "${method.getName()}" for sinks...`);

        const constraintT0 = process.hrtime.bigint();
        if (!matchesInvokeConstraints(invokeExpr, calleeSignature, options)) {
            profile.signatureMatchMs += elapsedMsSince(constraintT0);
            profile.constraintRejectedInvokeCount++;
            continue;
        }
        profile.signatureMatchMs += elapsedMsSince(constraintT0);

        sinksChecked++;
        profile.sinksChecked++;
        log(`  Found sink call: ${calleeSignature}`);

        const resolveT0 = process.hrtime.bigint();
        const candidates = resolveSinkCandidates(stmt, invokeExpr, options.targetEndpoint);
        profile.candidateResolveMs += elapsedMsSince(resolveT0);
        if (candidates.length === 0) {
            continue;
        }
        profile.candidateCount += candidates.length;
        let sinkDetected = false;
        for (const candidate of candidates) {
            if (options.targetPath && options.targetPath.length > 0 && fieldToVarIndex) {
                profile.fieldPathCheckCount++;
                const fieldPathT0 = process.hrtime.bigint();
                const fieldPathResult = detectFieldPathSource(candidate.value, options.targetPath, pag, tracker, fieldToVarIndex);
                profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                if (fieldPathResult) {
                    profile.sanitizerGuardCheckCount++;
                    const sanitizerT0 = process.hrtime.bigint();
                    const sanitizerResult = isSinkCandidateSanitizedByRules(
                        method,
                        stmt,
                        candidate,
                        options.sanitizerRules || [],
                        log
                    );
                    profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                    if (sanitizerResult.sanitized) {
                        profile.sanitizerGuardHitCount++;
                        continue;
                    }
                    profile.fieldPathHitCount++;
                    log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (field path: ${options.targetPath.join(".")}) ***`);
                    flows.push(new TaintFlow(fieldPathResult.source, stmt, {
                        sinkEndpoint: candidate.endpoint,
                        sinkNodeId: fieldPathResult.nodeId,
                        sinkFieldPath: fieldPathResult.fieldPath,
                    }));
                    sinkDetected = true;
                    break;
                }
                continue;
            }

            const pagLookupT0 = process.hrtime.bigint();
            const pagNodes = pag.getNodesByValue(candidate.value);
            profile.taintEvalMs += elapsedMsSince(pagLookupT0);
            if (!pagNodes || pagNodes.size === 0) {
                if (candidate.value instanceof Local) {
                    const declStmt = candidate.value.getDeclaringStmt?.();
                    if (declStmt instanceof ArkAssignStmt && declStmt.getLeftOp() === candidate.value) {
                        const rightOp = declStmt.getRightOp();
                        if (rightOp instanceof ArkInstanceFieldRef) {
                            const fieldName = rightOp.getFieldSignature().getFieldName();
                            if (!fallbackFieldToVarIndex) {
                                fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
                            }
                            const fieldPathT0 = process.hrtime.bigint();
                            const fieldPathResult = detectFieldPathSource(
                                rightOp,
                                [fieldName],
                                pag,
                                tracker,
                                fallbackFieldToVarIndex
                            );
                            profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                            if (fieldPathResult) {
                                profile.sanitizerGuardCheckCount++;
                                const sanitizerT0 = process.hrtime.bigint();
                                const sanitizerResult = isSinkCandidateSanitizedByRules(
                                    method,
                                    stmt,
                                    candidate,
                                    options.sanitizerRules || [],
                                    log
                                );
                                profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                                if (sanitizerResult.sanitized) {
                                    profile.sanitizerGuardHitCount++;
                                    continue;
                                }
                                log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (local-from-field fallback: ${fieldName}) ***`);
                                flows.push(new TaintFlow(fieldPathResult.source, stmt, {
                                    sinkEndpoint: candidate.endpoint,
                                    sinkNodeId: fieldPathResult.nodeId,
                                    sinkFieldPath: fieldPathResult.fieldPath,
                                }));
                                sinkDetected = true;
                                break;
                            }
                        }
                    }
                }
                if (candidate.value instanceof ArkInstanceFieldRef) {
                    const fieldName = candidate.value.getFieldSignature().getFieldName();
                    if (!fallbackFieldToVarIndex) {
                        fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
                    }
                    const fieldPathT0 = process.hrtime.bigint();
                    const fieldPathResult = detectFieldPathSource(
                        candidate.value,
                        [fieldName],
                        pag,
                        tracker,
                        fallbackFieldToVarIndex
                    );
                    profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                    if (fieldPathResult) {
                        profile.sanitizerGuardCheckCount++;
                        const sanitizerT0 = process.hrtime.bigint();
                        const sanitizerResult = isSinkCandidateSanitizedByRules(
                            method,
                            stmt,
                            candidate,
                            options.sanitizerRules || [],
                            log
                        );
                        profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                        if (sanitizerResult.sanitized) {
                            profile.sanitizerGuardHitCount++;
                            continue;
                        }
                        log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (field fallback: ${fieldName}) ***`);
                        flows.push(new TaintFlow(fieldPathResult.source, stmt, {
                            sinkEndpoint: candidate.endpoint,
                            sinkNodeId: fieldPathResult.nodeId,
                            sinkFieldPath: fieldPathResult.fieldPath,
                        }));
                        sinkDetected = true;
                        break;
                    }
                }
                continue;
            }

            for (const nodeId of pagNodes.values()) {
                profile.taintCheckCount++;
                const taintCheckT0 = process.hrtime.bigint();
                const isTainted = tracker.isTaintedAnyContext(nodeId);
                profile.taintEvalMs += elapsedMsSince(taintCheckT0);
                log(`    Checking ${candidate.endpoint}, node ${nodeId}, tainted: ${isTainted}`);
                if (!isTainted) continue;

                const source = tracker.getSourceAnyContext(nodeId)!;
                profile.sanitizerGuardCheckCount++;
                const sanitizerT0 = process.hrtime.bigint();
                const sanitizerResult = isSinkCandidateSanitizedByRules(
                    method,
                    stmt,
                    candidate,
                    options.sanitizerRules || [],
                    log
                );
                profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                if (sanitizerResult.sanitized) {
                    profile.sanitizerGuardHitCount++;
                    continue;
                }
                log(`    *** TAINT FLOW DETECTED! Source: ${source} ***`);
                flows.push(new TaintFlow(source, stmt, {
                    sinkEndpoint: candidate.endpoint,
                    sinkNodeId: nodeId,
                }));
                sinkDetected = true;
                break;
            }
            if (!sinkDetected && candidate.value instanceof ArkInstanceFieldRef) {
                const fieldName = candidate.value.getFieldSignature().getFieldName();
                if (!fallbackFieldToVarIndex) {
                    fallbackFieldToVarIndex = buildFieldToVarIndexFromPag(pag);
                }
                const fieldPathT0 = process.hrtime.bigint();
                const fieldPathResult = detectFieldPathSource(
                    candidate.value,
                    [fieldName],
                    pag,
                    tracker,
                    fallbackFieldToVarIndex
                );
                profile.taintEvalMs += elapsedMsSince(fieldPathT0);
                if (fieldPathResult) {
                    profile.sanitizerGuardCheckCount++;
                    const sanitizerT0 = process.hrtime.bigint();
                    const sanitizerResult = isSinkCandidateSanitizedByRules(
                        method,
                        stmt,
                        candidate,
                        options.sanitizerRules || [],
                        log
                    );
                    profile.sanitizerGuardMs += elapsedMsSince(sanitizerT0);
                    if (sanitizerResult.sanitized) {
                        profile.sanitizerGuardHitCount++;
                        continue;
                    }
                    log(`    *** TAINT FLOW DETECTED! Source: ${fieldPathResult.source} (field fallback: ${fieldName}) ***`);
                    flows.push(new TaintFlow(fieldPathResult.source, stmt, {
                        sinkEndpoint: candidate.endpoint,
                        sinkNodeId: fieldPathResult.nodeId,
                        sinkFieldPath: fieldPathResult.fieldPath,
                    }));
                    sinkDetected = true;
                }
            }
            if (sinkDetected) break;
        }
    }

    profile.totalMs = elapsedMsSince(detectStart);
    const profiledDetailMs = profile.signatureMatchMs
        + profile.candidateResolveMs
        + profile.cfgGuardMs
        + profile.taintEvalMs
        + profile.sanitizerGuardMs;
    profile.traversalMs = Math.max(0, profile.totalMs - profiledDetailMs);
    options.onProfile?.(profile);
    log(`Checked ${sinksChecked} sink call(s), found ${flows.length} flow(s)`);
    return flows;
}

function elapsedMsSince(t0: bigint): number {
    return Number(process.hrtime.bigint() - t0) / 1_000_000;
}

function getOrBuildSinkCallsiteIndex(scene: Scene, allowedMethodSignatures?: Set<string>): SinkCallsiteIndex {
    const key = buildAllowedMethodSignatureKey(allowedMethodSignatures);
    let byKey = sinkCallsiteIndexCache.get(scene);
    if (!byKey) {
        byKey = new Map<string, SinkCallsiteIndex>();
        sinkCallsiteIndexCache.set(scene, byKey);
    }
    const cached = byKey.get(key);
    if (cached) {
        return cached;
    }

    let methodCount = 0;
    let reachableMethodCount = 0;
    let stmtCount = 0;
    let invokeStmtCount = 0;
    const sites: IndexedInvokeSite[] = [];
    for (const method of scene.getMethods()) {
        methodCount++;
        const methodSignature = method.getSignature().toString();
        if (allowedMethodSignatures && allowedMethodSignatures.size > 0 && !allowedMethodSignatures.has(methodSignature)) {
            continue;
        }
        const cfg = method.getCfg();
        if (!cfg) continue;
        reachableMethodCount++;
        for (const stmt of cfg.getStmts()) {
            stmtCount++;
            if (!stmt.containsInvokeExpr()) continue;
            invokeStmtCount++;
            const invokeExpr = stmt.getInvokeExpr();
            if (!invokeExpr) continue;
            const calleeSignature = invokeExpr.getMethodSignature().toString();
            sites.push({
                method,
                stmt,
                invokeExpr,
                calleeSignature,
            });
        }
    }

    const built: SinkCallsiteIndex = {
        methodCount,
        reachableMethodCount,
        stmtCount,
        invokeStmtCount,
        sites,
        signatureMatchCache: new Map<string, IndexedInvokeSite[]>(),
    };
    byKey.set(key, built);
    return built;
}

function getOrBuildSignatureMatchedSites(
    index: SinkCallsiteIndex,
    sinkSignature: string,
    mode: "contains" | "equals"
): IndexedInvokeSite[] {
    const cacheKey = `${mode}|${sinkSignature}`;
    const cached = index.signatureMatchCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const matched = index.sites.filter(site => {
        if (mode === "equals") {
            return site.calleeSignature === sinkSignature;
        }
        return site.calleeSignature.includes(sinkSignature);
    });
    index.signatureMatchCache.set(cacheKey, matched);
    return matched;
}

function buildAllowedMethodSignatureKey(allowedMethodSignatures?: Set<string>): string {
    if (!allowedMethodSignatures || allowedMethodSignatures.size === 0) return "__all__";
    return [...allowedMethodSignatures].sort().join("||");
}

function resolveSinkCandidates(
    stmt: any,
    invokeExpr: any,
    targetEndpoint?: RuleEndpoint
): SinkCandidate[] {
    if (!targetEndpoint) {
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        return args.map((arg: any, idx: number) => ({
            value: arg,
            kind: "arg" as const,
            endpoint: `arg${idx}`,
        }));
    }

    if (targetEndpoint === "base") {
        if (invokeExpr instanceof ArkInstanceInvokeExpr) {
            return [{
                value: invokeExpr.getBase(),
                kind: "base",
                endpoint: "base",
            }];
        }
        return [];
    }

    if (targetEndpoint === "result") {
        if (stmt instanceof ArkAssignStmt) {
            return [{
                value: stmt.getLeftOp(),
                kind: "result",
                endpoint: "result",
            }];
        }
        return [];
    }

    const m = /^arg(\d+)$/.exec(targetEndpoint);
    if (!m) return [];
    const argIndex = Number(m[1]);
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (!Number.isFinite(argIndex) || argIndex < 0 || argIndex >= args.length) return [];

    return [{
        value: args[argIndex],
        kind: "arg",
        endpoint: `arg${argIndex}`,
    }];
}

function matchesInvokeConstraints(
    invokeExpr: any,
    calleeSignature: string,
    options: SinkDetectOptions
): boolean {
    if (options.invokeKind && options.invokeKind !== "any") {
        const actualKind: RuleInvokeKind = invokeExpr instanceof ArkInstanceInvokeExpr ? "instance" : "static";
        if (actualKind !== options.invokeKind) {
            return false;
        }
    }

    if (options.argCount !== undefined) {
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length !== options.argCount) {
            return false;
        }
    }

    if (options.typeHint && options.typeHint.trim().length > 0) {
        const hint = options.typeHint.trim().toLowerCase();
        const declaringClass = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
        const baseText = invokeExpr instanceof ArkInstanceInvokeExpr ? (invokeExpr.getBase()?.toString?.() || "") : "";
        const ptrText = invokeExpr instanceof ArkPtrInvokeExpr ? (invokeExpr.toString?.() || "") : "";
        const haystack = `${calleeSignature} ${declaringClass} ${baseText} ${ptrText}`.toLowerCase();
        if (!haystack.includes(hint)) {
            return false;
        }
    }

    return true;
}

function isSinkCandidateSanitizedByRules(
    method: any,
    sinkStmt: any,
    candidate: SinkCandidate,
    sanitizerRules: SanitizerRule[],
    log: (msg: string) => void
): { sanitized: boolean; ruleId?: string } {
    if (!sanitizerRules || sanitizerRules.length === 0) {
        return { sanitized: false };
    }
    const cfg = method.getCfg();
    if (!cfg) return { sanitized: false };
    const stmts = cfg.getStmts();
    const sinkIndex = stmts.indexOf(sinkStmt);
    if (sinkIndex <= 0) return { sanitized: false };

    const candidateValue = candidate.value;
    if (!candidateValue) return { sanitized: false };

    for (let i = 0; i < sinkIndex; i++) {
        const stmt = stmts[i];
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!invokeExpr) continue;
        const calleeSignature = invokeExpr.getMethodSignature()?.toString?.() || "";
        if (!calleeSignature) continue;

        for (const rule of sanitizerRules) {
            if (!matchesScope(method, rule.scope)) continue;
            if (!matchesSanitizerRule(rule, stmt, invokeExpr, calleeSignature)) continue;
            const targetEndpoint = rule.sanitizeTargetRef?.endpoint || rule.sanitizeTarget || "result";
            if (rule.sanitizeTargetRef?.path && rule.sanitizeTargetRef.path.length > 0) continue;
            const targetValue = resolveInvokeEndpointValue(stmt, invokeExpr, targetEndpoint);
            if (!targetValue) continue;
            if (!sameValueLike(candidateValue, targetValue)) continue;
            if (
                targetValue instanceof Local
                && hasLocalReassignmentBetween(stmts, targetValue.getName(), i, sinkIndex)
            ) {
                continue;
            }
            log(`    [Sanitizer-Guard] skip sink by '${rule.id}' on endpoint '${targetEndpoint}'.`);
            return { sanitized: true, ruleId: rule.id };
        }
    }

    return { sanitized: false };
}

function hasLocalReassignmentBetween(
    stmts: any[],
    localName: string,
    fromIndexInclusive: number,
    toIndexExclusive: number
): boolean {
    for (let i = fromIndexInclusive + 1; i < toIndexExclusive; i++) {
        const stmt = stmts[i];
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        if (left.getName() === localName) {
            return true;
        }
    }
    return false;
}

function resolveInvokeEndpointValue(stmt: any, invokeExpr: any, endpoint: RuleEndpoint): any | undefined {
    if (endpoint === "result") {
        if (stmt instanceof ArkAssignStmt) {
            return stmt.getLeftOp();
        }
        return undefined;
    }
    if (endpoint === "base") {
        if (invokeExpr instanceof ArkInstanceInvokeExpr) {
            return invokeExpr.getBase();
        }
        return undefined;
    }
    const m = /^arg(\d+)$/.exec(endpoint);
    if (!m) return undefined;
    const idx = Number(m[1]);
    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (!Number.isFinite(idx) || idx < 0 || idx >= args.length) return undefined;
    return args[idx];
}

function sameValueLike(a: any, b: any): boolean {
    if (a === b) return true;
    if (a instanceof Local && b instanceof Local) {
        return a.getName() === b.getName();
    }
    const aText = a?.toString?.();
    const bText = b?.toString?.();
    return typeof aText === "string" && aText.length > 0 && aText === bText;
}

function matchesSanitizerRule(
    rule: SanitizerRule,
    stmt: any,
    invokeExpr: any,
    calleeSignature: string
): boolean {
    if (rule.invokeKind && rule.invokeKind !== "any") {
        const actualKind: RuleInvokeKind = invokeExpr instanceof ArkInstanceInvokeExpr ? "instance" : "static";
        if (actualKind !== rule.invokeKind) return false;
    }
    if (rule.argCount !== undefined) {
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length !== rule.argCount) return false;
    }
    if (rule.typeHint && rule.typeHint.trim().length > 0) {
        const hint = rule.typeHint.trim().toLowerCase();
        const declaringClass = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
        const baseText = invokeExpr instanceof ArkInstanceInvokeExpr ? (invokeExpr.getBase()?.toString?.() || "") : "";
        const ptrText = invokeExpr instanceof ArkPtrInvokeExpr ? (invokeExpr.toString?.() || "") : "";
        const haystack = `${calleeSignature} ${declaringClass} ${baseText} ${ptrText}`.toLowerCase();
        if (!haystack.includes(hint)) return false;
    }

    const matchValue = rule.match.value || "";
    const methodName = invokeExpr.getMethodSignature?.().getMethodSubSignature?.().getMethodName?.()
        || extractMethodNameFromSignature(calleeSignature);
    switch (rule.match.kind) {
        case "signature_contains":
            return calleeSignature.includes(matchValue);
        case "signature_equals":
        case "callee_signature_equals":
            return exactTextMatch(calleeSignature, matchValue);
        case "signature_regex":
            try {
                return new RegExp(matchValue).test(calleeSignature);
            } catch {
                return false;
            }
        case "declaring_class_equals": {
            const classSignature = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
            const className = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.getClassName?.() || "";
            return exactDeclaringClassMatch(classSignature, className, matchValue);
        }
        case "method_name_equals":
            return methodName === matchValue;
        case "method_name_regex":
            try {
                return new RegExp(matchValue).test(methodName);
            } catch {
                return false;
            }
        case "local_name_regex": {
            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            const texts = args.map((arg: any) => arg?.toString?.() || "");
            if (invokeExpr instanceof ArkInstanceInvokeExpr) {
                texts.push(invokeExpr.getBase()?.toString?.() || "");
            }
            if (stmt instanceof ArkAssignStmt) {
                texts.push(stmt.getLeftOp()?.toString?.() || "");
            }
            try {
                const re = new RegExp(matchValue);
                return texts.some((t: string) => re.test(t));
            } catch {
                return false;
            }
        }
        default:
            return false;
    }
}

function extractMethodNameFromSignature(signature: string): string {
    const m = signature.match(/\.([A-Za-z0-9_$]+)\(/);
    return m ? m[1] : "";
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

function matchesScope(method: any, scope?: RuleScopeConstraint): boolean {
    if (!scope) return true;
    const sig = method.getSignature().toString();
    const filePath = extractFilePathFromSignature(sig);
    const classText = method.getDeclaringArkClass?.()?.getName?.() || sig;
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

function buildFieldToVarIndexFromPag(pag: Pag): Map<string, Set<number>> {
    const index: Map<string, Set<number>> = new Map();

    for (const node of pag.getNodesIter()) {
        if (!(node instanceof PagInstanceFieldNode)) continue;

        const fieldRef = node.getValue() as ArkInstanceFieldRef;
        const fieldName = fieldRef.getFieldSignature().getFieldName();
        const baseLocal = fieldRef.getBase();
        const baseNodesMap = pag.getNodesByValue(baseLocal);
        if (!baseNodesMap) continue;

        for (const baseNodeId of baseNodesMap.values()) {
            const baseNode = pag.getNode(baseNodeId) as PagNode;
            for (const objId of baseNode.getPointTo()) {
                const key = `${objId}-${fieldName}`;
                const loadEdges = node.getOutgoingLoadEdges();
                if (!loadEdges) continue;
                if (!index.has(key)) {
                    index.set(key, new Set<number>());
                }
                const bucket = index.get(key)!;
                for (const edge of loadEdges) {
                    bucket.add(edge.getDstID());
                }
            }
        }
    }

    return index;
}

function detectFieldPathSource(
    rootValue: any,
    fieldPath: string[],
    pag: Pag,
    tracker: TaintTracker,
    fieldToVarIndex: Map<string, Set<number>>
) : FieldPathDetectResult | undefined {
    if (fieldPath.length === 0) return undefined;

    const rootNodes = pag.getNodesByValue(rootValue);
    if (!rootNodes || rootNodes.size === 0) return undefined;

    const rootObjIds = new Set<number>();
    for (const rootNodeId of rootNodes.values()) {
        const rootNode = pag.getNode(rootNodeId) as PagNode;
        for (const objId of rootNode.getPointTo()) {
            rootObjIds.add(objId);
        }
    }
    if (rootObjIds.size === 0) return undefined;

    let frontierObjIds = rootObjIds;
    for (let i = 0; i < fieldPath.length; i++) {
        const fieldName = fieldPath[i];
        const isLast = i === fieldPath.length - 1;

        if (isLast) {
            for (const objId of frontierObjIds) {
                const directPathSource = tracker.getSourceAnyContext(objId, fieldPath);
                if (directPathSource) {
                    return {
                        source: directPathSource,
                        nodeId: objId,
                        fieldPath: [...fieldPath],
                    };
                }

                const source = tracker.getSourceAnyContext(objId, [fieldName]);
                if (source) {
                    return {
                        source,
                        nodeId: objId,
                        fieldPath: [fieldName],
                    };
                }

                const loadTargets = fieldToVarIndex.get(`${objId}-${fieldName}`);
                if (!loadTargets) continue;
                for (const loadNodeId of loadTargets.values()) {
                    const loadSource = tracker.getSourceAnyContext(loadNodeId);
                    if (loadSource) {
                        return {
                            source: loadSource,
                            nodeId: loadNodeId,
                        };
                    }
                }
            }
            return undefined;
        }

        const nextFrontier = new Set<number>();
        for (const objId of frontierObjIds) {
            const loadTargets = fieldToVarIndex.get(`${objId}-${fieldName}`);
            if (!loadTargets) continue;
            for (const loadNodeId of loadTargets.values()) {
                const loadNode = pag.getNode(loadNodeId) as PagNode;
                for (const nextObjId of loadNode.getPointTo()) {
                    nextFrontier.add(nextObjId);
                }
            }
        }

        if (nextFrontier.size === 0) {
            return undefined;
        }
        frontierObjIds = nextFrontier;
    }

    return undefined;
}

