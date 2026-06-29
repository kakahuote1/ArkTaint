import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt, ArkInvokeStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkCastExpr, ArkNormalBinopExpr, ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../arkanalyzer/out/src/core/base/Constant";
import { ArrayType } from "../../../../arkanalyzer/out/src/core/base/Type";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { resolveMethodsFromCallable } from "../../substrate/queries/CalleeResolver";
import { resolveExistingPagNodes, materializeExactPagNodes } from "../contracts/PagNodeResolution";
import { fromContainerFieldKey } from "../model/ContainerSlotKeys";

export interface OrdinaryArraySlotStoreInfo {
    objId: number;
    slot: string;
    carrierNodeId?: number;
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

export interface OrdinaryCollectionMutationEffects {
    baseNodeIds: number[];
    slotStores: OrdinaryArraySlotStoreInfo[];
}

export interface OrdinaryCollectionLoadEffects {
    resultNodeIds: number[];
    callbackParamNodeIds: number[];
    resultSlotStores: OrdinaryArraySlotStoreInfo[];
}

type ArraySlotIndexResolver = (indexValue: any, anchorStmt: ArkAssignStmt) => string | undefined;

const baseLocalCandidatesByCarrierCache: WeakMap<Pag, Map<number, Local[]>> = new WeakMap();
const arrayObjectPathKeysByCarrierCache: WeakMap<Pag, Map<number, Set<string>>> = new WeakMap();
const arrayLoadDestNodeIdsByPathKeyCache: WeakMap<Pag, Map<string, Set<number>>> = new WeakMap();
const localUseStmtsWithCfgRecoveryCache: WeakMap<Local, any[]> = new WeakMap();

export function collectOrdinaryArrayMutationEffectsFromTaintedLocal(
    local: Local,
    pag: Pag,
): OrdinaryArrayMutationEffects {
    const baseNodeIds: number[] = [];
    const slotStores: OrdinaryArraySlotStoreInfo[] = [];
    const baseDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(local)) {
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

        for (const target of resolveBaseCarrierTargets(base, pag)) {
            if (methodName === "push") {
                const slot = resolveArrayPushSlot(base, stmt);
                const dedupKey = `${target.carrierNodeId}|${target.objId}|${slot}`;
                if (slotDedup.has(dedupKey)) continue;
                slotDedup.add(dedupKey);
                slotStores.push({ objId: target.objId, slot, carrierNodeId: target.carrierNodeId });
                continue;
            }

            if (methodName === "unshift") {
                const slot = "arr:0";
                const dedupKey = `${target.carrierNodeId}|${target.objId}|${slot}`;
                if (slotDedup.has(dedupKey)) continue;
                slotDedup.add(dedupKey);
                slotStores.push({ objId: target.objId, slot, carrierNodeId: target.carrierNodeId });
                continue;
            }

            if (methodName === "splice") {
                const startNum = resolveNumber(args[0]);
                for (let i = 2; i < args.length; i++) {
                    if (!sameLocalValue(args[i], local)) continue;
                    const slot = startNum === undefined ? "arr:*" : `arr:${startNum + (i - 2)}`;
                    const dedupKey = `${target.carrierNodeId}|${target.objId}|${slot}`;
                    if (slotDedup.has(dedupKey)) continue;
                    slotDedup.add(dedupKey);
                    slotStores.push({ objId: target.objId, slot, carrierNodeId: target.carrierNodeId });
                }
            }
        }
    }

    return {
        baseNodeIds,
        slotStores,
    };
}

type OrdinaryCollectionKind = "map" | "set" | "list" | "queue" | "stack";

export function collectOrdinaryCollectionMutationEffectsFromTaintedLocal(
    local: Local,
    pag: Pag,
): OrdinaryCollectionMutationEffects {
    const baseNodeIds: number[] = [];
    const slotStores: OrdinaryArraySlotStoreInfo[] = [];
    const baseDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(local)) {
        const invokeExpr = resolveArrayMutationInvoke(stmt);
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const base = invokeExpr.getBase();
        if (!(base instanceof Local)) continue;

        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const methodName = resolveMethodName(invokeExpr);
        const sig = invokeExpr.getMethodSignature()?.toString() || "";
        const collectionKind = resolveOrdinaryCollectionKind(base, sig);
        if (!collectionKind) continue;

        const stores = resolveCollectionMutationSlots(collectionKind, methodName, args, local, base, stmt);
        const baseIsAffected = sameLocalValue(base, local) || stores.length > 0;
        if (!baseIsAffected) continue;

        const baseNodes = pag.getNodesByValue(base);
        if (baseNodes) {
            for (const nodeId of baseNodes.values()) {
                if (baseDedup.has(nodeId)) continue;
                baseDedup.add(nodeId);
                baseNodeIds.push(nodeId);
            }
        }

        if (stores.length === 0) continue;
        for (const target of resolveBaseCarrierTargets(base, pag)) {
            for (const slot of stores) {
                const key = `${target.carrierNodeId}|${target.objId}|${slot}`;
                if (slotDedup.has(key)) continue;
                slotDedup.add(key);
                slotStores.push({ objId: target.objId, slot, carrierNodeId: target.carrierNodeId });
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
    const loadIndex = getArrayLoadDestNodeIdsByPathKey(pag);

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(local)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkArrayRef) || !sameLocalValue(right, local)) continue;

        const sourceIdx = resolveValueKey(left.getIndex());
        if (sourceIdx === undefined) continue;
        const sourcePaths = collectArrayElementPathKeys(left.getBase(), sourceIdx);
        if (sourcePaths.size === 0) continue;

        for (const sourcePath of sourcePaths) {
            const dstNodes = loadIndex.get(sourcePath);
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

function getArrayLoadDestNodeIdsByPathKey(pag: Pag): Map<string, Set<number>> {
    const cached = arrayLoadDestNodeIdsByPathKeyCache.get(pag);
    if (cached) return cached;

    const index = new Map<string, Set<number>>();
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const val = node.getValue();
        if (!(val instanceof Local)) continue;

        const decl = val.getDeclaringStmt();
        if (!(decl instanceof ArkAssignStmt)) continue;
        if (!sameLocalValue(decl.getLeftOp(), val)) continue;

        const loadRef = decl.getRightOp();
        if (!(loadRef instanceof ArkArrayRef)) continue;
        const loadIdx = resolveValueKey(loadRef.getIndex());
        if (loadIdx === undefined) continue;

        const loadPaths = collectArrayElementPathKeys(loadRef.getBase(), loadIdx);
        if (loadPaths.size === 0) continue;

        const dstNodes = pag.getNodesByValue(val);
        if (!dstNodes) continue;
        for (const pathKey of loadPaths) {
            let bucket = index.get(pathKey);
            if (!bucket) {
                bucket = new Set<number>();
                index.set(pathKey, bucket);
            }
            for (const dstId of dstNodes.values()) {
                bucket.add(dstId);
            }
        }
    }
    arrayLoadDestNodeIdsByPathKeyCache.set(pag, index);
    return index;
}

export function collectOrdinaryArraySlotLoadNodeIds(
    objId: number,
    slot: string,
    pag: Pag,
    scene: Scene,
    scopeMethodSignature?: string,
    indexResolver?: ArraySlotIndexResolver,
): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const val of collectBaseLocalCandidatesForCarrier(pag, objId)) {
        if (scopeMethodSignature && localDeclaringMethodSignature(val) !== scopeMethodSignature) continue;
        if (!arrayLoadAliasMatchesCarrier(pag, val, objId)) continue;
        collectOrdinaryArraySlotLoadNodeIdsForBaseLocal(val, slot, pag, scene, results, dedup, indexResolver);
    }

    return results;
}

