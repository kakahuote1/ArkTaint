import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkCastExpr, ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { MAX_TAINT_FIELD_PATH_SEGMENTS, TaintFact } from "../model/TaintFact";
import { TaintTracker } from "../model/TaintTracker";
import { toContainerFieldKey } from "../model/ContainerSlotKeys";
import { TaintContextManager } from "../context/TaintContext";
import { collectAliasLocalsForCarrier, collectCarrierNodeIdsForValueAtStmt } from "../ordinary/OrdinaryAliasPropagation";
import { isCarrierFieldPathLiveAtStmt } from "../ordinary/OrdinaryObjectInvalidation";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";
import { getMethodBySignature } from "../contracts/MethodLookup";

const getterReturnFieldPathCache: WeakMap<Scene, Map<string, string[] | null>> = new WeakMap();

function pushUniqueFact(results: TaintFact[], seen: Set<string>, fact: TaintFact): void {
    const key = `${fact.id}\u0001${fact.source}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(fact);
}

export function propagateReflectGetFieldLoadsByObj(
    pag: Pag,
    taintedObjId: number,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    tracker?: TaintTracker,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const fieldName = fieldPath[0];
    for (const val of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            if (tracker && !isCarrierFieldPathLiveAtStmt(pag, tracker, taintedObjId, fieldPath, stmt, classBySignature)) continue;
            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof ArkStaticInvokeExpr) && !(rightOp instanceof ArkInstanceInvokeExpr)) continue;
            if (!isReflectLikeCall(rightOp, "get")) continue;

            const args = rightOp.getArgs ? rightOp.getArgs() : [];
            if (args.length < 2 || args[0] !== val) continue;

            const keyText = `${args[1]}`;
            const normalizedField = keyText.replace(/^['"`]/, "").replace(/['"`]$/, "");
            if (normalizedField !== fieldName) continue;

            const dstNodes = pag.getNodesByValue(stmt.getLeftOp());
            if (!dstNodes) continue;
            for (const dstNodeId of dstNodes.values()) {
                const dstNode = pag.getNode(dstNodeId) as PagNode;
                if (fieldPath.length > 1) {
                    const dstPts = dstNode.getPointTo();
                    let hasPointTo = false;
                    for (const objId of dstPts) {
                        hasPointTo = true;
                        results.push(new TaintFact(pag.getNode(objId) as PagNode, source, currentCtx, fieldPath.slice(1)));
                    }
                    if (!hasPointTo) results.push(new TaintFact(dstNode, source, currentCtx, fieldPath.slice(1)));
                } else {
                    results.push(new TaintFact(dstNode, source, currentCtx));
                }
            }
        }
    }
    return results;
}

export function propagateDirectFieldLoadsByLocal(
    pag: Pag,
    taintedNode: PagNode,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    tracker?: TaintTracker,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const seen = new Set<string>();
    const fieldName = fieldPath[0];
    const val = taintedNode.getValue();
    if (!(val instanceof Local)) return results;

    for (const stmt of val.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (tracker) {
            const carrierIds = collectCarrierNodeIdsForValueAtStmt(pag, val, stmt, classBySignature);
            if (carrierIds.length > 0 && !carrierIds.some(id => isCarrierFieldPathLiveAtStmt(pag, tracker, id, fieldPath, stmt, classBySignature))) {
                continue;
            }
        }
        const rightOp = stmt.getRightOp();
        if (!(rightOp instanceof ArkInstanceFieldRef)) continue;
        if (rightOp.getBase() !== val || rightOp.getFieldSignature().getFieldName() !== fieldName) continue;

        const dstNodes = pag.getNodesByValue(stmt.getLeftOp());
        const loadNodes = dstNodes && dstNodes.size > 0 ? dstNodes : getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
        if (!loadNodes) continue;
        for (const dstNodeId of loadNodes.values()) {
            const dstNode = pag.getNode(dstNodeId) as PagNode;
            if (fieldPath.length > 1) {
                const dstPts = dstNode.getPointTo();
                let hasPointTo = false;
                for (const objId of dstPts) {
                    hasPointTo = true;
                    pushUniqueFact(results, seen, new TaintFact(pag.getNode(objId) as PagNode, source, currentCtx, fieldPath.slice(1)));
                }
                if (!hasPointTo) pushUniqueFact(results, seen, new TaintFact(dstNode, source, currentCtx, fieldPath.slice(1)));
            } else {
                pushUniqueFact(results, seen, new TaintFact(dstNode, source, currentCtx));
            }
        }
    }
    return results;
}

