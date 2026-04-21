import { Scene } from '../../Scene';
import { Value } from '../../core/base/Value';
import { NodeID } from '../../core/graph/BaseExplicitGraph';
import { CallGraph, CallSite, FuncID } from '../model/CallGraph';
import { AbstractAnalysis } from '../algorithm/AbstractAnalysis';
import { Type } from '../../core/base/Type';
import { Stmt } from '../../core/base/Stmt';
import { Pag } from './Pag';
import { PointerAnalysisConfig } from './PointerAnalysisConfig';
import { DiffPTData, IPtsCollection } from './PtsDS';
import { ArkMethod } from '../../core/model/ArkMethod';
export declare class PointerAnalysis extends AbstractAnalysis {
    private pag;
    private pagBuilder;
    private ptd;
    private entries;
    private worklist;
    private ptaStat;
    private typeDiffMap;
    private config;
    constructor(p: Pag, cg: CallGraph, s: Scene, config: PointerAnalysisConfig);
    static pointerAnalysisForWholeProject(projectScene: Scene, config?: PointerAnalysisConfig): PointerAnalysis;
    static pointerAnalysisForMethod(s: Scene, method: ArkMethod, config?: PointerAnalysisConfig): PointerAnalysis;
    protected init(): void;
    start(): void;
    private postProcess;
    getPTD(): DiffPTData<NodeID, NodeID, IPtsCollection<NodeID>>;
    getPag(): Pag;
    getStat(): string;
    protected preProcessMethod(funcID: FuncID): CallSite[];
    setEntries(fIds: FuncID[]): void;
    private solveConstraint;
    /**
     * get newly added Address Edge, and add them to initial WorkList
     */
    private initWorklist;
    private solveWorklist;
    private processNode;
    private handleCopy;
    private handleLoadWrite;
    private handleFieldInEdges;
    private handleFieldOutEdges;
    /**
     * If current node is a base of a called method, pointer in this node will be transfered into `this` Local in method
     */
    private handleThis;
    private handlePt;
    private propagate;
    /**
     * 1. 记录被更新的节点(记录cid, nodeid)
     * 2. ( PAGLocalNode记录callSite(cid, value唯一))，通过1种的nodeID查询Node,拿到CallSite
     * 3. 在addDynamicCall里对传入指针过滤（已处理指针和未处理指针）
     */
    private onTheFlyDynamicCallSolve;
    private processDynCallSite;
    private processUnknownCallSite;
    private addToReanalyze;
    /**
     * compare interface
     */
    noAlias(leftValue: Value, rightValue: Value): boolean;
    mayAlias(leftValue: Value, rightValue: Value): boolean;
    getRelatedNodes(value: Value): Set<Value>;
    private processRelatedNode;
    private addIncomingEdgesToWorkList;
    private addOutgoingEdgesToWorkList;
    private detectTypeDiff;
    getTypeDiffMap(): Map<Value, Set<Type>>;
    protected resolveCall(sourceMethod: NodeID, invokeStmt: Stmt): CallSite[];
    getUnhandledFuncs(): FuncID[];
    getHandledFuncs(): FuncID[];
    getPTAConfig(): PointerAnalysisConfig;
    private dumpUnhandledFunctions;
    mergeInstanceFieldMap(src: Map<number, number[]>, dst: Map<number, number[]>): Map<number, number[]>;
}