export function collectOrdinaryCollectionLoadEffectsFromTaintedSlot(
    objId: number,
    slot: string,
    pag: Pag,
    scene: Scene,
): OrdinaryCollectionLoadEffects {
    const normalizedSlot = normalizeOrdinaryCollectionSlot(slot);
    const resultNodeIds: number[] = [];
    const callbackParamNodeIds: number[] = [];
    const resultSlotStores: OrdinaryArraySlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const callbackDedup = new Set<number>();
    const slotDedup = new Set<string>();

    if (!normalizedSlot) {
        return {
            resultNodeIds,
            callbackParamNodeIds,
            resultSlotStores,
        };
    }

    for (const val of collectBaseLocalCandidatesForCarrier(pag, objId)) {
        collectOrdinaryCollectionLoadEffectsForBaseLocal(
            val,
            normalizedSlot,
            pag,
            scene,
            resultNodeIds,
            callbackParamNodeIds,
            resultSlotStores,
            resultDedup,
            callbackDedup,
            slotDedup,
        );
    }

    return {
        resultNodeIds,
        callbackParamNodeIds,
        resultSlotStores,
    };
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

    if (isArrayParameterElementSource(local)) {
        const effect = collectOrdinaryArrayHigherOrderEffectsForBaseLocal(local, "arr:*", pag, scene);
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

export function collectOrdinaryArrayHigherOrderEffectsFromTaintedSlot(
    objId: number,
    slot: string,
    pag: Pag,
    scene: Scene,
): OrdinaryArrayHigherOrderEffects {
    if (!slot.startsWith("arr:")) {
        return {
            callbackParamNodeIds: [],
            resultNodeIds: [],
            resultSlotStores: [],
        };
    }
    return collectOrdinaryArrayHigherOrderEffectsForObj(objId, slot, pag, scene);
}

export function collectOrdinaryPromiseAggregateEffectsFromArraySlot(
    objId: number,
    slot: string,
    pag: Pag,
    scene: Scene,
    scopeMethodSignature?: string,
): OrdinaryArrayResultEffects {
    const normalizedSlot = fromContainerFieldKey(slot) || slot;
    const resultNodeIds: number[] = [];
    const resultSlotStores: OrdinaryArraySlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    if (!normalizedSlot.startsWith("arr:")) {
        return {
            resultNodeIds,
            resultSlotStores,
        };
    }

    for (const val of collectBaseLocalCandidatesForCarrier(pag, objId)) {
        if (scopeMethodSignature && localDeclaringMethodSignature(val) !== scopeMethodSignature) continue;
        if (!arrayLoadAliasMatchesCarrier(pag, val, objId)) continue;

        collectOrdinaryPromiseAggregateEffectsForArrayLocal(
            val,
            normalizedSlot,
            pag,
            scene,
            resultNodeIds,
            resultSlotStores,
            resultDedup,
            slotDedup,
        );
    }

    return {
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

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(local)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkStaticInvokeExpr) && !(right instanceof ArkInstanceInvokeExpr)) continue;

        const methodName = resolveMethodName(right);
        const sig = right.getMethodSignature()?.toString() || "";
        if (!isArrayStaticCall(sig, methodName, right)) continue;
        const args = right.getArgs ? right.getArgs() : [];

        if (methodName === "of") {
            let matched = false;
            const holderIds = resolveAssignedContainerHolderIds(stmt.getLeftOp(), pag, stmt);
            for (let i = 0; i < args.length; i++) {
                if (!sameLocalValue(args[i], local)) continue;
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
            if (args.length < 1 || !sameLocalValue(args[0], local)) continue;
            for (const holderId of resolveAssignedContainerHolderIds(stmt.getLeftOp(), pag, stmt)) {
                const key = `${holderId}|arr:*`;
                if (slotDedup.has(key)) continue;
                slotDedup.add(key);
                resultSlotStores.push({ objId: holderId, slot: "arr:*" });
            }
        } else {
            continue;
        }

        const dstNodes = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
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

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(local)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkInstanceInvokeExpr)) continue;
        if (!sameLocalValue(right.getBase(), local)) continue;
        if (resolveMethodName(right) !== "split") continue;

        const dstNodes = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
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
    scopeMethodSignature?: string,
): OrdinaryArrayResultEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: OrdinaryArraySlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const val of collectBaseLocalCandidatesForCarrier(pag, objId)) {
        if (scopeMethodSignature && localDeclaringMethodSignature(val) !== scopeMethodSignature) continue;
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
    scopeMethodSignature?: string,
): OrdinaryArrayResultEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: OrdinaryArraySlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const val of collectBaseLocalCandidatesForCarrier(pag, objId)) {
        if (scopeMethodSignature && localDeclaringMethodSignature(val) !== scopeMethodSignature) continue;

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

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(local)) {
        if (!(stmt instanceof ArkAssignStmt) && !(stmt instanceof ArkInvokeStmt)) continue;
        const invokeExpr = stmt instanceof ArkAssignStmt ? stmt.getRightOp() : stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkStaticInvokeExpr) && !(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        const methodName = resolveMethodName(invokeExpr);
        const sig = invokeExpr.getMethodSignature()?.toString() || "";
        if (!isArrayStaticCall(sig, methodName, invokeExpr) || methodName !== "from") continue;
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length < 2 || !sameLocalValue(args[0], local)) continue;

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

    for (const val of collectBaseLocalCandidatesForCarrier(pag, objId)) {

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
            if (isArrayStaticCall(sig, methodName, invokeExpr) && methodName === "from") {
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

function collectOrdinaryArrayHigherOrderEffectsForBaseLocal(
    val: Local,
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

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(val)) {
        if (stmt instanceof ArkInvokeStmt) {
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            if (!sameLocalValue(invokeExpr.getBase(), val)) continue;
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
        if (!sameLocalValue(right.getBase(), val)) continue;
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
            const dstNodes = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
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
            const dstNodes = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
            if (dstNodes) {
                for (const nodeId of dstNodes.values()) {
                    if (resultDedup.has(nodeId)) continue;
                    resultDedup.add(nodeId);
                    resultNodeIds.push(nodeId);
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

    for (const val of collectBaseLocalCandidatesForCarrier(pag, objId)) {

        for (const stmt of collectLocalUseStmtsWithCfgRecovery(val)) {
            if (stmt instanceof ArkInvokeStmt) {
                const invokeExpr = stmt.getInvokeExpr();
                if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
                if (!sameLocalValue(invokeExpr.getBase(), val)) continue;
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
            if (!sameLocalValue(right.getBase(), val)) continue;
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
                const dstNodes = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
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
                const dstNodes = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
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

function collectOrdinaryCollectionLoadEffectsForBaseLocal(
    val: Local,
    slot: string,
    pag: Pag,
    scene: Scene,
    resultNodeIds: number[],
    callbackParamNodeIds: number[],
    resultSlotStores: OrdinaryArraySlotStoreInfo[],
    resultDedup: Set<number>,
    callbackDedup: Set<number>,
    slotDedup: Set<string>,
): void {
    for (const stmt of collectLocalUseStmtsWithCfgRecovery(val)) {
        const invokeExpr = stmt instanceof ArkAssignStmt
            ? stmt.getRightOp()
            : stmt instanceof ArkInvokeStmt
                ? stmt.getInvokeExpr()
                : undefined;
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        if (!sameLocalValue(invokeExpr.getBase(), val)) continue;

        const methodName = resolveMethodName(invokeExpr);
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];

        if (stmt instanceof ArkAssignStmt && isCollectionSlotReadToResult(slot, methodName, args)) {
            const dst = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
            if (dst) {
                for (const id of dst.values()) {
                    if (resultDedup.has(id)) continue;
                    resultDedup.add(id);
                    resultNodeIds.push(id);
                }
            }
            if (isCollectionViewResultMethod(slot, methodName)) {
                collectArrayFromStoresForCollectionViewLocal(
                    stmt.getLeftOp(),
                    slot,
                    pag,
                    resultNodeIds,
                    resultSlotStores,
                    resultDedup,
                    slotDedup,
                );
            }
        }

        const forEachParamIndexes = methodName === "forEach" && args.length > 0
            ? collectionForEachParamIndexes(slot)
            : undefined;
        if (forEachParamIndexes) {
            for (const nodeId of collectCallbackParamNodeIds(scene, pag, args[0], forEachParamIndexes)) {
                if (callbackDedup.has(nodeId)) continue;
                callbackDedup.add(nodeId);
                callbackParamNodeIds.push(nodeId);
            }
        }
    }
}

function collectArrayFromStoresForCollectionViewLocal(
    viewValue: any,
    slot: string,
    pag: Pag,
    resultNodeIds: number[],
    resultSlotStores: OrdinaryArraySlotStoreInfo[],
    resultDedup: Set<number>,
    slotDedup: Set<string>,
): void {
    if (!(viewValue instanceof Local)) return;

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(viewValue)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkStaticInvokeExpr) && !(right instanceof ArkInstanceInvokeExpr)) continue;

        const methodName = resolveMethodName(right);
        const sig = right.getMethodSignature()?.toString() || "";
        if (!isArrayStaticCall(sig, methodName, right) || methodName !== "from") continue;
        const args = right.getArgs ? right.getArgs() : [];
        if (args.length < 1 || !sameLocalValue(args[0], viewValue)) continue;

        const dstNodes = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
        if (dstNodes) {
            for (const nodeId of dstNodes.values()) {
                if (resultDedup.has(nodeId)) continue;
                resultDedup.add(nodeId);
                resultNodeIds.push(nodeId);
            }
        }

        const resultSlot = resolveCollectionViewArrayResultSlot(slot);
        for (const holderId of resolveAssignedContainerHolderIds(stmt.getLeftOp(), pag, stmt)) {
            const key = `${holderId}|${resultSlot}`;
            if (slotDedup.has(key)) continue;
            slotDedup.add(key);
            resultSlotStores.push({ objId: holderId, slot: resultSlot });
        }
    }
}

function resolveCollectionViewArrayResultSlot(slot: string): string {
    return slot.startsWith("map:") || slot.startsWith("set:") ? "arr:*" : "arr:*";
}

function collectOrdinaryPromiseAggregateEffectsForArrayLocal(
    val: Local,
    slot: string,
    pag: Pag,
    scene: Scene,
    resultNodeIds: number[],
    resultSlotStores: OrdinaryArraySlotStoreInfo[],
    resultDedup: Set<number>,
    slotDedup: Set<string>,
): void {
    for (const stmt of collectLocalUseStmtsWithCfgRecovery(val)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkStaticInvokeExpr) && !(right instanceof ArkInstanceInvokeExpr)) continue;

        const methodName = resolveMethodName(right);
        if (!isPromiseAggregateCall(methodName, right)) continue;
        const args = right.getArgs ? right.getArgs() : [];
        if (args.length < 1 || !sameLocalValue(args[0], val)) continue;

        const dstNodes = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
        if (dstNodes) {
            for (const id of dstNodes.values()) {
                if (resultDedup.has(id)) continue;
                resultDedup.add(id);
                resultNodeIds.push(id);
            }
        }

        if (!(stmt.getLeftOp() instanceof Local)) continue;
        for (const callbackParamNodeId of collectPromiseThenCallbackParamNodeIds(
            stmt.getLeftOp() as Local,
            pag,
            scene,
        )) {
            const key = `${callbackParamNodeId}|${slot}`;
            if (slotDedup.has(key)) continue;
            slotDedup.add(key);
            resultSlotStores.push({ objId: callbackParamNodeId, slot });
        }
    }
}

function collectPromiseThenCallbackParamNodeIds(
    promiseLocal: Local,
    pag: Pag,
    scene: Scene,
): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(promiseLocal)) {
        const invokeExpr = stmt instanceof ArkAssignStmt
            ? stmt.getRightOp()
            : stmt instanceof ArkInvokeStmt
                ? stmt.getInvokeExpr()
                : undefined;
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        if (!sameLocalValue(invokeExpr.getBase(), promiseLocal)) continue;
        if (resolveMethodName(invokeExpr) !== "then") continue;
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        if (args.length < 1) continue;

        for (const nodeId of collectCallbackParamNodeIds(scene, pag, args[0], [0])) {
            if (dedup.has(nodeId)) continue;
            dedup.add(nodeId);
            results.push(nodeId);
        }
    }

    return results;
}

export function collectOrdinaryPromiseThenCallbackParamNodeIdsFromTaintedLocal(
    taintedNode: PagNode,
    pag: Pag,
    scene: Scene,
): number[] {
    const value = taintedNode.getValue?.();
    if (!(value instanceof Local)) return [];
    return collectPromiseThenCallbackParamNodeIds(value, pag, scene);
}

function collectOrdinaryArraySlotLoadNodeIdsForBaseLocal(
    val: Local,
    slot: string,
    pag: Pag,
    scene: Scene,
    results: number[],
    dedup: Set<number>,
    indexResolver?: ArraySlotIndexResolver,
): void {
    for (const stmt of collectLocalUseStmtsWithCfgRecovery(val)) {
        if (stmt instanceof ArkAssignStmt) {
            const right = stmt.getRightOp();
            const left = stmt.getLeftOp();

            if (right instanceof ArkInstanceFieldRef && sameLocalValue(right.getBase(), val)) {
                const fieldName = right.getFieldSignature().getFieldName();
                if (/^-?\d+$/.test(fieldName) && slot.startsWith("arr:")) {
                    const expectedSlot = `arr:${fieldName}`;
                    if (slot === expectedSlot) {
                        const dst = resolveOrMaterializeArrayLoadNodes(pag, left, stmt);
                        if (!dst) continue;
                        for (const id of dst.values()) {
                            if (dedup.has(id)) continue;
                            dedup.add(id);
                            results.push(id);
                        }
                    }
                }
            }

            if (right instanceof ArkArrayRef && sameLocalValue(right.getBase(), val)) {
                let idxKey = resolveValueKey(right.getIndex());
                let expectedSlot = idxKey === undefined ? undefined : `arr:${idxKey}`;
                if (expectedSlot !== slot) {
                    expectedSlot = indexResolver?.(right.getIndex(), stmt) ?? expectedSlot;
                }
                if (expectedSlot === undefined) {
                    expectedSlot = "arr:*";
                }
                if (slot === expectedSlot) {
                    const dst = resolveOrMaterializeArrayLoadNodes(pag, left, stmt);
                    if (!dst) continue;
                    for (const id of dst.values()) {
                        if (dedup.has(id)) continue;
                        dedup.add(id);
                        results.push(id);
                    }
                }
            }

            if (right instanceof ArkInstanceInvokeExpr && sameLocalValue(right.getBase(), val)) {
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
                    const dst = resolveOrMaterializeArrayLoadNodes(pag, left, stmt);
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
                    const dst = resolveOrMaterializeArrayLoadNodes(pag, left, stmt);
                    if (!dst) continue;
                    for (const id of dst.values()) {
                        if (dedup.has(id)) continue;
                        dedup.add(id);
                        results.push(id);
                    }
                }
            }
        }

        if (slot.startsWith("arr:") && stmt instanceof ArkAssignStmt) {
            collectLoweredIteratorElementLoadNodeIds(val, stmt, pag, results, dedup);
        }

        if (stmt instanceof ArkInvokeStmt) {
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            if (!sameLocalValue(invokeExpr.getBase(), val)) continue;
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

function collectLoweredIteratorElementLoadNodeIds(
    arrayLocal: Local,
    iteratorFactoryStmt: ArkAssignStmt,
    pag: Pag,
    results: number[],
    dedup: Set<number>,
): void {
    const iteratorFactory = iteratorFactoryStmt.getRightOp();
    if (!(iteratorFactory instanceof ArkInstanceInvokeExpr)) return;
    if (!sameLocalValue(iteratorFactory.getBase(), arrayLocal)) return;
    if (!isArrayIteratorFactoryInvoke(iteratorFactory)) return;
    const iteratorLocal = iteratorFactoryStmt.getLeftOp();
    if (!(iteratorLocal instanceof Local)) return;

    for (const nextResult of collectIteratorNextResultLocals(iteratorLocal)) {
        for (const valueLocal of collectIteratorValueLocals(nextResult)) {
            pushResolvedValueNodeIds(valueLocal, pag, results, dedup);
            for (const alias of collectLocalAliases(valueLocal)) {
                pushResolvedValueNodeIds(alias, pag, results, dedup);
            }
        }
    }
}

function collectIteratorNextResultLocals(iteratorLocal: Local): Local[] {
    const out: Local[] = [];
    const seen = new Set<string>();
    for (const stmt of collectLocalUseStmtsWithCfgRecovery(iteratorLocal)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkInstanceInvokeExpr)) continue;
        if (!sameLocalValue(right.getBase(), iteratorLocal)) continue;
        if (resolveMethodName(right) !== "next") continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        const key = localStableKey(left);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(left);
    }
    return out;
}

function collectIteratorValueLocals(nextResultLocal: Local): Local[] {
    const out: Local[] = [];
    const seen = new Set<string>();
    for (const stmt of collectLocalUseStmtsWithCfgRecovery(nextResultLocal)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkInstanceFieldRef)) continue;
        if (!sameLocalValue(right.getBase(), nextResultLocal)) continue;
        if (!isIteratorValueField(right)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        const key = localStableKey(left);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(left);
    }
    return out;
}

