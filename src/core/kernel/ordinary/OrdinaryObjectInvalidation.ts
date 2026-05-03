import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkArrayRef, ArkInstanceFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkAwaitExpr, ArkCastExpr, ArkDeleteExpr, ArkPhiExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { TaintTracker } from "../model/TaintTracker";
import { collectAliasLocalsForCarrier, collectCarrierNodeIdsForValueAtStmt } from "./OrdinaryAliasPropagation";
import { resolveOrdinaryArraySlotName } from "./OrdinaryLanguagePropagation";

type LatestStoreResult = ArkAssignStmt | null | undefined;

const defaultClassIndexKey = {};
const cfgOrderCache: WeakMap<object, { order: Map<any, number> }> = new WeakMap();
const latestStoreCache: WeakMap<Pag, WeakMap<object, WeakMap<object, Map<string, LatestStoreResult>>>> = new WeakMap();

export function isCarrierFieldPathLiveAtStmt(
    pag: Pag,
    tracker: TaintTracker,
    carrierNodeId: number,
    fieldPath: string[],
    anchorStmt: any,
    classBySignature?: Map<string, any>,
): boolean {
    if (!anchorStmt || fieldPath.length === 0) {
        return true;
    }

    const latestStore = findLatestCarrierFieldStoreBefore(
        pag,
        carrierNodeId,
        fieldPath[0],
        anchorStmt,
        classBySignature,
    );
    if (latestStore === null) {
        return false;
    }
    if (!latestStore) {
        return true;
    }

    return storeMayCarryTrackedFieldPath(
        pag,
        tracker,
        latestStore.getRightOp(),
        latestStore,
        fieldPath.slice(1),
        classBySignature,
    );
}

function findLatestCarrierFieldStoreBefore(
    pag: Pag,
    carrierNodeId: number,
    fieldName: string,
    anchorStmt: any,
    classBySignature?: Map<string, any>,
): ArkAssignStmt | null | undefined {
    const classKey = classBySignature || defaultClassIndexKey;
    const cachedByAnchor = getLatestStoreCacheForAnchor(pag, classKey, anchorStmt);
    const cacheKey = `${carrierNodeId}|${fieldName}`;
    if (cachedByAnchor?.has(cacheKey)) {
        return cachedByAnchor.get(cacheKey);
    }
    const result = findLatestCarrierFieldStoreBeforeUncached(
        pag,
        carrierNodeId,
        fieldName,
        anchorStmt,
        classBySignature,
    );
    cachedByAnchor?.set(cacheKey, result);
    return result;
}

function findLatestCarrierFieldStoreBeforeUncached(
    pag: Pag,
    carrierNodeId: number,
    fieldName: string,
    anchorStmt: any,
    classBySignature?: Map<string, any>,
): ArkAssignStmt | null | undefined {
    const cfg = anchorStmt?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) {
        return undefined;
    }

    const order = getCfgOrder(cfg, stmts);
    const anchorIndex = order.get(anchorStmt) ?? -1;
    if (anchorIndex < 0) {
        return undefined;
    }

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
                if (!sameLocal(deletedField.getBase(), aliasLocal)) continue;
                const deletedFieldName = deletedField.getFieldSignature?.().getFieldName?.() || deletedField.getFieldName?.();
                if (deletedFieldName !== fieldName) continue;
                latest = undefined;
                latestIndex = stmtIndex;
                latestWasDelete = true;
                continue;
            }

            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            if (!sameLocal(left.getBase(), aliasLocal)) continue;
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

function getCfgOrder(cfg: object, stmts: any[]): Map<any, number> {
    const cached = cfgOrderCache.get(cfg);
    if (cached) return cached.order;
    const order = new Map<any, number>();
    for (let index = 0; index < stmts.length; index++) {
        order.set(stmts[index], index);
    }
    cfgOrderCache.set(cfg, { order });
    return order;
}

function getLatestStoreCacheForAnchor(
    pag: Pag,
    classKey: object,
    anchorStmt: any,
): Map<string, LatestStoreResult> | undefined {
    if (!anchorStmt || (typeof anchorStmt !== "object" && typeof anchorStmt !== "function")) {
        return undefined;
    }
    let byClass = latestStoreCache.get(pag);
    if (!byClass) {
        byClass = new WeakMap<object, WeakMap<object, Map<string, LatestStoreResult>>>();
        latestStoreCache.set(pag, byClass);
    }
    let byAnchor = byClass.get(classKey);
    if (!byAnchor) {
        byAnchor = new WeakMap<object, Map<string, LatestStoreResult>>();
        byClass.set(classKey, byAnchor);
    }
    let byCarrierField = byAnchor.get(anchorStmt);
    if (!byCarrierField) {
        byCarrierField = new Map<string, LatestStoreResult>();
        byAnchor.set(anchorStmt, byCarrierField);
    }
    return byCarrierField;
}

function storeMayCarryTrackedFieldPath(
    pag: Pag,
    tracker: TaintTracker,
    value: any,
    anchorStmt: any,
    remainingFieldPath: string[],
    classBySignature?: Map<string, any>,
): boolean {
    if (value instanceof ArkCastExpr) {
        return storeMayCarryTrackedFieldPath(pag, tracker, value.getOp?.(), anchorStmt, remainingFieldPath, classBySignature);
    }
    if (value instanceof ArkAwaitExpr) {
        return storeMayCarryTrackedFieldPath(pag, tracker, value.getPromise?.(), anchorStmt, remainingFieldPath, classBySignature);
    }
    if (value instanceof ArkPhiExpr) {
        return true;
    }
    if (value instanceof Constant || value === undefined || value === null) {
        return false;
    }

    if (remainingFieldPath.length === 0) {
        if (value instanceof ArkInstanceFieldRef) {
            const baseCarrierIds = collectCarrierNodeIdsForValueAtStmt(pag, value.getBase(), anchorStmt, classBySignature);
            const fieldName = value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.();
            return baseCarrierIds.some(nodeId => tracker.isTaintedAnyContext(nodeId, [fieldName]));
        }
        if (value instanceof ArkArrayRef) {
            const baseCarrierIds = collectCarrierNodeIdsForValueAtStmt(pag, value.getBase(), anchorStmt, classBySignature);
            const slotKey = resolveOrdinaryArraySlotName(value.getIndex());
            return baseCarrierIds.some(nodeId => tracker.isTaintedAnyContext(nodeId, [slotKey]));
        }

        const directNodeIds = collectCarrierNodeIdsForValueAtStmt(pag, value, anchorStmt, classBySignature);
        if (directNodeIds.some(nodeId => tracker.isTaintedAnyContext(nodeId))) {
            return true;
        }
        return !(value instanceof Local);
    }

    const carrierIds = collectCarrierNodeIdsForValueAtStmt(pag, value, anchorStmt, classBySignature);
    if (carrierIds.length > 0) {
        return carrierIds.some(nodeId => tracker.isTaintedAnyContext(nodeId, remainingFieldPath));
    }
    return !(value instanceof Local);
}

function sameLocal(left: any, right: Local): boolean {
    return left instanceof Local
        && (left === right || (left.getName?.() || "") === (right.getName?.() || ""));
}
