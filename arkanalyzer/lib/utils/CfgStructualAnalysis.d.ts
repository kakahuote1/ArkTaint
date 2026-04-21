import { Trap } from '../core/base/Trap';
import { BasicBlock } from '../core/graph/BasicBlock';
import { Cfg } from '../core/graph/Cfg';
export declare enum CodeBlockType {
    NORMAL = 0,
    IF = 1,
    ELSE = 2,
    BREAK = 3,
    CONTINUE = 4,
    DO = 5,
    DO_WHILE = 6,
    WHILE = 7,
    FOR = 8,
    COMPOUND_END = 9,
    TRY = 10,
    CATCH = 11,
    FINALLY = 12
}
export type TraversalCallback = (block: BasicBlock | undefined, type: CodeBlockType) => void;
export declare class AbstractFlowGraph {
    private nodes;
    private entry;
    private block2NodeMap;
    private structOf;
    private structTypes;
    private structBlocks;
    private loopMap;
    constructor(cfg: Cfg, traps?: Trap[]);
    getEntry(): AbstractNode;
    getForIncBlock(block: BasicBlock): BasicBlock;
    preOrder(node: AbstractNode, callback: TraversalCallback, visitor?: Set<AbstractNode>): void;
    private structuralAnalysis;
    private dfsPostOrder;
    private buildCyclicStructural;
    private handleRegion;
    private prepareBuildLoops;
    private buildDominator;
    private getBackEdges;
    private naturalLoop;
    private isSelfLoopNode;
    private isForLoopIncNode;
    private isValidInBlocks;
    private isIfRegion;
    private isIfExitRegion;
    private isIfElseRegion;
    private isBlockRegion;
    private isIfBreakRegion;
    private isIfContinueRegion;
    private isWhileRegion;
    private isForRegion;
    private isDoWhileRegion;
    private identifyRegionType;
    private cyclicRegionType;
    private hasExitLoopSucc;
    private isExitLoop;
    private createRegion;
    private reduce;
    private setIntersect;
    private isSetEqual;
    private buildTrap;
    private searchTrapFinallyNodes;
    private bfs;
    private getNaturalTrapRegion;
    private findNaturalTrapRegion;
    private trapsStructuralAnalysis;
    private trapsSubStructuralAnalysis;
}
declare enum RegionType {
    ABSTRACT_NODE = 0,
    TRY_NODE = 1,
    CATCH_NODE = 2,
    FINALLY_NODE = 3,
    BLOCK_REGION = 4,
    IF_REGION = 5,
    IF_ELSE_REGION = 6,
    IF_THEN_EXIT_REGION = 7,
    IF_THEN_BREAK_REGION = 8,
    IF_THEN_CONTINUE_REGION = 9,
    SELF_LOOP_REGION = 10,
    NATURAL_LOOP_REGION = 11,
    WHILE_LOOP_REGION = 12,
    DO_WHILE_LOOP_REGION = 13,
    FOR_LOOP_REGION = 14,
    CASE_REGION = 15,
    SWITCH_REGION = 16,
    TRY_CATCH_REGION = 17,
    TRY_FINALLY_REGION = 18,
    TRY_CATCH_FINALLY_REGION = 19
}
declare class AbstractNode {
    type: RegionType;
    private predNodes;
    private succNodes;
    private bb;
    constructor();
    traversal(callback: TraversalCallback, type: CodeBlockType): void;
    getType(): RegionType;
    getSucc(): AbstractNode[];
    addSucc(node: AbstractNode): void;
    replaceSucc(src: AbstractNode, dst: AbstractNode): void;
    removeSucc(src: AbstractNode): void;
    getPred(): AbstractNode[];
    addPred(block: AbstractNode): void;
    replacePred(src: AbstractNode, dst: AbstractNode): void;
    removePred(src: AbstractNode): void;
    setBlock(bb: BasicBlock): void;
    getBlock(): BasicBlock | undefined;
    hasIfStmt(): boolean;
    hasReturnStmt(): boolean;
}
export {};
//# sourceMappingURL=CfgStructualAnalysis.d.ts.map