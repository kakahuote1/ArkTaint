import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import {
    ArkAwaitExpr,
    ArkCastExpr,
    ArkDeleteExpr,
    ArkInstanceInvokeExpr,
    ArkNewArrayExpr,
    ArkNewExpr,
    ArkPhiExpr,
} from "../../../../arkanalyzer/out/src/core/base/Expr";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";

const MAX_ALIAS_RESOLUTION_DEPTH = 8;
const defaultDirectAliasLocalCache: WeakMap<Pag, Map<number, Local[]>> = new WeakMap();
const directAliasLocalCacheByClassIndex: WeakMap<Pag, WeakMap<Map<string, any>, Map<number, Local[]>>> = new WeakMap();
const directAliasCandidateIndexCache: WeakMap<Pag, Map<number, Local[]>> = new WeakMap();
const aliasLocalsForCarrierCacheByClassIndex: WeakMap<Pag, WeakMap<Map<string, any>, Map<number, Local[]>>> = new WeakMap();
const capturedFieldLoadCandidateIndexByClassIndex: WeakMap<Pag, WeakMap<Map<string, any>, CapturedFieldLoadCandidateIndex>> = new WeakMap();
const hasAnonymousObjectLiteralClassCache: WeakMap<Map<string, any>, boolean> = new WeakMap();
const defaultCarrierResolutionCache: WeakMap<Pag, WeakMap<object, WeakMap<object, number[]>>> = new WeakMap();
const carrierResolutionCacheByClassIndex: WeakMap<Pag, WeakMap<Map<string, any>, WeakMap<object, WeakMap<object, number[]>>>> = new WeakMap();

interface CapturedFieldLoadCandidate {
    value: Local;
    declStmt: ArkAssignStmt;
}

interface CapturedFieldLoadCandidateIndex {
    byCapturedLocalName: Map<string, CapturedFieldLoadCandidate[]>;
}

export function isCarrierAliasNode(aliasNode: PagNode, carrierNodeId: number): boolean {
    if (aliasNode.getID() === carrierNodeId) return true;
    const pts = aliasNode.getPointTo();
    return !!(pts && pts.contains(carrierNodeId));
}

export function collectAliasLocalsForCarrier(
    pag: Pag,
    carrierNodeId: number,
    classBySignature?: Map<string, any>,
): Local[] {
    const fullCache = resolveAliasLocalsForCarrierCache(pag, classBySignature);
    if (fullCache?.has(carrierNodeId)) {
        return fullCache.get(carrierNodeId)!;
    }

    const results: Local[] = [];
    fullCache?.set(carrierNodeId, results);

    const directAliasLocals = collectDirectAliasLocalsForCarrier(pag, carrierNodeId, classBySignature);
    results.push(...directAliasLocals);
    const seen = new Set<string>(
        directAliasLocals.map(value => `${value.getName?.() || ""}#${value.getDeclaringStmt?.()?.toString?.() || ""}`),
    );
    const methodLocalIndex = new Map<string, Map<string, Local[]>>();

    if (!classBySignature || directAliasLocals.length === 0) {
        fullCache?.set(carrierNodeId, results);
        return results;
    }
    if (!hasAnonymousObjectLiteralClasses(classBySignature)) {
        fullCache?.set(carrierNodeId, results);
        return results;
    }

    const directAliasLocalNames = new Set<string>();
    for (const local of directAliasLocals) {
        const name = local.getName?.() || "";
        if (!name) continue;
        directAliasLocalNames.add(name);
    }

    const capturedCandidateIndex = getCapturedFieldLoadCandidateIndex(pag, classBySignature);
    const candidateSeen = new Set<string>();
    for (const directAliasName of directAliasLocalNames) {
        const candidates = capturedCandidateIndex.byCapturedLocalName.get(directAliasName) || [];
        for (const candidate of candidates) {
            const candidateValue = candidate.value;
            const declStmt = candidate.declStmt;
            const key = localIdentityKey(candidateValue);
            if (candidateSeen.has(key)) continue;
            candidateSeen.add(key);
            if (seen.has(key)) continue;

            const carrierIds = collectCarrierNodeIdsForValueAtStmt(
                pag,
                candidateValue,
                declStmt,
                classBySignature,
                methodLocalIndex,
            );
            if (!carrierIds.includes(carrierNodeId)) continue;

            seen.add(key);
            results.push(candidateValue);
        }
    }

    fullCache?.set(carrierNodeId, results);
    return results;
}

