import { BasicBlock } from './BasicBlock';
import { DominanceFinder } from './DominanceFinder';
export declare class DominanceTree {
    private blocks;
    private blockToIdx;
    private children;
    private parents;
    constructor(dominanceFinder: DominanceFinder);
    getAllNodesDFS(): BasicBlock[];
    getChildren(block: BasicBlock): BasicBlock[];
    getRoot(): BasicBlock;
}
//# sourceMappingURL=DominanceTree.d.ts.map