export type AnyKey<T> = {
    new (): T;
};
export interface CtxArg {
    readonly name: string;
}
export type UniMap<T> = Map<AnyKey<T>, T>;
interface Upper {
    readonly upper: Upper;
    readonly unreachable: boolean;
}
/**
 * Represents the root implementation of the Upper interface.
 * Provides a singleton instance to ensure a single point of access.
 * The class is designed to maintain immutability for its properties.
 * The `getInstance` method allows retrieval of the singleton instance.
 */
export declare class UpperRoot implements Upper {
    readonly upper: any;
    readonly unreachable = true;
    private static INSTANCE;
    static getInstance(): UpperRoot;
}
/**
 * Represents a context that manages a map of arguments and provides methods to manipulate them.
 * Implements the Upper interface, allowing for hierarchical structures.
 * The context maintains a reference to its upper context and provides utilities to traverse the hierarchy.
 *
 * The `unreachable` property indicates whether this context is considered unreachable in the hierarchy.
 * The `upper` property refers to the parent or enclosing context.
 * The `args` property is a map that stores key-value pairs specific to this context.
 *
 * Provides methods to retrieve, add, and remove entries from the argument map.
 * Allows traversal to the root context in the hierarchy by following the chain of upper contexts.
 */
export declare class Context<U extends Upper, T> implements Upper {
    unreachable: boolean;
    upper: U;
    protected args: UniMap<T>;
    constructor(upper: U);
    get<K extends T>(k: AnyKey<K>): K | undefined;
    set<K extends T>(k: AnyKey<K>, v: K): void;
    remove<K extends T>(k: AnyKey<K>): K | undefined;
    root(): Upper;
}
export {};
//# sourceMappingURL=Context.d.ts.map