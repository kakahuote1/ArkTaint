import { BasicBlock } from '../graph/BasicBlock';
export declare class Trap {
    private readonly tryBlocks;
    private readonly catchBlocks;
    constructor(tryBlocks: BasicBlock[], catchBlocks: BasicBlock[]);
    getTryBlocks(): BasicBlock[];
    getCatchBlocks(): BasicBlock[];
}
//# sourceMappingURL=Trap.d.ts.map