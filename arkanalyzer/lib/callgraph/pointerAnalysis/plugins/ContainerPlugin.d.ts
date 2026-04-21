import { NodeID } from '../../../core/graph/GraphTraits';
import { CallGraph, CallGraphNode, ICallSite } from '../../model/CallGraph';
import { ContextID } from '../context/Context';
import { Pag } from '../Pag';
import { PagBuilder } from '../PagBuilder';
import { IPagPlugin } from './IPagPlugin';
/**
 * ContainerPlugin processes built-in container APIs like Array, Set, and Map.
 */
export declare class ContainerPlugin implements IPagPlugin {
    pag: Pag;
    pagBuilder: PagBuilder;
    cg: CallGraph;
    constructor(pag: Pag, pagBuilder: PagBuilder, cg: CallGraph);
    getName(): string;
    canHandle(cs: ICallSite, cgNode: CallGraphNode): boolean;
    processCallSite(cs: ICallSite, cid: ContextID, basePTNode: NodeID): NodeID[];
    private processArrayPush;
    private processSetAdd;
    private processMapSet;
    private processMapGet;
    private processForeach;
}
//# sourceMappingURL=ContainerPlugin.d.ts.map