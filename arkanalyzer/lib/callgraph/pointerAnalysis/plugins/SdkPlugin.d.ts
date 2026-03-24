import { Value } from '../../../core/base/Value';
import { NodeID } from '../../../core/graph/GraphTraits';
import { ArkMethod } from '../../../core/model/ArkMethod';
import { CallGraph, CallGraphNode, FuncID, ICallSite } from '../../model/CallGraph';
import { ContextID } from '../context/Context';
import { Pag } from '../Pag';
import { PagBuilder } from '../PagBuilder';
import { IPagPlugin } from './IPagPlugin';
/**
 * SdkPlugin processes OpenHarmony and built-in SDK APIs.
 * creates fake PAG nodes for SDK method return values and parameters.
 */
export declare class SdkPlugin implements IPagPlugin {
    pag: Pag;
    pagBuilder: PagBuilder;
    cg: CallGraph;
    private sdkMethodReturnValueMap;
    private sdkMethodReturnArrayMap;
    private methodParamValueMap;
    private fakeSdkMethodParamDeclaringStmt;
    constructor(pag: Pag, pagBuilder: PagBuilder, cg: CallGraph);
    getName(): string;
    canHandle(cs: ICallSite, cgNode: CallGraphNode): boolean;
    processCallSite(cs: ICallSite, cid: ContextID, basePTNode: NodeID): NodeID[];
    private addSDKMethodPagCallEdge;
    /**
     * will not create real funcPag, only create param values
     */
    buildSDKFuncPag(funcID: FuncID, sdkMethod: ArkMethod): void;
    private createDummyParamValue;
    private addSDKMethodReturnPagEdge;
    private addSDKMethodReturnArrayPagEdge;
    private addSDKMethodReturnUnionPagEdge;
    private addSDKMethodReturnGenericPagEdge;
    /**
     * process the anonymous method param, create a new CallSite for it and invoke it.
     */
    private addSDKMethodParamPagEdge;
    getParamValues(method: ArkMethod): Value[] | undefined;
}
//# sourceMappingURL=SdkPlugin.d.ts.map