import { Kind, NodeID, GraphTraits } from './GraphTraits';
export { Kind, NodeID };
export declare abstract class BaseEdge {
    private src;
    private dst;
    protected kind: Kind;
    constructor(s: BaseNode, d: BaseNode, k: Kind);
    getSrcID(): NodeID;
    getDstID(): NodeID;
    getSrcNode(): BaseNode;
    getDstNode(): BaseNode;
    getKind(): Kind;
    setKind(kind: Kind): void;
    getEndPoints(): {
        src: NodeID;
        dst: NodeID;
    };
    getDotAttr(): string;
}
export declare abstract class BaseNode {
    private id;
    protected kind: Kind;
    private inEdges;
    private outEdges;
    constructor(id: NodeID, k: Kind);
    getID(): NodeID;
    getKind(): Kind;
    setKind(kind: Kind): void;
    hasIncomingEdges(): boolean;
    hasOutgoingEdges(): boolean;
    hasIncomingEdge(e: BaseEdge): boolean;
    hasOutgoingEdge(e: BaseEdge): boolean;
    addIncomingEdge(e: BaseEdge): void;
    addOutgoingEdge(e: BaseEdge): void;
    removeIncomingEdge(e: BaseEdge): boolean;
    removeOutgoingEdge(e: BaseEdge): boolean;
    getIncomingEdge(): Set<BaseEdge>;
    getOutgoingEdges(): Set<BaseEdge>;
    getDotAttr(): string;
    abstract getDotLabel(): string;
}
export declare abstract class BaseExplicitGraph implements GraphTraits<BaseNode> {
    protected edgeNum: number;
    protected nodeNum: number;
    protected idToNodeMap: Map<NodeID, BaseNode>;
    protected edgeMarkSet: Set<string>;
    constructor();
    getNodeNum(): number;
    getEdgeNum(): number;
    nodesItor(): IterableIterator<BaseNode>;
    addNode(n: BaseNode): void;
    getNode(id: NodeID): BaseNode | undefined;
    hasNode(id: NodeID): boolean;
    removeNode(id: NodeID): boolean;
    hasEdge(src: BaseNode, dst: BaseNode): boolean;
    ifEdgeExisting(edge: BaseEdge): boolean;
    getNodesIter(): IterableIterator<BaseNode>;
    abstract getGraphName(): string;
}
//# sourceMappingURL=BaseExplicitGraph.d.ts.map