function collectLocalAliases(local: Local): Local[] {
    const out: Local[] = [];
    const seen = new Set<string>();
    for (const stmt of collectLocalUseStmtsWithCfgRecovery(local)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local)) continue;
        const right = stmt.getRightOp();
        const aliases = sameLocalValue(right, local)
            || (right instanceof ArkCastExpr && sameLocalValue(right.getOp?.(), local));
        if (!aliases) continue;
        const key = localStableKey(left);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(left);
    }
    return out;
}

function pushResolvedValueNodeIds(
    value: Local,
    pag: Pag,
    results: number[],
    dedup: Set<number>,
): void {
    const declaringStmt = value.getDeclaringStmt?.();
    if (!(declaringStmt instanceof ArkAssignStmt)) return;
    const nodes = resolveExistingPagNodesForValue(pag, value, declaringStmt);
    if (!nodes) return;
    for (const id of nodes.values()) {
        if (dedup.has(id)) continue;
        dedup.add(id);
        results.push(id);
    }
}

function isArrayIteratorFactoryInvoke(invokeExpr: ArkInstanceInvokeExpr): boolean {
    const methodName = resolveMethodName(invokeExpr);
    const sig = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    return methodName === "Symbol.iterator"
        || sig.includes("Symbol.iterator")
        || methodName === "values"
        || methodName === "entries";
}

