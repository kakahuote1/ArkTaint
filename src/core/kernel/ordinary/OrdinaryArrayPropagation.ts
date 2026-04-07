import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt, ArkInvokeStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkNormalBinopExpr, ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { ArrayType } from "../../../../arkanalyzer/out/src/core/base/Type";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { resolveMethodsFromCallable } from "../../substrate/queries/CalleeResolver";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";

export interface OrdinaryArraySlotStoreInfo {
    objId: number;
    slot: string;
}

export interface OrdinaryArrayMutationEffects {
    baseNodeIds: number[];
    slotStores: OrdinaryArraySlotStoreInfo[];
}

export interface OrdinaryArrayHigherOrderEffects {
    callbackParamNodeIds: number[];
    resultNodeIds: number[];
    resultSlotStores: OrdinaryArraySlotStoreInfo[];
}

export interface OrdinaryArrayResultEffects {
    resultNodeIds: number[];
    resultSlotStores: OrdinaryArraySlotStoreInfo[];
}

export function collectOrdinaryArrayMutationEffectsFromTaintedLocal(
    local: Local,
    pag: Pag,
): OrdinaryArrayMutationEffects {
    const baseNodeIds: number[] = [];
    const slotStores: OrdinaryArraySlotStoreInfo[] = [];
    const baseDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const stmt of local.getUsedStmts()) {
        const invokeExpr = resolveArrayMutationInvoke(stmt);
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const base = invokeExpr.getBase();
        if (!(base instanceof Local)) continue;
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const methodName = resolveMethodName(invokeExpr);
        const sig = invokeExpr.getMethodSignature()?.toString() || "";
        const containerKind = resolveContainerKind(base, sig);
        if (containerKind !== "array") continue;
        if (!isArrayMutationForBase(methodName)) continue;
        if (!isMutationInputAffectingBase(methodName, base, args, local)) continue;

        const baseNodes = pag.getNodesByValue(base);
        if (!baseNodes) continue;
        for (const nodeId of baseNodes.values()) {
            if (!baseDedup.has(nodeId)) {
                baseDedup.add(nodeId);
                baseNodeIds.push(nodeId);
            }
        }

        for (const objId of resolveBaseObjIds(base, pag)) {
            if (methodName === "push") {
                const slot = resolveArrayPushSlot(base);
                const dedupKey = `${objId}|${slot}`;
                if (slotDedup.has(dedupKey)) continue;
                slotDedup.add(dedupKey);
                slotStores.push({ objId, slot });
                continue;
            }

            if (methodName === "unshift") {
                const slot = "arr:0";
                const dedupKey = `${objId}|${slot}`;
                if (slotDedup.has(dedupKey)) continue;
                slotDedup.add(dedupKey);
                slotStores.push({ objId, slot });
                continue;
            }

            if (methodName === "splice") {
                const startNum = resolveNumber(args[0]);
                for (let i = 2; i < args.length; i++) {
                    if (args[i] !== local) continue;
                    const slot = startNum === undefined ? "arr:*" : `arr:${startNum + (i - 2)}`;
                    const dedupKey = `${objId}|${slot}`;
                    if (slotDedup.has(dedupKey)) continue;
                    slotDedup.add(dedupKey);
                    slotStores.push({ objId, slot });
                }
            }
        }
    }

    return {
        baseNodeIds,
        slotStores,
    };
}

export function collectPreciseArrayLoadNodeIdsFromTaintedLocal(local: Local, pag: Pag): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkArrayRef) || right !== local) continue;

        const sourceIdx = resolveValueKey(left.getIndex());
        if (sourceIdx === undefined) continue;
        const sourcePaths = collectArrayElementPathKeys(left.getBase(), sourceIdx);
        if (sourcePaths.size === 0) continue;

        for (const rawNode of pag.getNodesIter()) {
            const node = rawNode as PagNode;
            const val = node.getValue();
            if (!(val instanceof Local)) continue;

            const decl = val.getDeclaringStmt();
            if (!(decl instanceof ArkAssignStmt)) continue;
            if (decl.getLeftOp() !== val) continue;

            const loadRef = decl.getRightOp();
            if (!(loadRef instanceof ArkArrayRef)) continue;
            const loadIdx = resolveValueKey(loadRef.getIndex());
            if (loadIdx === undefined) continue;

            const loadPaths = collectArrayElementPathKeys(loadRef.getBase(), loadIdx);
            if (!hasPathIntersection(sourcePaths, loadPaths)) continue;

            const dstNodes = pag.getNodesByValue(val);
            if (!dstNodes) continue;
            for (const dstId of dstNodes.values()) {
                if (dedup.has(dstId)) continue;
                dedup.add(dstId);
                results.push(dstId);
            }
        }
    }

    return results;
}

