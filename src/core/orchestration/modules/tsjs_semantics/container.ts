import { ArkAssignStmt, ArkInvokeStmt } from "../../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkNormalBinopExpr, ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkArrayRef, ArkInstanceFieldRef } from "../../../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../../../arkanalyzer/out/src/core/base/Local";
import { Constant } from "../../../../../arkanalyzer/out/src/core/base/Constant";
import { ArrayType } from "../../../../../arkanalyzer/out/src/core/base/Type";
import { Pag, PagNode } from "../../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import {
    defineModule,
    fromContainerFieldKey,
    type ModuleFactEvent,
    type TaintModule,
    toContainerFieldKey,
} from "../../../kernel/contracts/ModuleApi";
import type {
    ModuleContainerCapability,
    ModuleContainerFamilyKind,
} from "../../../kernel/contracts/ModuleSpec";
import { safeGetOrCreatePagNodes } from "../../../kernel/contracts/PagNodeResolution";

export interface TsjsContainerSemanticModuleOptions {
    id: string;
    description: string;
    families?: ModuleContainerFamilyKind[];
    capabilities?: ModuleContainerCapability[];
}

const ALL_CONTAINER_FAMILIES: ModuleContainerFamilyKind[] = [
    "array",
    "map",
    "weakmap",
    "set",
    "weakset",
    "list",
    "queue",
    "stack",
    "resultset",
];

const ALL_CONTAINER_CAPABILITIES: ModuleContainerCapability[] = [
    "store",
    "nested_store",
    "mutation_base",
    "load",
    "view",
    "object_from_entries",
    "promise_aggregate",
    "resultset",
];

function isContainerKindAllowed(
    kind: ModuleContainerFamilyKind | undefined,
    allowedFamilies: ReadonlySet<ModuleContainerFamilyKind>,
): boolean {
    return !!kind && allowedFamilies.has(kind);
}

function isContainerSlotFamilyAllowed(
    slot: string,
    allowedFamilies: ReadonlySet<ModuleContainerFamilyKind>,
): boolean {
    if (slot.startsWith("arr:")) return allowedFamilies.has("array");
    if (slot.startsWith("map:") || slot.startsWith("mapkey:")) return allowedFamilies.has("map");
    if (slot.startsWith("weakmap:")) return allowedFamilies.has("weakmap");
    if (slot.startsWith("set:")) return allowedFamilies.has("set");
    if (slot.startsWith("weakset:")) return allowedFamilies.has("weakset");
    if (slot.startsWith("list:")) return allowedFamilies.has("list");
    if (slot.startsWith("queue:")) return allowedFamilies.has("queue");
    if (slot.startsWith("stack:")) return allowedFamilies.has("stack");
    if (slot.startsWith("rs:")) return allowedFamilies.has("resultset");
    return false;
}

export function createTsjsContainerSemanticModule(
    options?: Partial<TsjsContainerSemanticModuleOptions>,
): TaintModule {
    const families = new Set<ModuleContainerFamilyKind>(options?.families || ALL_CONTAINER_FAMILIES);
    const capabilities = new Set<ModuleContainerCapability>(options?.capabilities || ALL_CONTAINER_CAPABILITIES);
    return defineModule({
        id: options?.id || "tsjs.container",
        description: options?.description || "Built-in TS/JS container and collection semantics.",
        setup() {
        const collectResultContainerEmissions = (
            event: ModuleFactEvent,
            reason: string,
            resultNodeIds: number[],
            resultSlotStores: Array<{ objId: number; slot: string }>,
            promoteResultNodes: boolean = false,
        ) => {
            const emissions = event.emit.collector();
            if (promoteResultNodes) {
                emissions.push(event.emit.toNodes(resultNodeIds, `${reason}-Node`));
            }
            emissions.push(event.emit.loadLikeToNodes(resultNodeIds, reason, event.current.cloneField()));
            for (const store of resultSlotStores) {
                emissions.push(event.emit.toField(
                    store.objId,
                    [toContainerFieldKey(store.slot), ...(event.current.cloneField() || [])],
                    reason,
                ));
            }
            return emissions.done();
        };
        return {
            onFact(event) {
                const { pag, fact, node } = event.raw;
                const emissions = event.emit.collector();

                if (!fact.field || fact.field.length === 0) {
                    const value = node.getValue?.();
                    if (value instanceof Local) {
                        if (capabilities.has("store")) {
                            for (const info of collectContainerSlotStoresFromTaintedLocal(value, pag, families)) {
                                if (info.slot.startsWith("arr:")) continue;
                                emissions.push(event.emit.toField(
                                    info.objId,
                                    [toContainerFieldKey(info.slot)],
                                    "Container-Store",
                                ));
                            }
                        }

                        if (capabilities.has("mutation_base")) {
                            emissions.push(event.emit.toNodes(
                                collectContainerMutationBaseNodeIdsFromTaintedLocal(value, pag, families)
                                    .filter(nodeId => !isNativeArrayBaseNode(pag, nodeId)),
                                "Container-Mutation-Base",
                            ));
                        }

                        if (capabilities.has("object_from_entries")) {
                            const objectFromEntries = collectObjectFromEntriesEffectsFromTaintedLocal(value, pag);
                            emissions.push(event.emit.loadLikeToNodes(
                                objectFromEntries.resultLoadNodeIds,
                                "Object-FromEntries-Load",
                                event.current.cloneField(),
                            ));
                            for (const store of objectFromEntries.resultFieldStores) {
                                emissions.push(event.emit.toField(
                                    store.objId,
                                    [store.field, ...(event.current.cloneField() || [])],
                                    "Object-FromEntries-Store",
                                ));
                            }
                        }

                        if (capabilities.has("promise_aggregate")) {
                            const promiseAggregate = collectPromiseAggregateEffectsFromTaintedLocal(value, pag);
                            emissions.push(collectResultContainerEmissions(event, "Promise-Aggregate", promiseAggregate.resultNodeIds, promiseAggregate.resultSlotStores));
                        }

                        if (capabilities.has("resultset") && families.has("resultset")) {
                            const resultSetProducer = collectResultSetProducerEffectsFromTaintedLocal(value, pag);
                            emissions.push(collectResultContainerEmissions(event, "ResultSet-Producer", resultSetProducer.resultNodeIds, resultSetProducer.resultSlotStores));
                        }
                    }
                }

                if (capabilities.has("nested_store") && fact.field && fact.field.length > 0) {
                    const slot = fromContainerFieldKey(fact.field[0]);
                    if (slot === null) {
                        for (const aliasLocal of event.analysis.aliasLocalsForCarrier(node.getID())) {
                            for (const info of collectContainerSlotStoresFromTaintedLocal(aliasLocal, pag, families)) {
                                emissions.push(event.emit.toField(
                                    info.objId,
                                    [toContainerFieldKey(info.slot), ...fact.field],
                                    "Container-Nested-Store",
                                ));
                            }

                            if (capabilities.has("resultset") && families.has("resultset")) {
                                const resultSetSlot = fact.field.length > 0 ? `rs:${fact.field[0]}` : "rs:*";
                                for (const info of collectResultSetProducerEffectsFromTaintedLocal(aliasLocal, pag, resultSetSlot).resultSlotStores) {
                                    emissions.push(event.emit.toField(
                                        info.objId,
                                        [toContainerFieldKey(info.slot), ...(fact.field.slice(1) || [])],
                                        "ResultSet-Nested-Producer",
                                    ));
                                }
                            }
                        }
                    }
                }

                if (fact.field && fact.field.length > 0) {
                    const slot = fromContainerFieldKey(fact.field[0]);
                    if (slot !== null && isContainerSlotFamilyAllowed(slot, families)) {
                        const remaining = fact.field.length > 1 ? fact.field.slice(1) : undefined;
                        if (capabilities.has("load")) {
                            emissions.push(event.emit.loadLikeToNodes(
                                collectContainerSlotLoadNodeIds(node.getID(), slot, pag, event.callbacks),
                                "Container-Load",
                                remaining,
                            ));
                        }
                        if (capabilities.has("view")) {
                            const viewEffects = collectContainerViewEffectsBySlot(node.getID(), slot, pag);
                            emissions.push(collectResultContainerEmissions(
                                event,
                                "Container-View",
                                viewEffects.resultNodeIds,
                                viewEffects.resultSlotStores,
                                slot.startsWith("rs:"),
                            ));
                        }
                    }
                }

                return emissions.done();
            },
        };
        },
    });
}