function isIteratorValueField(fieldRef: ArkInstanceFieldRef): boolean {
    const fieldName = fieldRef.getFieldSignature?.().getFieldName?.() || fieldRef.getFieldName?.() || "";
    if (fieldName === "value" || fieldName.endsWith(".value")) return true;
    return (fieldRef.getFieldSignature?.()?.toString?.() || "").includes("IteratorResult.value");
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
    for (const stmt of collectLocalUseStmtsWithCfgRecovery(val)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkInstanceInvokeExpr)) continue;
        if (!sameLocalValue(right.getBase(), val)) continue;

        const methodName = resolveMethodName(right);
        let matched = false;
        if ((methodName === "values" || methodName === "entries" || methodName === "flat") && slot.startsWith("arr:")) {
            matched = true;
        } else if (methodName === "splice") {
            matched = isSpliceRemovedSlot(slot, right.getArgs ? right.getArgs() : []);
        }

        if (!matched) continue;

        const dstNodes = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
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

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(local)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkStaticInvokeExpr) && !(right instanceof ArkInstanceInvokeExpr)) continue;
        const methodName = resolveMethodName(right);
        const sig = right.getMethodSignature()?.toString() || "";
        if (!isArrayStaticCall(sig, methodName, right)) continue;
        const args = right.getArgs ? right.getArgs() : [];
        if (methodName !== "from" || args.length < 1 || !sameLocalValue(args[0], local)) continue;

        const dstNodes = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
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