export function collectOrdinaryArraySlotLoadNodeIds(
    objId: number,
    slot: string,
    pag: Pag,
    scene: Scene,
): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (!baseLocalMatchesArrayCarrier(baseNode, objId)) continue;
        collectOrdinaryArraySlotLoadNodeIdsForBaseLocal(val, slot, pag, scene, results, dedup);
    }

    return results;
}

export function collectOrdinaryArrayHigherOrderEffectsFromTaintedLocal(
    local: Local,
    pag: Pag,
    scene: Scene,
): OrdinaryArrayHigherOrderEffects {
    const callbackParamNodeIds: number[] = [];
    const resultNodeIds: number[] = [];
    const resultSlotStores: OrdinaryArraySlotStoreInfo[] = [];
    const seenObjIds = new Set<number>();
    const callbackDedup = new Set<number>();
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const info of collectOrdinaryArrayMutationEffectsFromTaintedLocal(local, pag).slotStores) {
        if (!info.slot.startsWith("arr:")) continue;
        if (seenObjIds.has(info.objId)) continue;
        seenObjIds.add(info.objId);

        const effect = collectOrdinaryArrayHigherOrderEffectsForObj(info.objId, info.slot, pag, scene);
        for (const nodeId of effect.callbackParamNodeIds) {
            if (callbackDedup.has(nodeId)) continue;
            callbackDedup.add(nodeId);
            callbackParamNodeIds.push(nodeId);
        }
        for (const nodeId of effect.resultNodeIds) {
            if (resultDedup.has(nodeId)) continue;
            resultDedup.add(nodeId);
            resultNodeIds.push(nodeId);
        }
        for (const slotInfo of effect.resultSlotStores) {
            const key = `${slotInfo.objId}|${slotInfo.slot}`;
            if (slotDedup.has(key)) continue;
            slotDedup.add(key);
            resultSlotStores.push(slotInfo);
        }
    }

    return {
        callbackParamNodeIds,
        resultNodeIds,
        resultSlotStores,
    };
}

export function collectOrdinaryArrayConstructorEffectsFromTaintedLocal(
    local: Local,
    pag: Pag,
): OrdinaryArrayResultEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: OrdinaryArraySlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkStaticInvokeExpr) && !(right instanceof ArkInstanceInvokeExpr)) continue;

        const methodName = resolveMethodName(right);
        const sig = right.getMethodSignature()?.toString() || "";
        if (!isArrayStaticCall(sig, methodName)) continue;
        const args = right.getArgs ? right.getArgs() : [];

        if (methodName === "of") {
            let matched = false;
            const holderIds = resolveAssignedContainerHolderIds(stmt.getLeftOp(), pag, stmt);
            for (let i = 0; i < args.length; i++) {
                if (args[i] !== local) continue;
                matched = true;
                for (const holderId of holderIds) {
                    const slot = `arr:${i}`;
                    const key = `${holderId}|${slot}`;
                    if (slotDedup.has(key)) continue;
                    slotDedup.add(key);
                    resultSlotStores.push({ objId: holderId, slot });
                }
            }
            if (!matched) continue;
        } else if (methodName === "from") {
            if (args.length < 1 || args[0] !== local) continue;
            for (const holderId of resolveAssignedContainerHolderIds(stmt.getLeftOp(), pag, stmt)) {
                const key = `${holderId}|arr:*`;
                if (slotDedup.has(key)) continue;
                slotDedup.add(key);
                resultSlotStores.push({ objId: holderId, slot: "arr:*" });
            }
        } else {
            continue;
        }

        const dstNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
        if (!dstNodes) continue;
        for (const nodeId of dstNodes.values()) {
            if (resultDedup.has(nodeId)) continue;
            resultDedup.add(nodeId);
            resultNodeIds.push(nodeId);
        }
    }

    return {
        resultNodeIds,
        resultSlotStores,
    };
}

export function collectOrdinaryStringSplitEffectsFromTaintedLocal(
    local: Local,
    pag: Pag,
): OrdinaryArrayResultEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: OrdinaryArraySlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkInstanceInvokeExpr)) continue;
        if (right.getBase() !== local) continue;
        if (resolveMethodName(right) !== "split") continue;

        const dstNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
        if (dstNodes) {
            for (const nodeId of dstNodes.values()) {
                if (resultDedup.has(nodeId)) continue;
                resultDedup.add(nodeId);
                resultNodeIds.push(nodeId);
            }
        }

        for (const holderId of resolveAssignedContainerHolderIds(stmt.getLeftOp(), pag, stmt)) {
            const key = `${holderId}|arr:*`;
            if (slotDedup.has(key)) continue;
            slotDedup.add(key);
            resultSlotStores.push({ objId: holderId, slot: "arr:*" });
        }
    }

    return {
        resultNodeIds,
        resultSlotStores,
    };
}

