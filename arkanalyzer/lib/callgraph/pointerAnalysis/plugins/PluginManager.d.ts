import { CallGraph, CallGraphNode, FuncID } from '../../model/CallGraph';
import { ICallSite } from '../../model/CallSite';
import { Pag } from '../Pag';
import { PagBuilder } from '../PagBuilder';
import { IPagPlugin } from './IPagPlugin';
import { NodeID } from '../../../core/graph/GraphTraits';
import { ArkMethod } from '../../../core/model/ArkMethod';
import { Value } from '../../../core/base/Value';
import { Local } from '../../../core/base/Local';
import { Stmt } from '../../../core/base/Stmt';
export declare class PluginManager {
    private plugins;
    constructor(pag: Pag, pagBuilder: PagBuilder, cg: CallGraph);
    private init;
    registerPlugin(plugin: IPagPlugin): void;
    findPlugin(cs: ICallSite, cgNode: CallGraphNode): IPagPlugin | undefined;
    getAllPlugins(): IPagPlugin[];
    processCallSite(cs: ICallSite, cid: number, basePTNode: NodeID, cg: CallGraph): {
        handled: boolean;
        srcNodes: NodeID[];
    };
    processSDKFuncPag(funcID: FuncID, method: ArkMethod): {
        handled: boolean;
    };
    getSDKParamValue(method: ArkMethod): Value[] | undefined;
    getTaskObj2CGNodeMap(): Map<Local, CallGraphNode>;
    getTaskObj2ConstructorStmtMap(): Map<Local, Stmt>;
    getWorkerObj2CGNodeMap(): Map<Local, CallGraphNode>;
}
//# sourceMappingURL=PluginManager.d.ts.map