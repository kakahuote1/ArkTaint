/**
 * A memory-efficient Map-like structure where keys are integers and values are lists of integers.
 * Uses a static linked list approach based on TypedArrays (SoA) to avoid JS object overhead.
 *
 * Memory per entry: 8 bytes (value + next pointer).
 * Memory per key: 4 bytes (head pointer).
 */
export declare class IntMap {
    private heads;
    private values;
    private nexts;
    private count;
    private capacity;
    private keyRange;
    /**
     * @param keyRange - The maximum value of keys (nodeCapacity).
     * @param initialCapacity - The initial total number of values across all keys.
     */
    constructor(keyRange: number, initialCapacity?: number);
    /**
     * Add a value to the list associated with the key.
     */
    add(key: number, value: number): void;
    /**
     * Check if the list for a key contains a value.
     */
    contains(key: number, value: number): boolean;
    /**
     * Add a value only if it doesn't already exist in the key's list.
     */
    addUnique(key: number, value: number): boolean;
    /**
     * Get an iterator for the values associated with a key.
     * Efficient for loops: for (const v of map.getValues(key)) { ... }
     */
    getValues(key: number): IterableIterator<number>;
    /**
     * Get all values as an array (less efficient due to allocation).
     */
    getAsArray(key: number): number[];
    /**
     * Check if a key has any values.
     */
    has(key: number): boolean;
    private resizeHeads;
    private resizeCapacity;
}
