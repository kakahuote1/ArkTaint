import { BaseEdge, BaseExplicitGraph, BaseNode, Kind, NodeID } from './BaseExplicitGraph';
interface Attributes {
    [name: string]: any;
}
interface NodeAttributes extends Attributes {
    name: string;
    kind: Kind;
}
interface EdgeAttributes extends Attributes {
    kind: Kind;
}
export declare class DependsNode<NodeAttr extends NodeAttributes> extends BaseNode {
    private attr;
    constructor(id: NodeID, attr: NodeAttr);
    getNodeAttr(): NodeAttr;
    setNodeAttr(attr: NodeAttr): void;
    getDotLabel(): string;
}
export declare class DependsEdge<NodeAttr extends NodeAttributes, EdgeAttr extends EdgeAttributes> extends BaseEdge {
    private attr;
    constructor(s: DependsNode<NodeAttr>, d: DependsNode<NodeAttr>, attr: EdgeAttr);
    getEdgeAttr(): EdgeAttr;
    setEdgeAttr(attr: EdgeAttr): void;
    getKey(): string;
}
export declare class DependsGraph<NodeAttr extends NodeAttributes, EdgeAttr extends EdgeAttributes> extends BaseExplicitGraph {
    protected depsMap: Map<string, NodeID>;
    protected edgesMap: Map<string, DependsEdge<NodeAttr, EdgeAttr>>;
    constructor();
    hasDepsNode(key: string): boolean;
    addDepsNode(key: string, attr: NodeAttr): DependsNode<NodeAttr>;
    addEdge(src: DependsNode<NodeAttr>, dst: DependsNode<NodeAttr>, attr: EdgeAttr): DependsEdge<NodeAttr, EdgeAttr>;
    getGraphName(): string;
}
export {};
//# sourceMappingURL=DependsGraph.d.ts.map