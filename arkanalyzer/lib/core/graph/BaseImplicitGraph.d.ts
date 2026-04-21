import { NodeID, GraphTraits } from './GraphTraits';
export { NodeID };
/**
 * BaseImplicitGraph is an abstract class that represents an implicit graph.
 * An implicit graph is a graph representation where node and edge information is implicitly stored using maps.
 * This class implements the GraphTraits<Node> interface and provides basic graph operations.
 */
export declare abstract class BaseImplicitGraph<Node> implements GraphTraits<Node> {
    /**
     * idToNodeMap is an optional map that maps node IDs (NodeID) to node objects (Node).
     * If not initialized, calling related methods will throw an error.
     */
    protected idToNodeMap?: Map<NodeID, Node>;
    /**
     * nodeToIdMap is a map that maps node objects (Node) to node IDs (NodeID).
     * This map must be initialized in the subclass.
     */
    protected nodeToIdMap: Map<Node, NodeID>;
    /**
     * succMap is a map that stores the successors of each node.
     * The key is a node ID (NodeID), and the value is an array of successor node IDs.
     */
    succMap: Map<NodeID, NodeID[]>;
    /**
     * predMap is a map that stores the predecessors of each node.
     * The key is a node ID (NodeID), and the value is an array of predecessor node IDs.
     */
    predMap: Map<NodeID, NodeID[]>;
    constructor();
    /**
     * Gets the number of nodes in the graph.
     * @returns The number of nodes in the graph.
     */
    getNodeNum(): number;
    /**
     * Returns an iterator for all nodes in the graph.
     * @returns An iterator for traversing all nodes in the graph.
     */
    nodesItor(): IterableIterator<Node>;
    /**
     * Gets the node object corresponding to a given node ID.
     * @param id The node ID.
     * @returns The corresponding node object.
     * @throws Throws an error if idToNodeMap is not initialized or if the node is not found.
     */
    getNode(id: NodeID): Node;
    getNodeID(s: Node): NodeID;
    /**
     * Checks whether the graph contains a specific node ID.
     * @param id The node ID.
     * @returns Returns true if the node ID exists in the graph; otherwise, returns false.
     * @throws Throws an error if idToNodeMap is not initialized.
     */
    hasNode(id: NodeID): boolean;
    /**
     * Gets the list of successor node IDs for a given node.
     * @param id The node ID.
     * @returns An array of successor node IDs. Returns an empty array if no successors are found.
     */
    succ(id: NodeID): NodeID[];
    /**
     * Gets the list of predecessor node IDs for a given node.
     * @param id The node ID.
     * @returns An array of predecessor node IDs. Returns an empty array if no predecessors are found.
     */
    pred(id: NodeID): NodeID[];
    /**
     * Gets the nodeToIdMap, which maps node objects to node IDs.
     * @returns The nodeToIdMap.
     */
    getNodeToIdMap(): Map<Node, NodeID>;
    /**
     * Abstract method to get the name of the graph.
     * Subclasses must implement this method.
     * @returns The name of the graph.
     */
    abstract getGraphName(): string;
}
//# sourceMappingURL=BaseImplicitGraph.d.ts.map