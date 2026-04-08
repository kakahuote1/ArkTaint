import { Pag } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/lib/core/base/Stmt";
import { Constant } from "../../../../arkanalyzer/lib/core/base/Constant";
import { Local } from "../../../../arkanalyzer/lib/core/base/Local";
import { ArkArrayRef, ArkInstanceFieldRef } from "../../../../arkanalyzer/lib/core/base/Ref";
import { ArkAwaitExpr, ArkCastExpr, ArkDeleteExpr, ArkPhiExpr } from "../../../../arkanalyzer/lib/core/base/Expr";
import { TaintTracker } from "../model/TaintTracker";
import { collectAliasLocalsForCarrier, collectCarrierNodeIdsForValueAtStmt } from "./OrdinaryAliasPropagation";
import { resolveOrdinaryArraySlotName } from "./OrdinaryLanguagePropagation";

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
    const cfg = anchorStmt?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) {
        return undefined;
    }

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