export const tsjsContainerModule: TaintModule = createTsjsContainerSemanticModule({
    id: "tsjs.container",
    description: "Built-in TS/JS container and collection semantics.",
});

function isNativeArrayBaseNode(pag: any, nodeId: number): boolean {
    const node = pag.getNode(nodeId);
    const value = node?.getValue?.();
    const type = value?.getType?.();
    const typeText = type?.toString?.() || "";
    return typeText.endsWith("[]") || type?.constructor?.name === "ArrayType";
}
export interface ContainerSlotStoreInfo {
    objId: number;
    slot: string;
}

export interface ArrayHigherOrderEffects {
    callbackParamNodeIds: number[];
    resultNodeIds: number[];
    resultSlotStores: ContainerSlotStoreInfo[];
}

export interface ObjectFromEntriesEffects {
    resultLoadNodeIds: number[];
    resultFieldStores: Array<{ objId: number; field: string }>;
}

export interface PromiseAggregateEffects {
    resultNodeIds: number[];
    resultSlotStores: ContainerSlotStoreInfo[];
}

export interface ResultContainerEffects {
    resultNodeIds: number[];
    resultSlotStores: ContainerSlotStoreInfo[];
}

export function collectContainerSlotStoresFromTaintedLocal(
    local: Local,
    pag: Pag,
    allowedFamilies?: ReadonlySet<ModuleContainerFamilyKind>,
): ContainerSlotStoreInfo[] {
    const results: ContainerSlotStoreInfo[] = [];
    const dedup = new Set<string>();

    for (const stmt of local.getUsedStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (left instanceof ArkArrayRef && right === local) {
                if (allowedFamilies && !allowedFamilies.has("array")) {
                    continue;
                }
                const base = left.getBase();
                const idxKey = resolveValueKey(left.getIndex());
                if (idxKey !== undefined) {
                    for (const objId of resolveBaseObjIds(base, pag)) {
                        const slot = `arr:${idxKey}`;
                        const key = `${objId}|${slot}`;
                        if (dedup.has(key)) continue;
                        dedup.add(key);
                        results.push({ objId, slot });
                    }
                }
            }
        }

        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

        const base = invokeExpr.getBase();
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const methodName = resolveMethodName(invokeExpr);
        const sig = invokeExpr.getMethodSignature()?.toString() || "";
        const containerKind = resolveContainerKind(base, sig);
        if (allowedFamilies && containerKind && !isContainerKindAllowed(containerKind, allowedFamilies)) {
            continue;
        }

        if (isMapLikeStoreMethod(methodName) && (containerKind === "map" || containerKind === "weakmap") && args.length >= 2 && args[1] === local) {
            const key = resolveValueKey(args[0]);
            if (key !== undefined) {
                for (const objId of resolveBaseObjIds(base, pag)) {
                    const slot = containerKind === "weakmap" ? `weakmap:${key}` : `map:${key}`;
                    const dedupKey = `${objId}|${slot}`;
                    if (dedup.has(dedupKey)) continue;
                    dedup.add(dedupKey);
                    results.push({ objId, slot });
                }
            }
        }

        if (isMapLikeStoreMethod(methodName) && containerKind === "map" && args.length >= 1 && args[0] === local) {
            const key = resolveValueKey(args[0]);
            if (key !== undefined) {
                for (const objId of resolveBaseObjIds(base, pag)) {
                    const slot = `mapkey:${key}`;
                    const dedupKey = `${objId}|${slot}`;
                    if (dedup.has(dedupKey)) continue;
                    dedup.add(dedupKey);
                    results.push({ objId, slot });
                }
            }
        }

        if ((methodName === "add" || methodName === "append" || methodName === "push" || methodName === "insertEnd") && args.length >= 1 && args[0] === local) {
            const ordinal = resolveAddOrdinal(base, stmt);
            if (ordinal < 0) continue;
            let slot: string | null = null;
            if (containerKind === "set") slot = `set:${ordinal}`;
            if (containerKind === "list") slot = `list:${ordinal}`;
            if (containerKind === "queue") slot = `queue:${ordinal}`;
            if (containerKind === "stack") slot = `stack:${ordinal}`;
            if (containerKind === "array") slot = `arr:${ordinal}`;
            if (!slot) continue;

            for (const objId of resolveBaseObjIds(base, pag)) {
                const dedupKey = `${objId}|${slot}`;
                if (dedup.has(dedupKey)) continue;
                dedup.add(dedupKey);
                results.push({ objId, slot });
            }
        }

        if (methodName === "add" && containerKind === "weakset" && args.length >= 1 && args[0] === local) {
            const ordinal = resolveAddOrdinal(base, stmt);
            if (ordinal < 0) continue;
            for (const objId of resolveBaseObjIds(base, pag)) {
                const slot = `weakset:${ordinal}`;
                const dedupKey = `${objId}|${slot}`;
                if (dedup.has(dedupKey)) continue;
                dedup.add(dedupKey);
                results.push({ objId, slot });
            }
        }

        if (methodName === "splice" && containerKind === "array" && args.length >= 3) {
            const startNum = resolveNumber(args[0]);
            for (let i = 2; i < args.length; i++) {
                if (args[i] !== local) continue;
                const slot = startNum === undefined ? "arr:*" : `arr:${startNum + (i - 2)}`;
                for (const objId of resolveBaseObjIds(base, pag)) {
                    const dedupKey = `${objId}|${slot}`;
                    if (dedup.has(dedupKey)) continue;
                    dedup.add(dedupKey);
                    results.push({ objId, slot });
                }
            }
        }
    }

    return results;
}

