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
const directAliasLocalCache: WeakMap<Pag, Map<number, Local[]>> = new WeakMap();
const hasAnonymousObjectLiteralClassCache: WeakMap<Map<string, any>, boolean> = new WeakMap();
const defaultCarrierResolutionCache: WeakMap<Pag, WeakMap<object, WeakMap<object, number[]>>> = new WeakMap();
const carrierResolutionCacheByClassIndex: WeakMap<Pag, WeakMap<Map<string, any>, WeakMap<object, WeakMap<object, number[]>>>> = new WeakMap();

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
    const directAliasLocals = collectDirectAliasLocalsForCarrier(pag, carrierNodeId, classBySignature);
    const results: Local[] = [...directAliasLocals];
    const seen = new Set<string>(
        directAliasLocals.map(value => `${value.getName?.() || ""}#${value.getDeclaringStmt?.()?.toString?.() || ""}`),
    );
    const methodLocalIndex = new Map<string, Map<string, Local[]>>();

    if (!classBySignature || directAliasLocals.length === 0) {
        return results;
    }
    if (!hasAnonymousObjectLiteralClasses(classBySignature)) {
        return results;
    }

    const directAliasLocalNames = new Set<string>();
    for (const local of directAliasLocals) {
        const name = local.getName?.() || "";
        if (!name) continue;
        directAliasLocalNames.add(name);
    }

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

        const baseMethodSig = resolveDeclaringMethodSignature(base);
        if (!baseMethodSig) continue;
        const baseClassSig = resolveValueClassSignatureAtStmt(base, declStmt, 0, new Set<string>());
        if (!baseClassSig) continue;
        const arkClass = classBySignature.get(baseClassSig);
        if (!arkClass) continue;

        const fieldName = rhs.getFieldSignature?.().getFieldName?.() || rhs.getFieldName?.();
        if (!fieldName) continue;
        const capturedLocalNames = resolveCapturedLocalNamesForField(arkClass, fieldName);
        if (capturedLocalNames.length === 0) continue;

        const localIndex = ensureMethodLocalIndex(methodLocalIndex, pag, baseMethodSig);
        const hasDirectCarrierCapture = capturedLocalNames.some(name => directAliasLocalNames.has(name));
        if (!hasDirectCarrierCapture) continue;

        const key = `${candidateValue.getName?.() || ""}#${candidateValue.getDeclaringStmt?.()?.toString?.() || ""}`;
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

    return results;
}

function collectDirectAliasLocalsForCarrier(
    pag: Pag,
    carrierNodeId: number,
    classBySignature?: Map<string, any>,
): Local[] {
    let byCarrier = directAliasLocalCache.get(pag);
    if (!byCarrier) {
        byCarrier = new Map<number, Local[]>();
        directAliasLocalCache.set(pag, byCarrier);
    }
    const cached = byCarrier.get(carrierNodeId);
    if (cached) {
        return cached;
    }

    const results: Local[] = [];
    const seen = new Set<string>();
    const methodLocalIndex = new Map<string, Map<string, Local[]>>();
    for (const rawNode of pag.getNodesIter()) {
        const aliasNode = rawNode as PagNode;
        if (!isCarrierAliasNode(aliasNode, carrierNodeId)) continue;

        const value = aliasNode.getValue?.();
        if (!(value instanceof Local)) continue;
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

        const key = `${value.getName?.() || ""}#${value.getDeclaringStmt?.()?.toString?.() || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(value);
    }

    byCarrier.set(carrierNodeId, results);
    return results;
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
    return local.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
}

function resolveDeclaringMethodSignatureFromStmt(stmt: any): string | undefined {
    return stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
}

function resolveLocalClassSignature(local: Local): string | undefined {
    const typeAny = local.getType?.() as any;
    const classSig = typeAny?.getClassSignature?.();
    const text = classSig?.toString?.() || "";
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
    const text = classSig?.toString?.() || "";
    if (text) return text;
    return value.getClassSignature?.()?.toString?.() || undefined;
}

function isSameLocal(candidate: any, local: Local): boolean {
    return candidate instanceof Local
        && (candidate === local || (candidate.getName?.() || "") === (local.getName?.() || ""));
}

function isWeakMapKey(value: any): value is object {
    return (typeof value === "object" || typeof value === "function") && value !== null;
}
