import { IPtsCollection, PtsCollectionType } from './PtsDS';
import { NodeID } from '../../core/graph/BaseExplicitGraph';
export declare enum PtaAnalysisScale {
    WholeProgram = 0,
    MethodLevel = 1
}
export declare enum ContextType {
    CallSite = 0,
    Obj = 1,
    Func = 2
}
export declare class PointerAnalysisConfig {
    private static instance;
    kLimit: number;
    contextType: ContextType;
    outputDirectory: string;
    detectTypeDiff: boolean;
    dotDump: boolean;
    debug: boolean;
    analysisScale: PtaAnalysisScale;
    ptsCollectionType: PtsCollectionType;
    ptsCollectionCtor: new () => IPtsCollection<NodeID>;
    constructor(kLimit: number, contextType: ContextType, outputDirectory: string, detectTypeDiff?: boolean, dotDump?: boolean, debug?: boolean, analysisScale?: PtaAnalysisScale, ptsCoType?: PtsCollectionType);
    static dispose(): void;
    static create(kLimit: number, outputDirectory: string, detectTypeDiff?: boolean, dotDump?: boolean, debug?: boolean, analysisScale?: PtaAnalysisScale, ptsCoType?: PtsCollectionType, contextType?: ContextType): PointerAnalysisConfig;
    static getInstance(): PointerAnalysisConfig;
}
//# sourceMappingURL=PointerAnalysisConfig.d.ts.map