export function collectContainerMutationBaseNodeIdsFromTaintedLocal(
    local: Local,
    pag: Pag,
    allowedFamilies?: ReadonlySet<ModuleContainerFamilyKind>,
): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkInvokeStmt) || !stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;

        const base = invokeExpr.getBase();
        if (!(base instanceof Local)) continue;

        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const methodName = resolveMethodName(invokeExpr);
        const sig = invokeExpr.getMethodSignature()?.toString() || "";
        const containerKind = resolveContainerKind(base, sig);
        if (allowedFamilies && containerKind && !isContainerKindAllowed(containerKind, allowedFamilies)) continue;
        if (!isContainerMutationForBase(methodName, containerKind)) continue;
        if (!isMutationInputAffectingBase(methodName, containerKind, base, args, local)) continue;

        const baseNodes = pag.getNodesByValue(base);
        if (!baseNodes) continue;
        for (const nodeId of baseNodes.values()) {
            if (dedup.has(nodeId)) continue;
            dedup.add(nodeId);
            results.push(nodeId);
        }
    }

    return results;
}

export function collectContainerSlotLoadNodeIds(
    objId: number,
    slot: string,
    pag: Pag,
    callbacks: ModuleFactEvent["callbacks"],
): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (baseNode.getID() !== objId && !baseNode.getPointTo().contains(objId)) continue;
        collectContainerSlotLoadNodeIdsForBaseLocal(val, slot, pag, callbacks, results, dedup);
    }

    return results;
}

export function collectContainerSlotLoadNodeIdsFromLocal(
    base: Local,
    slot: string,
    pag: Pag,
    callbacks: ModuleFactEvent["callbacks"],
): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();
    collectContainerSlotLoadNodeIdsForBaseLocal(base, slot, pag, callbacks, results, dedup);
    return results;
}

export function collectArrayForEachCallbackParamNodeIdsFromTaintedLocal(
    local: Local,
    pag: Pag,
    callbacks: ModuleFactEvent["callbacks"],
): number[] {
    const results: number[] = [];
    const seenObjIds = new Set<number>();
    const dedup = new Set<number>();

    for (const info of collectContainerSlotStoresFromTaintedLocal(local, pag)) {
        if (!info.slot.startsWith("arr:")) continue;
        if (seenObjIds.has(info.objId)) continue;
        seenObjIds.add(info.objId);

        const callbackNodeIds = collectArrayCallbackParamNodeIds(info.objId, pag, callbacks, "forEach", [0]);
        for (const nodeId of callbackNodeIds) {
            if (dedup.has(nodeId)) continue;
            dedup.add(nodeId);
            results.push(nodeId);
        }
    }

    return results;
}

export function collectArrayHigherOrderEffectsFromTaintedLocal(
    local: Local,
    pag: Pag,
    callbacks: ModuleFactEvent["callbacks"],
): ArrayHigherOrderEffects {
    const callbackParamNodeIds: number[] = [];
    const resultNodeIds: number[] = [];
    const resultSlotStores: ContainerSlotStoreInfo[] = [];
    const seenObjIds = new Set<number>();
    const callbackDedup = new Set<number>();
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const info of collectContainerSlotStoresFromTaintedLocal(local, pag)) {
        if (!info.slot.startsWith("arr:")) continue;
        if (seenObjIds.has(info.objId)) continue;
        seenObjIds.add(info.objId);

        const effect = collectArrayHigherOrderEffectsForObj(info.objId, info.slot, pag, callbacks);
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

export function collectObjectFromEntriesEffectsFromTaintedLocal(local: Local, pag: Pag): ObjectFromEntriesEffects {
    const resultLoadNodeIds: number[] = [];
    const resultFieldStores: Array<{ objId: number; field: string }> = [];
    const loadDedup = new Set<number>();
    const storeDedup = new Set<string>();

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (stmt.getRightOp() !== local) continue;

        const pairSlot = resolveValueKey(left.getIndex());
        if (pairSlot !== "1") continue;

        const pairBase = left.getBase();
        if (!(pairBase instanceof Local)) continue;

        const fieldName = resolveFromEntriesKeyFromPairLocal(pairBase);
        if (!fieldName) continue;

        const outerArrays = collectFromEntriesOuterArrayLocals(pairBase);
        for (const outerArray of outerArrays) {
            for (const outerUse of outerArray.getUsedStmts()) {
                if (!(outerUse instanceof ArkAssignStmt)) continue;
                const right = outerUse.getRightOp();
                if (!(right instanceof ArkStaticInvokeExpr)) continue;
                if (resolveMethodName(right) !== "fromEntries") continue;

                const args = right.getArgs ? right.getArgs() : [];
                if (args.length < 1 || args[0] !== outerArray) continue;

                for (const objId of resolveAssignedObjIds(outerUse.getLeftOp(), pag)) {
                    const key = `${objId}|${fieldName}`;
                    if (storeDedup.has(key)) continue;
                    storeDedup.add(key);
                    resultFieldStores.push({ objId, field: fieldName });
                }

                const resultLocal = outerUse.getLeftOp();
                if (!(resultLocal instanceof Local)) continue;
                for (const resultUse of resultLocal.getUsedStmts()) {
                    if (!(resultUse instanceof ArkAssignStmt)) continue;
                    const resultRight = resultUse.getRightOp();
                    if (!(resultRight instanceof ArkInstanceFieldRef)) continue;
                    if (resultRight.getBase() !== resultLocal) continue;
                    if (resultRight.getFieldSignature().getFieldName() !== fieldName) continue;

                    const dstNodes = getOrCreatePagNodes(pag, resultUse.getLeftOp(), resultUse);
                    if (!dstNodes) continue;
                    for (const nodeId of dstNodes.values()) {
                        if (loadDedup.has(nodeId)) continue;
                        loadDedup.add(nodeId);
                        resultLoadNodeIds.push(nodeId);
                    }
                }
            }
        }
    }

    return {
        resultLoadNodeIds,
        resultFieldStores,
    };
}

export function collectPromiseAggregateEffectsFromTaintedLocal(local: Local, pag: Pag): PromiseAggregateEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: ContainerSlotStoreInfo[] = [];
    const dedup = new Set<number>();
    const slotDedup = new Set<string>();
    const seenArrayObjIds = new Set<number>();

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkStaticInvokeExpr) && !(right instanceof ArkInstanceInvokeExpr)) continue;
        if (!isPromiseAggregateInvoke(right)) continue;
        const args = right.getArgs ? right.getArgs() : [];
        if (!args.includes(local)) continue;

        const dstNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
        if (!dstNodes) continue;
        for (const nodeId of dstNodes.values()) {
            if (dedup.has(nodeId)) continue;
            dedup.add(nodeId);
            resultNodeIds.push(nodeId);
        }
    }

    for (const info of collectContainerSlotStoresFromTaintedLocal(local, pag)) {
        if (!info.slot.startsWith("arr:")) continue;
        if (seenArrayObjIds.has(info.objId)) continue;
        seenArrayObjIds.add(info.objId);

        const aggregateResultNodeIds = collectPromiseAggregateResultNodeIdsForObj(info.objId, pag);
        for (const nodeId of aggregateResultNodeIds) {
            if (dedup.has(nodeId)) continue;
            dedup.add(nodeId);
            resultNodeIds.push(nodeId);
        }
        for (const nodeId of aggregateResultNodeIds) {
            const key = `${nodeId}|${info.slot}`;
            if (slotDedup.has(key)) continue;
            slotDedup.add(key);
            resultSlotStores.push({ objId: nodeId, slot: info.slot });
        }
    }

    return {
        resultNodeIds,
        resultSlotStores,
    };
}