function resolveAliasLocalsForCarrierCache(
    pag: Pag,
    classBySignature?: Map<string, any>,
): Map<number, Local[]> | undefined {
    if (!classBySignature) {
        return undefined;
    }
    let byClassIndex = aliasLocalsForCarrierCacheByClassIndex.get(pag);
    if (!byClassIndex) {
        byClassIndex = new WeakMap<Map<string, any>, Map<number, Local[]>>();
        aliasLocalsForCarrierCacheByClassIndex.set(pag, byClassIndex);
    }
    let byCarrier = byClassIndex.get(classBySignature);
    if (!byCarrier) {
        byCarrier = new Map<number, Local[]>();
        byClassIndex.set(classBySignature, byCarrier);
    }
    return byCarrier;
}

function collectDirectAliasLocalsForCarrier(
    pag: Pag,
    carrierNodeId: number,
    classBySignature?: Map<string, any>,
): Local[] {
    const byCarrier = resolveDirectAliasLocalCache(pag, classBySignature);
    if (byCarrier.has(carrierNodeId)) {
        return byCarrier.get(carrierNodeId)!;
    }

    const results: Local[] = [];
    byCarrier.set(carrierNodeId, results);
    const seen = new Set<string>();
    const methodLocalIndex = new Map<string, Map<string, Local[]>>();
    const candidates = getDirectAliasCandidateIndex(pag).get(carrierNodeId) || [];
    for (const value of candidates) {
        const anchorStmt = value.getDeclaringStmt?.();
        if (anchorStmt) {
            const resolvedCarrierIds = collectCarrierNodeIdsForValueAtStmt(
                pag,
                value,
                anchorStmt,
                classBySignature,
                methodLocalIndex,
            );
            if (resolvedCarrierIds.length > 0 && !resolvedCarrierIds.includes(carrierNodeId)) {
                continue;
            }
        }

        const key = localIdentityKey(value);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(value);
    }

    return results;
}

function resolveDirectAliasLocalCache(
    pag: Pag,
    classBySignature?: Map<string, any>,
): Map<number, Local[]> {
    if (!classBySignature) {
        let cache = defaultDirectAliasLocalCache.get(pag);
        if (!cache) {
            cache = new Map<number, Local[]>();
            defaultDirectAliasLocalCache.set(pag, cache);
        }
        return cache;
    }
    let byClassIndex = directAliasLocalCacheByClassIndex.get(pag);
    if (!byClassIndex) {
        byClassIndex = new WeakMap<Map<string, any>, Map<number, Local[]>>();
        directAliasLocalCacheByClassIndex.set(pag, byClassIndex);
    }
    let cache = byClassIndex.get(classBySignature);
    if (!cache) {
        cache = new Map<number, Local[]>();
        byClassIndex.set(classBySignature, cache);
    }
    return cache;
}

function getDirectAliasCandidateIndex(pag: Pag): Map<number, Local[]> {
    const cached = directAliasCandidateIndexCache.get(pag);
    if (cached) {
        return cached;
    }
    const index = new Map<number, Local[]>();
    const seenByCarrier = new Map<number, Set<string>>();
    for (const rawNode of pag.getNodesIter()) {
        const aliasNode = rawNode as PagNode;
        const value = aliasNode.getValue?.();
        if (!(value instanceof Local)) continue;
        addDirectAliasCandidate(index, seenByCarrier, aliasNode.getID(), value);
        for (const objId of aliasNode.getPointTo()) {
            addDirectAliasCandidate(index, seenByCarrier, objId, value);
        }
    }
    directAliasCandidateIndexCache.set(pag, index);
    return index;
}

