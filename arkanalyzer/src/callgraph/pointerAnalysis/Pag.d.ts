import { NodeID, BaseEdge, BaseExplicitGraph, BaseNode, Kind } from '../../core/graph/BaseExplicitGraph';
import { CallGraph, CallSite, DynCallSite } from '../model/CallGraph';
import { Value } from '../../core/base/Value';
import { ArkAssignStmt, Stmt } from '../../core/base/Stmt';
import { AbstractExpr } from '../../core/base/Expr';
import { AbstractFieldRef, ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ArkStaticFieldRef, ArkThisRef } from '../../core/base/Ref';
import { Local } from '../../core/base/Local';
import { Constant } from '../../core/base/Constant';
import { MethodSignature } from '../../core/model/ArkSignature';
import { ExportInfo } from '../../core/model/ArkExport';
import { BuiltApiType } from './PTAUtils';
import { IPtsCollection } from './PtsDS';
import { ContextID } from './context/Context';
import { StorageType } from './plugins/StoragePlugin';
export type PagNodeType = Value;
export declare enum PagEdgeKind {
    Address = 0,
    Copy = 1,
    Load = 2,
    Write = 3,
    This = 4,
    Unknown = 5,
    InterProceduralCopy = 6
}
export declare class PagEdge extends BaseEdge {
    private stmt;
    constructor(n: PagNode, d: PagNode, k: PagEdgeKind, s?: Stmt);
    getDotAttr(): string;
}
export declare class AddrPagEdge extends PagEdge {
    constructor(n: PagNode, d: PagNode, s: Stmt);
}
export declare class CopyPagEdge extends PagEdge {
    constructor(n: PagNode, d: PagNode, s: Stmt);
}
export declare class LoadPagEdge extends PagEdge {
    constructor(n: PagNode, d: PagNode, s: Stmt);
}
export declare class WritePagEdge extends PagEdge {
    constructor(n: PagNode, d: PagNode, s: Stmt);
}
export declare class ThisPagEdge extends PagEdge {
    constructor(n: PagNode, d: PagNode, s: Stmt);
}
type PagEdgeSet = Set<PagEdge>;
export declare enum PagNodeKind {
    HeapObj = 0,
    LocalVar = 1,
    RefVar = 2,
    Param = 3,
    ThisRef = 4,
    Function = 5,
    GlobalThis = 6,
    ExportInfo = 7
}
export declare class PagNode extends BaseNode {
    private cid;
    private value;
    private stmt;
    private pointTo;
    private addressInEdges;
    private addressOutEdges;
    private copyInEdges;
    private copyOutEdges;
    private loadInEdges;
    private loadOutEdges;
    private writeInEdges;
    private writeOutEdges;
    private thisInEdges;
    private thisOutEdges;
    protected basePt: NodeID;
    protected clonedFrom: NodeID;
    constructor(id: NodeID, cid: ContextID | undefined, value: Value, k: Kind, s?: Stmt);
    getBasePt(): NodeID;
    setBasePt(pt: NodeID): void;
    getCid(): ContextID;
    setCid(cid: ContextID): void;
    setStmt(s: Stmt): void;
    getStmt(): Stmt | undefined;
    hasOutgoingCopyEdge(): boolean;
    getOutgoingCopyEdges(): PagEdgeSet;
    getIncomingCopyEdges(): PagEdgeSet;
    getOutgoingLoadEdges(): PagEdgeSet;
    getOutgoingWriteEdges(): PagEdgeSet;
    getIncomingWriteEdges(): PagEdgeSet;
    getOutgoingThisEdges(): PagEdgeSet;
    getIncomingThisEdges(): PagEdgeSet;
    addAddressInEdge(e: AddrPagEdge): void;
    addAddressOutEdge(e: AddrPagEdge): void;
    addCopyInEdge(e: CopyPagEdge): void;
    addCopyOutEdge(e: CopyPagEdge): void;
    addLoadInEdge(e: LoadPagEdge): void;
    addLoadOutEdge(e: LoadPagEdge): void;
    addWriteInEdge(e: WritePagEdge): void;
    addWriteOutEdge(e: LoadPagEdge): void;
    addThisInEdge(e: ThisPagEdge): void;
    addThisOutEdge(e: ThisPagEdge): void;
    getValue(): Value;
    getPointTo(): IPtsCollection<NodeID>;
    addPointToElement(node: NodeID): void;
    setPointTo(pts: IPtsCollection<NodeID>): void;
    getOutEdges(): {
        AddressEdge: PagEdgeSet;
        CopyEdge: PagEdgeSet;
        LoadEdge: PagEdgeSet;
        WriteEdge: PagEdgeSet;
    };
    getClonedFrom(): NodeID;
    setClonedFrom(id: NodeID): void;
    getDotAttr(): string;
    getDotLabel(): string;
    getFunctionNameFromThisRefNode(): string | undefined;
}
export declare class PagLocalNode extends PagNode {
    private relatedDynamicCallSite?;
    private relatedUnknownCallSite?;
    private storageLinked;
    private storageType?;
    private propertyName?;
    private sdkParam;
    constructor(id: NodeID, cid: ContextID | undefined, value: Local, stmt?: Stmt);
    addRelatedDynCallSite(cs: DynCallSite): void;
    getRelatedDynCallSites(): Set<DynCallSite>;
    addRelatedUnknownCallSite(cs: CallSite): void;
    getRelatedUnknownCallSites(): Set<CallSite>;
    setStorageLink(storageType: StorageType, propertyName: string): void;
    getStorage(): {
        StorageType: StorageType;
        PropertyName: string;
    };
    isStorageLinked(): boolean;
    setSdkParam(): void;
    isSdkParam(): boolean;
}
export declare class PagInstanceFieldNode extends PagNode {
    constructor(id: NodeID, cid: ContextID | undefined, instanceFieldRef: ArkInstanceFieldRef, stmt?: Stmt);
}
export declare class PagStaticFieldNode extends PagNode {
    constructor(id: NodeID, cid: ContextID | undefined, staticFieldRef: ArkStaticFieldRef, stmt?: Stmt);
}
export declare class PagThisRefNode extends PagNode {
    pointToNode: NodeID[];
    constructor(id: NodeID, cid: ContextID | undefined, thisRef: ArkThisRef);
    getThisPTNode(): NodeID[];
    addPTNode(ptNode: NodeID): void;
}
export declare class PagArrayNode extends PagNode {
    base: Value;
    constructor(id: NodeID, cid: ContextID | undefined, expr: ArkArrayRef, stmt?: Stmt);
}
export declare class PagConstantNode extends PagNode {
    constructor(id: NodeID, cid: ContextID | undefined, constant: Constant, stmt?: Stmt);
}
/**
 * below is heapObj like Node
 */