export function collectOrdinaryArrayViewEffectsBySlot(
    objId: number,
    slot: string,
    pag: Pag,
): OrdinaryArrayResultEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: OrdinaryArraySlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (!baseLocalMatchesArrayCarrier(baseNode, objId)) continue;
        collectOrdinaryArrayViewEffectsBySlotForBaseLocal(val, slot, pag, resultNodeIds, resultSlotStores, resultDedup, slotDedup);
    }

    return {
        resultNodeIds,
        resultSlotStores,
    };
}

export function collectOrdinaryArrayStaticViewEffectsBySlot(
    objId: number,
    slot: string,
    pag: Pag,
): OrdinaryArrayResultEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: OrdinaryArraySlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (!baseLocalMatchesArrayCarrier(baseNode, objId)) continue;

        const effects = collectOrdinaryArrayStaticViewEffectsBySlotFromLocal(val, slot, pag);
        for (const nodeId of effects.resultNodeIds) {
            if (resultDedup.has(nodeId)) continue;
            resultDedup.add(nodeId);
            resultNodeIds.push(nodeId);
        }
        for (const info of effects.resultSlotStores) {
            const key = `${info.objId}|${info.slot}`;
            if (slotDedup.has(key)) continue;
            slotDedup.add(key);
            resultSlotStores.push(info);
        }
    }

    return {
        resultNodeIds,
        resultSlotStores,
    };
}

export function collectOrdinaryArrayFromMapperCallbackParamNodeIdsFromTaintedLocal(
    local: Local,
    pag: Pag,
    scene: Scene,
): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt) && !(stmt instanceof ArkInvokeStmt)) continue;
        const invokeExpr = stmt instanceof ArkAssignStmt ? stmt.getRightOp() : stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkStaticInvokeExpr) && !(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const methodName = resolveMethodName(invokeExpr);
        const sig = invokeExpr.getMethodSignature()?.toString() || "";
        if (!isArrayStaticCall(sig, methodName) || methodName !== "from") continue;
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length < 2 || args[0] !== local) continue;

        for (const nodeId of collectCallbackParamNodeIds(scene, pag, args[1], [0])) {
            if (dedup.has(nodeId)) continue;
            dedup.add(nodeId);
            results.push(nodeId);
        }
    }

    return results;
}

export function collectOrdinaryArrayFromMapperCallbackParamNodeIdsForObj(
    objId: number,
    pag: Pag,
    scene: Scene,
): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (!baseLocalMatchesArrayCarrier(baseNode, objId)) continue;

        for (const nodeId of collectOrdinaryArrayFromMapperCallbackParamNodeIdsFromTaintedLocal(val, pag, scene)) {
            if (dedup.has(nodeId)) continue;
            dedup.add(nodeId);
            results.push(nodeId);
        }
    }

    return results;
}

export function collectOrdinaryHigherOrderCallbackMethodSignaturesFromMethod(
    scene: Scene,
    method: any,
): string[] {
    const cfg = method?.getCfg?.();
    if (!cfg) return [];

    const out = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        const invokeExpr = stmt instanceof ArkAssignStmt
            ? stmt.getRightOp()
            : stmt instanceof ArkInvokeStmt
                ? stmt.getInvokeExpr()
                : undefined;
        if (!(invokeExpr instanceof ArkStaticInvokeExpr) && !(invokeExpr instanceof ArkInstanceInvokeExpr)) {
            continue;
        }

        const methodName = resolveMethodName(invokeExpr);
        const sig = invokeExpr.getMethodSignature()?.toString() || "";
        if (isArrayStaticCall(sig, methodName) && methodName === "from") {
            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length < 2) continue;
            for (const callbackMethod of resolveCallbackMethods(scene, args[1])) {
                const signature = callbackMethod?.getSignature?.()?.toString?.();
                if (signature) out.add(signature);
            }
            continue;
        }

        const callbackParamIndexes = resolveArrayHigherOrderCallbackParamIndexes(methodName);
        if (!callbackParamIndexes) continue;
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length === 0) continue;
        for (const callbackMethod of resolveCallbackMethods(scene, args[0])) {
            const signature = callbackMethod?.getSignature?.()?.toString?.();
            if (signature) out.add(signature);
        }
    }

    return [...out];
}