export function collectArrayConstructorEffectsFromTaintedLocal(local: Local, pag: Pag): ResultContainerEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: ContainerSlotStoreInfo[] = [];
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

export function collectStringSplitEffectsFromTaintedLocal(local: Local, pag: Pag): ResultContainerEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: ContainerSlotStoreInfo[] = [];
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

export function collectArrayStaticViewEffectsBySlotFromLocal(local: Local, slot: string, pag: Pag): ResultContainerEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: ContainerSlotStoreInfo[] = [];
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

export function collectArrayStaticViewEffectsBySlot(objId: number, slot: string, pag: Pag): ResultContainerEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: ContainerSlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (!baseNode.getPointTo().contains(objId)) continue;

        const effects = collectArrayStaticViewEffectsBySlotFromLocal(val, slot, pag);
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

export function collectArrayFromMapperCallbackParamNodeIdsFromTaintedLocal(
    local: Local,
    pag: Pag,
    callbacks: ModuleFactEvent["callbacks"]
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

        for (const nodeId of collectCallbackParamNodeIds(callbacks, pag, args[1], [0])) {
            if (dedup.has(nodeId)) continue;
            dedup.add(nodeId);
            results.push(nodeId);
        }
    }

    return results;
}

export function collectArrayFromMapperCallbackParamNodeIdsForObj(
    objId: number,
    pag: Pag,
    callbacks: ModuleFactEvent["callbacks"]
): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (!baseNode.getPointTo().contains(objId)) continue;

        for (const nodeId of collectArrayFromMapperCallbackParamNodeIdsFromTaintedLocal(val, pag, callbacks)) {
            if (dedup.has(nodeId)) continue;
            dedup.add(nodeId);
            results.push(nodeId);
        }
    }

    return results;
}

export function collectContainerViewEffectsBySlot(objId: number, slot: string, pag: Pag): ResultContainerEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: ContainerSlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (baseNode.getID() !== objId && !baseNode.getPointTo().contains(objId)) continue;
        collectContainerViewEffectsBySlotForBaseLocal(val, slot, pag, resultNodeIds, resultSlotStores, resultDedup, slotDedup);
    }

    return {
        resultNodeIds,
        resultSlotStores,
    };
}

export function collectContainerViewEffectsBySlotFromLocal(base: Local, slot: string, pag: Pag): ResultContainerEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: ContainerSlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();
    collectContainerViewEffectsBySlotForBaseLocal(base, slot, pag, resultNodeIds, resultSlotStores, resultDedup, slotDedup);
    return {
        resultNodeIds,
        resultSlotStores,
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

function collectArrayElementPathKeys(base: Local, idxKey: string): Set<string> {
    const keys = new Set<string>();
    for (const p of collectArrayObjectPathKeys(base, new Set<Local>())) {
        keys.add(`${p}/${idxKey}`);
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
                for (const p of collectArrayObjectPathKeys(right.getBase(), visiting)) {
                    keys.add(`${p}/${idx}`);
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
        for (const p of collectArrayObjectPathKeys(left.getBase(), visiting)) {
            keys.add(`${p}/${parentIdx}`);
        }
    }

    visiting.delete(local);
    return keys;
}

function mergePathKeys(target: Set<string>, src: Set<string>): void {
    for (const k of src) target.add(k);
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

export function collectResultSetProducerEffectsFromTaintedLocal(
    local: Local,
    pag: Pag,
    slot: string = "rs:*",
): ResultContainerEffects {
    const resultNodeIds: number[] = [];
    const resultSlotStores: ContainerSlotStoreInfo[] = [];
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const stmt of local.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkInstanceInvokeExpr)) continue;
        if (right.getBase() !== local) continue;
        const methodName = resolveMethodName(right);
        if (!isResultSetProducerMethod(methodName)) continue;
        if (!doesResultSetQueryExposeSlot(right, slot)) continue;

        const dstNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
        if (dstNodes) {
            for (const nodeId of dstNodes.values()) {
                if (resultDedup.has(nodeId)) continue;
                resultDedup.add(nodeId);
                resultNodeIds.push(nodeId);
            }
        }

        for (const holderId of resolveAssignedContainerHolderIds(stmt.getLeftOp(), pag, stmt)) {
            const key = `${holderId}|${slot}`;
            if (slotDedup.has(key)) continue;
            slotDedup.add(key);
            resultSlotStores.push({ objId: holderId, slot });
        }
    }

    return {
        resultNodeIds,
        resultSlotStores,
    };
}

function hasPathIntersection(a: Set<string>, b: Set<string>): boolean {
    for (const k of a) {
        if (b.has(k)) return true;
    }
    return false;
}

function resolveMethodName(invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr): string {
    const fromSig = invokeExpr.getMethodSignature()?.getMethodSubSignature()?.getMethodName() || "";
    if (fromSig) return fromSig;
    const sig = invokeExpr.getMethodSignature()?.toString() || "";
    const m = sig.match(/\.([A-Za-z0-9_]+)\(\)/);
    return m ? m[1] : "";
}

function isArrayStaticCall(sig: string, methodName: string): boolean {
    if (methodName !== "from" && methodName !== "of") return false;
    return sig.length === 0 || sig.includes("Array.") || sig.includes("@%unk/%unk");
}

function isContainerMutationForBase(
    methodName: string,
    containerKind: "array" | "map" | "weakmap" | "set" | "weakset" | "list" | "queue" | "stack" | "resultset" | undefined
): boolean {
    if (!containerKind) return false;
    if (containerKind === "map" || containerKind === "weakmap") return isMapLikeStoreMethod(methodName);
    if (containerKind === "set" || containerKind === "weakset") return methodName === "add";
    if (containerKind === "array") return methodName === "push" || methodName === "unshift" || methodName === "splice";
    if (containerKind === "list") return methodName === "add" || methodName === "append" || methodName === "push" || methodName === "unshift";
    if (containerKind === "queue") return methodName === "add" || methodName === "append" || methodName === "push" || methodName === "insertEnd";
    if (containerKind === "stack") return methodName === "push";
    return false;
}

function isMutationInputAffectingBase(
    methodName: string,
    containerKind: "array" | "map" | "weakmap" | "set" | "weakset" | "list" | "queue" | "stack" | "resultset" | undefined,
    base: Local,
    args: any[],
    local: Local
): boolean {
    if (base === local) return true;
    if (containerKind === "array" && methodName === "splice") {
        return args.slice(2).includes(local);
    }
    return args.includes(local);
}