function collectBaseLocalCandidatesForCarrier(pag: Pag, carrierId: number): Local[] {
    return getBaseLocalCandidatesByCarrier(pag).get(carrierId) || [];
}

function arrayLoadAliasMatchesCarrier(pag: Pag, local: Local, carrierId: number): boolean {
    const decl = local.getDeclaringStmt?.();
    if (!(decl instanceof ArkAssignStmt)) return true;
    const right = decl.getRightOp?.();
    if (!(right instanceof ArkArrayRef)) return true;

    const idxKey = resolveValueKey(right.getIndex());
    if (idxKey === undefined) return false;
    const loadPaths = collectArrayElementPathKeys(right.getBase(), idxKey);
    if (loadPaths.size === 0) return false;

    const carrierPaths = collectArrayObjectPathKeysForCarrier(pag, carrierId);
    return hasPathIntersection(loadPaths, carrierPaths);
}

function getBaseLocalCandidatesByCarrier(pag: Pag): Map<number, Local[]> {
    const cached = baseLocalCandidatesByCarrierCache.get(pag);
    if (cached) return cached;

    const index = new Map<number, Local[]>();
    const seenByCarrier = new Map<number, Set<string>>();
    const add = (carrierId: number, value: Local): void => {
        let seen = seenByCarrier.get(carrierId);
        if (!seen) {
            seen = new Set<string>();
            seenByCarrier.set(carrierId, seen);
        }
        const key = localStableKey(value);
        if (seen.has(key)) return;
        seen.add(key);
        let values = index.get(carrierId);
        if (!values) {
            values = [];
            index.set(carrierId, values);
        }
        values.push(value);
    };

    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const value = node.getValue();
        if (!(value instanceof Local)) continue;
        add(node.getID(), value);
        for (const objId of node.getPointTo()) {
            add(objId, value);
        }
    }
    baseLocalCandidatesByCarrierCache.set(pag, index);
    return index;
}

function collectArrayObjectPathKeysForCarrier(pag: Pag, carrierId: number): Set<string> {
    let byCarrier = arrayObjectPathKeysByCarrierCache.get(pag);
    if (!byCarrier) {
        byCarrier = new Map<number, Set<string>>();
        arrayObjectPathKeysByCarrierCache.set(pag, byCarrier);
    }
    const cached = byCarrier.get(carrierId);
    if (cached) return cached;

    const keys = new Set<string>();
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const value = node.getValue();
        if (!(value instanceof Local)) continue;
        const pointToIds = [...node.getPointTo()];
        if (!pointToIds.includes(carrierId)) continue;
        if (pointToIds.length !== 1) continue;
        mergePathKeys(keys, collectArrayObjectPathKeys(value, new Set<Local>()));
    }
    byCarrier.set(carrierId, keys);
    return keys;
}

function collectLocalUseStmtsWithCfgRecovery(local: Local): any[] {
    const cached = localUseStmtsWithCfgRecoveryCache.get(local);
    if (cached) return cached;

    const out = new Set<any>(local.getUsedStmts?.() || []);
    const cfg = local.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (stmts) {
        for (const stmt of stmts) {
            if (stmtUsesLocalValue(stmt, local)) {
                out.add(stmt);
            }
        }
    }
    const result = [...out];
    localUseStmtsWithCfgRecoveryCache.set(local, result);
    return result;
}

function sameLocalValue(value: any, local: Local): value is Local {
    if (value === local) return true;
    if (!(value instanceof Local)) return false;
    return localStableKey(value) === localStableKey(local);
}

function localStableKey(local: Local): string {
    const methodSig = local.getDeclaringStmt?.()
        ?.getCfg?.()
        ?.getDeclaringMethod?.()
        ?.getSignature?.()
        ?.toString?.() || "";
    const declaringStmt = local.getDeclaringStmt?.()?.toString?.() || "";
    return `${methodSig}::${local.getName?.() || ""}::${declaringStmt}`;
}

function localDeclaringMethodSignature(local: Local): string {
    return local.getDeclaringStmt?.()
        ?.getCfg?.()
        ?.getDeclaringMethod?.()
        ?.getSignature?.()
        ?.toString?.() || "";
}

function stmtUsesLocalValue(stmt: any, local: Local): boolean {
    if (stmt instanceof ArkAssignStmt) {
        return valueUsesLocal(stmt.getRightOp?.(), local)
            || valueUsesLocal(stmt.getLeftOp?.(), local);
    }
    if (stmt instanceof ArkInvokeStmt) {
        return valueUsesLocal(stmt.getInvokeExpr?.(), local);
    }
    return valueUsesLocal(stmt, local);
}