function getCapturedFieldLoadCandidateIndex(
    pag: Pag,
    classBySignature: Map<string, any>,
): CapturedFieldLoadCandidateIndex {
    let byClassIndex = capturedFieldLoadCandidateIndexByClassIndex.get(pag);
    if (!byClassIndex) {
        byClassIndex = new WeakMap<Map<string, any>, CapturedFieldLoadCandidateIndex>();
        capturedFieldLoadCandidateIndexByClassIndex.set(pag, byClassIndex);
    }
    const cached = byClassIndex.get(classBySignature);
    if (cached) {
        return cached;
    }

    const index: CapturedFieldLoadCandidateIndex = {
        byCapturedLocalName: new Map<string, CapturedFieldLoadCandidate[]>(),
    };
    const seenByCapturedName = new Map<string, Set<string>>();
    for (const rawNode of pag.getNodesIter()) {
        const candidateNode = rawNode as PagNode;
        const candidateValue = candidateNode.getValue?.();
        if (!(candidateValue instanceof Local)) continue;

        const declStmt = candidateValue.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== candidateValue) continue;
        const rhs = declStmt.getRightOp();
        if (!(rhs instanceof ArkInstanceFieldRef)) continue;
        const base = rhs.getBase?.();
        if (!(base instanceof Local)) continue;

        const baseClassSig = resolveValueClassSignatureAtStmt(base, declStmt, 0, new Set<string>());
        if (!baseClassSig) continue;
        const arkClass = classBySignature.get(baseClassSig);
        if (!arkClass) continue;

        const fieldName = rhs.getFieldSignature?.().getFieldName?.() || rhs.getFieldName?.();
        if (!fieldName) continue;
        const capturedLocalNames = resolveCapturedLocalNamesForField(arkClass, fieldName);
        if (capturedLocalNames.length === 0) continue;

        for (const capturedLocalName of capturedLocalNames) {
            addCapturedFieldLoadCandidate(index, seenByCapturedName, capturedLocalName, {
                value: candidateValue,
                declStmt,
            });
        }
    }
    byClassIndex.set(classBySignature, index);
    return index;
}

function addCapturedFieldLoadCandidate(
    index: CapturedFieldLoadCandidateIndex,
    seenByCapturedName: Map<string, Set<string>>,
    capturedLocalName: string,
    candidate: CapturedFieldLoadCandidate,
): void {
    const key = localIdentityKey(candidate.value);
    let seen = seenByCapturedName.get(capturedLocalName);
    if (!seen) {
        seen = new Set<string>();
        seenByCapturedName.set(capturedLocalName, seen);
    }
    if (seen.has(key)) return;
    seen.add(key);
    let candidates = index.byCapturedLocalName.get(capturedLocalName);
    if (!candidates) {
        candidates = [];
        index.byCapturedLocalName.set(capturedLocalName, candidates);
    }
    candidates.push(candidate);
}

function addDirectAliasCandidate(
    index: Map<number, Local[]>,
    seenByCarrier: Map<number, Set<string>>,
    carrierNodeId: number,
    value: Local,
): void {
    const key = localIdentityKey(value);
    let seen = seenByCarrier.get(carrierNodeId);
    if (!seen) {
        seen = new Set<string>();
        seenByCarrier.set(carrierNodeId, seen);
    }
    if (seen.has(key)) return;
    seen.add(key);
    let values = index.get(carrierNodeId);
    if (!values) {
        values = [];
        index.set(carrierNodeId, values);
    }
    values.push(value);
}

function hasAnonymousObjectLiteralClasses(classBySignature: Map<string, any>): boolean {
    const cached = hasAnonymousObjectLiteralClassCache.get(classBySignature);
    if (cached !== undefined) {
        return cached;
    }
    const hasAnonymous = [...classBySignature.keys()].some(signature => signature.includes("%AC"));
    hasAnonymousObjectLiteralClassCache.set(classBySignature, hasAnonymous);
    return hasAnonymous;
}

export function collectCarrierNodeIdsForValueAtStmt(
    pag: Pag,
    value: any,
    anchorStmt: any,
    classBySignature?: Map<string, any>,
    methodLocalIndexCache?: Map<string, Map<string, Local[]>>,
): number[] {
    const cache = resolveCarrierResolutionCache(pag, classBySignature, value, anchorStmt);
    const cached = cache?.get(anchorStmt)?.get(value);
    if (cached) {
        return [...cached];
    }
    const out = resolveCarrierNodeIdsForValueAtStmt(
        pag,
        value,
        anchorStmt,
        classBySignature,
        methodLocalIndexCache,
        0,
        new Set<string>(),
    );
    const deduped = [...new Set(out)];
    if (cache) {
        let byValue = cache.get(anchorStmt);
        if (!byValue) {
            byValue = new WeakMap<object, number[]>();
            cache.set(anchorStmt, byValue);
        }
        byValue.set(value, deduped);
    }
    return deduped;
}

