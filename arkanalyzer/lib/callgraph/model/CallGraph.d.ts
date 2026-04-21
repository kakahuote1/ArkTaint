import { MethodSignature } from '../../core/model/ArkSignature';
import { Stmt } from '../../core/base/Stmt';
import { Scene } from '../../Scene';
import { ArkMethod } from '../../core/model/ArkMethod';
import { BaseEdge, BaseNode, BaseExplicitGraph, NodeID } from '../../core/graph/BaseExplicitGraph';
import { CallSite, CallSiteID, CallSiteManager, DynCallSite, ICallSite } from './CallSite';
export type Method = MethodSignature;
export type FuncID = number;
export { CallSite, DynCallSite, ICallSite };
export declare enum CallGraphNodeKind {
    real = 0,
    vitual = 1,
    intrinsic = 2,
    constructor = 3,
    blank = 4
}
export declare class CallGraphEdge extends BaseEdge {
    private directCalls;
    private specialCalls;
    private indirectCalls;
    constructor(src: CallGraphNode, dst: CallGraphNode);
    addDirectCallSite(stmt: Stmt): void;
    addSpecialCallSite(stmt: Stmt): void;
    addInDirectCallSite(stmt: Stmt): void;
    getDotAttr(): string;
}
export declare class CallGraphNode extends BaseNode {
    private method;
    private ifSdkMethod;
    constructor(id: number, m: Method, k?: CallGraphNodeKind);
    getMethod(): Method;
    setSdkMethod(v: boolean): void;
    isSdkMethod(): boolean;
    get isBlankMethod(): boolean;
    getDotAttr(): string;
    getDotLabel(): string;
}
export declare class CallGraph extends BaseExplicitGraph {
    private scene;
    private csManager;
    private stmtToCallSitemap;
    private stmtToDynCallSitemap;
    private methodToCGNodeMap;
    private callPairToEdgeMap;
    private methodToCallSiteMap;
    private entries;
    private cgStat;
    private dummyMainMethodID;
    constructor(s: Scene);
    private getCallPairString;
    getCallEdgeByPair(srcID: NodeID, dstID: NodeID): CallGraphEdge | undefined;
    addCallGraphNode(method: Method, kind?: CallGraphNodeKind): CallGraphNode;
    removeCallGraphNode(nodeID: NodeID): void;
    getCallGraphNodeByMethod(method: Method): CallGraphNode;
    addDirectOrSpecialCallEdge(caller: Method, callee: Method, callStmt: Stmt, isDirectCall?: boolean): void;
    removeCallGraphEdge(nodeID: NodeID): void;
    addDynamicCallInfo(callStmt: Stmt, caller: Method, protentialCallee?: Method): void;
    addDynamicCallEdge(callerID: NodeID, calleeID: NodeID, callStmt: Stmt): void;
    getDynCallSiteByStmt(stmt: Stmt): DynCallSite | undefined;
    addStmtToCallSiteMap(stmt: Stmt, cs: CallSite): boolean;
    getCallSiteByStmt(stmt: Stmt): CallSite[];
    addMethodToCallSiteMap(funcID: FuncID, cs: CallSite): void;
    getCallSitesByMethod(func: FuncID | MethodSignature): Set<CallSite>;
    getInvokeStmtByMethod(func: FuncID | MethodSignature): Stmt[];
    getDynEdges(): Map<Method, Set<Method>>;
    getMethodByFuncID(id: FuncID): Method | null;
    getArkMethodByFuncID(id: FuncID): ArkMethod | null;
    getEntries(): FuncID[];
    setEntries(n: NodeID[]): void;
    dump(name: string, entry?: FuncID): void;
    detectReachable(fromID: FuncID, dstID: FuncID): boolean;
    startStat(): void;
    endStat(): void;
    printStat(): void;
    getStat(): string;
    setDummyMainFuncID(dummyMainMethodID: number): void;
    getDummyMainFuncID(): FuncID | undefined;
    isUnknownMethod(funcID: FuncID): boolean;
    getGraphName(): string;
    getCallSiteManager(): CallSiteManager;
    getCallSiteInfo(csID: CallSiteID): string;
}
//# sourceMappingURL=CallGraph.d.ts.map