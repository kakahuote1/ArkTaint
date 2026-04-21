import { Scene } from '../../Scene';
import { AbstractInvokeExpr } from '../../core/base/Expr';
import { Stmt } from '../../core/base/Stmt';
import { ArkClass } from '../../core/model/ArkClass';
import { ArkMethod } from '../../core/model/ArkMethod';
import { MethodSignature } from '../../core/model/ArkSignature';
import { NodeID } from '../../core/graph/BaseExplicitGraph';
import { CallGraph, FuncID, CallSite } from '../model/CallGraph';
import { CallGraphBuilder } from '../model/builder/CallGraphBuilder';
import { IPtsCollection } from '../pointerAnalysis/PtsDS';
export declare abstract class AbstractAnalysis {
    protected scene: Scene;
    protected cg: CallGraph;
    protected cgBuilder: CallGraphBuilder;
    protected workList: FuncID[];
    protected processedMethod: IPtsCollection<FuncID>;
    constructor(s: Scene, cg: CallGraph);
    getScene(): Scene;
    getCallGraph(): CallGraph;
    protected abstract resolveCall(sourceMethod: NodeID, invokeStmt: Stmt): CallSite[];
    protected abstract preProcessMethod(funcID: FuncID): CallSite[];
    resolveInvokeExpr(invokeExpr: AbstractInvokeExpr): ArkMethod | undefined;
    getClassHierarchy(arkClass: ArkClass): ArkClass[];
    start(displayGeneratedMethod: boolean): void;
    projectStart(displayGeneratedMethod: boolean): void;
    private processCallSite;
    protected init(): void;
    protected processMethod(methodID: FuncID): CallSite[];
    protected getParamAnonymousMethod(invokeExpr: AbstractInvokeExpr): MethodSignature[];
    protected addCallGraphEdge(caller: FuncID, callee: ArkMethod | null, cs: CallSite, displayGeneratedMethod: boolean): void;
}
//# sourceMappingURL=AbstractAnalysis.d.ts.map