function resolveCarrierResolutionCache(
    pag: Pag,
    classBySignature: Map<string, any> | undefined,
    value: any,
    anchorStmt: any,
): WeakMap<object, WeakMap<object, number[]>> | undefined {
    if (!isWeakMapKey(value) || !isWeakMapKey(anchorStmt)) {
        return undefined;
    }
    if (!classBySignature) {
        let cache = defaultCarrierResolutionCache.get(pag);
        if (!cache) {
            cache = new WeakMap<object, WeakMap<object, number[]>>();
            defaultCarrierResolutionCache.set(pag, cache);
        }
        return cache;
    }
    let byClassIndex = carrierResolutionCacheByClassIndex.get(pag);
    if (!byClassIndex) {
        byClassIndex = new WeakMap<Map<string, any>, WeakMap<object, WeakMap<object, number[]>>>();
        carrierResolutionCacheByClassIndex.set(pag, byClassIndex);
    }
    let cache = byClassIndex.get(classBySignature);
    if (!cache) {
        cache = new WeakMap<object, WeakMap<object, number[]>>();
        byClassIndex.set(classBySignature, cache);
    }
    return cache;
}

function resolveCarrierNodeIdsForValueAtStmt(
    pag: Pag,
    value: any,
    anchorStmt: any,
    classBySignature: Map<string, any> | undefined,
    methodLocalIndexCache: Map<string, Map<string, Local[]>> | undefined,
    depth: number,
    visiting: Set<string>,
): number[] {
    if (depth > MAX_ALIAS_RESOLUTION_DEPTH) {
        return fallbackCarrierNodeIds(pag, value, anchorStmt);
    }

    if (!(value instanceof Local)) {
        return fallbackCarrierNodeIds(pag, value, anchorStmt);
    }

    const methodSig = resolveDeclaringMethodSignature(value) || resolveDeclaringMethodSignatureFromStmt(anchorStmt) || "";
    const visitKey = `${methodSig}::${value.getName?.() || ""}@${depth}`;
    if (visiting.has(visitKey)) {
        return fallbackCarrierNodeIds(pag, value, anchorStmt);
    }
    visiting.add(visitKey);

    const latestAssign = findLatestAssignStmtForLocalBefore(value, anchorStmt);
    if (!latestAssign) {
        return fallbackCarrierNodeIds(pag, value, anchorStmt);
    }

    const rhs = latestAssign.getRightOp();
    if (rhs instanceof ArkNewExpr || rhs instanceof ArkNewArrayExpr) {
        const exactAllocIds = collectExactCarrierNodeIdsFromValue(pag, rhs, latestAssign);
        if (exactAllocIds.length > 0) {
            return exactAllocIds;
        }
    }

    if (rhs instanceof Local) {
        return resolveCarrierNodeIdsForValueAtStmt(
            pag,
            rhs,
            anchorStmt,
            classBySignature,
            methodLocalIndexCache,
            depth + 1,
            visiting,
        );
    }

    if (rhs instanceof ArkCastExpr) {
        return resolveCarrierNodeIdsForValueAtStmt(
            pag,
            rhs.getOp?.(),
            anchorStmt,
            classBySignature,
            methodLocalIndexCache,
            depth + 1,
            visiting,
        );
    }

    if (rhs instanceof ArkAwaitExpr) {
        return resolveCarrierNodeIdsForValueAtStmt(
            pag,
            rhs.getPromise?.(),
            anchorStmt,
            classBySignature,
            methodLocalIndexCache,
            depth + 1,
            visiting,
        );
    }

    if (rhs instanceof ArkPhiExpr) {
        return fallbackCarrierNodeIds(pag, value, anchorStmt);
    }

    if (rhs instanceof ArkInstanceInvokeExpr && isSelfConstructorInvoke(rhs, value)) {
        const previousAssign = findLatestAssignStmtForLocalStrictlyBefore(value, latestAssign);
        if (!previousAssign) {
            return fallbackCarrierNodeIds(pag, value, anchorStmt);
        }
        const previousRhs = previousAssign.getRightOp();
        if (previousRhs instanceof ArkNewExpr || previousRhs instanceof ArkNewArrayExpr) {
            const exactAllocIds = collectExactCarrierNodeIdsFromValue(pag, previousRhs, previousAssign);
            if (exactAllocIds.length > 0) {
                return exactAllocIds;
            }
        }
        return resolveCarrierNodeIdsForValueAtStmt(
            pag,
            value,
            previousAssign,
            classBySignature,
            methodLocalIndexCache,
            depth + 1,
            visiting,
        );
    }

    if (rhs instanceof ArkInstanceFieldRef) {
        const loadedCarrierIds = resolveCarrierNodeIdsFromFieldLoad(
            pag,
            rhs,
            latestAssign,
            classBySignature,
            methodLocalIndexCache,
            depth + 1,
            visiting,
        );
        if (loadedCarrierIds === null) {
            return [];
        }
        if (loadedCarrierIds.length > 0) {
            return loadedCarrierIds;
        }
    }

    if (rhs instanceof ArkInstanceFieldRef && classBySignature) {
        const capturedCarrierIds = resolveCapturedCarrierNodeIdsFromObjectLiteralField(
            pag,
            rhs,
            anchorStmt,
            classBySignature,
            methodLocalIndexCache,
            depth + 1,
            visiting,
        );
        if (capturedCarrierIds.length > 0) {
            return capturedCarrierIds;
        }
    }

    return fallbackCarrierNodeIds(pag, value, anchorStmt);
}