export declare class PagNewExprNode extends PagNode {
    fieldNodes: Map<string, NodeID>;
    constructor(id: NodeID, cid: ContextID | undefined, expr: AbstractExpr, stmt?: Stmt);
    addFieldNode(fieldSignature: AbstractFieldRef, nodeID: NodeID): boolean;
    getFieldNode(fieldSignature: AbstractFieldRef): NodeID | undefined;
    getFieldNodes(): Map<string, NodeID> | undefined;
}
export declare class PagNewContainerExprNode extends PagNode {
    elementNode: NodeID | undefined;
    constructor(id: NodeID, cid: ContextID | undefined, expr: Value, stmt?: Stmt);
    addElementNode(nodeID: NodeID): boolean;
    getElementNode(): NodeID | undefined;
}
export declare class PagParamNode extends PagNode {
    constructor(id: NodeID, cid: ContextID | undefined, r: ArkParameterRef, stmt?: Stmt);
}
export declare class PagFuncNode extends PagNode {
    private methodSignature;
    private thisPt;
    private methodType;
    private originCallSite;
    private argsOffset;
    private originCid;
    constructor(id: NodeID, cid: ContextID | undefined, r: Value, stmt?: Stmt, method?: MethodSignature, thisInstanceID?: NodeID);
    setMethod(method: MethodSignature): void;
    getMethod(): MethodSignature;
    setThisPt(thisPt: NodeID): void;
    getThisPt(): NodeID;
    setCS(callSite: CallSite): void;
    getCS(): CallSite;
    setArgsOffset(offset: number): void;
    getArgsOffset(): number;
    getMethodType(): BuiltApiType;
    setOriginCid(cid: ContextID): void;
    getOriginCid(): ContextID;
}
/**
 * almost same as PagNewExprNode, used only for globalThis and its field reference
 */
