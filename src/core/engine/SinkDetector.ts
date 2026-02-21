import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { CallGraph } from "../../../arkanalyzer/out/src/callgraph/model/CallGraph";
import { Pag, PagInstanceFieldNode, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt, ArkIfStmt, ArkInvokeStmt, ArkReturnVoidStmt, ArkThrowStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkNormalBinopExpr, ArkPtrInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { Constant } from "../../../arkanalyzer/out/src/core/base/Constant";
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

    log(`\n=== Detecting sinks for: "${sinkSignature}" ===`);
    let sinksChecked = 0;

    const index = getOrBuildSinkCallsiteIndex(scene, options.allowedMethodSignatures);
    profile.methodsVisited += index.methodCount;
    profile.reachableMethodsVisited += index.reachableMethodCount;
    profile.stmtsVisited += index.stmtCount;
    profile.invokeStmtsVisited += index.invokeStmtCount;
    const matchedSites = getOrBuildSignatureMatchedSites(index, sinkSignature);
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

        profile.cfgGuardCheckCount++;
        const cfgT0 = process.hrtime.bigint();
        if (shouldSkipSinkByControlFlow(method, stmt, scene, log)) {
            profile.cfgGuardMs += elapsedMsSince(cfgT0);
            profile.cfgGuardSkipCount++;
            log("    [Sink-SKIP] statically unreachable by control-flow guard.");
            continue;
        }
        profile.cfgGuardMs += elapsedMsSince(cfgT0);

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
                if (
                    candidate.kind === "arg" &&
                    candidate.value instanceof Local &&
                    isForEachCallbackParamLikelyTainted(scene, method, candidate.value, pag, tracker, log)
                ) {
                    const source = "entry_arg";
                    log(`    *** TAINT FLOW DETECTED! Source: ${source} (forEach callback heuristic) ***`);
                    flows.push(new TaintFlow(source, stmt, {
                        sinkEndpoint: candidate.endpoint,
                    }));
                    sinkDetected = true;
                    break;
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

                if (candidate.value instanceof Local) {
                    profile.defReachabilityCheckCount++;
                    const defReachT0 = process.hrtime.bigint();
                    const shouldSkip = shouldSkipLocalByUnreachableTaintDefs(method, stmt, candidate.value, log);
                    profile.cfgGuardMs += elapsedMsSince(defReachT0);
                    if (shouldSkip) {
                        continue;
                    }
                }

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

function getOrBuildSignatureMatchedSites(index: SinkCallsiteIndex, sinkSignature: string): IndexedInvokeSite[] {
    const cached = index.signatureMatchCache.get(sinkSignature);
    if (cached) {
        return cached;
    }
    const matched = index.sites.filter(site => site.calleeSignature.includes(sinkSignature));
    index.signatureMatchCache.set(sinkSignature, matched);
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
            return calleeSignature === matchValue;
        case "signature_regex":
            try {
                return new RegExp(matchValue).test(calleeSignature);
            } catch {
                return false;
            }
        case "declaring_class_equals": {
            const declaringClass = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.()?.toString?.() || "";
            return declaringClass === matchValue;
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

function shouldSkipSinkByControlFlow(method: any, sinkStmt: any, scene: Scene, log: (msg: string) => void): boolean {
    const cfg = method.getCfg();
    if (!cfg) return false;

    const stmtToBlock = cfg.getStmtToBlock();
    const sinkBlock = stmtToBlock.get(sinkStmt);
    if (!sinkBlock) return false;
    const sinkBlockStmts = sinkBlock.getStmts();
    const sinkIdx = sinkBlockStmts.indexOf(sinkStmt);

    if (sinkIdx >= 0) {
        for (let i = 0; i < sinkIdx; i++) {
            const s = sinkBlockStmts[i];
            if (s instanceof ArkThrowStmt || s instanceof ArkReturnVoidStmt) {
                return true;
            }
        }
    }

    for (const s of cfg.getStmts()) {
        if (!(s instanceof ArkIfStmt)) continue;
        const guard = parseSimpleEqGuard(s.toString());
        if (!guard) continue;
        if (!allCallsitesPassConstant(scene, method, guard.paramName, guard.literal)) continue;

        const condBlock = stmtToBlock.get(s);
        if (!condBlock) continue;
        const succs = condBlock.getSuccessors();
        if (succs.length !== 2) continue;

        const returnSucc = succs.find((b: any) => hasImmediateReturn(b));
        const otherSucc = succs.find((b: any) => b !== returnSucc);
        if (!returnSucc || !otherSucc) continue;

        const ifLine = s.getOriginPositionInfo?.().getLineNo?.() ?? -1;
        const sinkLine = sinkStmt.getOriginPositionInfo?.().getLineNo?.() ?? -1;
        const sinkLikelyOutsideIf = ifLine > 0 && sinkLine > ifLine + 1;

        if (sinkLikelyOutsideIf && blockCanReachStmt(otherSucc, sinkStmt, stmtToBlock)) {
            log(`    [Sink-Guard] all callsites satisfy '${guard.paramName} === ${guard.literal}'`);
            return true;
        }
    }

    return false;
}

function hasImmediateReturn(block: any): boolean {
    const stmts = block.getStmts();
    return stmts.length > 0 && stmts[0] instanceof ArkReturnVoidStmt;
}

function blockCanReachStmt(startBlock: any, targetStmt: any, stmtToBlock: Map<any, any>): boolean {
    const targetBlock = stmtToBlock.get(targetStmt);
    if (!targetBlock) return false;
    if (startBlock === targetBlock) return true;

    const q: any[] = [startBlock];
    const vis = new Set<any>();
    while (q.length > 0) {
        const b = q.shift();
        if (vis.has(b)) continue;
        vis.add(b);
        for (const succ of b.getSuccessors()) {
            if (succ === targetBlock) return true;
            if (!vis.has(succ)) q.push(succ);
        }
    }
    return false;
}

function parseSimpleEqGuard(text: string): { paramName: string; literal: string } | null {
    const m = text.match(/if\s+([A-Za-z_][A-Za-z0-9_]*)\s*===\s*('(?:[^']*)'|"(?:[^"]*)"|`(?:[^`]*)`|-?\d+)/);
    if (!m) return null;
    return { paramName: m[1], literal: normalizeLiteral(m[2]) };
}

function allCallsitesPassConstant(scene: Scene, method: any, paramName: string, literal: string): boolean {
    const paramIndex = resolveParamIndex(method, paramName);
    if (paramIndex < 0) return false;

    const sigText = method.getSignature().toString();
    let foundCallsite = false;

    for (const m of scene.getMethods()) {
        const cfg = m.getCfg();
        if (!cfg) continue;
        for (const s of cfg.getStmts()) {
            if (!(s instanceof ArkInvokeStmt) && !(s instanceof ArkAssignStmt)) continue;
            if (!s.containsInvokeExpr || !s.containsInvokeExpr()) continue;
            const ie = s.getInvokeExpr();
            if (!ie) continue;
            if (ie.getMethodSignature()?.toString() !== sigText) continue;
            const args = ie.getArgs ? ie.getArgs() : [];
            if (args.length <= paramIndex) continue;
            foundCallsite = true;
            const arg = args[paramIndex];
            if (!(arg instanceof Constant)) return false;
            if (normalizeLiteral(arg.toString()) !== literal) return false;
        }
    }

    return foundCallsite;
}

function resolveParamIndex(method: any, paramName: string): number {
    const cfg = method.getCfg();
    if (!cfg) return -1;
    for (const s of cfg.getStmts()) {
        if (!(s instanceof ArkAssignStmt)) continue;
        const right = s.getRightOp();
        const left = s.getLeftOp();
        if (!(right instanceof ArkParameterRef) || !(left instanceof Local)) continue;
        if (left.getName() !== paramName) continue;
        const text = right.toString();
        const m = text.match(/parameter(\d+)/);
        if (!m) return -1;
        return Number(m[1]);
    }
    return -1;
}

function normalizeLiteral(text: string): string {
    return text.replace(/^['"`]/, "").replace(/['"`]$/, "");
}

function isForEachCallbackParamLikelyTainted(
    scene: Scene,
    callbackMethod: any,
    argLocal: Local,
    pag: Pag,
    tracker: TaintTracker,
    log: (msg: string) => void
): boolean {
    const callbackParams = getParameterLocalNames(callbackMethod);
    if (!callbackParams.has(argLocal.getName())) return false;

    const callbackName = callbackMethod.getName();
    for (const method of scene.getMethods()) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        const paramLocals = getParameterLocalNames(method);

        for (const stmt of cfg.getStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            const sigText = invokeExpr.getMethodSignature()?.toString() || "";
            let methodName = invokeExpr.getMethodSignature()?.getMethodSubSignature()?.getMethodName() || "";
            if (!methodName) {
                const m = sigText.match(/\.([A-Za-z0-9_]+)\(\)/);
                methodName = m ? m[1] : "";
            }
            if (methodName !== "forEach") continue;

            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length === 0) continue;
            const callbackArgText = args[0]?.toString?.() || "";
            if (callbackArgText !== callbackName) continue;

            const base = invokeExpr.getBase();
            if (!(base instanceof Local)) continue;
            if (hasTaintLikeArrayStore(base, paramLocals, pag, tracker, new Set<Local>())) {
                log(`    [Sink-ForEach] callback '${callbackName}' receives tainted array elements.`);
                return true;
            }
        }
    }
    return false;
}

function hasTaintLikeArrayStore(
    base: Local,
    paramLocalNames: Set<string>,
    pag: Pag,
    tracker: TaintTracker,
    visiting: Set<Local>
): boolean {
    if (visiting.has(base)) return false;
    visiting.add(base);

    for (const stmt of base.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkArrayRef) || left.getBase() !== base) continue;
        if (!(right instanceof Local)) continue;
        if (isLikelyTaintingRHS(right, paramLocalNames) && isLocalAnyContextTainted(right, pag, tracker)) {
            visiting.delete(base);
            return true;
        }
    }

    const decl = base.getDeclaringStmt();
    if (decl instanceof ArkAssignStmt && decl.getLeftOp() === base) {
        const right = decl.getRightOp();
        if (right instanceof Local) {
            if (hasTaintLikeArrayStore(right, paramLocalNames, pag, tracker, visiting)) {
                visiting.delete(base);
                return true;
            }
        }
    }

    visiting.delete(base);
    return false;
}

function isLocalAnyContextTainted(local: Local, pag: Pag, tracker: TaintTracker): boolean {
    const nodes = pag.getNodesByValue(local);
    if (!nodes || nodes.size === 0) return false;
    for (const nodeId of nodes.values()) {
        if (tracker.isTaintedAnyContext(nodeId)) return true;
    }
    return false;
}

function getParameterLocalNames(method: any): Set<string> {
    const names = new Set<string>();
    const cfg = method.getCfg();
    if (!cfg) return names;
    for (const s of cfg.getStmts()) {
        if (!(s instanceof ArkAssignStmt)) continue;
        if (!(s.getRightOp() instanceof ArkParameterRef)) continue;
        const left = s.getLeftOp();
        if (left instanceof Local) names.add(left.getName());
    }
    return names;
}

function shouldSkipLocalByUnreachableTaintDefs(method: any, sinkStmt: any, localArg: Local, log: (msg: string) => void): boolean {
    const cfg = method.getCfg();
    if (!cfg) return false;

    const allStmts = cfg.getStmts();
    const stmtToBlock = cfg.getStmtToBlock();
    const sinkBlock = stmtToBlock.get(sinkStmt);
    if (!sinkBlock) return false;
    const sinkIdx = sinkBlock.getStmts().indexOf(sinkStmt);
    if (sinkIdx < 0) return false;

    const constIfSummaries = collectConstantIfBranchSummaries(cfg, stmtToBlock);
    const stmtIndex = new Map<any, number>();
    for (let i = 0; i < allStmts.length; i++) {
        stmtIndex.set(allStmts[i], i);
    }

    const paramLocalNames = getParameterLocalNames(method);
    let taintingDefCount = 0;
    let reachableTaintingDefCount = 0;

    for (const s of allStmts) {
        if (!(s instanceof ArkAssignStmt)) continue;
        const left = s.getLeftOp();
        if (!(left instanceof Local) || left.getName() !== localArg.getName()) continue;

        const right = s.getRightOp();
        if (!isLikelyTaintingRHS(right, paramLocalNames)) continue;
        taintingDefCount++;

        const defBlock = stmtToBlock.get(s);
        if (!defBlock) continue;

        let reachable = false;
        if (defBlock === sinkBlock) {
            const defIdx = defBlock.getStmts().indexOf(s);
            if (defIdx >= 0 && defIdx < sinkIdx) {
                reachable = true;
            } else if (defIdx > sinkIdx && canReachSinkViaLoopBackedge(defBlock, sinkIdx)) {
                reachable = true;
            }
        } else {
            reachable = blockCanReachStmt(defBlock, sinkStmt, stmtToBlock);
        }

        if (reachable) {
            const defOrder = stmtIndex.get(s) ?? -1;
            if (isStaticallyUnreachableByConstantBranch(defBlock, defOrder, constIfSummaries)) {
                reachable = false;
            }
        }
        if (reachable) reachableTaintingDefCount++;
    }

    if (taintingDefCount > 0 && reachableTaintingDefCount === 0) {
        log(`    [Arg-SKIP] local '${localArg.getName()}' only has non-reaching taint-defs before sink.`);
        return true;
    }
    return false;
}

interface ConstantIfBranchSummary {
    ifIndex: number;
    expectedBranch: "true" | "false";
    trueSucc: any;
    falseSucc: any;
}

function collectConstantIfBranchSummaries(cfg: any, stmtToBlock: Map<any, any>): ConstantIfBranchSummary[] {
    const summaries: ConstantIfBranchSummary[] = [];
    const constEnv = new Map<string, string>();
    const stmts = cfg.getStmts();

    for (let i = 0; i < stmts.length; i++) {
        const s = stmts[i];
        if (s instanceof ArkAssignStmt) {
            updateConstEnvByAssign(s, constEnv);
            continue;
        }
        if (!(s instanceof ArkIfStmt)) continue;

        const cond = evaluateIfConditionWithEnv(s.toString(), constEnv);
        if (cond === null) continue;

        const branches = inferIfTrueFalseSuccessors(cfg, stmtToBlock, s, i);
        if (!branches) continue;
        summaries.push({
            ifIndex: i,
            expectedBranch: cond ? "true" : "false",
            trueSucc: branches.trueSucc,
            falseSucc: branches.falseSucc,
        });
    }

    return summaries;
}

function isStaticallyUnreachableByConstantBranch(
    defBlock: any,
    defOrder: number,
    summaries: ConstantIfBranchSummary[]
): boolean {
    if (defOrder < 0) return false;

    for (const summary of summaries) {
        if (summary.ifIndex >= defOrder) continue;
        const fromTrue = blockCanReachBlock(summary.trueSucc, defBlock);
        const fromFalse = blockCanReachBlock(summary.falseSucc, defBlock);
        if (fromTrue === fromFalse) continue;

        if (summary.expectedBranch === "true" && !fromTrue && fromFalse) {
            return true;
        }
        if (summary.expectedBranch === "false" && fromTrue && !fromFalse) {
            return true;
        }
    }

    return false;
}

function inferIfTrueFalseSuccessors(
    cfg: any,
    stmtToBlock: Map<any, any>,
    ifStmt: any,
    ifIndex: number
): { trueSucc: any; falseSucc: any } | null {
    const condBlock = stmtToBlock.get(ifStmt);
    if (!condBlock) return null;
    const succs = condBlock.getSuccessors ? condBlock.getSuccessors() : [];
    if (!succs || succs.length !== 2) return null;

    const stmts = cfg.getStmts();
    const nextStmt = ifIndex + 1 < stmts.length ? stmts[ifIndex + 1] : null;
    if (!nextStmt) return null;

    const s0IsTrue = blockCanReachStmt(succs[0], nextStmt, stmtToBlock);
    const s1IsTrue = blockCanReachStmt(succs[1], nextStmt, stmtToBlock);
    if (s0IsTrue === s1IsTrue) return null;

    if (s0IsTrue) {
        return { trueSucc: succs[0], falseSucc: succs[1] };
    }
    return { trueSucc: succs[1], falseSucc: succs[0] };
}

function updateConstEnvByAssign(stmt: ArkAssignStmt, env: Map<string, string>): void {
    const left = stmt.getLeftOp();
    if (!(left instanceof Local)) return;

    const right = stmt.getRightOp();
    const value = resolveConstValue(right, env);
    if (value === null) {
        env.delete(left.getName());
        return;
    }
    env.set(left.getName(), value);
}

function resolveConstValue(value: any, env: Map<string, string>): string | null {
    if (value instanceof Constant) {
        return normalizeLiteral(value.toString());
    }
    if (value instanceof Local) {
        return env.get(value.getName()) ?? null;
    }
    if (value instanceof ArkNormalBinopExpr) {
        const left = resolveConstValue(value.getOp1(), env);
        const right = resolveConstValue(value.getOp2(), env);
        if (left === null || right === null) return null;
        const l = Number(left);
        const r = Number(right);
        if (!Number.isFinite(l) || !Number.isFinite(r)) return null;
        const op = value.getOperator();
        if (op === "+") return String(l + r);
        if (op === "-") return String(l - r);
        if (op === "*") return String(l * r);
        if (op === "/" && r !== 0) return String(l / r);
        return null;
    }
    return null;
}

function evaluateIfConditionWithEnv(text: string, env: Map<string, string>): boolean | null {
    const trimmed = text.trim().replace(/^if\s+/, "");
    const m = trimmed.match(/^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
    if (!m) return null;

    const left = resolveOperandLiteral(m[1], env);
    const right = resolveOperandLiteral(m[3], env);
    if (left === null || right === null) return null;

    const op = m[2];
    const lNum = Number(left);
    const rNum = Number(right);
    const bothNumeric = Number.isFinite(lNum) && Number.isFinite(rNum);

    if (bothNumeric) {
        if (op === "==") return lNum === rNum;
        if (op === "!=") return lNum !== rNum;
        if (op === "<") return lNum < rNum;
        if (op === "<=") return lNum <= rNum;
        if (op === ">") return lNum > rNum;
        if (op === ">=") return lNum >= rNum;
        return null;
    }

    if (op === "==") return left === right;
    if (op === "!=") return left !== right;
    return null;
}

function resolveOperandLiteral(tokenRaw: string, env: Map<string, string>): string | null {
    const token = tokenRaw.trim();
    if (!token) return null;

    if (/^[-+]?\d+(\.\d+)?$/.test(token)) return token;
    if (token === "true" || token === "false") return token;
    if ((token.startsWith("'") && token.endsWith("'")) ||
        (token.startsWith("\"") && token.endsWith("\"")) ||
        (token.startsWith("`") && token.endsWith("`"))) {
        return normalizeLiteral(token);
    }

    return env.get(token) ?? null;
}

function canReachSinkViaLoopBackedge(loopBodyBlock: any, sinkIdx: number): boolean {
    const succs = loopBodyBlock.getSuccessors ? loopBodyBlock.getSuccessors() : [];
    for (const succ of succs) {
        if (!blockCanReachBlock(succ, loopBodyBlock)) continue;

        const condLocalNames = collectIfConditionLocalNames(succ);
        if (condLocalNames.size === 0) continue;
        if (hasConditionLocalAssignmentAfterIndex(loopBodyBlock, sinkIdx, condLocalNames)) continue;
        return true;
    }
    return false;
}

function blockCanReachBlock(startBlock: any, targetBlock: any): boolean {
    if (startBlock === targetBlock) return true;
    const q: any[] = [startBlock];
    const vis = new Set<any>();
    while (q.length > 0) {
        const b = q.shift();
        if (vis.has(b)) continue;
        vis.add(b);
        for (const succ of b.getSuccessors()) {
            if (succ === targetBlock) return true;
            if (!vis.has(succ)) q.push(succ);
        }
    }
    return false;
}

function collectIfConditionLocalNames(block: any): Set<string> {
    const names = new Set<string>();
    const stmts = block.getStmts ? block.getStmts() : [];
    for (const s of stmts) {
        if (!(s instanceof ArkIfStmt)) continue;
        const uses = s.getUses ? s.getUses() : [];
        for (const u of uses) {
            if (u instanceof Local) names.add(u.getName());
        }
        break;
    }
    return names;
}

function hasConditionLocalAssignmentAfterIndex(block: any, idx: number, localNames: Set<string>): boolean {
    const stmts = block.getStmts ? block.getStmts() : [];
    for (let i = idx + 1; i < stmts.length; i++) {
        const s = stmts[i];
        if (!(s instanceof ArkAssignStmt)) continue;
        const left = s.getLeftOp();
        if (left instanceof Local && localNames.has(left.getName())) {
            return true;
        }
    }
    return false;
}

function isLikelyTaintingRHS(rhs: any, paramLocalNames: Set<string>): boolean {
    if (rhs instanceof Local) {
        return paramLocalNames.has(rhs.getName()) || rhs.getName().includes("taint");
    }
    if (rhs instanceof Constant) {
        return false;
    }
    const text = rhs?.toString?.() || "";
    return text.includes("taint");
}
