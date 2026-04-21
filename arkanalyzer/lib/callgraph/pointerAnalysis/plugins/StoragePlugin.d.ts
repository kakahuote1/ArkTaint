import { Stmt } from '../../../core/base/Stmt';
import { Value } from '../../../core/base/Value';
import { NodeID } from '../../../core/graph/GraphTraits';
import { CallGraph, CallGraphNode } from '../../model/CallGraph';
import { ICallSite } from '../../model/CallSite';
import { ContextID } from '../context/Context';
import { Pag, PagNode } from '../Pag';
import { PagBuilder } from '../PagBuilder';
import { IPagPlugin } from './IPagPlugin';
export declare enum StorageType {
    APP_STORAGE = 0,
    LOCAL_STORAGE = 1,
    SUBSCRIBED_ABSTRACT_PROPERTY = 2,
    Undefined = 3
}
export declare enum StorageLinkEdgeType {
    Property2Local = 0,
    Local2Property = 1,
    TwoWay = 2
}
/**
 * StoragePlugin processes AppStorage, LocalStorage, and SubscribedAbstractProperty APIs.
 */
export declare class StoragePlugin implements IPagPlugin {
    pag: Pag;
    pagBuilder: PagBuilder;
    cg: CallGraph;
    private storagePropertyMap;
    constructor(pag: Pag, pagBuilder: PagBuilder, cg: CallGraph);
    getName(): string;
    canHandle(cs: ICallSite, cgNode: CallGraphNode): boolean;
    processCallSite(cs: ICallSite, cid: ContextID, emptyNode: NodeID): NodeID[];
    /**
     * get storageType enum with method's Declaring ClassName
     *
     * @param storageName ClassName that method belongs to, currently support AppStorage and SubscribedAbstractProperty
     * SubscribedAbstractProperty: in following listing, `link1` is infered as ClassType `SubscribedAbstractProperty`,
     * it needs to get PAG node to check the StorageType
     * let link1: SubscribedAbstractProperty<A> = AppStorage.link('PropA');
     * link1.set(a);
     * @param cs: for search PAG node in SubscribedAbstractProperty
     * @param cid: for search PAG node in SubscribedAbstractProperty
     * @returns StorageType enum
     */
    private getStorageType;
    private processStorageAPI;
    private processStorageSetOrCreate;
    /**
     * search the storage map to get propertyNode with given storage and propertyFieldName
     * @param storage storage type: AppStorage, LocalStorage etc.
     * @param propertyName string property key
     * @returns propertyNode: PagLocalNode
     */
    getOrNewPropertyNode(storage: StorageType, propertyName: string): PagNode;
    /**
     * add PagEdge
     * @param edgeKind: edge kind differs from API
     * @param propertyNode: PAG node created by protpertyName
     * @param obj: heapObj stored with Storage API
     */
    addPropertyLinkEdge(propertyNode: PagNode, storageObj: Value, cid: ContextID, stmt: Stmt, edgeKind: number, srcNodes: NodeID[]): void;
    private processStorageLink;
    private processStorageProp;
    private processStorageSet;
    private processStorageGet;
    private getPropertyName;
}
//# sourceMappingURL=StoragePlugin.d.ts.map