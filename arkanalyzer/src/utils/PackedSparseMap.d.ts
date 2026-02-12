/**
 * PackedSparseMap - A memory-efficient sparse index with packed storage.
 *
 * Implements a two-level indexing structure:
 * - First level: Owner-based segmentation (sparse)
 * - Second level: Sorted key-value pairs within each owner (packed)
 *
 */
export declare class PackedSparseMap {
    private offsets;
    private lengths;
    private capacities;
    private keys;
    private values;
    private poolSize;
    private poolCapacity;
    constructor(initialOwnerCapacity: number, initialPoolCapacity: number);
    getOrInsert(owner: number, key: number, createValue: () => number): number;
    private binarySearch;
    private binarySearchInsertPosition;
    private ensureOwnerCapacity;
    private ensureOwnerListCapacity;
    private ensurePoolCapacity;
    private resizeOwners;
}