function collectOrdinaryArrayHigherOrderEffectsForObj(
    objId: number,
    slot: string,
    pag: Pag,
    scene: Scene,
): OrdinaryArrayHigherOrderEffects {
    const callbackParamNodeIds: number[] = [];
    const resultNodeIds: number[] = [];
    const resultSlotStores: OrdinaryArraySlotStoreInfo[] = [];
    const callbackDedup = new Set<number>();
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (!baseLocalMatchesArrayCarrier(baseNode, objId)) continue;

        for (const stmt of val.getUsedStmts()) {
            if (stmt instanceof ArkInvokeStmt) {
                const invokeExpr = stmt.getInvokeExpr();
                if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
                if (invokeExpr.getBase() !== val) continue;
                const methodName = resolveMethodName(invokeExpr);
                const callbackParamIndexes = resolveArrayHigherOrderCallbackParamIndexes(methodName);
                if (!callbackParamIndexes) continue;
                const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
                if (args.length === 0) continue;

                for (const nodeId of collectCallbackParamNodeIds(scene, pag, args[0], callbackParamIndexes)) {
                    if (callbackDedup.has(nodeId)) continue;
                    callbackDedup.add(nodeId);
                    callbackParamNodeIds.push(nodeId);
                }
                continue;
            }

            if (!(stmt instanceof ArkAssignStmt)) continue;
            const right = stmt.getRightOp();
            if (!(right instanceof ArkInstanceInvokeExpr)) continue;
            if (right.getBase() !== val) continue;
            const methodName = resolveMethodName(right);
            const args = right.getArgs ? right.getArgs() : [];
            if (args.length === 0) continue;

            const callbackParamIndexes = resolveArrayHigherOrderCallbackParamIndexes(methodName);
            if (!callbackParamIndexes) continue;

            for (const nodeId of collectCallbackParamNodeIds(scene, pag, args[0], callbackParamIndexes)) {
                if (callbackDedup.has(nodeId)) continue;
                callbackDedup.add(nodeId);
                callbackParamNodeIds.push(nodeId);
            }

            if (methodName === "map" || methodName === "filter" || methodName === "flatMap") {
                const dstNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
                if (dstNodes) {
                    for (const nodeId of dstNodes.values()) {
                        if (resultDedup.has(nodeId)) continue;
                        resultDedup.add(nodeId);
                        resultNodeIds.push(nodeId);
                    }
                }
                const resultHolderIds = resolveAssignedContainerHolderIds(stmt.getLeftOp(), pag, stmt);
                for (const resultHolderId of resultHolderIds) {
                    const key = `${resultHolderId}|${slot}`;
                    if (slotDedup.has(key)) continue;
                    slotDedup.add(key);
                    resultSlotStores.push({ objId: resultHolderId, slot });
                }
                continue;
            }

            if (methodName === "find" || methodName === "reduce" || methodName === "reduceRight") {
                const dstNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
                if (dstNodes) {
                    for (const nodeId of dstNodes.values()) {
                        if (resultDedup.has(nodeId)) continue;
                        resultDedup.add(nodeId);
                        resultNodeIds.push(nodeId);
                    }
                }
            }
        }
    }

    return {
        callbackParamNodeIds,
        resultNodeIds,
        resultSlotStores,
    };
}

