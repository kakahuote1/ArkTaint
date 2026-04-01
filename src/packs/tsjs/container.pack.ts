import { Local } from "../../../arkanalyzer/out/src/core/base/Local";
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
            collectContainerMutationBaseNodeIdsFromTaintedLocal,
            collectContainerSlotLoadNodeIds,
            collectContainerSlotStoresFromTaintedLocal,
            collectContainerViewEffectsBySlot,
            collectObjectFromEntriesEffectsFromTaintedLocal,
            collectPromiseAggregateEffectsFromTaintedLocal,
        } = require("./ContainerModel") as typeof import("./ContainerModel");

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
                        for (const info of collectContainerSlotStoresFromTaintedLocal(value, event.pag)) {
                            if (info.slot.startsWith("arr:")) continue;
                            push(emitObjectFieldFactsByIds(
                                event.pag,
                                [info.objId],
                                event.fact.source,
                                event.fact.contextID,
                                "Container-Store",
                                [toContainerFieldKey(info.slot)],
                            ));
                        }

                        push(emitNodeFactsByIds(
                            event.pag,
                            collectContainerMutationBaseNodeIdsFromTaintedLocal(value, event.pag)
                                .filter(nodeId => !isNativeArrayBaseNode(event.pag, nodeId)),
                            event.fact.source,
                            event.fact.contextID,
                            "Container-Mutation-Base",
                        ));

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
                    }
                }

                if (event.fact.field && event.fact.field.length > 0) {
                    const slot = fromContainerFieldKey(event.fact.field[0]);
                    if (slot !== null && !slot.startsWith("arr:")) {
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
                    }
                }

                return emissions.length > 0 ? emissions : undefined;
            },
        };
    },
});

function isNativeArrayBaseNode(pag: any, nodeId: number): boolean {
    const node = pag.getNode(nodeId);
    const value = node?.getValue?.();
    const type = value?.getType?.();
    const typeText = type?.toString?.() || "";
    return typeText.endsWith("[]") || type?.constructor?.name === "ArrayType";
}

export default tsjsContainerPack;