function resolveCarrierNodeIdsFromFieldLoad(
    pag: Pag,
    fieldRef: ArkInstanceFieldRef,
    anchorStmt: any,
    classBySignature: Map<string, any> | undefined,
    methodLocalIndexCache: Map<string, Map<string, Local[]>> | undefined,
    depth: number,
    visiting: Set<string>,
): number[] | null {
    const base = fieldRef.getBase?.();
    if (!(base instanceof Local)) return [];

    const fieldName = fieldRef.getFieldSignature?.().getFieldName?.() || fieldRef.getFieldName?.();
    if (!fieldName) return [];

    const baseCarrierIds = resolveCarrierNodeIdsForValueAtStmt(
        pag,
        base,
        anchorStmt,
        classBySignature,
        methodLocalIndexCache,
        depth + 1,
        visiting,
    );
    if (baseCarrierIds.length === 0) return [];

    const resolved: number[] = [];
    let invalidated = false;
    for (const carrierNodeId of baseCarrierIds) {
        const latestStore = findLatestCarrierFieldStoreBefore(
            pag,
            carrierNodeId,
            fieldName,
            anchorStmt,
            classBySignature,
        );
        if (latestStore === null) {
            invalidated = true;
            continue;
        }
        if (!latestStore) continue;
        resolved.push(...resolveCarrierNodeIdsForValueAtStmt(
            pag,
            latestStore.getRightOp(),
            latestStore,
            classBySignature,
            methodLocalIndexCache,
            depth + 1,
            visiting,
        ));
    }

    if (resolved.length === 0 && invalidated) {
        return null;
    }
    return [...new Set(resolved)];
}

