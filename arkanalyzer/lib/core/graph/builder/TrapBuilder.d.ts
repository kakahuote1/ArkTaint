import { BasicBlock } from '../BasicBlock';
import { ArkIRTransformer } from '../../common/ArkIRTransformer';
import { Trap } from '../../base/Trap';
import { BlockBuilder } from './CfgBuilder';
/**
 * Builder for traps from try...catch
 */
export declare class TrapBuilder {
    private processedBlockBuildersBeforeTry;
    private arkIRTransformer;
    private basicBlockSet;
    private blockBuilderToCfgBlock;
    private blockBuildersBeforeTry;
    constructor(blockBuildersBeforeTry: Set<BlockBuilder>, blockBuilderToCfgBlock: Map<BlockBuilder, BasicBlock>, arkIRTransformer: ArkIRTransformer, basicBlockSet: Set<BasicBlock>);
    buildTraps(): Trap[];
    private buildTrapGroup;
    private shouldSkipProcessing;
    private getTryStatementBuilder;
    private getFinallyBlock;
    private prepareHeadBlock;
    private processTryBlock;
    private processCatchBlock;
    private getAfterFinallyBlock;
    private buildSingleTraps;
    private buildTrapsRecursively;
    private removeEmptyBlockBeforeTry;
    private shouldRemoveEmptyBlockBeforeTry;
    private buildTrapsIfNoFinally;
    private buildTrapsIfFinallyExist;
    private getAllBlocksBFS;
    private copyFinallyBlocks;
    private copyBlocks;
    private copyStmt;
}
//# sourceMappingURL=TrapBuilder.d.ts.map