export function propagateObjectResultLoadsByObj(
    pag: Pag,
    taintedObjId: number,
    source: string,
    currentCtx: number,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    for (const val of objectAssignSourceLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of objectAssignUseStmtsForLocal(val)) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof ArkStaticInvokeExpr)) continue;
            if (!isObjectBuiltinCall(rightOp, "values") && !isObjectBuiltinCall(rightOp, "entries")) continue;
            const args = rightOp.getArgs ? rightOp.getArgs() : [];
            if (args.length < 1 || args[0] !== val) continue;
            const dstNodes = pag.getNodesByValue(stmt.getLeftOp());
            const loadNodes = dstNodes && dstNodes.size > 0 ? dstNodes : getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
            if (!loadNodes) continue;
            for (const dstNodeId of loadNodes.values()) {
                results.push(new TaintFact(pag.getNode(dstNodeId) as PagNode, source, currentCtx));
            }
        }
    }
    return results;
}

export function propagateObjectResultContainerStoresByObj(
    pag: Pag,
    taintedObjId: number,
    source: string,
    currentCtx: number,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const dedup = new Set<number>();
    for (const val of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof ArkStaticInvokeExpr)) continue;
            if (!isObjectBuiltinCall(rightOp, "values") && !isObjectBuiltinCall(rightOp, "entries")) continue;
            const args = rightOp.getArgs ? rightOp.getArgs() : [];
            if (args.length < 1 || args[0] !== val) continue;
            const resultNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
            if (!resultNodes) continue;
            for (const resultNodeId of resultNodes.values()) {
                if (dedup.has(resultNodeId)) continue;
                dedup.add(resultNodeId);
                results.push(new TaintFact(pag.getNode(resultNodeId) as PagNode, source, currentCtx, [toContainerFieldKey("arr:*")]));
            }
        }
    }
    return results;
}

export function propagateObjectAssignFieldBridgesByObj(
    pag: Pag,
    taintedObjId: number,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    for (const val of objectAssignSourceLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of val.getUsedStmts()) {
            const invokeExpr = stmt.containsInvokeExpr && stmt.containsInvokeExpr() ? stmt.getInvokeExpr() : undefined;
            if (!(invokeExpr instanceof ArkStaticInvokeExpr) || !isObjectBuiltinCall(invokeExpr, "assign")) continue;
            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length < 2) continue;
            const sourceArgs = args.slice(1);
            const sourceMatchesLocalAlias = sourceArgs.some(arg => sameLocalValue(arg, val));
            const sourceMatchesCarrierField = sourceArgs.some(arg => objectAssignSourceFieldRefMatchesTaintedField(
                pag,
                arg,
                taintedObjId,
                fieldPath,
                stmt,
                classBySignature,
            ));
            if (!sourceMatchesLocalAlias && !sourceMatchesCarrierField) continue;

            const targetNodes = pag.getNodesByValue(args[0]);
            if (targetNodes) {
                const shouldProjectToTargetReadFields = (sourceMatchesCarrierField && !sourceMatchesLocalAlias)
                    || (sourceMatchesLocalAlias && fieldPath.length === 0);
                const projectedFields = shouldProjectToTargetReadFields
                    ? objectAssignTargetReadFields(args[0])
                    : [];
                for (const targetNodeId of targetNodes.values()) {
                    const targetNode = pag.getNode(targetNodeId) as PagNode;
                    const targetObjects = objectAssignTargetCarrierNodes(pag, targetNode);
                    for (const targetObj of targetObjects) {
                        if (sourceMatchesLocalAlias) {
                            if (fieldPath.length > 0) {
                                results.push(new TaintFact(targetObj, source, currentCtx, [...fieldPath]));
                            } else {
                                for (const projectedField of projectedFields) {
                                    results.push(new TaintFact(targetObj, source, currentCtx, [projectedField]));
                                }
                            }
                        }
                        if (sourceMatchesCarrierField) {
                            const remainingPath = fieldPath.length > 1 ? fieldPath.slice(1) : [];
                            if (remainingPath.length > 0) {
                                results.push(new TaintFact(targetObj, source, currentCtx, remainingPath));
                            } else {
                                for (const projectedField of projectedFields) {
                                    results.push(new TaintFact(targetObj, source, currentCtx, [projectedField]));
                                }
                            }
                        }
                    }
                }
            }

            if (!(stmt instanceof ArkAssignStmt)) continue;
            const assignResult = stmt.getLeftOp();
            if (!(assignResult instanceof Local)) continue;
            for (const useStmt of assignResult.getUsedStmts()) {
                if (!(useStmt instanceof ArkAssignStmt)) continue;
                const rightOp = useStmt.getRightOp();
                if (!(rightOp instanceof ArkInstanceFieldRef)) continue;
                if (!sameLocalValue(rightOp.getBase(), assignResult) || rightOp.getFieldSignature().getFieldName() !== fieldPath[0]) continue;
                const dstNodes = pag.getNodesByValue(useStmt.getLeftOp());
                const loadNodes = dstNodes && dstNodes.size > 0 ? dstNodes : getOrCreatePagNodes(pag, useStmt.getLeftOp(), useStmt);
                if (!loadNodes) continue;
                for (const dstNodeId of loadNodes.values()) {
                    results.push(new TaintFact(pag.getNode(dstNodeId) as PagNode, source, currentCtx));
                }
            }
        }
    }
    return results;
}