function collectOrdinaryArraySlotLoadNodeIdsForBaseLocal(
    val: Local,
    slot: string,
    pag: Pag,
    scene: Scene,
    results: number[],
    dedup: Set<number>,
): void {
    for (const stmt of val.getUsedStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const right = stmt.getRightOp();
            const left = stmt.getLeftOp();

            if (right instanceof ArkInstanceFieldRef && right.getBase() === val) {
                const fieldName = right.getFieldSignature().getFieldName();
                if (/^-?\d+$/.test(fieldName) && slot.startsWith("arr:")) {
                    const expectedSlot = `arr:${fieldName}`;
                    if (isArraySlotMatch(slot, expectedSlot)) {
                        const dst = getOrCreatePagNodes(pag, left, stmt);
                        if (!dst) continue;
                        for (const id of dst.values()) {
                            if (dedup.has(id)) continue;
                            dedup.add(id);
                            results.push(id);
                        }
                    }
                }
            }

            if (right instanceof ArkArrayRef && right.getBase() === val) {
                continue;
            }

            if (right instanceof ArkInstanceInvokeExpr && right.getBase() === val) {
                const methodName = resolveMethodName(right);
                const args = right.getArgs ? right.getArgs() : [];

                let matched = false;
                if ((methodName === "values" || methodName === "entries") && slot.startsWith("arr:")) {
                    matched = true;
                } else if (methodName === "toString" && slot.startsWith("arr:")) {
                    matched = true;
                } else if (methodName === "flat" && slot.startsWith("arr:")) {
                    matched = true;
                } else if (methodName === "at" && slot.startsWith("arr:")) {
                    const idxKey = args.length > 0 ? resolveValueKey(args[0]) : undefined;
                    matched = idxKey !== undefined && isArraySlotMatch(slot, `arr:${idxKey}`);
                } else if (methodName === "shift" && isArraySlotMatch(slot, "arr:0")) {
                    matched = true;
                } else if (methodName === "pop" && slot.startsWith("arr:")) {
                    matched = isLikelyArrayPopSourceSlot(slot, val);
                } else if (methodName === "splice" && slot.startsWith("arr:")) {
                    matched = isSpliceRemovedSlot(slot, args);
                }

                if (matched) {
                    const dst = getOrCreatePagNodes(pag, left, stmt);
                    if (!dst) continue;
                    for (const id of dst.values()) {
                        if (dedup.has(id)) continue;
                        dedup.add(id);
                        results.push(id);
                    }
                }
            }

            if (right instanceof ArkInstanceInvokeExpr) {
                const methodName = resolveMethodName(right);
                const args = right.getArgs ? right.getArgs() : [];
                if (methodName === "concat" && slot.startsWith("arr:") && args.includes(val)) {
                    const dst = getOrCreatePagNodes(pag, left, stmt);
                    if (!dst) continue;
                    for (const id of dst.values()) {
                        if (dedup.has(id)) continue;
                        dedup.add(id);
                        results.push(id);
                    }
                }
            }
        }

        if (stmt instanceof ArkInvokeStmt) {
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            if (invokeExpr.getBase() !== val) continue;
            if (resolveMethodName(invokeExpr) !== "forEach") continue;
            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length === 0) continue;

            const callbackParamNodeIds = collectCallbackParamNodeIds(scene, pag, args[0], [0]);
            for (const nodeId of callbackParamNodeIds) {
                if (dedup.has(nodeId)) continue;
                dedup.add(nodeId);
                results.push(nodeId);
            }
        }
    }
}

function collectOrdinaryArrayViewEffectsBySlotForBaseLocal(
    val: Local,
    slot: string,
    pag: Pag,
    resultNodeIds: number[],
    resultSlotStores: OrdinaryArraySlotStoreInfo[],
    resultDedup: Set<number>,
    slotDedup: Set<string>,
): void {
    for (const stmt of val.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkInstanceInvokeExpr)) continue;
        if (right.getBase() !== val) continue;

        const methodName = resolveMethodName(right);
        let matched = false;
        if ((methodName === "values" || methodName === "entries" || methodName === "flat") && slot.startsWith("arr:")) {
            matched = true;
        } else if (methodName === "splice") {
            matched = isSpliceRemovedSlot(slot, right.getArgs ? right.getArgs() : []);
        }

        if (!matched) continue;

        const dstNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
        if (dstNodes) {
            for (const nodeId of dstNodes.values()) {
                if (resultDedup.has(nodeId)) continue;
                resultDedup.add(nodeId);
                resultNodeIds.push(nodeId);
            }
        }

        const resultSlot = resolveArrayViewResultSlot(methodName, slot, right.getArgs ? right.getArgs() : []);
        for (const holderId of resolveAssignedContainerHolderIds(stmt.getLeftOp(), pag, stmt)) {
            const key = `${holderId}|${resultSlot}`;
            if (slotDedup.has(key)) continue;
            slotDedup.add(key);
            resultSlotStores.push({ objId: holderId, slot: resultSlot });
        }
    }
}