function valueUsesLocal(value: any, local: Local, visiting = new Set<any>()): boolean {
    if (!value || visiting.has(value)) return false;
    if (sameLocalValue(value, local)) return true;
    visiting.add(value);

    if (value instanceof ArkInstanceInvokeExpr) {
        if (valueUsesLocal(value.getBase?.(), local, visiting)) return true;
        for (const arg of value.getArgs?.() || []) {
            if (valueUsesLocal(arg, local, visiting)) return true;
        }
        return false;
    }
    if (value instanceof ArkStaticInvokeExpr) {
        for (const arg of value.getArgs?.() || []) {
            if (valueUsesLocal(arg, local, visiting)) return true;
        }
        return false;
    }
    if (value instanceof ArkArrayRef) {
        return valueUsesLocal(value.getBase?.(), local, visiting)
            || valueUsesLocal(value.getIndex?.(), local, visiting);
    }
    if (value instanceof ArkInstanceFieldRef) {
        return valueUsesLocal(value.getBase?.(), local, visiting);
    }
    if (value instanceof ArkNormalBinopExpr) {
        return valueUsesLocal(value.getOp1?.(), local, visiting)
            || valueUsesLocal(value.getOp2?.(), local, visiting);
    }

    for (const use of value.getUses?.() || []) {
        if (valueUsesLocal(use, local, visiting)) return true;
    }
    return false;
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

function isArrayStaticCall(
    sig: string,
    methodName: string,
    invokeExpr?: ArkInstanceInvokeExpr | ArkStaticInvokeExpr,
): boolean {
    if (methodName !== "from" && methodName !== "of") return false;
    if (!sig.includes("@%unk") && sig.includes("Array.")) return true;
    const base = invokeExpr instanceof ArkInstanceInvokeExpr ? invokeExpr.getBase() : undefined;
    return base instanceof Local && base.getName?.() === "Array";
}

function isPromiseAggregateCall(
    methodName: string,
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr,
): boolean {
    if (methodName !== "all" && methodName !== "allSettled") return false;
    const sig = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    if (!sig.includes("@%unk") && sig.includes("Promise.")) return true;
    const base = invokeExpr instanceof ArkInstanceInvokeExpr ? invokeExpr.getBase() : undefined;
    return base instanceof Local && base.getName?.() === "Promise";
}

function isArrayMutationForBase(methodName: string): boolean {
    return methodName === "push" || methodName === "unshift" || methodName === "splice";
}

function isMutationInputAffectingBase(methodName: string, base: Local, args: any[], local: Local): boolean {
    if (sameLocalValue(base, local)) return true;
    if (methodName === "splice") {
        return args.slice(2).includes(local);
    }
    return args.includes(local);
}

function isArrayParameterElementSource(local: Local): boolean {
    const decl = local.getDeclaringStmt?.();
    if (!(decl instanceof ArkAssignStmt)) return false;
    if (!(decl.getRightOp() instanceof ArkParameterRef)) return false;
    return isArrayLikeLocal(local);
}

function isArrayLikeLocal(local: Local): boolean {
    const type = local.getType?.();
    const text = type?.toString?.() || "";
    const lowered = text.toLowerCase();
    return type instanceof ArrayType
        || text.endsWith("[]")
        || lowered.includes("array<")
        || lowered.includes("[]");
}

function resolveContainerKind(base: Local, sig: string): "array" | undefined {
    if (!sig.includes("@%unk") && sig.includes("Array.")) return "array";
    const baseType = base.getType?.();
    const text = baseType?.toString?.() || "";
    if (baseType instanceof ArrayType || text.endsWith("[]")) return "array";
    return undefined;
}

function resolveOrdinaryCollectionKind(base: Local, sig: string): OrdinaryCollectionKind | undefined {
    if (!sig.includes("@%unk")) {
        if (sig.includes("Map.") || sig.includes("WeakMap.")) return "map";
        if (sig.includes("Set.") || sig.includes("WeakSet.")) return "set";
        const sequenceKind = resolveSequenceCollectionKindFromSignature(sig);
        if (sequenceKind) return sequenceKind;
    }

    const typeText = base.getType?.()?.toString?.() || "";
    const lowered = typeText.toLowerCase();
    if (isCollectionTypeText(lowered, "map")) return "map";
    if (isCollectionTypeText(lowered, "set")) return "set";
    const sequenceKind = resolveSequenceCollectionKindFromTypeText(lowered);
    if (sequenceKind) return sequenceKind;
    return undefined;
}

function isCollectionTypeText(loweredTypeText: string, kind: "map" | "set"): boolean {
    if (!loweredTypeText) return false;
    const weakKind = `weak${kind}`;
    return loweredTypeText === kind
        || loweredTypeText === weakKind
        || hasLoweredTypeToken(loweredTypeText, kind)
        || hasLoweredTypeToken(loweredTypeText, weakKind)
        || loweredTypeText.includes(`${kind}<`)
        || loweredTypeText.includes(`${weakKind}<`)
        || loweredTypeText.endsWith(`.${kind}`)
        || loweredTypeText.endsWith(`.${weakKind}`)
        || loweredTypeText.includes(` ${kind}<`)
        || loweredTypeText.includes(` ${weakKind}<`);
}

function resolveCollectionMutationSlots(
    collectionKind: OrdinaryCollectionKind,
    methodName: string,
    args: any[],
    local: Local,
    base?: Local,
    stmt?: any,
): string[] {
    if (collectionKind === "map" && methodName === "set" && args.length >= 2) {
        const slots: string[] = [];
        const keySlot = resolveCollectionKeySlot(args[0]);
        if (sameLocalValue(args[0], local)) {
            slots.push(`mapkey:${keySlot}`);
        }
        if (sameLocalValue(args[1], local)) {
            slots.push(`map:${keySlot}`);
        }
        return slots;
    }
    if (collectionKind === "set" && methodName === "add" && args.length >= 1 && sameLocalValue(args[0], local)) {
        return ["set:*"];
    }
    if ((collectionKind === "list" || collectionKind === "queue" || collectionKind === "stack") && isSequenceCollectionAppendMethod(methodName) && args.length >= 1 && sameLocalValue(args[0], local)) {
        const slot = base ? resolveSequenceCollectionAppendSlot(base, stmt) : "seq:*";
        return [slot === "seq:*" ? `${collectionKind}:*` : slot.replace(/^seq:/, `${collectionKind}:`)];
    }
    return [];
}

function normalizeOrdinaryCollectionSlot(field: string): string | undefined {
    const slot = fromContainerFieldKey(field) || field;
    if (
        slot.startsWith("map:")
        || slot.startsWith("mapkey:")
        || slot.startsWith("set:")
        || slot.startsWith("list:")
        || slot.startsWith("queue:")
        || slot.startsWith("stack:")
    ) return slot;
    return undefined;
}

function resolveCollectionKeySlot(value: any): string {
    const key = resolveValueKey(value);
    if (key === undefined || key === "") return "*";
    return key.replace(/[:|]/g, "_");
}

function isCollectionSlotReadToResult(slot: string, methodName: string, args: any[]): boolean {
    if (slot.startsWith("mapkey:")) {
        return methodName === "keys" || methodName === "entries";
    }

    if (slot.startsWith("map:")) {
        if (methodName === "get") {
            const expected = args.length > 0 ? `map:${resolveCollectionKeySlot(args[0])}` : "map:*";
            return isCollectionSlotMatch(slot, expected);
        }
        return methodName === "values" || methodName === "entries";
    }

    if (slot.startsWith("set:")) {
        return methodName === "values" || methodName === "entries" || methodName === "keys";
    }

    if (slot.startsWith("list:")) {
        if (methodName === "get" || methodName === "at") {
            const expected = args.length > 0 ? `list:${resolveCollectionKeySlot(args[0])}` : "list:*";
            return isCollectionSlotMatch(slot, expected);
        }
        return methodName === "values" || methodName === "entries";
    }

    if (slot.startsWith("queue:")) {
        if (methodName === "getFirst" || methodName === "peek" || methodName === "front") {
            return isCollectionSlotMatch(slot, "queue:0");
        }
        return methodName === "values" || methodName === "entries";
    }

    if (slot.startsWith("stack:")) {
        if (methodName === "peek") return slot.startsWith("stack:");
        return methodName === "values" || methodName === "entries";
    }

    return false;
}

function isCollectionViewResultMethod(slot: string, methodName: string): boolean {
    if (slot.startsWith("mapkey:")) {
        return methodName === "keys" || methodName === "entries";
    }

    if (slot.startsWith("map:")) {
        return methodName === "values" || methodName === "entries";
    }
    if (slot.startsWith("set:")) {
        return methodName === "values" || methodName === "entries" || methodName === "keys";
    }
    if (slot.startsWith("list:") || slot.startsWith("queue:") || slot.startsWith("stack:")) {
        return methodName === "values" || methodName === "entries";
    }
    return false;
}

function isCollectionSlotForEachValue(slot: string): boolean {
    return slot.startsWith("map:") || slot.startsWith("set:") || slot.startsWith("list:") || slot.startsWith("queue:") || slot.startsWith("stack:");
}

function collectionForEachParamIndexes(slot: string): number[] | undefined {
    if (slot.startsWith("mapkey:")) return [1];
    if (isCollectionSlotForEachValue(slot)) return [0];
    return undefined;
}

function resolveSequenceCollectionKindFromSignature(sig: string): "list" | "queue" | "stack" | undefined {
    if (sig.includes(".Queue.") || sig.includes(".Deque.")) return "queue";
    if (sig.includes(".Stack.")) return "stack";
    if (sig.includes(".List.") || sig.includes(".ArrayList.") || sig.includes(".LinkedList.") || sig.includes(".Vector.")) return "list";
    return undefined;
}

function resolveSequenceCollectionKindFromTypeText(loweredTypeText: string): "list" | "queue" | "stack" | undefined {
    if (!loweredTypeText) return undefined;
    if (hasSequenceType(loweredTypeText, "queue") || hasSequenceType(loweredTypeText, "deque")) return "queue";
    if (hasSequenceType(loweredTypeText, "stack")) return "stack";
    if (
        hasSequenceType(loweredTypeText, "list")
        || hasSequenceType(loweredTypeText, "arraylist")
        || hasSequenceType(loweredTypeText, "linkedlist")
        || hasSequenceType(loweredTypeText, "vector")
    ) {
        return "list";
    }
    return undefined;
}

function hasSequenceType(loweredTypeText: string, token: string): boolean {
    return loweredTypeText === token
        || hasLoweredTypeToken(loweredTypeText, token)
        || loweredTypeText.includes(`${token}<`)
        || loweredTypeText.endsWith(`.${token}`);
}

function hasLoweredTypeToken(loweredTypeText: string, token: string): boolean {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9_$])${escaped}($|[^a-z0-9_$])`).test(loweredTypeText);
}

function isSequenceCollectionAppendMethod(methodName: string): boolean {
    return methodName === "add"
        || methodName === "push"
        || methodName === "pushBack"
        || methodName === "enqueue"
        || methodName === "insert";
}

function resolveSequenceCollectionAppendSlot(base: Local, anchorStmt: any): string {
    const exactIndex = resolveExactSequenceAppendIndexAtStmt(base, anchorStmt);
    return exactIndex === undefined ? "seq:*" : `seq:${exactIndex}`;
}

function resolveExactSequenceAppendIndexAtStmt(base: Local, anchorStmt: any): number | undefined {
    if (!anchorStmt || !isDefinitelyEmptySequenceCollectionLocal(base)) return undefined;
    const cfg = anchorStmt.getCfg?.() || base.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;

    let length = 0;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) {
            return length;
        }
        const invokeExpr = resolveArrayMutationInvoke(stmt);
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        if (!sameLocalValue(invokeExpr.getBase(), base)) continue;
        const methodName = resolveMethodName(invokeExpr);
        if (isSequenceCollectionAppendMethod(methodName)) {
            length += Math.max(1, invokeExpr.getArgs?.()?.length || 1);
        }
    }
    return undefined;
}

function isDefinitelyEmptySequenceCollectionLocal(base: Local, visiting: Set<string> = new Set<string>()): boolean {
    const key = `${base.getName?.() || ""}#${base.getDeclaringStmt?.()?.toString?.() || ""}`;
    if (visiting.has(key)) return false;
    visiting.add(key);

    const decl = base.getDeclaringStmt?.();
    if (!(decl instanceof ArkAssignStmt)) return false;
    const right = decl.getRightOp?.();
    if (right instanceof Local) {
        return isDefinitelyEmptySequenceCollectionLocal(right, visiting);
    }
    const text = String(right?.toString?.() || "");
    if (/\bnew\s+(?:List|ArrayList|LinkedList|Queue|Deque|Vector|Stack)\s*</.test(text)) return true;
    if (/\bnew\s+(?:List|ArrayList|LinkedList|Queue|Deque|Vector|Stack)\s*\(/.test(text)) return true;
    const typeText = base.getType?.()?.toString?.()?.toLowerCase?.() || "";
    return !!resolveSequenceCollectionKindFromTypeText(typeText) && /\bnew\b|%instInit|constructor/i.test(text);
}

