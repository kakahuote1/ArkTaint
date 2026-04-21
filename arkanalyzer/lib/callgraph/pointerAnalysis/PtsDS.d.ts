import { SparseBitVector } from '../../utils/SparseBitVector';
type Idx = number;
export interface IPtsCollection<T extends Idx> {
    contains(elem: T): boolean;
    insert(elem: T): boolean;
    remove(elem: T): boolean;
    clone(): this;
    union(other: this): boolean;
    subtract(other: this): boolean;
    clear(): void;
    count(): number;
    isEmpty(): boolean;
    superset(other: this): boolean;
    intersect(other: this): boolean;
    getProtoPtsSet(): any;
    [Symbol.iterator](): IterableIterator<T>;
}
export declare function createPtsCollectionCtor<T extends Idx>(type: PtsCollectionType): new () => IPtsCollection<T>;
export declare class PtsSet<T extends Idx> implements IPtsCollection<T> {
    pts: Set<T>;
    constructor();
    contains(elem: T): boolean;
    insert(elem: T): boolean;
    remove(elem: T): boolean;
    clone(): this;
    union(other: this): boolean;
    subtract(other: this): boolean;
    clear(): void;
    count(): number;
    isEmpty(): boolean;
    superset(other: this): boolean;
    intersect(other: this): boolean;
    getProtoPtsSet(): Set<T>;
    [Symbol.iterator](): IterableIterator<T>;
}
export declare class PtsBV<T extends Idx> implements IPtsCollection<T> {
    pts: SparseBitVector;
    constructor();
    contains(elem: T): boolean;
    insert(elem: T): boolean;
    remove(elem: T): boolean;
    clone(): this;
    union(other: this): boolean;
    subtract(other: this): boolean;
    clear(): void;
    count(): number;
    isEmpty(): boolean;
    superset(other: this): boolean;
    intersect(other: this): boolean;
    getProtoPtsSet(): SparseBitVector;
    [Symbol.iterator](): IterableIterator<T>;
}
export declare enum PtsCollectionType {
    Set = 0,
    BitVector = 1
}
export declare class DiffPTData<K, D extends Idx, DS extends IPtsCollection<D>> {
    private DSCreator;
    private diffPtsMap;
    private propaPtsMap;
    constructor(DSCreator: new () => DS);
    clear(): void;
    addPts(v: K, elem: D): boolean;
    resetElem(v: K): boolean;
    unionDiffPts(dstv: K, srcv: K): boolean;
    unionPts(dstv: K, srcv: K): boolean;
    unionPtsTo(dstv: K, srcDs: DS): boolean;
    removePtsElem(v: K, elem: D): boolean;
    getDiffPts(v: K): DS | undefined;
    getMutDiffPts(v: K): DS | undefined;
    getPropaPts(v: K): DS | undefined;
    getAllPropaPts(): Map<K, DS>;
    getPropaPtsMut(v: K): DS;
    flush(v: K): void;
    clearPts(v: K): void;
    clearDiffPts(v: K): void;
    clearPropaPts(v: K): void;
    calculateDiff(src: K, dst: K): DS;
}
export {};
//# sourceMappingURL=PtsDS.d.ts.map