function collectOrdinaryArrayStaticViewEffectsBySlotFromLocal(
    local: Local,
    slot: string,
    pag: Pag,
): OrdinaryArrayResultEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: OrdinaryArraySlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    if (!slot.startsWith("arr:")) {
        return { resultNodeIds, resultSlotStores };
    }

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkStaticInvokeExpr) && !(right instanceof ArkInstanceInvokeExpr)) continue;
        const methodName = resolveMethodName(right);
        const sig = right.getMethodSignature()?.toString() || "";
        if (!isArrayStaticCall(sig, methodName)) continue;
        const args = right.getArgs ? right.getArgs() : [];
        if (methodName !== "from" || args.length < 1 || args[0] !== local) continue;

        const dstNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
        if (dstNodes) {
            for (const nodeId of dstNodes.values()) {
                if (resultDedup.has(nodeId)) continue;
                resultDedup.add(nodeId);
                resultNodeIds.push(nodeId);
            }
        }

        for (const holderId of resolveAssignedContainerHolderIds(stmt.getLeftOp(), pag, stmt)) {
            const resultSlot = slot === "arr:*" ? "arr:*" : slot;
            const key = `${holderId}|${resultSlot}`;
            if (slotDedup.has(key)) continue;
            slotDedup.add(key);
            resultSlotStores.push({ objId: holderId, slot: resultSlot });
        }
    }

    return {
        resultNodeIds,
        resultSlotStores,
    };
}

function baseLocalMatchesArrayCarrier(baseNode: PagNode, carrierId: number): boolean {
    if (baseNode.getID() === carrierId) return true;
    return baseNode.getPointTo().contains(carrierId);
}

function resolveArrayMutationInvoke(stmt: any): ArkInstanceInvokeExpr | undefined {
    if (stmt instanceof ArkInvokeStmt) {
        const invokeExpr = stmt.getInvokeExpr();
        return invokeExpr instanceof ArkInstanceInvokeExpr ? invokeExpr : undefined;
    }
    if (stmt instanceof ArkAssignStmt) {
        const right = stmt.getRightOp();
        return right instanceof ArkInstanceInvokeExpr ? right : undefined;
    }
    return undefined;
}

function resolveMethodName(invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr): string {
    const fromSig = invokeExpr.getMethodSignature()?.getMethodSubSignature()?.getMethodName() || "";
    if (fromSig) return fromSig;
    const sig = invokeExpr.getMethodSignature()?.toString() || "";
    const matched = sig.match(/\.([A-Za-z0-9_]+)\(\)/);
    return matched ? matched[1] : "";
}

function isArrayStaticCall(sig: string, methodName: string): boolean {
    if (methodName !== "from" && methodName !== "of") return false;
    return sig.length === 0 || sig.includes("Array.") || sig.includes("@%unk/%unk");
}

function isArrayMutationForBase(methodName: string): boolean {
    return methodName === "push" || methodName === "unshift" || methodName === "splice";
}

function isMutationInputAffectingBase(methodName: string, base: Local, args: any[], local: Local): boolean {
    if (base === local) return true;
    if (methodName === "splice") {
        return args.slice(2).includes(local);
    }
    return args.includes(local);
}

function resolveContainerKind(base: Local, sig: string): "array" | undefined {
    if (sig.includes("Array.")) return "array";
    const baseType = base.getType?.();
    const text = baseType?.toString?.() || "";
    if (baseType instanceof ArrayType || text.endsWith("[]")) return "array";
    return undefined;
}

function collectCallbackParamNodeIds(scene: Scene, pag: Pag, callbackArg: any, paramIndexes?: number[]): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();
    const indexFilter = paramIndexes && paramIndexes.length > 0 ? new Set(paramIndexes) : undefined;
    const methods = resolveCallbackMethods(scene, callbackArg);

    for (const method of methods) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof ArkParameterRef)) continue;
            if (indexFilter && !indexFilter.has(rightOp.getIndex())) continue;
            let dst = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
            if (!dst || dst.size === 0) {
                dst = pag.getNodesByValue(rightOp);
            }
            if (!dst || dst.size === 0) continue;
            for (const nodeId of dst.values()) {
                if (dedup.has(nodeId)) continue;
                dedup.add(nodeId);
                results.push(nodeId);
            }
        }
    }

    return results;
}

function resolveCallbackMethods(scene: Scene, callbackArg: any): any[] {
    const methods: any[] = [];
    const seen = new Set<string>();

    const addMethod = (method: any): void => {
        const sig = method?.getSignature?.().toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        methods.push(method);
    };

    const callableMethods = resolveMethodsFromCallable(scene, callbackArg, { maxCandidates: 8 });
    for (const method of callableMethods) {
        addMethod(method);
    }

    if (methods.length > 0) return methods;

    const names = new Set<string>();
    if (callbackArg instanceof Local) names.add(callbackArg.getName());
    const text = callbackArg?.toString?.() || "";
    if (text) names.add(text);

    for (const name of names) {
        const matched = scene.getMethods().filter(m => m.getName() === name);
        for (const method of matched) addMethod(method);
    }
    return methods;
}

