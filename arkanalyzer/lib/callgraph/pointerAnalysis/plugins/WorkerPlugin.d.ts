import { ArkFile } from '../../..';
import { StringConstant } from '../../../core/base/Constant';
import { Local } from '../../../core/base/Local';
import { Stmt } from '../../../core/base/Stmt';
import { NodeID } from '../../../core/graph/GraphTraits';
import { CallGraph, CallGraphNode, ICallSite } from '../../model/CallGraph';
import { ContextID } from '../context/Context';
import { Pag } from '../Pag';
import { PagBuilder } from '../PagBuilder';
import { IPagPlugin } from './IPagPlugin';
export declare class WorkerPlugin implements IPagPlugin {
    pag: Pag;
    pagBuilder: PagBuilder;
    cg: CallGraph;
    private workerObj2CGNodeMap;
    constructor(pag: Pag, pagBuilder: PagBuilder, cg: CallGraph);
    getName(): string;
    canHandle(cs: ICallSite, cgNode: CallGraphNode): boolean;
    processCallSite(cs: ICallSite, cid: ContextID, basePTNode: NodeID): NodeID[];
    private addWorkerPagCallEdge;
    private addPostMessagePagCallEdge;
    private ProcessPostMessagePagCallEdge;
    addWorkerObj2CGNodeMap(cs: ICallSite): void;
    getWorkerObj2CGNodeMap(): Map<Local, CallGraphNode>;
    getFileByPath(callstmt: Stmt, filePath: StringConstant): ArkFile | null;
}
//# sourceMappingURL=WorkerPlugin.d.ts.map