function resolveCapturedCarrierNodeIdsFromObjectLiteralField(
    pag: Pag,
    fieldRef: ArkInstanceFieldRef,
    anchorStmt: any,
    classBySignature: Map<string, any>,
    methodLocalIndexCache: Map<string, Map<string, Local[]>> | undefined,
    depth: number,
    visiting: Set<string>,
): number[] {
    const base = fieldRef.getBase?.();
    if (!(base instanceof Local)) return [];

    const baseClassSig = resolveValueClassSignatureAtStmt(base, anchorStmt, depth + 1, new Set<string>());
    if (!baseClassSig) return [];
    const arkClass = classBySignature.get(baseClassSig);
    if (!arkClass) return [];

    const fieldName = fieldRef.getFieldSignature?.().getFieldName?.() || fieldRef.getFieldName?.();
    if (!fieldName) return [];

    const capturedLocalNames = resolveCapturedLocalNamesForField(arkClass, fieldName);
    if (capturedLocalNames.length === 0) return [];

    const methodSig = resolveDeclaringMethodSignature(base);
    if (!methodSig) return [];

    const localIndex = ensureMethodLocalIndex(methodLocalIndexCache, pag, methodSig);
    const out: number[] = [];
    for (const capturedLocalName of capturedLocalNames) {
        const candidateLocals = localIndex.get(capturedLocalName) || [];
        for (const candidateLocal of candidateLocals) {
            out.push(...resolveCarrierNodeIdsForValueAtStmt(
                pag,
                candidateLocal,
                anchorStmt,
                classBySignature,
                methodLocalIndexCache,
                depth + 1,
                visiting,
            ));
        }
    }

    return [...new Set(out)];
}

function fallbackCarrierNodeIds(
    pag: Pag,
    value: any,
    anchorStmt: any,
): number[] {
    const nodes = safeGetOrCreatePagNodes(pag, value, anchorStmt);
    if (!nodes || nodes.size === 0) return [];
    const out: number[] = [];
    const seen = new Set<number>();
    for (const nodeId of nodes.values()) {
        const node = pag.getNode(nodeId) as PagNode;
        if (!node) continue;
        let hasPointTo = false;
        for (const objId of node.getPointTo()) {
            hasPointTo = true;
            if (seen.has(objId)) continue;
            seen.add(objId);
            out.push(objId);
        }
        if (!hasPointTo && !seen.has(nodeId)) {
            seen.add(nodeId);
            out.push(nodeId);
        }
    }
    return out;
}

function collectExactCarrierNodeIdsFromValue(
    pag: Pag,
    value: any,
    anchorStmt: any,
): number[] {
    const nodes = safeGetOrCreatePagNodes(pag, value, anchorStmt);
    if (!nodes || nodes.size === 0) return [];
    const out: number[] = [];
    const seen = new Set<number>();
    for (const nodeId of nodes.values()) {
        if (seen.has(nodeId)) continue;
        seen.add(nodeId);
        out.push(nodeId);
    }
    return out;
}

function findLatestCarrierFieldStoreBefore(
    pag: Pag,
    carrierNodeId: number,
    fieldName: string,
    anchorStmt: any,
    classBySignature?: Map<string, any>,
): ArkAssignStmt | null | undefined {
    const cfg = anchorStmt?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;

    const order = new Map<any, number>();
    let anchorIndex = -1;
    let index = 0;
    for (const stmt of stmts) {
        order.set(stmt, index);
        if (stmt === anchorStmt) {
            anchorIndex = index;
        }
        index++;
    }
    if (anchorIndex < 0) return undefined;

    let latest: ArkAssignStmt | undefined;
    let latestIndex = -1;
    let latestWasDelete = false;
    for (const aliasLocal of collectAliasLocalsForCarrier(pag, carrierNodeId, classBySignature)) {
        const aliasCfg = aliasLocal.getDeclaringStmt?.()?.getCfg?.();
        if (aliasCfg !== cfg) continue;
        for (const stmt of aliasCfg.getStmts()) {
            const stmtIndex = order.get(stmt);
            if (stmtIndex === undefined || stmtIndex >= anchorIndex || stmtIndex <= latestIndex) continue;
            if (!(stmt instanceof ArkAssignStmt)) continue;

            const right = stmt.getRightOp();
            if (right instanceof ArkDeleteExpr) {
                const deletedField = right.getField?.();
                if (!(deletedField instanceof ArkInstanceFieldRef)) continue;
                if (!isSameLocal(deletedField.getBase(), aliasLocal)) continue;
                const deletedFieldName = deletedField.getFieldSignature?.().getFieldName?.() || deletedField.getFieldName?.();
                if (deletedFieldName !== fieldName) continue;
                latest = undefined;
                latestIndex = stmtIndex;
                latestWasDelete = true;
                continue;
            }

            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            if (!isSameLocal(left.getBase(), aliasLocal)) continue;
            const candidateField = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.();
            if (candidateField !== fieldName) continue;
            latest = stmt;
            latestIndex = stmtIndex;
            latestWasDelete = false;
        }
    }

    if (latestWasDelete) {
        return null;
    }
    return latest;
}

