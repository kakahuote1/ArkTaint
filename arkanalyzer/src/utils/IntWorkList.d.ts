/**
 * High-performance circular buffer worklist for integer IDs.
 * Uses Int32Array to avoid object allocation and GC overhead.
 */
export declare class IntWorkList {
    private buffer;
    private head;
    private tail;
    private count;
    private capacity;
    private mask;
    constructor(initialCapacity?: number);
    /**
     * Add a value to the end of the worklist.
     */
    push(value: number): void;
    /**
     * Remove and return the value from the front of the worklist.
     * Returns undefined if empty.
     */
    pop(): number | undefined;
    /**
     * Check if the worklist is empty.
     */
    isEmpty(): boolean;
    /**
     * Get the number of elements in the worklist.
     */
    size(): number;
    /**
     * Double the capacity of the buffer.
     */
    private resize;
}
