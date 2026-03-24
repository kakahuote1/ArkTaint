import { Local } from '../../../core/base/Local';
import { Stmt } from '../../../core/base/Stmt';
import { NodeID } from '../../../core/graph/GraphTraits';
import { ArkMethod } from '../../../core/model/ArkMethod';
import { CallGraph, CallGraphNode, FuncID, ICallSite } from '../../model/CallGraph';
import { ContextID } from '../context/Context';
import { Pag } from '../Pag';
import { PagBuilder } from '../PagBuilder';
import { IPagPlugin } from './IPagPlugin';
export declare class TaskPoolPlugin implements IPagPlugin {
    pag: Pag;
    pagBuilder: PagBuilder;
    cg: CallGraph;
    private sdkMethodReturnValueMap;
    private methodParamValueMap;
    private fakeSdkMethodParamDeclaringStmt;
    private taskObj2CGNodeMap;
    private taskObj2ConstructorStmtMap;
    constructor(pag: Pag, pagBuilder: PagBuilder, cg: CallGraph);
    getName(): string;
    canHandle(cs: ICallSite, cgNode: CallGraphNode): boolean;
    processCallSite(cs: ICallSite, cid: ContextID, basePTNode: NodeID): NodeID[];
    private addTaskPoolMethodPagCallEdge;
    /**
     * will not create real funcPag, only create param values
     */
    buildSDKFuncPag(funcID: FuncID, sdkMethod: ArkMethod): void;
    private createDummyParamValue;
    private addSDKMethodReturnPagEdge;
    private addTaskPoolMethodParamPagEdge;
    addTaskObj2CGNodeMap(cs: ICallSite, index: number): void;
    getTaskObj2CGNodeMap(): Map<Local, CallGraphNode>;
    getTaskObj2ConstructorStmtMap(): Map<Local, Stmt>;
}
//# sourceMappingURL=TaskPoolPlugin.d.ts.map