function findLatestAssignStmtForLocalBefore(local: Local, anchorStmt: any): ArkAssignStmt | undefined {
    const cfg = anchorStmt?.getCfg?.() || local.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;

    let latest: ArkAssignStmt | undefined;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) {
            if (stmt instanceof ArkAssignStmt && isSameLocal(stmt.getLeftOp(), local)) {
                latest = stmt;
            }
            break;
        }
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!isSameLocal(stmt.getLeftOp(), local)) continue;
        latest = stmt;
    }
    return latest;
}

function findLatestAssignStmtForLocalStrictlyBefore(local: Local, anchorStmt: any): ArkAssignStmt | undefined {
    const cfg = anchorStmt?.getCfg?.() || local.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;

    let latest: ArkAssignStmt | undefined;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) {
            break;
        }
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!isSameLocal(stmt.getLeftOp(), local)) continue;
        latest = stmt;
    }
    return latest;
}

function isSelfConstructorInvoke(invokeExpr: ArkInstanceInvokeExpr, local: Local): boolean {
    const base = invokeExpr.getBase?.();
    if (!isSameLocal(base, local)) return false;
    const methodName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    return methodName === "constructor";
}

function ensureMethodLocalIndex(
    cache: Map<string, Map<string, Local[]>> | undefined,
    pag: Pag,
    methodSig: string,
): Map<string, Local[]> {
    if (!cache) {
        return buildMethodLocalIndex(pag, methodSig);
    }
    const existing = cache.get(methodSig);
    if (existing) return existing;
    const built = buildMethodLocalIndex(pag, methodSig);
    cache.set(methodSig, built);
    return built;
}

function buildMethodLocalIndex(
    pag: Pag,
    methodSig: string,
): Map<string, Local[]> {
    const out = new Map<string, Local[]>();
    const seen = new Set<string>();
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const value = node.getValue?.();
        if (!(value instanceof Local)) continue;
        if (resolveDeclaringMethodSignature(value) !== methodSig) continue;
        const name = value.getName?.() || "";
        if (!name) continue;
        const key = `${name}#${value.getDeclaringStmt?.()?.toString?.() || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!out.has(name)) out.set(name, []);
        out.get(name)!.push(value);
    }
    return out;
}

function resolveCapturedLocalNamesForField(arkClass: any, fieldName: string): string[] {
    const out: string[] = [];
    const fields = arkClass?.getFields?.() || [];
    for (const field of fields) {
        const candidateName = field?.getSignature?.()?.getFieldName?.() || field?.getName?.();
        if (candidateName !== fieldName) continue;
        const initializer = field?.getInitializer?.();
        const rhsLocalName = normalizeCapturedLocalFromInitializer(initializer);
        if (rhsLocalName) {
            out.push(rhsLocalName);
            continue;
        }
        const initializerText = String(initializer?.toString?.() || "").trim();
        if (!initializerText) {
            out.push(fieldName);
            continue;
        }
        const normalized = normalizeCapturedLocalToken(extractInitializerRhsText(initializerText));
        if (normalized) {
            out.push(normalized);
        }
    }
    return [...new Set(out)];
}

function normalizeCapturedLocalFromInitializer(initializer: any): string | undefined {
    if (!(initializer instanceof ArkAssignStmt)) return undefined;
    const right = initializer.getRightOp?.();
    if (right instanceof Local) {
        return right.getName?.() || undefined;
    }
    return normalizeCapturedLocalToken(extractInitializerRhsText(String(initializer.toString?.() || "")));
}

function normalizeCapturedLocalToken(text: string): string | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    if (/^['"`].*['"`]$/.test(trimmed)) return undefined;
    return /^[%A-Za-z_$][%A-Za-z0-9_$]*$/.test(trimmed) ? trimmed : undefined;
}

function extractInitializerRhsText(text: string): string {
    const parts = text.split("=");
    return parts.length >= 2 ? parts.slice(1).join("=").trim() : text.trim();
}

