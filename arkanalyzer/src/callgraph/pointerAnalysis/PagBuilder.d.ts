import { CallGraph, CallSite, DynCallSite, FuncID, ICallSite } from '../model/CallGraph';
import { Scene } from '../../Scene';
import { Stmt } from '../../core/base/Stmt';
import { Value } from '../../core/base/Value';
import { ArkMethod } from '../../core/model/ArkMethod';
import { Local } from '../../core/base/Local';
import { NodeID } from '../../core/graph/BaseExplicitGraph';
import { FuncPag, InterFuncPag, IntraProceduralEdge, Pag, PagNode, PagNodeType } from './Pag';
import { IPtsCollection } from './PtsDS';
import { PointerAnalysisConfig } from './PointerAnalysisConfig';
import { ContextID } from './context/Context';
import { ContextSelector } from './context/ContextSelector';
export declare class CSFuncID {
    cid: ContextID;
    funcID: FuncID;
    constructor(cid: ContextID, fid: FuncID);
}
export declare class PagBuilder {
    private pag;
    private cg;
    private scale;
    private funcPags;
    private interFuncPags?;
    private handledFunc;
    private ctxSelector;
    private pluginManager;
    private scene;
    private worklist;
    private pagStat;
    private staticField2UniqInstanceMap;
    private instanceField2UniqInstanceMap;
    private sdkMethodReturnValueMap;
    private funcHandledThisRound;
    private updatedNodesThisRound;
    private singletonFuncMap;
    private globalThisValue;
    private globalThisPagNode?;
    private externalScopeVariableMap;
    private retriggerNodesList;
    private arrowFunctionObjectMap;
    constructor(p: Pag, cg: CallGraph, s: Scene, config: PointerAnalysisConfig);
    buildFuncPagAndAddToWorklist(cs: CSFuncID): CSFuncID;
    private addToFuncHandledListThisRound;
    buildForEntries(funcIDs: FuncID[]): void;
    handleReachable(): boolean;
    build(): void;
    buildFuncPag(funcID: FuncID): boolean;
    private buildInvokeExprInStmt;
    private processExternalScopeValue;
    /**
     * process Method level analysis only
     */
    private createDummyParamValue;
    private createDummyParamPagNodes;
    buildPagFromFuncPag(funcID: FuncID, cid: ContextID): void;
    addEdgesFromFuncPag(funcPag: FuncPag, cid: ContextID, funcID: FuncID): boolean;
    /**
     * handle closure field ref intra-procedural edge
     * @param edge the intra-procedural edge with ClosureFieldRef as src
     * @param cid
     */
    addClosureEdges(edge: IntraProceduralEdge, cid: ContextID): void;
    addCallsEdgesFromFuncPag(funcPag: FuncPag, cid: ContextID): boolean;
    addDynamicCallSite(funcPag: FuncPag, funcID: FuncID, cid: ContextID): void;
    addUnknownCallSite(funcPag: FuncPag, funcID: FuncID): void;
    addDynamicCallEdge(cs: ICallSite, baseClassPTNode: NodeID, cid: ContextID): NodeID[];
    /**
     * all possible callee methods of a dynamic call site
     * handle both PtrInvokeExpr and InstanceInvokeExpr
     */
    private getDynamicCallee;
    processNormalMethodPagCallEdge(staticCS: CallSite, cid: ContextID, baseClassPTNode: NodeID): NodeID[];
    handleUnkownDynamicCall(cs: DynCallSite, cid: ContextID): NodeID[];
    handleUnprocessedCallSites(processedCallSites: Set<DynCallSite>): NodeID[];
    addThisRefCallEdge(cid: ContextID, baseLocal: Local, callee: ArkMethod, calleeCid: ContextID, callerFunID: FuncID): NodeID;
    private recordThisRefNode;
    addStaticPagCallEdge(cs: CallSite, callerCid: ContextID, calleeCid?: ContextID, ptNode?: PagNode): NodeID[];
    /**
     * only process the param PAG edge for invoke stmt
     */
    addCallParamPagEdge(calleeMethod: ArkMethod, args: Value[], cs: ICallSite, callerCid: ContextID, calleeCid: ContextID, offset: number): NodeID[];
    /**
     * process the return value PAG edge for invoke stmt
     */
    addCallReturnPagEdge(calleeMethod: ArkMethod, callStmt: Stmt, callerCid: ContextID, calleeCid: ContextID): NodeID[];
    /**
     * for method level call graph, add return edge
     */
    addStaticPagCallReturnEdge(cs: CallSite, cid: ContextID, baseClassPTNode: NodeID): NodeID[];
    private addSDKMethodReturnPagEdge;
    getOrNewPagNode(cid: ContextID, v: PagNodeType, s?: Stmt): PagNode;
    getOrNewGlobalThisNode(cid: ContextID): PagNode;
    getRealInstanceRef(v: Value): Value;
    /**
     * check if a method is singleton function
     * rule: static method, assign heap obj to global var or static field, return the receiver
     */
    isSingletonFunction(funcID: FuncID): boolean;
    private isValueConnected;
    private funcPagDfs;
    getGlobalThisValue(): Local;
    private getEdgeKindForAssignStmt;
    /**\
     * ArkNewExpr, ArkNewArrayExpr, function ptr, globalThis
     */
    private stmtIsCreateAddressObj;
    private stmtIsCopyKind;
    private stmtIsWriteKind;
    private stmtIsReadKind;
    addToDynamicCallSite(funcPag: FuncPag, cs: DynCallSite): void;
    setPtForNode(node: NodeID, pts: IPtsCollection<NodeID> | undefined): void;
    getRealThisLocal(input: Local, funcId: FuncID): Local;
    doStat(): void;
    printStat(): void;
    getStat(): string;
    getUnhandledFuncs(): FuncID[];
    getHandledFuncs(): FuncID[];
    /**
     * build export edge in internal func pag
     * @param value: Value that need to check if it is from import/export
     * @param originValue: if Value if InstanceFieldRef, the base will be passed to `value` recursively,
     *                      fieldRef will be passed to `originValue`
     */
    private handleValueFromExternalScope;
    private addInterFuncEdge;
    private getSourceValueFromExternalScope;
    private getDefaultMethodSourceValue;
    private getExportSourceValue;
    private addExportVariableMap;
    getExportVariableMap(src: Local): Local[];
    addEdgesFromInterFuncPag(interFuncPag: InterFuncPag, cid: ContextID): boolean;
    getRetriggerNodes(): NodeID[];
    addUpdatedNode(nodeID: NodeID, diffPT: IPtsCollection<NodeID>): void;
    getUpdatedNodes(): Map<number, IPtsCollection<number>>;
    resetUpdatedNodes(): void;
    getContextSelector(): ContextSelector;
    /**
     * Record arrow function object node for later thisPt setup
     */
    private recordArrowFunctionObjectNode;
    /**
     * Set up 'this' binding for arrow functions
     * 1. Set the thisPt of arrow function object node (pointing to ThisRef node inside arrow function body)
     * 2. Establish This edge from arrow function's ThisRef to outer function's this
     */
    private setupArrowFunctionThis;
    /**
     * Find 'this' local node for the specified method in the specified context
     * @param method Target method
     * @param contextID Optional context ID. If not specified, returns the 'this' node in the first found context
     */
    private findThisNodeForMethod;
}
