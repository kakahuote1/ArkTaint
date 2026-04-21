/**
 * A ContextItem represents a unique context in the program.
 */
export interface ContextItem {
    readonly id: number;
    getSignature(): string;
}
export declare class CallSiteContextItem implements ContextItem {
    readonly id: number;
    readonly callSiteId: number;
    readonly calleeFuncId: number;
    constructor(id: number, callSiteId: number, calleeFuncId: number);
    getSignature(): string;
}
export declare class ObjectContextItem implements ContextItem {
    readonly id: number;
    readonly nodeID: number;
    constructor(id: number, allocationSiteId: number);
    getSignature(): string;
}
export declare class FuncContextItem implements ContextItem {
    readonly id: number;
    readonly funcID: number;
    constructor(id: number, funcID: number);
    getSignature(): string;
}
/**
 * Manages the creation and unique identification of all ContextItems.
 * This ensures that each unique item (based on its signature) has one and only one ID.
 */
export declare class ContextItemManager {
    private itemToIdMap;
    private idToItemMap;
    private nextItemId;
    getOrCreateCallSiteItem(callSiteId: number, calleeFuncID: number): CallSiteContextItem;
    getOrCreateObjectItem(allocationSiteId: number): ObjectContextItem;
    getOrCreateFuncItem(calleeFuncID: number): FuncContextItem;
    getItem(id: number): ContextItem | undefined;
}
//# sourceMappingURL=ContextItem.d.ts.map