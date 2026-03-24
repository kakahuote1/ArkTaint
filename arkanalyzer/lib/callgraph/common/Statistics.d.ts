import { CallGraphNodeKind } from '../model/CallGraph';
import { PointerAnalysis } from '../pointerAnalysis/PointerAnalysis';
declare abstract class StatTraits {
    TotalTime: number;
    startTime: number;
    endTime: number;
    getStat(): string;
    printStat(): void;
}
export declare class PTAStat extends StatTraits {
    pta: PointerAnalysis;
    numProcessedAddr: number;
    numProcessedCopy: number;
    numProcessedLoad: number;
    numProcessedWrite: number;
    numProcessedThis: number;
    numRealWrite: number;
    numRealLoad: number;
    numUnhandledFun: number;
    numTotalValuesInHandedFun: number;
    numTotalHandledValue: number;
    numInferedUnknownValue: number;
    numInferedDiffTypeValue: number;
    totalValuesInVisitedFunc: number;
    numNotInferedUnknownValue: number;
    numUnhandledFunc: number;
    iterTimes: number;
    startMemUsage: any;
    endMemUsage: any;
    rssUsed: number;
    heapUsed: number;
    constructor(pta: PointerAnalysis);
    startStat(): void;
    endStat(): void;
    getNow(): number;
    private getInferedStat;
    private getNotInferredUnknownStat;
    private getUnhandledFuncStat;
    getStat(): string;
    printStat(): void;
}
export declare class PAGStat extends StatTraits {
    numDynamicCall: number;
    numTotalFunction: number;
    numTotalNode: number;
    getStat(): string;
    printStat(): void;
}
export declare class CGStat extends StatTraits {
    numTotalNode: number;
    numReal: number;
    numVirtual: number;
    numIntrinsic: number;
    numConstructor: number;
    numBlank: number;
    startStat(): void;
    endStat(): void;
    addNodeStat(kind: CallGraphNodeKind): void;
    getStat(): string;
}
export {};
//# sourceMappingURL=Statistics.d.ts.map