function isCollectionSlotMatch(taintedSlot: string, expectedSlot: string): boolean {
    if (taintedSlot === expectedSlot) return true;
    if (taintedSlot.endsWith("*")) {
        return expectedSlot.startsWith(taintedSlot.slice(0, -1));
    }
    if (expectedSlot.endsWith("*")) {
        return taintedSlot.startsWith(expectedSlot.slice(0, -1));
    }
    return false;
}

function collectCallbackParamNodeIds(scene: Scene, pag: Pag, callbackArg: any, paramIndexes?: number[]): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();
    const indexFilter = paramIndexes && paramIndexes.length > 0 ? new Set(paramIndexes) : undefined;
    const methods = resolveCallbackMethods(scene, callbackArg);

    for (const method of methods) {
        const cfg = method.getCfg();
        if (!cfg) continue;
        const closureParameterIndexes = collectClosureEnvironmentParameterIndexes(cfg.getStmts());
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const rightOp = stmt.getRightOp();
            if (!(rightOp instanceof ArkParameterRef)) continue;
            const logicalIndex = toCallbackLogicalParameterIndex(rightOp.getIndex(), closureParameterIndexes);
            if (logicalIndex < 0) continue;
            if (indexFilter && !indexFilter.has(logicalIndex)) continue;
            let dst = resolveExistingPagNodesForValue(pag, stmt.getLeftOp(), stmt);
            if (!dst || dst.size === 0) {
                dst = materializeExactPagNodes(pag, stmt.getLeftOp(), stmt);
            }
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

function collectClosureEnvironmentParameterIndexes(stmts: any[]): number[] {
    const out: number[] = [];
    for (const stmt of stmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const rightOp = stmt.getRightOp();
        if (!(rightOp instanceof ArkParameterRef)) continue;
        const leftOp = stmt.getLeftOp();
        if (isClosureEnvironmentParameter(leftOp, rightOp)) {
            out.push(rightOp.getIndex());
        }
    }
    return out.sort((a, b) => a - b);
}

function toCallbackLogicalParameterIndex(actualIndex: number, closureParameterIndexes: number[]): number {
    if (closureParameterIndexes.includes(actualIndex)) return -1;
    let skippedBefore = 0;
    for (const closureIndex of closureParameterIndexes) {
        if (closureIndex < actualIndex) skippedBefore++;
    }
    return actualIndex - skippedBefore;
}

function isClosureEnvironmentParameter(leftOp: any, rightOp: ArkParameterRef): boolean {
    const leftName = leftOp instanceof Local ? leftOp.getName?.() || "" : "";
    const leftTypeText = leftOp?.getType?.()?.toString?.() || "";
    const rightTypeText = rightOp.getType?.()?.toString?.() || "";
    return leftName.startsWith("%closures")
        || leftTypeText.startsWith("[")
        || rightTypeText.startsWith("[");
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

function resolveExistingPagNodesForValue(pag: Pag, value: any, anchorStmt: ArkAssignStmt): Map<number, number> | undefined {
    return resolveExistingPagNodes(pag, value, anchorStmt);
}

function resolveOrMaterializeArrayLoadNodes(pag: Pag, value: any, anchorStmt: ArkAssignStmt): Map<number, number> | undefined {
    const existing = resolveExistingPagNodesForValue(pag, value, anchorStmt);
    if (existing && existing.size > 0) return existing;
    return materializeExactPagNodes(pag, value, anchorStmt);
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

function resolveBaseCarrierTargets(base: Local, pag: Pag): Array<{ carrierNodeId: number; objId: number }> {
    const out: Array<{ carrierNodeId: number; objId: number }> = [];
    const seen = new Set<string>();
    const baseNodes = pag.getNodesByValue(base);
    if (!baseNodes) return out;

    for (const baseNodeId of baseNodes.values()) {
        const baseNode = pag.getNode(baseNodeId) as PagNode;
        const pointToIds = [...baseNode.getPointTo()];
        const objIds = pointToIds.length > 0 ? pointToIds : [baseNodeId];
        for (const objId of objIds) {
            const key = `${baseNodeId}|${objId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ carrierNodeId: baseNodeId, objId });
        }
    }

    return out;
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
    const nodes = resolveExistingPagNodesForValue(pag, value, anchorStmt);
    if (nodes && nodes.size > 0) return [...nodes.values()];
    const created = materializeExactPagNodes(pag, value, anchorStmt);
    return created ? [...created.values()] : [];
}

function resolveArrayPushSlot(base: Local, anchorStmt?: any): string {
    const exactIndex = resolveExactArrayPushIndexAtStmt(base, anchorStmt);
    if (exactIndex !== undefined) {
        return `arr:${exactIndex}`;
    }
    const maxIndex = resolveArrayMaxStoredIndex(base, new Set<Local>());
    return maxIndex === undefined ? "arr:*" : `arr:${maxIndex + 1}`;
}

function resolveExactArrayPushIndexAtStmt(base: Local, anchorStmt: any): number | undefined {
    if (!anchorStmt || !isDefinitelyEmptyArrayLocal(base)) return undefined;
    const cfg = anchorStmt.getCfg?.() || base.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;

    let length = 0;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) {
            return length;
        }
        if (stmt instanceof ArkAssignStmt) {
            const left = stmt.getLeftOp();
            if (left instanceof ArkArrayRef && sameLocalValue(left.getBase(), base)) {
                const idx = resolveNumber(left.getIndex());
                if (idx !== undefined && idx >= length) {
                    length = idx + 1;
                }
            }
            const invokeExpr = stmt.getRightOp();
            if (invokeExpr instanceof ArkInstanceInvokeExpr && sameLocalValue(invokeExpr.getBase(), base)) {
                length = advanceExactArrayLengthForInvoke(length, invokeExpr);
            }
        } else if (stmt instanceof ArkInvokeStmt) {
            const invokeExpr = stmt.getInvokeExpr();
            if (invokeExpr instanceof ArkInstanceInvokeExpr && sameLocalValue(invokeExpr.getBase(), base)) {
                length = advanceExactArrayLengthForInvoke(length, invokeExpr);
            }
        }
    }
    return undefined;
}

function isDefinitelyEmptyArrayLocal(base: Local, visiting: Set<string> = new Set<string>()): boolean {
    const key = `${base.getName?.() || ""}#${base.getDeclaringStmt?.()?.toString?.() || ""}`;
    if (visiting.has(key)) return false;
    visiting.add(key);

    const decl = base.getDeclaringStmt?.();
    if (!(decl instanceof ArkAssignStmt)) return false;
    const right = decl.getRightOp?.();
    if (right instanceof Local) {
        return isDefinitelyEmptyArrayLocal(right, visiting);
    }
    const text = String(right?.toString?.() || "");
    return text === "[]" || /\[\s*0\s*\]/.test(text) || /\bnew\s+Array\s*\(\s*\)/.test(text);
}

function advanceExactArrayLengthForInvoke(length: number, invokeExpr: ArkInstanceInvokeExpr): number {
    const methodName = resolveMethodName(invokeExpr);
    const args = invokeExpr.getArgs?.() || [];
    if (methodName === "push") {
        return length + args.length;
    }
    if (methodName === "unshift") {
        return length + args.length;
    }
    return length;
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

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(local)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (!sameLocalValue(left.getBase(), local)) continue;
        const idxKey = resolveValueKey(left.getIndex());
        if (idxKey === undefined) continue;
        const idxNum = Number(idxKey);
        if (!Number.isFinite(idxNum)) continue;
        maxIndex = maxIndex === undefined ? idxNum : Math.max(maxIndex, idxNum);
    }

    const decl = local.getDeclaringStmt();
    if (decl instanceof ArkAssignStmt && sameLocalValue(decl.getLeftOp(), local)) {
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

    if (decl instanceof ArkAssignStmt && sameLocalValue(decl.getLeftOp(), local)) {
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

    for (const stmt of collectLocalUseStmtsWithCfgRecovery(local)) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (!sameLocalValue(right, local)) continue;

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
