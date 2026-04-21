import { BasicBlock } from '../BasicBlock';
import { ArkIRTransformer, ValueAndStmts } from '../../common/ArkIRTransformer';
import { BlockBuilder } from './CfgBuilder';
/**
 * Builder for switch statement in CFG
 */
export declare class SwitchBuilder {
    buildSwitch(blockBuilderToCfgBlock: Map<BlockBuilder, BasicBlock>, blockBuildersContainSwitch: BlockBuilder[], valueAndStmtsOfSwitchAndCasesAll: ValueAndStmts[][], arkIRTransformer: ArkIRTransformer, basicBlockSet: Set<BasicBlock>): void;
    private generateIfBlocksForCases;
    private linkIfBlockAndCaseBlock;
}
//# sourceMappingURL=SwitchBuilder.d.ts.map