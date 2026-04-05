export interface ContainerModuleProvider {
    readonly providerId: "tsjs.container";
    collectArrayHigherOrderEffectsFromTaintedLocal(...args: any[]): any;
    collectArrayConstructorEffectsFromTaintedLocal(...args: any[]): any;
    collectArrayFromMapperCallbackParamNodeIdsForObj(...args: any[]): any;
    collectArrayFromMapperCallbackParamNodeIdsFromTaintedLocal(...args: any[]): any;
    collectArrayStaticViewEffectsBySlot(...args: any[]): any;
    collectArrayStaticViewEffectsBySlotFromLocal(...args: any[]): any;
    collectContainerMutationBaseNodeIdsFromTaintedLocal(...args: any[]): any;
    collectPreciseArrayLoadNodeIdsFromTaintedLocal(...args: any[]): any;
    collectContainerSlotLoadNodeIds(...args: any[]): any;
    collectContainerSlotLoadNodeIdsFromLocal(...args: any[]): any;
    collectContainerViewEffectsBySlot(...args: any[]): any;
    collectContainerViewEffectsBySlotFromLocal(...args: any[]): any;
    collectContainerSlotStoresFromTaintedLocal(...args: any[]): any;
    collectObjectFromEntriesEffectsFromTaintedLocal(...args: any[]): any;
    collectPromiseAggregateEffectsFromTaintedLocal(...args: any[]): any;
    collectStringSplitEffectsFromTaintedLocal(...args: any[]): any;
}

export function createEmptyContainerModuleProvider(): ContainerModuleProvider {
    const emptyResultContainer = () => ({
        resultNodeIds: [],
        resultSlotStores: [],
    });
    return {
        providerId: "tsjs.container",
        collectArrayHigherOrderEffectsFromTaintedLocal: () => ({
            callbackParamNodeIds: [],
            resultNodeIds: [],
            resultSlotStores: [],
        }),
        collectArrayConstructorEffectsFromTaintedLocal: emptyResultContainer,
        collectArrayFromMapperCallbackParamNodeIdsForObj: () => [],
        collectArrayFromMapperCallbackParamNodeIdsFromTaintedLocal: () => [],
        collectArrayStaticViewEffectsBySlot: emptyResultContainer,
        collectArrayStaticViewEffectsBySlotFromLocal: emptyResultContainer,
        collectContainerMutationBaseNodeIdsFromTaintedLocal: () => [],
        collectPreciseArrayLoadNodeIdsFromTaintedLocal: () => [],
        collectContainerSlotLoadNodeIds: () => [],
        collectContainerSlotLoadNodeIdsFromLocal: () => [],
        collectContainerViewEffectsBySlot: emptyResultContainer,
        collectContainerViewEffectsBySlotFromLocal: emptyResultContainer,
        collectContainerSlotStoresFromTaintedLocal: () => [],
        collectObjectFromEntriesEffectsFromTaintedLocal: () => ({
            resultLoadNodeIds: [],
            resultFieldStores: [],
        }),
        collectPromiseAggregateEffectsFromTaintedLocal: emptyResultContainer,
        collectStringSplitEffectsFromTaintedLocal: emptyResultContainer,
    };
}
