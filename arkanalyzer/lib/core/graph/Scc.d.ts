import { BaseNode } from './BaseExplicitGraph';
import { NodeID, GraphTraits } from './GraphTraits';
type NodeSet = Set<NodeID>;
type NodeStack = NodeID[];
type Node2RepSCCInfoMap = Map<NodeID, NodeSCCInfo>;
/**
 * Basic SCC info for a single node
 */
declare class NodeSCCInfo {
    private _rep;
    private _subNodes;
    constructor();
    get rep(): NodeID;
    set rep(n: NodeID);
    addSubNodes(n: NodeID): void;
    get subNodes(): NodeSet;
}
/**
 * Detect strongly connected components in a directed graph
 * A topological graph is an extra product from this algorithm
 * Advanced Nuutila’s algorithm which come from the following paper:
 *   Wave Propagation and Deep Propagation for pointer Analysis
 *   CGO 2009
 */
export declare class SCCDetection<Graph extends GraphTraits<BaseNode>> {
    private _G;
    private _I;
    private _D;
    private _R;
    private _S;
    private _T;
    private repNodes;
    private visitedNodes;
    private inSCCNodes;
    constructor(GT: Graph);
    private isVisited;
    private inSCC;
    private setVisited;
    private setInSCC;
    private setRep;
    private getRep;
    private getNode;
    private visit;
    private clear;
    /**
     * Get the rep node
     * If not found return itself
     */
    getRepNode(n: NodeID): NodeID;
    /**
     * Start to detect and collapse SCC
     */
    find(): void;
    getTopoAndCollapsedNodeStack(): NodeStack;
    getNode2SCCInfoMap(): Node2RepSCCInfoMap;
    nodeIsInCycle(n: NodeID): boolean;
    getMySCCNodes(n: NodeID): NodeSet;
    getSubNodes(n: NodeID): NodeSet;
    getRepNodes(): NodeSet;
}
export {};
//# sourceMappingURL=Scc.d.ts.map