function objectAssignSourceLocalsForCarrier(
    pag: Pag,
    carrierNodeId: number,
    classBySignature?: Map<string, any>,
): Local[] {
    const out: Local[] = [];
    const seen = new Set<string>();
    const add = (value: unknown): void => {
        if (!isLocalLikeValue(value)) return;
        const key = localStableKey(value);
        if (seen.has(key)) return;
        seen.add(key);
        out.push(value as Local);
    };
    add((pag.getNode(carrierNodeId) as PagNode | undefined)?.getValue?.());
    for (const value of collectAliasLocalsForCarrier(pag, carrierNodeId, classBySignature)) {
        add(value);
    }
    return out;
}

function objectAssignTargetCarrierNodes(pag: Pag, targetNode: PagNode): PagNode[] {
    const out: PagNode[] = [];
    for (const objId of targetNode.getPointTo()) {
        out.push(pag.getNode(objId) as PagNode);
    }
    if (out.length === 0 && targetNode.getValue?.() instanceof Local) {
        out.push(targetNode);
    }
    return out;
}

function objectAssignSourceFieldRefMatchesTaintedField(
    pag: Pag,
    sourceArg: any,
    taintedObjId: number,
    fieldPath: string[],
    stmt: any,
    classBySignature?: Map<string, any>,
): boolean {
    if (fieldPath.length === 0) return false;
    if (!(sourceArg instanceof ArkInstanceFieldRef)) return false;
    const sourceFieldName = sourceArg.getFieldSignature?.().getFieldName?.() || sourceArg.getFieldName?.();
    if (!sourceFieldName || sourceFieldName !== fieldPath[0]) return false;
    const base = sourceArg.getBase?.();
    if (!(base instanceof Local)) return false;
    const carrierIds = collectCarrierNodeIdsForValueAtStmt(pag, base, stmt, classBySignature);
    if (carrierIds.includes(taintedObjId)) return true;
    for (const carrierId of carrierIds) {
        const carrierNode = pag.getNode(carrierId) as PagNode | undefined;
        const pts = carrierNode?.getPointTo?.();
        if (pts?.contains?.(taintedObjId)) return true;
    }
    return false;
}

function objectAssignTargetReadFields(target: any): string[] {
    if (!isLocalLikeValue(target)) return [];
    const fields = new Set<string>();
    for (const useStmt of localUseStmtsWithCfgFallback(target)) {
        if (!(useStmt instanceof ArkAssignStmt)) continue;
        const rightOp = useStmt.getRightOp();
        if (!(rightOp instanceof ArkInstanceFieldRef)) continue;
        if (!sameLocalValue(rightOp.getBase(), target)) continue;
        const fieldName = rightOp.getFieldSignature?.().getFieldName?.() || rightOp.getFieldName?.();
        if (fieldName) fields.add(fieldName);
    }
    return [...fields];
}

