import { BasicBlock } from './BasicBlock';
import { Cfg } from './Cfg';
export declare class DominanceFinder {
    private blocks;
    private blockToIdx;
    private idoms;
    private domFrontiers;
    constructor(cfg: Cfg);
    getDominanceFrontiers(block: BasicBlock): Set<BasicBlock>;
    getBlocks(): BasicBlock[];
    getBlockToIdx(): Map<BasicBlock, number>;
    getImmediateDominators(): number[];
    private getFirstDefinedBlockPredIdx;
    private intersect;
}
//# sourceMappingURL=DominanceFinder.d.ts.map