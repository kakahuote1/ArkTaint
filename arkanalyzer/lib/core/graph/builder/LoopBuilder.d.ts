import { BasicBlock } from '../BasicBlock';
import { BlockBuilder } from './CfgBuilder';
/**
 * Builder for loop in CFG
 */
export declare class LoopBuilder {
    rebuildBlocksInLoop(blockBuilderToCfgBlock: Map<BlockBuilder, BasicBlock>, blocksContainLoopCondition: Set<BlockBuilder>, basicBlockSet: Set<BasicBlock>, blockBuilders: BlockBuilder[]): void;
    private doesPrevBlockBuilderContainLoop;
    private insertBeforeConditionBlockBuilder;
    private getBlockFromMap;
    private collectBlocksBeforeAndReenter;
    private getCollectedBlocks;
    private createAndLinkBlocks;
    private updatePredecessors;
    private getNewPrevBlocks;
    private updateConditionBlockBuilder;
    private finalizeInsertion;
    private findIteratorIdx;
    private adjustIncrementorStmts;
}
//# sourceMappingURL=LoopBuilder.d.ts.map