function objectAssignUseStmtsForLocal(value: Local): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const add = (stmt: any): void => {
        const key = `${stmt?.constructor?.name || ""}#${stmt?.toString?.() || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(stmt);
    };
    for (const stmt of value.getUsedStmts?.() || []) {
        add(stmt);
    }
    const cfg = value.getDeclaringStmt?.()?.getCfg?.();
    for (const stmt of cfg?.getStmts?.() || []) {
        const invokeExpr = stmt?.containsInvokeExpr?.() ? stmt.getInvokeExpr?.() : undefined;
        if (!(invokeExpr instanceof ArkStaticInvokeExpr) || !isObjectBuiltinCall(invokeExpr, "assign")) continue;
        const args = invokeExpr.getArgs?.() || [];
        if (args.slice(1).some((arg: unknown) => sameLocalValue(arg, value))) {
            add(stmt);
        }
    }
    return out;
}

function localUseStmtsWithCfgFallback(value: Local): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const add = (stmt: any): void => {
        const key = `${stmt?.constructor?.name || ""}#${stmt?.toString?.() || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(stmt);
    };
    for (const stmt of value.getUsedStmts?.() || []) {
        add(stmt);
    }
    const cfg = value.getDeclaringStmt?.()?.getCfg?.();
    for (const stmt of cfg?.getStmts?.() || []) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const rightOp = stmt.getRightOp();
        if (rightOp instanceof ArkInstanceFieldRef && sameLocalValue(rightOp.getBase?.(), value)) {
            add(stmt);
        }
    }
    return out;
}

function sameLocalValue(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (!isLocalLikeValue(left) || !isLocalLikeValue(right)) return false;
    const leftKey = localStableKey(left);
    const rightKey = localStableKey(right);
    return leftKey === rightKey;
}

function isLocalLikeValue(value: unknown): value is Local {
    if (value instanceof Local) return true;
    const anyValue = value as any;
    return !!anyValue
        && typeof anyValue.getName === "function"
        && typeof anyValue.getDeclaringStmt === "function"
        && typeof anyValue.getUsedStmts === "function";
}

function localStableKey(value: any): string {
    return `${value.getName?.() || value.toString?.() || ""}#${value.getDeclaringStmt?.()?.toString?.() || ""}`;
}

export function propagateReflectSetFieldStores(
    pag: Pag,
    taintedNode: PagNode,
    source: string,
    currentCtx: number
): TaintFact[] {
    const results: TaintFact[] = [];
    const val = taintedNode.getValue();
    if (!(val instanceof Local)) return results;

    for (const stmt of val.getUsedStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkStaticInvokeExpr) && !(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        if (!isReflectLikeCall(invokeExpr, "set")) continue;
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length < 3 || args[2] !== val) continue;
        const fieldName = resolveReflectPropertyName(args[1]);
        if (!fieldName) continue;

        const baseNodes = pag.getNodesByValue(args[0]);
        if (!baseNodes) continue;
        for (const baseNodeId of baseNodes.values()) {
            const baseNode = pag.getNode(baseNodeId) as PagNode;
            for (const objId of baseNode.getPointTo()) {
                results.push(new TaintFact(pag.getNode(objId) as PagNode, source, currentCtx, [fieldName]));
            }
        }
    }
    return results;
}

export function propagateDirectFieldLoadsByObj(
    pag: Pag,
    taintedObjId: number,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    tracker?: TaintTracker,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const seen = new Set<string>();
    const fieldName = fieldPath[0];
    for (const val of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            if (tracker && !isCarrierFieldPathLiveAtStmt(pag, tracker, taintedObjId, fieldPath, stmt, classBySignature)) continue;
            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof ArkInstanceFieldRef)) continue;
            if (rightOp.getBase() !== val || rightOp.getFieldSignature().getFieldName() !== fieldName) continue;
            const dstNodes = pag.getNodesByValue(stmt.getLeftOp());
            const loadNodes = dstNodes && dstNodes.size > 0 ? dstNodes : getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
            if (!loadNodes) continue;
            const prefixOnlySource = fieldPath.length === 1
                && tracker?.hasDescendantFieldSourceAnyContext(taintedObjId, source, fieldPath);
            for (const dstNodeId of loadNodes.values()) {
                const dstNode = pag.getNode(dstNodeId) as PagNode;
                if (fieldPath.length > 1) {
                const dstPts = dstNode.getPointTo();
                let hasPointTo = false;
                for (const objId of dstPts) {
                    hasPointTo = true;
                    pushUniqueFact(results, seen, new TaintFact(pag.getNode(objId) as PagNode, source, currentCtx, fieldPath.slice(1)));
                }
                if (!hasPointTo) pushUniqueFact(results, seen, new TaintFact(dstNode, source, currentCtx, fieldPath.slice(1)));
            } else if (!prefixOnlySource) {
                pushUniqueFact(results, seen, new TaintFact(dstNode, source, currentCtx));
            }
        }
    }
    }
    return results;
}

