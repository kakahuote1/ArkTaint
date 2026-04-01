import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { TaintFact } from "../model/TaintFact";
import { toContainerFieldKey } from "../model/ContainerSlotKeys";
import { TaintContextManager } from "../context/TaintContext";
import { collectAliasLocalsForCarrier, collectCarrierNodeIdsForValueAtStmt } from "../ordinary/OrdinaryAliasPropagation";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";
import { getMethodBySignature } from "../contracts/MethodLookup";

export function propagateReflectGetFieldLoadsByObj(
    pag: Pag,
    taintedObjId: number,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const fieldName = fieldPath[0];
    for (const val of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
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
    currentCtx: number
): TaintFact[] {
    const results: TaintFact[] = [];
    const fieldName = fieldPath[0];
    const val = taintedNode.getValue();
    if (!(val instanceof Local)) return results;

    for (const stmt of val.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
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
                    results.push(new TaintFact(pag.getNode(objId) as PagNode, source, currentCtx, fieldPath.slice(1)));
                }
                if (!hasPointTo) results.push(new TaintFact(dstNode, source, currentCtx, fieldPath.slice(1)));
            } else {
                results.push(new TaintFact(dstNode, source, currentCtx));
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
    for (const val of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of val.getUsedStmts()) {
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
    for (const val of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of val.getUsedStmts()) {
            const invokeExpr = stmt.containsInvokeExpr && stmt.containsInvokeExpr() ? stmt.getInvokeExpr() : undefined;
            if (!(invokeExpr instanceof ArkStaticInvokeExpr) || !isObjectBuiltinCall(invokeExpr, "assign")) continue;
            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length < 2 || !args.slice(1).includes(val)) continue;

            const targetNodes = pag.getNodesByValue(args[0]);
            if (targetNodes) {
                for (const targetNodeId of targetNodes.values()) {
                    const targetNode = pag.getNode(targetNodeId) as PagNode;
                    for (const objId of targetNode.getPointTo()) {
                        results.push(new TaintFact(pag.getNode(objId) as PagNode, source, currentCtx, [...fieldPath]));
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
                if (rightOp.getBase() !== assignResult || rightOp.getFieldSignature().getFieldName() !== fieldPath[0]) continue;
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
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const fieldName = fieldPath[0];
    for (const val of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
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

export function propagateDirectFieldArgUsesByObj(
    pag: Pag,
    taintedObjId: number,
    fieldPath: string[],
    source: string,
    currentCtx: number,
    classBySignature?: Map<string, any>,
): TaintFact[] {
    const results: TaintFact[] = [];
    const fieldName = fieldPath[0];
    for (const val of collectAliasLocalsForCarrier(pag, taintedObjId, classBySignature)) {
        for (const stmt of val.getUsedStmts()) {
            if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkStaticInvokeExpr) && !(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            for (const arg of args) {
                if (!(arg instanceof ArkInstanceFieldRef)) continue;
                if (arg.getBase() !== val || arg.getFieldSignature().getFieldName() !== fieldName) continue;
                const argNodes = getOrCreatePagNodes(pag, arg, stmt);
                if (!argNodes) continue;
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
                    } else {
                        results.push(new TaintFact(argNode, source, currentCtx));
                    }
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
