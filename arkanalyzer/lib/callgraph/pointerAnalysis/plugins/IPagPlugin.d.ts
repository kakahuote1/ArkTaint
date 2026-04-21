import { NodeID } from '../../../core/graph/GraphTraits';
import { CallGraph, CallGraphNode } from '../../model/CallGraph';
import { ICallSite } from '../../model/CallSite';
import { ContextID } from '../context/Context';
import { Pag } from '../Pag';
import { PagBuilder } from '../PagBuilder';
export interface IPagPlugin {
    pag: Pag;
    pagBuilder: PagBuilder;
    cg: CallGraph;
    getName(): string;
    canHandle(cs: ICallSite, cgNode: CallGraphNode): boolean;
    processCallSite(cs: ICallSite, cid: ContextID, basePTNode: NodeID): NodeID[];
}
//# sourceMappingURL=IPagPlugin.d.ts.map