export function propagateDirectFieldArgUsesByObj(
    pag: Pag,
    taintedObjId: number,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    tracker?: TaintTracker,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const fieldName = fieldPath[0];
    for (const val of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of val.getUsedStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            if (tracker && !isCarrierFieldPathLiveAtStmt(pag, tracker, taintedObjId, fieldPath, stmt, classBySignature)) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkStaticInvokeExpr) && !(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            for (const arg of args) {
                if (!(arg instanceof ArkInstanceFieldRef)) continue;
                if (arg.getBase() !== val || arg.getFieldSignature().getFieldName() !== fieldName) continue;
                const argNodes = getOrCreatePagNodes(pag, arg, stmt);
                if (!argNodes) continue;
                const prefixOnlySource = fieldPath.length === 1
                    && tracker?.hasDescendantFieldSourceAnyContext(taintedObjId, source, fieldPath);
                for (const argNodeId of argNodes.values()) {
                    const argNode = pag.getNode(argNodeId) as PagNode;
                    if (fieldPath.length > 1) {
                        const argPts = argNode.getPointTo();
                        let hasPointTo = false;
                        for (const objId of argPts) {
                            hasPointTo = true;
                            results.push(new TaintFact(pag.getNode(objId) as PagNode, source, currentCtx, fieldPath.slice(1)));
                        }
                        if (!hasPointTo) results.push(new TaintFact(argNode, source, currentCtx, fieldPath.slice(1)));
                    } else if (!prefixOnlySource) {
                        results.push(new TaintFact(argNode, source, currentCtx));
                    }
                }
            }
        }
    }
    return results;
}

