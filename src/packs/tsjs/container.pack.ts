import { ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
import { PagInstanceFieldNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import {
    defineSemanticPack,
    fromContainerFieldKey,
    SemanticPack,
    SemanticPackEmission,
    SemanticPackFactEvent,
    toContainerFieldKey,
} from "../../core/kernel/contracts/SemanticPack";
import { emitLoadLikeFactsByIds, emitNodeFactsByIds, emitObjectFieldFactsByIds } from "../../core/kernel/contracts/PackEmissionUtils";

function collectResultContainerEmissions(
    event: SemanticPackFactEvent,
    reason: string,
    resultNodeIds: number[],
    resultSlotStores: Array<{ objId: number; slot: string }>,
): SemanticPackEmission[] {
    const emissions: SemanticPackEmission[] = [];
    emissions.push(
        ...emitLoadLikeFactsByIds(
            event.pag,
            resultNodeIds,
            event.fact.source,
            event.fact.contextID,
            reason,
            event.fact.field,
        ),
    );
    for (const store of resultSlotStores) {
        emissions.push(
            ...emitObjectFieldFactsByIds(
                event.pag,
                [store.objId],
                event.fact.source,
                event.fact.contextID,
                reason,
                [toContainerFieldKey(store.slot), ...(event.fact.field || [])],
            ),
        );
    }
    return emissions;
}

export const tsjsContainerPack: SemanticPack = defineSemanticPack({
    id: "tsjs.container",
    description: "Built-in TS/JS container and collection semantics.",
    setup() {
        const {
            collectArrayConstructorEffectsFromTaintedLocal,
            collectArrayFromMapperCallbackParamNodeIdsForObj,
            collectArrayFromMapperCallbackParamNodeIdsFromTaintedLocal,
            collectArrayHigherOrderEffectsFromTaintedLocal,
            collectArrayStaticViewEffectsBySlot,
            collectContainerMutationBaseNodeIdsFromTaintedLocal,
            collectContainerSlotLoadNodeIds,
            collectContainerSlotStoresFromTaintedLocal,
            collectContainerViewEffectsBySlot,
            collectObjectFromEntriesEffectsFromTaintedLocal,
            collectPreciseArrayLoadNodeIdsFromTaintedLocal,
            collectPromiseAggregateEffectsFromTaintedLocal,
            collectStringSplitEffectsFromTaintedLocal,
        } = require("./ContainerModel") as typeof import("./ContainerModel");
        const arraySlotObjsByCtx = new Map<number, Set<number>>();

        const markArraySlotObj = (contextId: number, objId: number): void => {
            if (!arraySlotObjsByCtx.has(contextId)) {
                arraySlotObjsByCtx.set(contextId, new Set<number>());
            }
            arraySlotObjsByCtx.get(contextId)!.add(objId);
        };

        return {
            onFact(event) {
                const emissions: SemanticPackEmission[] = [];
                const push = (items?: SemanticPackEmission[] | void): void => {
                    if (!items || items.length === 0) return;
                    emissions.push(...items);
                };

                if (!event.fact.field || event.fact.field.length === 0) {
                    const value = event.node.getValue?.();
                    if (value instanceof Local) {
                        push(emitNodeFactsByIds(
                            event.pag,
                            collectPreciseArrayLoadNodeIdsFromTaintedLocal(value, event.pag),
                            event.fact.source,
                            event.fact.contextID,
                            "Array-Precise",
                        ));

                        for (const info of collectContainerSlotStoresFromTaintedLocal(value, event.pag)) {
                            push(emitObjectFieldFactsByIds(
                                event.pag,
                                [info.objId],
                                event.fact.source,
                                event.fact.contextID,
                                "Container-Store",
                                [toContainerFieldKey(info.slot)],
                            ));
                            if (info.slot.startsWith("arr:")) {
                                markArraySlotObj(event.fact.contextID, info.objId);
                            }
                        }

                        push(emitNodeFactsByIds(
                            event.pag,
                            collectContainerMutationBaseNodeIdsFromTaintedLocal(value, event.pag),
                            event.fact.source,
                            event.fact.contextID,
                            "Container-Mutation-Base",
                        ));

                        const arrayHof = collectArrayHigherOrderEffectsFromTaintedLocal(value, event.pag, event.scene);
                        push(emitNodeFactsByIds(
                            event.pag,
                            arrayHof.callbackParamNodeIds,
                            event.fact.source,
                            event.fact.contextID,
                            "Array-HOF-CB",
                        ));
                        push(collectResultContainerEmissions(event, "Array-HOF-Result", arrayHof.resultNodeIds, arrayHof.resultSlotStores));

                        const objectFromEntries = collectObjectFromEntriesEffectsFromTaintedLocal(value, event.pag);
                        push(emitLoadLikeFactsByIds(
                            event.pag,
                            objectFromEntries.resultLoadNodeIds,
                            event.fact.source,
                            event.fact.contextID,
                            "Object-FromEntries-Load",
                            event.fact.field,
                        ));
                        for (const store of objectFromEntries.resultFieldStores) {
                            push(emitObjectFieldFactsByIds(
                                event.pag,
                                [store.objId],
                                event.fact.source,
                                event.fact.contextID,
                                "Object-FromEntries-Store",
                                [store.field, ...(event.fact.field || [])],
                            ));
                        }

                        const promiseAggregate = collectPromiseAggregateEffectsFromTaintedLocal(value, event.pag);
                        push(collectResultContainerEmissions(event, "Promise-Aggregate", promiseAggregate.resultNodeIds, promiseAggregate.resultSlotStores));

                        const arrayCtor = collectArrayConstructorEffectsFromTaintedLocal(value, event.pag);
                        push(collectResultContainerEmissions(event, "Array-Constructor", arrayCtor.resultNodeIds, arrayCtor.resultSlotStores));

                        const stringSplit = collectStringSplitEffectsFromTaintedLocal(value, event.pag);
                        push(collectResultContainerEmissions(event, "String-Split", stringSplit.resultNodeIds, stringSplit.resultSlotStores));

                        push(emitNodeFactsByIds(
                            event.pag,
                            collectArrayFromMapperCallbackParamNodeIdsFromTaintedLocal(value, event.pag, event.scene),
                            event.fact.source,
                            event.fact.contextID,
                            "Array-From-Mapper-CB",
                        ));
                    }
                }

                if (event.fact.field && event.fact.field.length > 0) {
                    const slot = fromContainerFieldKey(event.fact.field[0]);
                    if (slot !== null) {
                        const remaining = event.fact.field.length > 1 ? event.fact.field.slice(1) : undefined;
                        push(emitLoadLikeFactsByIds(
                            event.pag,
                            collectContainerSlotLoadNodeIds(event.node.getID(), slot, event.pag, event.scene),
                            event.fact.source,
                            event.fact.contextID,
                            "Container-Load",
                            remaining,
                        ));
                        const viewEffects = collectContainerViewEffectsBySlot(event.node.getID(), slot, event.pag);
                        push(collectResultContainerEmissions(event, "Container-View", viewEffects.resultNodeIds, viewEffects.resultSlotStores));
                        const staticViewEffects = collectArrayStaticViewEffectsBySlot(event.node.getID(), slot, event.pag);
                        push(collectResultContainerEmissions(event, "Array-StaticView", staticViewEffects.resultNodeIds, staticViewEffects.resultSlotStores));
                        push(emitLoadLikeFactsByIds(
                            event.pag,
                            collectArrayFromMapperCallbackParamNodeIdsForObj(event.node.getID(), event.pag, event.scene),
                            event.fact.source,
                            event.fact.contextID,
                            "Array-From-Mapper-CB",
                            remaining,
                        ));
                    }
                }

                return emissions.length > 0 ? emissions : undefined;
            },
            shouldSkipCopyEdge(event) {
                if (!(event.node instanceof PagInstanceFieldNode)) return false;
                const fieldRef = event.node.getValue();
                if (!(fieldRef instanceof ArkInstanceFieldRef)) return false;
                const fieldSigText = fieldRef.getFieldSignature().toString();
                if (!fieldSigText.includes("Array.field")) return false;
                const baseLocal = fieldRef.getBase();
                if (!(baseLocal instanceof Local)) return false;
                const baseNodes = event.pag.getNodesByValue(baseLocal);
                if (!baseNodes) return false;
                const slotObjs = arraySlotObjsByCtx.get(event.contextId);
                if (!slotObjs || slotObjs.size === 0) return false;
                for (const baseNodeId of baseNodes.values()) {
                    const baseNode = event.pag.getNode(baseNodeId) as any;
                    if (!baseNode) continue;
                    for (const objId of baseNode.getPointTo()) {
                        if (slotObjs.has(objId)) {
                            return true;
                        }
                    }
                }
                return false;
            },
        };
    },
});

export default tsjsContainerPack;