export declare class PagGlobalThisNode extends PagNode {
    fieldNodes: Map<string, NodeID>;
    constructor(id: NodeID, cid: ContextID | undefined, r: Value, stmt?: Stmt);
    addFieldNode(fieldSignature: AbstractFieldRef, nodeID: NodeID): boolean;
    getFieldNode(fieldSignature: AbstractFieldRef): NodeID | undefined;
    getFieldNodes(): Map<string, NodeID> | undefined;
}
export declare class Pag extends BaseExplicitGraph {
    private cg;
    private contextValueToIdMap;
    private ExportInfoToIdMap?;
    private contextBaseToIdMap;
    private stashAddrEdge;
    private addrEdge;
    private clonedNodeMap;
    getCG(): CallGraph;
    getOrClonePagNode(src: PagNode, basePt: NodeID): PagNode;
    getOrClonePagFieldNode(src: PagInstanceFieldNode, basePt: NodeID): PagInstanceFieldNode | undefined;
    /**
     * Handle field access on container types (Array, Set, Map)
     * Distinguishes between element access and property access based on container type and field name
     * @param baseNode The container node (PagNewContainerExprNode)
     * @param src The abstract field node representing the access
     * @param basePt The pointer ID of the base container
     * @returns PagInstanceFieldNode for the access, or undefined if error
     */
    private handleContainerFieldAccess;
    getOrClonePagContainerFieldNode(basePt: NodeID, base: Local, className: string): PagInstanceFieldNode | undefined;
    getOrClonePagFuncNode(basePt: NodeID): PagFuncNode | undefined;
    addPagNode(cid: ContextID, value: PagNodeType, stmt?: Stmt, refresh?: boolean): PagNode;
    private handleLocalNode;
    private handleInstanceFieldNode;
    private handleStaticFieldNode;
    private createFieldNode;
    private handleNewExprNode;
    private addContextOrExportInfoMap;
    private addExportInfoMap;
    private addContextMap;
    getOrNewThisLocalNode(cid: ContextID, ptNode: NodeID, value: Local, s?: Stmt): PagNode;
    hasExportNode(v: ExportInfo): NodeID | undefined;
    hasCtxNode(cid: ContextID, v: Value): NodeID | undefined;
    hasCtxRetNode(cid: ContextID, v: Value): NodeID | undefined;
    getOrNewNode(cid: ContextID, v: PagNodeType, s?: Stmt): PagNode;
    getNodesByValue(v: Value): Map<ContextID, NodeID> | undefined;
    getNodesByBaseValue(v: Value): Map<ContextID, NodeID[]> | undefined;
    addPagEdge(src: PagNode, dst: PagNode, kind: PagEdgeKind, stmt?: Stmt): boolean;
    getAddrEdges(): PagEdgeSet;
    resetAddrEdges(): void;
    getGraphName(): string;
    dump(name: string): void;
}
export type InterProceduralSrcType = Local;
export type IntraProceduralEdge = {
    src: Value;
    dst: Value;
    kind: PagEdgeKind;
    stmt: Stmt;
};
export type InterProceduralEdge = {
    src: InterProceduralSrcType;
    dst: Value;
    kind: PagEdgeKind;
};
export declare class FuncPag {
    private internalEdges;
    private normalCallSites;
    private dynamicCallSites;
    private unknownCallSites;
    getInternalEdges(): Set<IntraProceduralEdge> | undefined;
    addNormalCallSite(cs: CallSite): void;
    getNormalCallSites(): Set<CallSite>;
    addDynamicCallSite(cs: DynCallSite): void;
    getDynamicCallSites(): Set<DynCallSite>;
    addUnknownCallSite(cs: CallSite): void;
    getUnknownCallSites(): Set<CallSite>;
    addInternalEdge(stmt: ArkAssignStmt, k: PagEdgeKind): boolean;
}
export declare class InterFuncPag {
    private interFuncEdges;
    constructor();
    getInterProceduralEdges(): Set<InterProceduralEdge>;
    addToInterProceduralEdgeSet(e: InterProceduralEdge): void;
}
export {};