function resolveDeclaringMethodSignature(local: Local): string | undefined {
    return safeMethodSignatureKey(local.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.());
}

function resolveDeclaringMethodSignatureFromStmt(stmt: any): string | undefined {
    return safeMethodSignatureKey(stmt?.getCfg?.()?.getDeclaringMethod?.());
}

function resolveLocalClassSignature(local: Local): string | undefined {
    const typeAny = local.getType?.() as any;
    const classSig = typeAny?.getClassSignature?.();
    const text = safeSignatureLikeText(classSig) || "";
    return text || undefined;
}

function resolveValueClassSignatureAtStmt(
    value: any,
    anchorStmt: any,
    depth: number,
    visiting: Set<string>,
): string | undefined {
    if (depth > MAX_ALIAS_RESOLUTION_DEPTH) return undefined;
    const direct = resolveClassSignatureFromValue(value);
    if (direct) return direct;

    if (!(value instanceof Local)) return undefined;

    const methodSig = resolveDeclaringMethodSignature(value) || resolveDeclaringMethodSignatureFromStmt(anchorStmt) || "";
    const visitKey = `${methodSig}::${value.getName?.() || ""}@class`;
    if (visiting.has(visitKey)) return undefined;
    visiting.add(visitKey);

    const latestAssign = findLatestAssignStmtForLocalBefore(value, anchorStmt);
    if (!latestAssign) return undefined;
    return resolveValueClassSignatureAtStmt(latestAssign.getRightOp(), latestAssign, depth + 1, visiting);
}

function resolveClassSignatureFromValue(value: any): string | undefined {
    if (!value) return undefined;
    const typeAny = value.getType?.() as any;
    const classSig = typeAny?.getClassSignature?.();
    const text = safeSignatureLikeText(classSig) || "";
    if (text) return text;
    return safeSignatureLikeText(value.getClassSignature?.());
}

function safeMethodSignatureKey(method: any): string | undefined {
    if (!method) return undefined;
    const signature = safeRead(() => method.getSignature?.());
    const full = safeSignatureLikeText(signature);
    if (full) return full;

    const classText = safeSignatureLikeText(safeRead(() => signature?.getDeclaringClassSignature?.()))
        || safeSignatureLikeText(safeRead(() => method.getDeclaringArkClass?.()?.getSignature?.()))
        || safeString(() => method.getDeclaringArkClass?.()?.getName?.())
        || "%unk";
    const subSignature = safeRead(() => signature?.getMethodSubSignature?.());
    const methodName = safeString(() => subSignature?.getMethodName?.())
        || safeString(() => method.getName?.())
        || "%unk";
    const paramCount = safeNumber(() => subSignature?.getParameters?.()?.length)
        ?? safeNumber(() => method.getParameters?.()?.length);
    return `${classText}.${methodName}/${paramCount ?? "?"}`;
}

function safeSignatureLikeText(signatureLike: any): string | undefined {
    if (!signatureLike) return undefined;
    try {
        const text = signatureLike.toString?.();
        if (typeof text === "string" && text.length > 0) {
            return text;
        }
    } catch {
        // Fall back to a coarser key below.
    }
    try {
        const text = signatureLike.toMapKey?.();
        if (typeof text === "string" && text.length > 0) {
            return text;
        }
    } catch {
        // A recursive type signature can also make toMapKey unsafe.
    }
    return undefined;
}

function safeRead<T>(read: () => T): T | undefined {
    try {
        return read();
    } catch {
        return undefined;
    }
}

function safeString(read: () => unknown): string | undefined {
    try {
        const value = read();
        return typeof value === "string" && value.length > 0 ? value : undefined;
    } catch {
        return undefined;
    }
}

function safeNumber(read: () => unknown): number | undefined {
    try {
        const value = read();
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

function isSameLocal(candidate: any, local: Local): boolean {
    return candidate instanceof Local
        && (candidate === local || (candidate.getName?.() || "") === (local.getName?.() || ""));
}

function localIdentityKey(value: Local): string {
    return `${value.getName?.() || ""}#${value.getDeclaringStmt?.()?.toString?.() || ""}`;
}

function isWeakMapKey(value: any): value is object {
    return (typeof value === "object" || typeof value === "function") && value !== null;
}
