import { BasicBlock } from '../BasicBlock';
import { BlockBuilder } from './CfgBuilder';
/**
 * Builder for condition in CFG
 */
export declare class ConditionBuilder {
    rebuildBlocksContainConditionalOperator(blockBuilderToCfgBlock: Map<BlockBuilder, BasicBlock>, basicBlockSet: Set<BasicBlock>, isArkUIBuilder: boolean): void;
    private updateBasicBlockInContainConditionalOperator;
    private generateBlocksInConditionalOperatorGroup;
    private generateBlocksInSingleConditionalOperator;
    private generateBlockOutConditionalOperator;
    private deleteDummyConditionalOperatorStmt;
    private findFirstConditionalOperator;
    private removeUnnecessaryBlocksInConditionalOperator;
    private replaceTempRecursively;
}
