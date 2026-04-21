import { Stmt } from '../base/Stmt';
import { ArkMethod } from '../model/ArkMethod';
export declare abstract class DataflowProblem<D> {
    /**
     * Transfer the outFact of srcStmt to the inFact of tgtStmt
     *
     * Return true if keeping progagation (i.e., tgtStmt will be added to the WorkList for further analysis)
     */
    abstract getNormalFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<D>;
    abstract getCallFlowFunction(srcStmt: Stmt, method: ArkMethod): FlowFunction<D>;
    abstract getExitToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt, callStmt: Stmt): FlowFunction<D>;
    abstract getCallToReturnFlowFunction(srcStmt: Stmt, tgtStmt: Stmt): FlowFunction<D>;
    abstract createZeroValue(): D;
    abstract getEntryPoint(): Stmt;
    abstract getEntryMethod(): ArkMethod;
    abstract factEqual(d1: D, d2: D): boolean;
}
export interface FlowFunction<D> {
    getDataFacts(d: D): Set<D>;
}
//# sourceMappingURL=DataflowProblem.d.ts.map