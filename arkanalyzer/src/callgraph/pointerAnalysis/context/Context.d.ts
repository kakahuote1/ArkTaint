import { CallGraph } from '../../model/CallGraph';
import { ContextItemManager } from './ContextItem';
export type ContextID = number;
export declare const DUMMY_CID = 0;
export declare const CONTAINER_ELEMENT_CID = -2;
/**
 * An abstract base class representing a context in pointer analysis.
 * A context is an immutable sequence of context elements (represented by their IDs).
 */
export declare abstract class Context {
    protected contextElems: number[];
    constructor(contextElems?: number[]);
    /**
     * Creates a new empty context instance.
     * This static method must be called on a concrete subclass.
     * @example CallSiteContext.newEmpty()
     */
    static newEmpty<T extends Context>(this: new () => T): T;
    /**
     * Creates a new context instance from an array of element IDs.
     * This static method must be called on a concrete subclass.
     * @param contextElems An array of ContextItem IDs.
     * @example CallSiteContext.new([1, 2])
     */
    static new<T extends Context>(this: new (elems: number[]) => T, contextElems: number[]): T;
    /**
     * Creates a new k-limited context by prepending a new element to an old context.
     * The returned instance has the same type as the `oldCtx`.
     * @param oldCtx The previous context instance.
     * @param elem The ID of the new element to add.
     * @param k The maximum length limit for the context.
     */
    static newKLimitedContext<T extends Context>(oldCtx: T, elem: number, k: number): T;
    /**
     * Truncates an existing context to a specified k-limit.
     * The returned instance has the same type as `ctx`.
     * @param ctx The context instance to truncate.
     * @param k The maximum length limit for the context.
     */
    static kLimitedContext<T extends Context>(ctx: T, k: number): T;
    length(): number;
    get(index: number): number;
    toString(): string;
    abstract append(callSiteID: number, elementID: number, k: number, m: ContextItemManager): Context;
    abstract dump(m: ContextItemManager, cg: CallGraph): string;
}
export declare class CallSiteContext extends Context {
    append(callSiteID: number, calleeFunc: number, k: number, m: ContextItemManager): CallSiteContext;
    dump(m: ContextItemManager, cg: CallGraph): string;
}
export declare class ObjContext extends Context {
    append(callSiteID: number, objId: number, k: number, m: ContextItemManager): ObjContext;
    dump(m: ContextItemManager, cg: CallGraph): string;
}
export declare class FuncContext extends Context {
    append(callSiteID: number, funcId: number, k: number, m: ContextItemManager): FuncContext;
    dump(m: ContextItemManager, cg: CallGraph): string;
}
export declare class ContextCache {
    private contextList;
    private contextToIDMap;
    constructor();
    getOrNewContextID(context: Context): ContextID;
    updateContext(id: ContextID, newContext: Context, oldContext: Context): boolean;
    getContextID(context: Context): ContextID | undefined;
    getContext(id: number): Context | undefined;
    getContextList(): Context[];
    dump(m: ContextItemManager, cg: CallGraph): string;
}