function resolveContainerKind(base: Local, sig: string): "array" | "map" | "weakmap" | "set" | "weakset" | "list" | "queue" | "stack" | "resultset" | undefined {
    if (sig.includes("PlainArray.")) return "map";
    if (sig.includes("Array.")) return "array";
    if (sig.includes("Map.")) return "map";
    if (sig.includes("WeakMap.")) return "weakmap";
    if (sig.includes("ResultSet.") || sig.includes("DataShareResultSet.")) return "resultset";
    if (sig.includes("Set.")) return "set";
    if (sig.includes("WeakSet.")) return "weakset";
    if (sig.includes("List.")) return "list";
    if (sig.includes("Queue.")) return "queue";
    if (sig.includes("ArrayList.")) return "list";
    if (sig.includes("LinkedList.")) return "list";
    if (sig.includes("Vector.")) return "list";
    if (sig.includes("Deque.")) return "queue";
    if (sig.includes("Stack.")) return "stack";
    const baseType = base.getType?.();
    const text = baseType?.toString?.() || "";
    if (baseType instanceof ArrayType || text.endsWith("[]")) return "array";
    if (hasContainerTypeToken(text, "WeakMap")) return "weakmap";
    if (hasContainerTypeToken(text, "Map")) return "map";
    if (hasContainerTypeToken(text, "WeakSet")) return "weakset";
    if (hasContainerTypeToken(text, "Set")) return "set";
    if (hasContainerTypeToken(text, "ArrayList") || hasContainerTypeToken(text, "LinkedList") || hasContainerTypeToken(text, "Vector") || hasContainerTypeToken(text, "List")) return "list";
    if (hasContainerTypeToken(text, "Deque") || hasContainerTypeToken(text, "Queue")) return "queue";
    if (hasContainerTypeToken(text, "Stack")) return "stack";
    if (hasContainerTypeToken(text, "PlainArray")) return "map";
    if (hasContainerTypeToken(text, "DataShareResultSet") || hasContainerTypeToken(text, "ResultSet")) return "resultset";
    if (isNamedMapLikeType(text)) return "map";
    return undefined;
}

