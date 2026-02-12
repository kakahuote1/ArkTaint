import { Stmt } from '../base/Stmt';
import { ArkError } from '../common/ArkError';
/**
 * @category core/graph
 * A `BasicBlock` is composed of:
 * - ID: a **number** that uniquely identify the basic block, initialized as -1.
 * - Statements: an **array** of statements in the basic block.
 * - Predecessors:  an **array** of basic blocks in front of the current basic block. More accurately, these basic
 *     blocks can reach the current block through edges.
 * - Successors: an **array** of basic blocks after the current basic block. More accurately, the current block can
 *     reach these basic blocks through edges.
 */
export declare class BasicBlock {
    private id;
    private stmts;
    private predecessorBlocks;
    private successorBlocks;
    private exceptionalSuccessorBlocks?;
    private exceptionalPredecessorBlocks?;
    constructor();
    getId(): number;
    setId(id: number): void;
    /**
     * Returns an array of the statements in a basic block.
     * @returns An array of statements in a basic block.
     */
    getStmts(): Stmt[];
    addStmt(stmt: Stmt): void;
    /**
     * Adds the given stmt at the beginning of the basic block.
     * @param stmt
     */
    addHead(stmt: Stmt | Stmt[]): void;
    /**
     * Adds the given stmt at the end of the basic block.
     * @param stmt
     */
    addTail(stmt: Stmt | Stmt[]): void;
    /**
     * Inserts toInsert in the basic block after point.
     * @param toInsert
     * @param point
     * @returns The number of successfully inserted statements
     */
    insertAfter(toInsert: Stmt | Stmt[], point: Stmt): number;
    /**
     * Inserts toInsert in the basic block befor point.
     * @param toInsert
     * @param point
     * @returns The number of successfully inserted statements
     */
    insertBefore(toInsert: Stmt | Stmt[], point: Stmt): number;
    /**
     * Removes the given stmt from this basic block.
     * @param stmt
     * @returns
     */
    remove(stmt: Stmt): void;
    /**
     * Removes the first stmt from this basic block.
     */
    removeHead(): void;
    /**
     * Removes the last stmt from this basic block.
     */
    removeTail(): void;
    getHead(): Stmt | null;
    getTail(): Stmt | null;
    /**
     * Returns successors of the current basic block, whose types are also basic blocks (i.e.{@link BasicBlock}).
     * @returns Successors of the current basic block.
     * @example
     * 1. get block successors.

    ```typescript
    const body = arkMethod.getBody();
    const blocks = [...body.getCfg().getBlocks()]
    for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
        ...
        for (const next of block.getSuccessors()) {
        ...
        }
    }
    ```
     */
    getSuccessors(): BasicBlock[];
    /**
     * Returns predecessors of the current basic block, whose types are also basic blocks.
     * @returns An array of basic blocks.
     */
    getPredecessors(): BasicBlock[];
    addPredecessorBlock(block: BasicBlock): void;
    setPredecessorBlock(idx: number, block: BasicBlock): boolean;
    setSuccessorBlock(idx: number, block: BasicBlock): boolean;
    addStmtToFirst(stmt: Stmt): void;
    addSuccessorBlock(block: BasicBlock): void;
    removePredecessorBlock(block: BasicBlock): boolean;
    removeSuccessorBlock(block: BasicBlock): boolean;
    toString(): string;
    validate(): ArkError;
    private insertPos;
    getExceptionalSuccessorBlocks(): BasicBlock[] | undefined;
    getExceptionalPredecessorBlocks(): BasicBlock[] | undefined;
    addExceptionalPredecessorBlock(block: BasicBlock): void;
    addExceptionalSuccessorBlock(block: BasicBlock): void;
}
