import { NodeID } from '../../../core/graph/GraphTraits';
import { CallGraphNode, CallGraph } from '../../model/CallGraph';
import { ICallSite, CallSite } from '../../model/CallSite';
import { ContextID } from '../context/Context';
import { Pag } from '../Pag';
import { PagBuilder } from '../PagBuilder';
import { IPagPlugin } from './IPagPlugin';
/**
 * FunctionPlugin processes Function.call, Function.apply, Function.bind.
 */
export declare class FunctionPlugin implements IPagPlugin {
    pag: Pag;
    pagBuilder: PagBuilder;
    cg: CallGraph;
    constructor(pag: Pag, pagBuilder: PagBuilder, cg: CallGraph);
    getName(): string;
    canHandle(cs: ICallSite, cgNode: CallGraphNode): boolean;
    processCallSite(cs: CallSite, cid: ContextID, basePTNode: NodeID): NodeID[];
    private handleFunctionCall;
    private handleFunctionApply;
    private handleFunctionBind;
    private transferArrayValues;
    private setFunctionThisPt;
    private addThisEdge;
}
//# sourceMappingURL=FunctionPlugin.d.ts.map