export function propagateCarrierLoadPrefixesByObj(
    pag: Pag,
    taintedObjId: number,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    tracker?: TaintTracker,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const seen = new Set<string>();
    if (fieldPath.length >= MAX_TAINT_FIELD_PATH_SEGMENTS) {
        return results;
    }
    for (const val of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        const declStmt = val.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== val) continue;
        if (tracker && !isCarrierFieldPathLiveAtStmt(pag, tracker, taintedObjId, fieldPath, declStmt, classBySignature)) continue;

        const rightOp = declStmt.getRightOp();
        let pathPrefix: string | undefined;
        let fieldRef: ArkInstanceFieldRef | undefined;
        if (rightOp instanceof ArkInstanceFieldRef) {
            fieldRef = rightOp;
            pathPrefix = rightOp.getFieldSignature?.().getFieldName?.() || rightOp.getFieldName?.();
        }
        const baseValue = rightOp instanceof ArkInstanceFieldRef ? rightOp.getBase?.() : undefined;
        if (!pathPrefix || !baseValue) continue;
        if (fieldRef && isScalarFieldLoadValue(val, fieldRef)) continue;

        const ownerCarrierIds = collectCarrierNodeIdsForValueAtStmt(
            pag,
            baseValue,
            declStmt,
            classBySignature,
        );
        for (const ownerCarrierId of ownerCarrierIds) {
            const ownerCarrier = pag.getNode(ownerCarrierId) as PagNode;
            if (!ownerCarrier) continue;
            const nextFieldPath = [pathPrefix, ...fieldPath];
            const key = `${ownerCarrierId}|${source}|${currentCtx}|${nextFieldPath.join(".")}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push(new TaintFact(ownerCarrier, source, currentCtx, nextFieldPath));
        }
    }
    return results;
}

function isScalarFieldLoadValue(local: Local, fieldRef: ArkInstanceFieldRef): boolean {
    return isScalarLikeTypeText(local.getType?.()?.toString?.())
        || isScalarLikeTypeText(fieldRef.getType?.()?.toString?.())
        || isScalarLikeTypeText(fieldRef.getFieldSignature?.()?.getType?.()?.toString?.());
}

function isScalarLikeTypeText(raw: string | undefined): boolean {
    const text = String(raw || "").trim().toLowerCase();
    if (!text) return false;
    if (text.includes("[]") || text.includes("array<") || text.includes("map<") || text.includes("set<")) {
        return false;
    }
    return text === "string"
        || text === "boolean"
        || text === "number"
        || text === "bigint"
        || text === "symbol"
        || text === "null"
        || text === "undefined"
        || text === "void"
        || text === "byte"
        || text === "short"
        || text === "int"
        || text === "long"
        || text === "float"
        || text === "double"
        || text.endsWith(".string")
        || text.includes("std.core.string");
}

export function propagateReceiverGetterResultLoadsByObj(
    scene: Scene,
    pag: Pag,
    taintedObjId: number,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    tracker?: TaintTracker,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    for (const val of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            if (tracker && !isCarrierFieldPathLiveAtStmt(pag, tracker, taintedObjId, fieldPath, stmt, classBySignature)) continue;

            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof ArkInstanceInvokeExpr)) continue;
            if (rightOp.getBase() !== val) continue;

            const getterFieldPath = resolveReceiverGetterReturnFieldPath(
                scene,
                rightOp.getMethodSignature?.()?.toString?.() || "",
            );
            if (!getterFieldPath || getterFieldPath.length === 0) continue;
            if (!fieldPathStartsWith(fieldPath, getterFieldPath)) continue;

            const suffix = fieldPath.slice(getterFieldPath.length);
            const dstNodes = pag.getNodesByValue(stmt.getLeftOp());
            const loadNodes = dstNodes && dstNodes.size > 0 ? dstNodes : getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
            if (!loadNodes) continue;
            for (const dstNodeId of loadNodes.values()) {
                const dstNode = pag.getNode(dstNodeId) as PagNode;
                if (suffix.length > 0) {
                    const dstPts = dstNode.getPointTo();
                    let hasPointTo = false;
                    for (const objId of dstPts) {
                        hasPointTo = true;
                        results.push(new TaintFact(pag.getNode(objId) as PagNode, source, currentCtx, suffix));
                    }
                    if (!hasPointTo) results.push(new TaintFact(dstNode, source, currentCtx, suffix));
                } else {
                    results.push(new TaintFact(dstNode, source, currentCtx));
                }
            }
        }
    }
    return results;
}

export function propagateRestArrayParam(
    scene: Scene,
    pag: Pag,
    ctxManager: TaintContextManager,
    taintedNode: PagNode,
    source: string,
    currentCtx: number
): TaintFact[] {
    const results: TaintFact[] = [];
    const val = taintedNode.getValue();
    if (!(val instanceof Local)) return results;
    for (const stmt of val.getUsedStmts()) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkStaticInvokeExpr) && !(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length <= 1 || !args.includes(val)) continue;
        const calleeSig = invokeExpr.getMethodSignature()?.toString() || "";
        if (!calleeSig.includes("[]")) continue;
        const callee = getMethodBySignature(scene, calleeSig);
        if (!callee || !callee.getCfg()) continue;
        const paramAssigns = callee.getCfg()!.getStmts().filter((s: any) => s instanceof ArkAssignStmt && s.getRightOp() instanceof ArkParameterRef) as ArkAssignStmt[];
        if (paramAssigns.length !== 1) continue;
        let dstNodes = pag.getNodesByValue(paramAssigns[0].getLeftOp());
        if (!dstNodes || dstNodes.size === 0) dstNodes = pag.getNodesByValue(paramAssigns[0].getRightOp());
        if (!dstNodes || dstNodes.size === 0) continue;
        const callSiteId = stmt.getOriginPositionInfo().getLineNo() * 10000 + simpleHash(calleeSig);
        const newCtx = ctxManager.createCalleeContext(currentCtx, callSiteId, "<rest_arg_dispatch>", callee.getName());
        for (const dstNodeId of dstNodes.values()) {
            results.push(new TaintFact(pag.getNode(dstNodeId) as PagNode, source, newCtx));
        }
    }
    return results;
}

export function findStoreAnchorStmtForTaintedValue(
    value: any,
    targetRef: ArkInstanceFieldRef | ArkArrayRef,
): ArkAssignStmt | undefined {
    if (!(value instanceof Local)) return undefined;
    for (const stmt of value.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt) || stmt.getRightOp() !== value) continue;
        const left = stmt.getLeftOp();
        if (targetRef instanceof ArkInstanceFieldRef && left instanceof ArkInstanceFieldRef) {
            const leftField = left.getFieldSignature?.().getFieldName?.() || left.getFieldName?.();
            const targetField = targetRef.getFieldSignature?.().getFieldName?.() || targetRef.getFieldName?.();
            if (left.getBase() === targetRef.getBase() && leftField === targetField) return stmt;
        }
        if (targetRef instanceof ArkArrayRef && left instanceof ArkArrayRef) {
            if (left.getBase() === targetRef.getBase() && String(left.getIndex?.() || "") === String(targetRef.getIndex?.() || "")) return stmt;
        }
    }
    return undefined;
}

export function propagateArrayElementLoads(
    pag: Pag,
    taintedNode: PagNode,
    source: string,
    currentCtx: number
): TaintFact[] {
    const results: TaintFact[] = [];
    const val = taintedNode.getValue();
    if (!(val instanceof Local)) return results;
    for (const stmt of val.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const rightOp = stmt.getRightOp();
        if (!(rightOp instanceof ArkArrayRef) || rightOp.getBase() !== val) continue;
        const dstNodes = pag.getNodesByValue(stmt.getLeftOp());
        if (!dstNodes) continue;
        for (const dstNodeId of dstNodes.values()) {
            results.push(new TaintFact(pag.getNode(dstNodeId) as PagNode, source, currentCtx));
        }
    }
    return results;
}

export function propagateCapturedFieldWrites(
    pag: Pag,
    taintedNode: PagNode,
    source: string,
    currentCtx: number,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const val = taintedNode.getValue();
    if (!(val instanceof Local)) return results;
    for (const stmt of val.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const leftOp = stmt.getLeftOp();
        const rightOp = stmt.getRightOp();
        if (!(leftOp instanceof ArkInstanceFieldRef) || !(rightOp instanceof Local) || rightOp !== val) continue;
        const fieldName = leftOp.getFieldSignature().getFieldName();
        const baseLocal = leftOp.getBase();
        for (const carrierNodeId of collectCarrierNodeIdsForValueAtStmt(pag, baseLocal, stmt, classBySignature)) {
            const carrierNode = pag.getNode(carrierNodeId) as PagNode;
            if (carrierNode) results.push(new TaintFact(carrierNode, source, currentCtx, [fieldName]));
        }
        const declaringStmt = baseLocal.getDeclaringStmt?.();
        if (!(declaringStmt instanceof ArkAssignStmt)) continue;
        const baseRightOp = declaringStmt.getRightOp();
        if (!(baseRightOp instanceof ArkInstanceFieldRef)) continue;
        const ownerFieldName = baseRightOp.getFieldSignature().getFieldName();
        for (const ownerCarrierNodeId of collectCarrierNodeIdsForValueAtStmt(pag, baseRightOp.getBase(), declaringStmt, classBySignature)) {
            const ownerCarrierNode = pag.getNode(ownerCarrierNodeId) as PagNode;
            if (ownerCarrierNode) results.push(new TaintFact(ownerCarrierNode, source, currentCtx, [ownerFieldName, fieldName]));
        }
    }
    return results;
}

function simpleHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h) + s.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h % 10000);
}

function resolveReflectPropertyName(value: any): string | undefined {
    if (value instanceof Constant) return normalizeReflectPropertyLiteral(value.toString());
    if (value instanceof Local) {
        const decl = value.getDeclaringStmt();
        if (decl instanceof ArkAssignStmt && decl.getLeftOp() === value) {
            const right = decl.getRightOp();
            if (right instanceof Constant) return normalizeReflectPropertyLiteral(right.toString());
        }
        const text = value.getName?.() || value.toString?.() || "";
        return text ? normalizeReflectPropertyLiteral(text) : undefined;
    }
    const text = value?.toString?.() || "";
    return text ? normalizeReflectPropertyLiteral(text) : undefined;
}

function normalizeReflectPropertyLiteral(text: string): string {
    return text.replace(/^['"`]/, "").replace(/['"`]$/, "");
}

function getOrCreatePagNodes(pag: Pag, value: any, anchorStmt: any): Map<number, number> | undefined {
    return safeGetOrCreatePagNodes(pag, value, anchorStmt);
}

export function resolveReceiverGetterReturnFieldPath(
    scene: Scene,
    methodSignature: string,
): string[] | undefined {
    if (!methodSignature) return undefined;
    let cache = getterReturnFieldPathCache.get(scene);
    if (!cache) {
        cache = new Map<string, string[] | null>();
        getterReturnFieldPathCache.set(scene, cache);
    }
    if (cache.has(methodSignature)) {
        return cache.get(methodSignature) || undefined;
    }

    const method = getMethodBySignature(scene, methodSignature);
    if (!method?.getCfg?.()) {
        cache.set(methodSignature, null);
        return undefined;
    }

    const returnStmts = method.getReturnStmt?.() || [];
    const uniquePaths = new Set<string>();
    for (const retStmt of returnStmts) {
        if (!(retStmt instanceof ArkReturnStmt)) continue;
        const fieldPath = resolveReceiverFieldPathFromValue(retStmt.getOp?.(), retStmt, 0, new Set<string>());
        if (!fieldPath || fieldPath.length === 0) {
            cache.set(methodSignature, null);
            return undefined;
        }
        uniquePaths.add(fieldPath.join("."));
    }

    if (uniquePaths.size !== 1) {
        cache.set(methodSignature, null);
        return undefined;
    }

    const resolved = [...uniquePaths][0].split(".");
    cache.set(methodSignature, resolved);
    return resolved;
}

function resolveReceiverFieldPathFromValue(
    value: any,
    anchorStmt: any,
    depth: number,
    visiting: Set<string>,
): string[] | undefined {
    if (depth > 8) return undefined;
    if (value instanceof Local) {
        if (isReceiverLikeLocal(value)) return [];
        const localKey = `${value.getName?.() || ""}#${value.getDeclaringStmt?.()?.toString?.() || ""}`;
        if (visiting.has(localKey)) return undefined;
        visiting.add(localKey);
        const assignStmt = findLatestAssignStmtForLocalBefore(value, anchorStmt);
        if (!(assignStmt instanceof ArkAssignStmt)) return undefined;
        const rightOp = assignStmt.getRightOp();
        if (rightOp instanceof Local) {
            return resolveReceiverFieldPathFromValue(rightOp, assignStmt, depth + 1, visiting);
        }
        if (rightOp instanceof ArkCastExpr) {
            return resolveReceiverFieldPathFromValue(rightOp.getOp?.(), assignStmt, depth + 1, visiting);
        }
        if (rightOp instanceof ArkInstanceFieldRef) {
            const basePath = resolveReceiverFieldPathFromValue(rightOp.getBase?.(), assignStmt, depth + 1, visiting);
            const fieldName = rightOp.getFieldSignature?.().getFieldName?.() || rightOp.getFieldName?.();
            if (!basePath || !fieldName) return undefined;
            return [...basePath, fieldName];
        }
        return undefined;
    }

    if (value instanceof ArkInstanceFieldRef) {
        const basePath = resolveReceiverFieldPathFromValue(value.getBase?.(), anchorStmt, depth + 1, visiting);
        const fieldName = value.getFieldSignature?.().getFieldName?.() || value.getFieldName?.();
        if (!basePath || !fieldName) return undefined;
        return [...basePath, fieldName];
    }

    return undefined;
}

function findLatestAssignStmtForLocalBefore(local: Local, anchorStmt: any): ArkAssignStmt | undefined {
    const cfg = anchorStmt?.getCfg?.() || local.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;

    let latest: ArkAssignStmt | undefined;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) {
            if (stmt instanceof ArkAssignStmt && stmt.getLeftOp() === local) {
                latest = stmt;
            }
            break;
        }
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (stmt.getLeftOp() !== local) continue;
        latest = stmt;
    }
    return latest;
}