function hasContainerTypeToken(text: string, typeName: string): boolean {
    const normalized = String(text || "").trim();
    if (!normalized) return false;
    const escapedTypeName = typeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapedTypeName}(?:<[^|)]*>)?(?=$|[^A-Za-z0-9_])`);
    return pattern.test(normalized);
}

function isNamedMapLikeType(text: string): boolean {
    const normalized = String(text || "").trim();
    if (!normalized) return false;
    const tail = normalized.includes(":")
        ? normalized.split(":").pop()!.trim()
        : normalized;
    return tail === "Preferences"
        || tail === "DistributedKVStore"
        || tail === "GlobalContext"
        || normalized.endsWith(".Preferences")
        || normalized.endsWith(".DistributedKVStore")
        || normalized.endsWith(".GlobalContext");
}

function isMapLikeStoreMethod(methodName: string): boolean {
    return methodName === "set"
        || methodName === "put"
        || methodName === "putSync"
        || methodName === "setObject"
        || methodName === "add";
}

function isMapLikeLoadMethod(methodName: string): boolean {
    return methodName === "get" || methodName === "getSync" || methodName === "getObject";
}

function collectCallbackParamNodeIds(
    callbacks: ModuleFactEvent["callbacks"],
    pag: Pag,
    callbackArg: any,
    paramIndexes?: number[],
): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();
    const paramIndexesToResolve = paramIndexes && paramIndexes.length > 0
        ? paramIndexes
        : [0];

    for (const paramIndex of paramIndexesToResolve) {
        for (const binding of callbacks.paramBindings(callbackArg, paramIndex, { maxCandidates: 8 })) {
            for (const nodeId of binding.localNodeIds()) {
                if (dedup.has(nodeId)) continue;
                dedup.add(nodeId);
                results.push(nodeId);
            }
        }
    }

    return results;
}

function collectArrayCallbackParamNodeIds(
    objId: number,
    pag: Pag,
    callbacks: ModuleFactEvent["callbacks"],
    methodName: string,
    paramIndexes?: number[]
): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (!baseNode.getPointTo().contains(objId)) continue;

        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkInvokeStmt)) continue;
            const invokeExpr = stmt.getInvokeExpr();
            if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
            if (invokeExpr.getBase() !== val) continue;
            if (resolveMethodName(invokeExpr) !== methodName) continue;

            const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
            if (args.length === 0) continue;
            const callbackNodeIds = collectCallbackParamNodeIds(callbacks, pag, args[0], paramIndexes);
            for (const nodeId of callbackNodeIds) {
                if (dedup.has(nodeId)) continue;
                dedup.add(nodeId);
                results.push(nodeId);
            }
        }
    }

    return results;
}

function collectArrayHigherOrderEffectsForObj(
    objId: number,
    slot: string,
    pag: Pag,
    callbacks: ModuleFactEvent["callbacks"]
): ArrayHigherOrderEffects {
    const callbackParamNodeIds: number[] = [];
    const resultNodeIds: number[] = [];
    const resultSlotStores: ContainerSlotStoreInfo[] = [];
    const callbackDedup = new Set<number>();
    const resultDedup = new Set<number>();
    const slotDedup = new Set<string>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (!baseNode.getPointTo().contains(objId)) continue;

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

                for (const nodeId of collectCallbackParamNodeIds(callbacks, pag, args[0], callbackParamIndexes)) {
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

            for (const nodeId of collectCallbackParamNodeIds(callbacks, pag, args[0], callbackParamIndexes)) {
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

            if (methodName === "find") {
                const dstNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
                if (dstNodes) {
                    for (const nodeId of dstNodes.values()) {
                        if (resultDedup.has(nodeId)) continue;
                        resultDedup.add(nodeId);
                        resultNodeIds.push(nodeId);
                    }
                }
                continue;
            }

            if (methodName === "reduce" || methodName === "reduceRight") {
                const dstNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
                if (dstNodes) {
                    for (const nodeId of dstNodes.values()) {
                        if (resultDedup.has(nodeId)) continue;
                        resultDedup.add(nodeId);
                        resultNodeIds.push(nodeId);
                    }
                }
                continue;
            }
        }
    }

    return {
        callbackParamNodeIds,
        resultNodeIds,
        resultSlotStores,
    };
}

function collectPromiseAggregateResultNodeIdsForObj(objId: number, pag: Pag): number[] {
    const results: number[] = [];
    const dedup = new Set<number>();

    for (const rawNode of pag.getNodesIter()) {
        const baseNode = rawNode as PagNode;
        const val = baseNode.getValue();
        if (!(val instanceof Local)) continue;
        if (!baseNode.getPointTo().contains(objId)) continue;

        for (const stmt of val.getUsedStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const right = stmt.getRightOp();
            if (!(right instanceof ArkStaticInvokeExpr) && !(right instanceof ArkInstanceInvokeExpr)) continue;
            if (!isPromiseAggregateInvoke(right)) continue;
            const args = right.getArgs ? right.getArgs() : [];
            if (!args.includes(val)) continue;

            const dstNodes = getOrCreatePagNodes(pag, stmt.getLeftOp(), stmt);
            if (!dstNodes) continue;
            for (const nodeId of dstNodes.values()) {
                if (dedup.has(nodeId)) continue;
                dedup.add(nodeId);
                results.push(nodeId);
            }
        }
    }

    return results;
}

function resolveArrayHigherOrderCallbackParamIndexes(methodName: string): number[] | undefined {
    if (methodName === "reduce" || methodName === "reduceRight") return [1];
    if (methodName === "forEach"
        || methodName === "map"
        || methodName === "filter"
        || methodName === "flatMap"
        || methodName === "find"
        || methodName === "findIndex"
        || methodName === "some"
        || methodName === "every") {
        return [0];
    }
    return undefined;
}

function isPromiseAggregateInvoke(invokeExpr: ArkStaticInvokeExpr | ArkInstanceInvokeExpr): boolean {
    const methodName = resolveMethodName(invokeExpr);
    if (!["all", "race", "allSettled", "any"].includes(methodName)) return false;
    const sig = invokeExpr.getMethodSignature()?.toString() || "";
    return sig.length === 0 || sig.includes("Promise.") || sig.includes("@%unk/%unk");
}

function getOrCreatePagNodes(pag: Pag, value: any, anchorStmt: ArkAssignStmt): Map<number, number> | undefined {
    return safeGetOrCreatePagNodes(pag, value, anchorStmt);
}

function collectContainerSlotLoadNodeIdsForBaseLocal(
    val: Local,
    slot: string,
    pag: Pag,
    callbacks: ModuleFactEvent["callbacks"],
    results: number[],
    dedup: Set<number>
): void {
    for (const stmt of val.getUsedStmts()) {
        if (stmt instanceof ArkAssignStmt) {
            const right = stmt.getRightOp();
            const left = stmt.getLeftOp();

            if (right instanceof ArkInstanceFieldRef && right.getBase() === val) {
                const fieldName = right.getFieldSignature().getFieldName();
                if (/^-?\d+$/.test(fieldName) && slot.startsWith("arr:")) {
                    const expectedSlot = `arr:${fieldName}`;
                    if (isContainerSlotMatch(slot, expectedSlot)) {
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
                const sig = right.getMethodSignature()?.toString() || "";
                const args = right.getArgs ? right.getArgs() : [];
                const containerKind = resolveContainerKind(val, sig);
                const arrayLike = containerKind === "array" || (containerKind === undefined && slot.startsWith("arr:"));
                const mapLike = containerKind === "map" || (containerKind === undefined && (slot.startsWith("map:") || slot.startsWith("mapkey:")));
                const setLike = containerKind === "set" || (containerKind === undefined && slot.startsWith("set:"));
                const weakSetLike = containerKind === "weakset" || (containerKind === undefined && slot.startsWith("weakset:"));
                const listLike = containerKind === "list" || (containerKind === undefined && slot.startsWith("list:"));
                const queueLike = containerKind === "queue" || (containerKind === undefined && slot.startsWith("queue:"));
                const stackLike = containerKind === "stack" || (containerKind === undefined && slot.startsWith("stack:"));
                const resultSetLike = containerKind === "resultset" || (containerKind === undefined && slot.startsWith("rs:"));

                let matched = false;
                if (isMapLikeLoadMethod(methodName) && mapLike) {
                    const key = args.length > 0 ? resolveValueKey(args[0]) : undefined;
                    matched = key !== undefined && isContainerSlotMatch(slot, `map:${key}`);
                } else if (methodName === "getFirst" && queueLike) {
                    matched = isContainerSlotMatch(slot, "queue:0");
                } else if (methodName === "getLast" && queueLike && slot.startsWith("queue:")) {
                    matched = isLikelyContainerTailSourceSlot(slot, val, new Set(["add", "append", "push", "insertEnd"]), "queue:");
                } else if (methodName === "get" && listLike) {
                    const idxKey = args.length > 0 ? resolveValueKey(args[0]) : undefined;
                    matched = idxKey !== undefined && isContainerSlotMatch(slot, `list:${idxKey}`);
                } else if (methodName === "peek" && stackLike && slot.startsWith("stack:")) {
                    matched = isLikelyContainerTailSourceSlot(slot, val, new Set(["push"]), "stack:");
                } else if (isResultSetScalarLoadMethod(methodName) && resultSetLike) {
                    const key = args.length > 0 ? resolveValueKey(args[0]) : undefined;
                    matched = slot === "rs:*" || (key !== undefined && isContainerSlotMatch(slot, `rs:${key}`));
                } else if (methodName === "getRow" && resultSetLike) {
                    matched = slot.startsWith("rs:");
                } else if (methodName === "values" && mapLike) {
                    matched = slot.startsWith("map:");
                } else if (methodName === "keys" && mapLike) {
                    matched = slot.startsWith("mapkey:");
                } else if (methodName === "entries" && mapLike) {
                    matched = slot.startsWith("map:") || slot.startsWith("mapkey:");
                } else if (methodName === "values" && setLike) {
                    matched = slot.startsWith("set:");
                } else if (methodName === "keys" && setLike) {
                    matched = slot.startsWith("set:");
                } else if (methodName === "entries" && setLike) {
                    matched = slot.startsWith("set:");
                } else if (methodName === "values" && weakSetLike) {
                    matched = slot.startsWith("weakset:");
                } else if (methodName === "keys" && weakSetLike) {
                    matched = slot.startsWith("weakset:");
                } else if (methodName === "entries" && weakSetLike) {
                    matched = slot.startsWith("weakset:");
                } else if (methodName === "values" && arrayLike) {
                    matched = slot.startsWith("arr:");
                } else if (methodName === "entries" && arrayLike) {
                    matched = slot.startsWith("arr:");
                } else if (methodName === "toString" && arrayLike && slot.startsWith("arr:")) {
                    matched = true;
                } else if (methodName === "flat" && arrayLike && slot.startsWith("arr:")) {
                    matched = true;
                } else if (methodName === "at" && arrayLike && slot.startsWith("arr:")) {
                    const idxKey = args.length > 0 ? resolveValueKey(args[0]) : undefined;
                    matched = idxKey !== undefined && isContainerSlotMatch(slot, `arr:${idxKey}`);
                } else if (methodName === "shift" && arrayLike && isContainerSlotMatch(slot, "arr:0")) {
                    matched = true;
                } else if (methodName === "pop" && arrayLike && slot.startsWith("arr:")) {
                    matched = isLikelyArrayPopSourceSlot(slot, val);
                } else if (methodName === "splice" && arrayLike && slot.startsWith("arr:")) {
                    matched = isSpliceRemovedSlot(slot, args);
                }

                if (matched && !isContainerSlotLiveAtStmt(val, slot, stmt)) {
                    matched = false;
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

            const callbackParamIndexes = resolveForEachCallbackParamIndexes(slot);
            if (callbackParamIndexes.length === 0) continue;
            const callbackParamNodeIds = collectCallbackParamNodeIds(callbacks, pag, args[0], callbackParamIndexes);
            for (const nodeId of callbackParamNodeIds) {
                if (dedup.has(nodeId)) continue;
                dedup.add(nodeId);
                results.push(nodeId);
            }
        }
    }
}

function collectContainerViewEffectsBySlotForBaseLocal(
    val: Local,
    slot: string,
    pag: Pag,
    resultNodeIds: number[],
    resultSlotStores: ContainerSlotStoreInfo[],
    resultDedup: Set<number>,
    slotDedup: Set<string>
): void {
    for (const stmt of val.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const right = stmt.getRightOp();
        if (!(right instanceof ArkInstanceInvokeExpr)) continue;
        if (right.getBase() !== val) continue;

        const methodName = resolveMethodName(right);
        const sig = right.getMethodSignature()?.toString() || "";
        const containerKind = resolveContainerKind(val, sig);
        const arrayLike = containerKind === "array" || (containerKind === undefined && slot.startsWith("arr:"));
        const mapLike = containerKind === "map" || (containerKind === undefined && (slot.startsWith("map:") || slot.startsWith("mapkey:")));
        const setLike = containerKind === "set" || (containerKind === undefined && slot.startsWith("set:"));
        const weakSetLike = containerKind === "weakset" || (containerKind === undefined && slot.startsWith("weakset:"));
        const resultSetLike = containerKind === "resultset" || (containerKind === undefined && slot.startsWith("rs:"));

        let matched = false;
        if (methodName === "values" && mapLike) {
            matched = slot.startsWith("map:");
        } else if (methodName === "keys" && mapLike) {
            matched = slot.startsWith("mapkey:");
        } else if (methodName === "entries" && mapLike) {
            matched = slot.startsWith("map:") || slot.startsWith("mapkey:");
        } else if (methodName === "values" && setLike) {
            matched = slot.startsWith("set:");
        } else if (methodName === "keys" && setLike) {
            matched = slot.startsWith("set:");
        } else if (methodName === "entries" && setLike) {
            matched = slot.startsWith("set:");
        } else if (methodName === "values" && weakSetLike) {
            matched = slot.startsWith("weakset:");
        } else if (methodName === "keys" && weakSetLike) {
            matched = slot.startsWith("weakset:");
        } else if (methodName === "entries" && weakSetLike) {
            matched = slot.startsWith("weakset:");
        } else if (methodName === "values" && arrayLike) {
            matched = slot.startsWith("arr:");
        } else if (methodName === "entries" && arrayLike) {
            matched = slot.startsWith("arr:");
        } else if (methodName === "flat" && arrayLike) {
            matched = slot.startsWith("arr:");
        } else if (methodName === "splice" && arrayLike) {
            matched = isSpliceRemovedSlot(slot, right.getArgs ? right.getArgs() : []);
        } else if (methodName === "getRows" && resultSetLike) {
            matched = slot.startsWith("rs:");
        }

        if (matched && !isContainerSlotLiveAtStmt(val, slot, stmt)) {
            matched = false;
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

        const resultSlot = resolveContainerViewResultSlot(methodName, slot, containerKind, right.getArgs ? right.getArgs() : []);
        for (const holderId of resolveAssignedContainerHolderIds(stmt.getLeftOp(), pag, stmt)) {
            const key = `${holderId}|${resultSlot}`;
            if (slotDedup.has(key)) continue;
            slotDedup.add(key);
            resultSlotStores.push({ objId: holderId, slot: resultSlot });
        }
    }
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

function collectFromEntriesOuterArrayLocals(pairBase: Local): Local[] {
    const results: Local[] = [];
    const dedup = new Set<string>();
    for (const stmt of pairBase.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (stmt.getRightOp() !== pairBase) continue;

        const outerBase = left.getBase();
        if (!(outerBase instanceof Local)) continue;
        const key = `${outerBase.getName()}|${outerBase.getDeclaringStmt()?.toString?.() || ""}`;
        if (dedup.has(key)) continue;
        dedup.add(key);
        results.push(outerBase);
    }
    return results;
}

function resolveFromEntriesKeyFromPairLocal(pairBase: Local): string | undefined {
    for (const stmt of pairBase.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (left.getBase() !== pairBase) continue;
        const idxKey = resolveValueKey(left.getIndex());
        if (idxKey !== "0") continue;
        return resolveValueKey(stmt.getRightOp());
    }
    return undefined;
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

function isContainerSlotMatch(taintedSlot: string, expectedSlot: string): boolean {
    if (taintedSlot === expectedSlot) return true;
    if (taintedSlot.endsWith("*")) {
        return expectedSlot.startsWith(taintedSlot.slice(0, -1));
    }
    return false;
}

function resolveContainerViewResultSlot(
    methodName: string,
    sourceSlot: string,
    containerKind: "array" | "map" | "weakmap" | "set" | "weakset" | "list" | "queue" | "stack" | "resultset" | undefined,
    args: any[]
): string {
    if (containerKind === "array" && (methodName === "values" || methodName === "entries") && sourceSlot.startsWith("arr:")) {
        return sourceSlot;
    }
    if (containerKind === "array" && methodName === "splice") {
        return resolveSpliceResultSlot(sourceSlot, args);
    }
    if (containerKind === "resultset" && methodName === "getRows") {
        return "arr:*";
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

function parseArraySlotIndex(slot: string): number | undefined {
    const m = slot.match(/^arr:(-?\d+)$/);
    if (!m) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : undefined;
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

function resolveAddOrdinal(base: Local, targetStmt: any): number {
    return resolveSequentialOrdinal(base, targetStmt, new Set(["add", "append", "push", "insertEnd"]));
}

function resolveSequentialOrdinal(base: Local, targetStmt: any, methods: Set<string>): number {
    const stmts = [...base.getUsedStmts()].sort(
        (a: any, b: any) => a.getOriginPositionInfo().getLineNo() - b.getOriginPositionInfo().getLineNo()
    );
    let idx = 0;
    for (const stmt of stmts) {
        if (stmt === targetStmt) return idx;
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        if (invokeExpr.getBase() !== base) continue;
        const methodName = resolveMethodName(invokeExpr);
        if (methodName === "clear") {
            idx = 0;
            continue;
        }
        if (methods.has(methodName)) {
            idx++;
        }
    }
    return -1;
}

function isLikelyContainerTailSourceSlot(slot: string, base: Local, methods: Set<string>, prefix: string): boolean {
    if (!slot.startsWith(prefix)) return false;
    const slotIndex = Number(slot.slice(prefix.length));
    if (Number.isNaN(slotIndex)) return false;
    const maxIndex = resolveMaxSequentialOrdinal(base, methods);
    if (maxIndex === undefined) return true;
    return slotIndex === maxIndex;
}

function resolveMaxSequentialOrdinal(base: Local, methods: Set<string>): number | undefined {
    const stmts = [...base.getUsedStmts()].sort(
        (a: any, b: any) => a.getOriginPositionInfo().getLineNo() - b.getOriginPositionInfo().getLineNo()
    );
    let idx = 0;
    let maxIndex: number | undefined;
    for (const stmt of stmts) {
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;
        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        if (invokeExpr.getBase() !== base) continue;
        const methodName = resolveMethodName(invokeExpr);
        if (methodName === "clear") {
            idx = 0;
            maxIndex = undefined;
            continue;
        }
        if (!methods.has(methodName)) continue;
        maxIndex = idx;
        idx++;
    }
    return maxIndex;
}

function isContainerSlotLiveAtStmt(base: Local, slot: string, anchorStmt: any): boolean {
    const cfg = anchorStmt?.getCfg?.() || base.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return true;

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
    if (anchorIndex < 0) return true;

    let state: "unknown" | "live" | "dead" = "unknown";
    for (const stmt of stmts) {
        const stmtIndex = order.get(stmt);
        if (stmtIndex === undefined || stmtIndex >= anchorIndex) break;
        if (!stmt.containsInvokeExpr || !stmt.containsInvokeExpr()) continue;

        const invokeExpr = stmt.getInvokeExpr();
        if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) continue;
        if (invokeExpr.getBase() !== base) continue;

        const methodName = resolveMethodName(invokeExpr);
        const sig = invokeExpr.getMethodSignature()?.toString() || "";
        const containerKind = resolveContainerKind(base, sig);
        const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];

        if (isContainerSlotClearInvalidation(methodName, containerKind, slot)) {
            state = "dead";
            continue;
        }

        if (isContainerSlotDeleteInvalidation(methodName, containerKind, slot, args)) {
            state = "dead";
            continue;
        }

        if (isContainerSlotStoreMutation(methodName, containerKind, slot, args, base, stmt)) {
            state = "live";
        }
    }

    return state !== "dead";
}

function isContainerSlotClearInvalidation(
    methodName: string,
    containerKind: "array" | "map" | "weakmap" | "set" | "weakset" | "list" | "queue" | "stack" | "resultset" | undefined,
    slot: string,
): boolean {
    if (methodName !== "clear") return false;
    if (containerKind === "map" || containerKind === "weakmap") {
        return slot.startsWith("map:") || slot.startsWith("mapkey:") || slot.startsWith("weakmap:");
    }
    if (containerKind === "set") return slot.startsWith("set:");
    if (containerKind === "weakset") return slot.startsWith("weakset:");
    if (containerKind === "list") return slot.startsWith("list:");
    if (containerKind === "queue") return slot.startsWith("queue:");
    if (containerKind === "stack") return slot.startsWith("stack:");
    if (containerKind === "array") return slot.startsWith("arr:");
    return false;
}

function isContainerSlotDeleteInvalidation(
    methodName: string,
    containerKind: "array" | "map" | "weakmap" | "set" | "weakset" | "list" | "queue" | "stack" | "resultset" | undefined,
    slot: string,
    args: any[],
): boolean {
    if (containerKind === "map" || containerKind === "weakmap") {
        if (methodName !== "delete" && methodName !== "remove") return false;
        const key = args.length > 0 ? resolveValueKey(args[0]) : undefined;
        if (key === undefined) return false;
        if (containerKind === "weakmap") {
            return isContainerSlotMatch(slot, `weakmap:${key}`);
        }
        return isContainerSlotMatch(slot, `map:${key}`) || isContainerSlotMatch(slot, `mapkey:${key}`);
    }

    if (containerKind === "set" || containerKind === "weakset") {
        if (methodName !== "delete" && methodName !== "remove") return false;
        return containerKind === "set" ? slot.startsWith("set:") : slot.startsWith("weakset:");
    }

    return false;
}

function isContainerSlotStoreMutation(
    methodName: string,
    containerKind: "array" | "map" | "weakmap" | "set" | "weakset" | "list" | "queue" | "stack" | "resultset" | undefined,
    slot: string,
    args: any[],
    base: Local,
    stmt: any,
): boolean {
    if ((containerKind === "map" || containerKind === "weakmap") && isMapLikeStoreMethod(methodName)) {
        const key = args.length > 0 ? resolveValueKey(args[0]) : undefined;
        if (key === undefined) return false;
        if (containerKind === "weakmap") {
            return isContainerSlotMatch(slot, `weakmap:${key}`);
        }
        return isContainerSlotMatch(slot, `map:${key}`) || isContainerSlotMatch(slot, `mapkey:${key}`);
    }

    if ((methodName === "add" || methodName === "append" || methodName === "push" || methodName === "insertEnd") && args.length >= 1) {
        const ordinal = resolveAddOrdinal(base, stmt);
        if (ordinal < 0) return false;

        if (containerKind === "list") return isContainerSlotMatch(slot, `list:${ordinal}`);
        if (containerKind === "queue") return isContainerSlotMatch(slot, `queue:${ordinal}`);
        if (containerKind === "stack") return isContainerSlotMatch(slot, `stack:${ordinal}`);
        if (containerKind === "set") return isContainerSlotMatch(slot, `set:${ordinal}`);
        if (containerKind === "weakset") return isContainerSlotMatch(slot, `weakset:${ordinal}`);
        if (containerKind === "array") return isContainerSlotMatch(slot, `arr:${ordinal}`);
    }

    if (methodName === "splice" && containerKind === "array" && slot.startsWith("arr:") && args.length >= 3) {
        const startNum = resolveNumber(args[0]);
        if (startNum === undefined) return slot === "arr:*";
        const slotIndex = parseArraySlotIndex(slot);
        if (slotIndex === undefined) return false;
        return slotIndex >= startNum && slotIndex < startNum + (args.length - 2);
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
        const t = normalizeLiteral(v.toString());
        const n = Number(t);
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

function isResultSetProducerMethod(methodName: string): boolean {
    return methodName === "query"
        || methodName === "querySql"
        || methodName === "querySync"
        || methodName === "querySqlSync";
}

function doesResultSetQueryExposeSlot(
    invokeExpr: ArkInstanceInvokeExpr,
    slot: string,
): boolean {
    if (slot === "rs:*") return true;
    if (!slot.startsWith("rs:")) return true;

    const targetColumn = slot.slice("rs:".length);
    if (!targetColumn) return true;

    const args = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    if (args.length === 0) return true;
    const sqlText = resolveValueKey(args[0]);
    if (!sqlText) return true;

    const selectedColumns = parseSelectedResultSetColumns(sqlText);
    if (!selectedColumns) return true;
    if (selectedColumns.has("*")) return true;
    return selectedColumns.has(targetColumn);
}

function parseSelectedResultSetColumns(sqlText: string): Set<string> | undefined {
    const normalized = String(sqlText || "").trim();
    if (!normalized) return undefined;
    const match = normalized.match(/^select\s+(.+?)(?:\s+from\b|$)/i);
    if (!match) return undefined;

    const out = new Set<string>();
    for (const rawToken of match[1].split(",")) {
        const token = rawToken.trim();
        if (!token) continue;
        if (token === "*") {
            out.add("*");
            continue;
        }
        const aliasStripped = token.replace(/\s+as\s+.+$/i, "").trim();
        const tail = aliasStripped.split(".").pop()?.trim() || aliasStripped;
        const unquoted = tail.replace(/^[`'"]+/, "").replace(/[`'"]+$/, "");
        if (unquoted) out.add(unquoted);
    }
    return out.size > 0 ? out : undefined;
}

function isResultSetScalarLoadMethod(methodName: string): boolean {
    return methodName === "getString"
        || methodName === "getLong"
        || methodName === "getDouble"
        || methodName === "getBlob"
        || methodName === "getObject";
}

function resolveForEachCallbackParamIndexes(slot: string): number[] {
    if (slot.startsWith("arr:")) return [0];
    if (slot.startsWith("map:")) return [0];
    if (slot.startsWith("mapkey:")) return [1];
    if (slot.startsWith("set:")) return [0, 1];
    return [];
}

export default tsjsContainerModule;