function resolveArrayHigherOrderCallbackParamIndexes(methodName: string): number[] | undefined {
    if (methodName === "reduce" || methodName === "reduceRight") return [1];
    if (
        methodName === "forEach"
        || methodName === "map"
        || methodName === "filter"
        || methodName === "flatMap"
        || methodName === "find"
        || methodName === "findIndex"
        || methodName === "some"
        || methodName === "every"
    ) {
        return [0];
    }
    return undefined;
}

function getOrCreatePagNodes(pag: Pag, value: any, anchorStmt: ArkAssignStmt): Map<number, number> | undefined {
    return safeGetOrCreatePagNodes(pag, value, anchorStmt);
}

function resolveBaseObjIds(base: Local, pag: Pag): number[] {
    const ids: number[] = [];
    const baseNodes = pag.getNodesByValue(base);
    if (!baseNodes) return ids;
    for (const baseNodeId of baseNodes.values()) {
        const baseNode = pag.getNode(baseNodeId) as PagNode;
        for (const objId of baseNode.getPointTo()) {
            ids.push(objId);
        }
    }
    return ids;
}

function resolveAssignedObjIds(value: any, pag: Pag): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    const nodes = pag.getNodesByValue(value);
    if (!nodes) return out;
    for (const nodeId of nodes.values()) {
        const node = pag.getNode(nodeId) as PagNode;
        for (const objId of node.getPointTo()) {
            if (seen.has(objId)) continue;
            seen.add(objId);
            out.push(objId);
        }
    }
    return out;
}

function resolveAssignedContainerHolderIds(value: any, pag: Pag, anchorStmt: ArkAssignStmt): number[] {
    const objIds = resolveAssignedObjIds(value, pag);
    if (objIds.length > 0) return objIds;
    const nodes = getOrCreatePagNodes(pag, value, anchorStmt);
    return nodes ? [...nodes.values()] : [];
}

function resolveArrayPushSlot(base: Local): string {
    const maxIndex = resolveArrayMaxStoredIndex(base, new Set<Local>());
    return maxIndex === undefined ? "arr:*" : `arr:${maxIndex + 1}`;
}

function resolveArrayViewResultSlot(methodName: string, sourceSlot: string, args: any[]): string {
    if ((methodName === "values" || methodName === "entries") && sourceSlot.startsWith("arr:")) {
        return sourceSlot;
    }
    if (methodName === "splice") {
        return resolveSpliceResultSlot(sourceSlot, args);
    }
    return "arr:*";
}

function isSpliceRemovedSlot(slot: string, args: any[]): boolean {
    if (slot === "arr:*") return true;
    const slotIndex = parseArraySlotIndex(slot);
    if (slotIndex === undefined) return false;
    const start = resolveNumber(args[0]);
    if (start === undefined) return true;
    const deleteCount = args.length >= 2 ? resolveNumber(args[1]) : undefined;
    if (deleteCount === undefined) return slotIndex >= start;
    return slotIndex >= start && slotIndex < start + deleteCount;
}

function resolveSpliceResultSlot(sourceSlot: string, args: any[]): string {
    if (sourceSlot === "arr:*") return "arr:*";
    const slotIndex = parseArraySlotIndex(sourceSlot);
    if (slotIndex === undefined) return "arr:*";
    const start = resolveNumber(args[0]);
    if (start === undefined) return "arr:*";
    return `arr:${Math.max(slotIndex - start, 0)}`;
}

function isLikelyArrayPopSourceSlot(slot: string, base: Local): boolean {
    if (slot === "arr:*") return true;
    const slotIndex = parseArraySlotIndex(slot);
    if (slotIndex === undefined) return false;
    const maxIndex = resolveArrayMaxStoredIndex(base, new Set<Local>());
    if (maxIndex === undefined) {
        return true;
    }
    return slotIndex === maxIndex;
}

function parseArraySlotIndex(slot: string): number | undefined {
    const matched = slot.match(/^arr:(-?\d+)$/);
    if (!matched) return undefined;
    const value = Number(matched[1]);
    return Number.isFinite(value) ? value : undefined;
}

function isArraySlotMatch(taintedSlot: string, expectedSlot: string): boolean {
    if (taintedSlot === expectedSlot) return true;
    if (taintedSlot.endsWith("*")) {
        return expectedSlot.startsWith(taintedSlot.slice(0, -1));
    }
    return false;
}