function isReceiverLikeLocal(local: Local): boolean {
    const name = local.getName?.() || local.toString?.() || "";
    return name === "this" || name.endsWith(".this");
}

function fieldPathStartsWith(fieldPath: string[], prefix: string[]): boolean {
    if (prefix.length > fieldPath.length) return false;
    for (let i = 0; i < prefix.length; i++) {
        if (fieldPath[i] !== prefix[i]) return false;
    }
    return true;
}

function isReflectLikeCall(invokeExpr: ArkStaticInvokeExpr | ArkInstanceInvokeExpr, methodName: "get" | "set"): boolean {
    const sig = invokeExpr.getMethodSignature()?.toString() || "";
    if (sig.includes(`Reflect.${methodName}`)) return true;
    if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) return false;
    const baseText = invokeExpr.getBase()?.toString?.() || "";
    return baseText === "Reflect" && sig.includes(`.${methodName}()`);
}

function isObjectBuiltinCall(invokeExpr: ArkStaticInvokeExpr | ArkInstanceInvokeExpr, methodName: "assign" | "values" | "entries"): boolean {
    if (!(invokeExpr instanceof ArkStaticInvokeExpr)) return false;
    const sig = invokeExpr.getMethodSignature()?.toString() || "";
    return sig.includes(`Object.${methodName}`);
}
