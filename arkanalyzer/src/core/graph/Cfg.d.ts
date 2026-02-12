import { DefUseChain } from '../base/DefUseChain';
import { Local } from '../base/Local';
import { Stmt } from '../base/Stmt';
import { ArkError } from '../common/ArkError';
import { ArkMethod } from '../model/ArkMethod';
import { BasicBlock } from './BasicBlock';
import { GlobalRef } from '../base/Ref';
/**
 * @category core/graph
 */
export declare class Cfg {
    private blocks;
    private stmtToBlock;
    private startingStmt;
    private defUseChains;
    private declaringMethod;
    constructor();
    getStmtToBlock(): Map<Stmt, BasicBlock>;
    getStmts(): Stmt[];
    /**
     * Inserts toInsert in the basic block in CFG after point.
     * @param toInsert
     * @param point
     * @returns The number of successfully inserted statements
     */
    insertAfter(toInsert: Stmt | Stmt[], point: Stmt): number;
    /**
     * Inserts toInsert in the basic block in CFG befor point.
     * @param toInsert
     * @param point
     * @returns The number of successfully inserted statements
     */
    insertBefore(toInsert: Stmt | Stmt[], point: Stmt): number;
    /**
     * Removes the given stmt from the basic block in CFG.
     * @param stmt
     * @returns
     */
    remove(stmt: Stmt): void;
    /**
     * Update stmtToBlock Map
     * @param block
     * @param changed
     */
    updateStmt2BlockMap(block: BasicBlock, changed?: Stmt | Stmt[]): void;
    addBlock(block: BasicBlock): void;
    setBlocks(blocks: Set<BasicBlock>, resetStmtToBlock?: boolean): void;
    /**
     * Get all basic blocks with topological order.
     * @returns The set of all basic blocks.
     */
    getBlocks(): Set<BasicBlock>;
    getStartingBlock(): BasicBlock | undefined;
    getStartingStmt(): Stmt;
    setStartingStmt(newStartingStmt: Stmt): void;
    getDeclaringMethod(): ArkMethod;
    setDeclaringMethod(method: ArkMethod): void;
    getDefUseChains(): DefUseChain[];
    toString(): string;
    buildDefUseStmt(locals: Set<Local>, globals?: Map<string, GlobalRef>): void;
    private buildUseStmt;
    private handleDefUseForValue;
    buildDefUseChain(): void;
    getUnreachableBlocks(): Set<BasicBlock>;
    validate(): ArkError;
    private dfsPostOrder;
}
