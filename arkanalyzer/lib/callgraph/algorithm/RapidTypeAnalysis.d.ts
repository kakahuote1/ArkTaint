import { Scene } from '../../Scene';
import { Stmt } from '../../core/base/Stmt';
import { ClassSignature } from '../../core/model/ArkSignature';
import { NodeID } from '../../core/graph/BaseExplicitGraph';
import { CallGraph, CallSite, FuncID } from '../model/CallGraph';
import { AbstractAnalysis } from './AbstractAnalysis';
export declare class RapidTypeAnalysis extends AbstractAnalysis {
    private instancedClasses;
    private ignoredCalls;
    constructor(scene: Scene, cg: CallGraph);
    resolveCall(callerMethod: NodeID, invokeStmt: Stmt): CallSite[];
    protected preProcessMethod(funcID: FuncID): CallSite[];
    private collectInstancedClassesInMethod;
    addIgnoredCalls(arkClass: ClassSignature, callerID: FuncID, calleeID: FuncID, invokeStmt: Stmt): void;
}
//# sourceMappingURL=RapidTypeAnalysis.d.ts.map