function resolveArrayMaxStoredIndex(local: Local, visiting: Set<Local>): number | undefined {
    if (visiting.has(local)) return undefined;
    visiting.add(local);

    let maxIndex: number | undefined = undefined;

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (left.getBase() !== local) continue;
        const idxKey = resolveValueKey(left.getIndex());
        if (idxKey === undefined) continue;
        const idxNum = Number(idxKey);
        if (!Number.isFinite(idxNum)) continue;
        maxIndex = maxIndex === undefined ? idxNum : Math.max(maxIndex, idxNum);
    }

    const decl = local.getDeclaringStmt();
    if (decl instanceof ArkAssignStmt && decl.getLeftOp() === local) {
        const right = decl.getRightOp();
        if (right instanceof Local) {
            const rhsMax = resolveArrayMaxStoredIndex(right, visiting);
            if (rhsMax !== undefined) {
                maxIndex = maxIndex === undefined ? rhsMax : Math.max(maxIndex, rhsMax);
            }
        }
    }

    visiting.delete(local);
    return maxIndex;
}

function collectArrayElementPathKeys(base: Local, idxKey: string): Set<string> {
    const keys = new Set<string>();
    for (const pathKey of collectArrayObjectPathKeys(base, new Set<Local>())) {
        keys.add(`${pathKey}/${idxKey}`);
    }
    return keys;
}

function collectArrayObjectPathKeys(local: Local, visiting: Set<Local>): Set<string> {
    if (visiting.has(local)) {
        return new Set([rootPathKey(local)]);
    }
    visiting.add(local);

    const keys = new Set<string>();
    const decl = local.getDeclaringStmt();

    if (decl instanceof ArkAssignStmt && decl.getLeftOp() === local) {
        const right = decl.getRightOp();
        if (right instanceof Local) {
            mergePathKeys(keys, collectArrayObjectPathKeys(right, visiting));
        } else if (right instanceof ArkArrayRef) {
            const idx = resolveValueKey(right.getIndex());
            if (idx !== undefined) {
                for (const pathKey of collectArrayObjectPathKeys(right.getBase(), visiting)) {
                    keys.add(`${pathKey}/${idx}`);
                }
            }
        } else {
            keys.add(rootPathKey(local));
        }
    } else {
        keys.add(rootPathKey(local));
    }

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (right !== local) continue;

        const parentIdx = resolveValueKey(left.getIndex());
        if (parentIdx === undefined) continue;
        for (const pathKey of collectArrayObjectPathKeys(left.getBase(), visiting)) {
            keys.add(`${pathKey}/${parentIdx}`);
        }
    }

    visiting.delete(local);
    return keys;
}

function mergePathKeys(target: Set<string>, src: Set<string>): void {
    for (const key of src) target.add(key);
}

function rootPathKey(local: Local): string {
    const line = local.getDeclaringStmt()?.getOriginPositionInfo()?.getLineNo?.() ?? -1;
    const methodSig = local
        .getDeclaringStmt?.()
        ?.getCfg?.()
        ?.getDeclaringMethod?.()
        ?.getSignature?.()
        ?.toString?.() || "";
    return `${methodSig}::${local.getName()}@${line}`;
}

function hasPathIntersection(a: Set<string>, b: Set<string>): boolean {
    for (const key of a) {
        if (b.has(key)) return true;
    }
    return false;
}

function resolveValueKey(v: any): string | undefined {
    if (v instanceof Constant) {
        return normalizeLiteral(v.toString());
    }

    if (v instanceof Local) {
        const decl = v.getDeclaringStmt();
        if (decl instanceof ArkAssignStmt) {
            const right = decl.getRightOp();
            if (right instanceof Constant) {
                return normalizeLiteral(right.toString());
            }
            if (right instanceof ArkNormalBinopExpr) {
                const n1 = resolveNumber(right.getOp1());
                const n2 = resolveNumber(right.getOp2());
                if (n1 !== undefined && n2 !== undefined) {
                    const op = right.getOperator();
                    if (op === "+") return String(n1 + n2);
                    if (op === "-") return String(n1 - n2);
                    if (op === "*") return String(n1 * n2);
                    if (op === "/" && n2 !== 0) return String(n1 / n2);
                }
            }
        }
        return v.getName();
    }

    return undefined;
}

function resolveNumber(v: any): number | undefined {
    if (v instanceof Constant) {
        const text = normalizeLiteral(v.toString());
        const n = Number(text);
        if (!Number.isNaN(n)) return n;
    }
    if (v instanceof Local) {
        const key = resolveValueKey(v);
        const n = key !== undefined ? Number(key) : NaN;
        if (!Number.isNaN(n)) return n;
    }
    return undefined;
}

function normalizeLiteral(text: string): string {
    return text.replace(/^['"`]/, "").replace(/['"`]$/, "");
}
