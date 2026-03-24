/**
 * SparseBitVector is a LLVM-interfaces-like data structure designed to efficiently
 * represent and manipulate large sets of integers where the majority of the elements
 * are unset (i.e., sparse). It is particularly useful in scenarios where memory efficiency
 * is critical, and the set of integers contains large gaps between set bits.
 *
 * The SparseBitVector is implemented as a collection of SparseBitVectorElement objects,
 * where each element represents a fixed-size chunk of the bit vector. This allows the
 * structure to only allocate memory for the portions of the bit vector that contain
 * set bits, significantly reducing memory usage for sparse data.
 *
 * Key Features:
 * - **Unordered**: We implement it as unordered rather than LLVM's for performance reason.
 * - **Sparse Storage**: Only stores the indices of set bits, making it memory-efficient
 *   for sparse datasets.
 * - **Efficient Operations**: Supports fast bitwise operations such as union and intersection
 * - **Iterable**: Provides an iterator to traverse all set bits in stored order.
 * - **Dynamic Resizing**: Automatically adjusts its internal structure as bits are set
 *   or reset.
 *
 * Perforceman VS Array
 * - **Random Store**         2.5:1
 * - **Continuous Store**       1:1
 * - **Random Test**            1:6
 * - **Continuous Test**        1:1
 * - **Random Iterator**        4:1
 * - **Continuous Iterator**    2:1
 *
 * The SparseBitVector is parameterized by `ElementSize`, which defines the size of each
 * chunk (element) in the bit vector and MUST be times of 32. This allows for customization
 * based on the expected sparsity and performance requirements.
 *
 */
export type Word = Uint16Array;
declare class SparseBitVectorElement {
    private ELEMENT_SIZE;
    private BITWORDS_NUM;
    private bits;
    constructor(elementSize?: number);
    word(idx: number): number;
    clone(): Word;
    get elementSize(): number;
    get bitWordNum(): number;
    isEmpty(): boolean;
    set(bitIdx: number): void;
    setWord(word: Word): void;
    reset(bitIdx: number): void;
    test(bitIdx: number): boolean;
    test_and_set(bitIdx: number): boolean;
    count(): number;
    findFirst(): number;
    findNext(bitIdx: number): number;
    equals(rhs: SparseBitVectorElement): boolean;
    unionWith(other: SparseBitVectorElement): boolean;
    intersectWith(other: SparseBitVectorElement): boolean;
    subtractWith(rhs: SparseBitVectorElement): boolean;
    countBitsV2(word: number): number;
    countBits(word: number): number;
    isZero(): boolean;
    private countTrailingZeros;
}
export declare class SparseBitVector {
    private ELEMENT_SIZE;
    private elements;
    constructor(elementsSize?: number);
    get elementSize(): number;
    get elems(): Map<number, SparseBitVectorElement>;
    set(bitIdx: number): void;
    test(bitIdx: number): boolean;
    testAndSet(bitIdx: number): boolean;
    reset(bitIdx: number): void;
    clear(): void;
    clone(): SparseBitVector;
    findFirst(): number;
    count(): number;
    isEmpty(): boolean;
    [Symbol.iterator](): IterableIterator<number>;
    /**
     * Check if this SparseBitVector is equal to another SparseBitVector.
     */
    equals(rhs: SparseBitVector): boolean;
    /**
     * Perform a union operation with another SparseBitVector.
     * Returns True if this vector was changed, false otherwise.
     */
    unionWith(rhs: SparseBitVector): boolean;
    /**
     * Perform an intersection operation with another SparseBitVector.
     * Returns True if this vector was changed, false otherwise.
     */
    intersectWith(rhs: SparseBitVector): boolean;
    /**
     * Subtract another SparseBitVector from this one.
     * This operation modifies the current SparseBitVector in place.
     * Return True if the current SparseBitVector was modified, false otherwise.
     */
    subtractWith(rhs: SparseBitVector): boolean;
    toString(): string;
}
export {};
//# sourceMappingURL=SparseBitVector.d.ts.map