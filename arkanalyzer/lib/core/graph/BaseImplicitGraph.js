"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseImplicitGraph = void 0;
/**
 * BaseImplicitGraph is an abstract class that represents an implicit graph.
 * An implicit graph is a graph representation where node and edge information is implicitly stored using maps.
 * This class implements the GraphTraits<Node> interface and provides basic graph operations.
 */
class BaseImplicitGraph {
    constructor() { }
    /**
     * Gets the number of nodes in the graph.
     * @returns The number of nodes in the graph.
     */
    getNodeNum() {
        return this.nodeToIdMap.size;
    }
    /**
     * Returns an iterator for all nodes in the graph.
     * @returns An iterator for traversing all nodes in the graph.
     */
    nodesItor() {
        return this.nodeToIdMap.keys();
    }
    /**
     * Gets the node object corresponding to a given node ID.
     * @param id The node ID.
     * @returns The corresponding node object.
     * @throws Throws an error if idToNodeMap is not initialized or if the node is not found.
     */
    getNode(id) {
        if (!this.idToNodeMap) {
            throw new Error(`initialize this.idToNodeMap first`);
        }
        if (!this.idToNodeMap.has(id)) {
            throw new Error(`Can find Node # ${id}`);
        }
        return this.idToNodeMap.get(id);
    }
    getNodeID(s) {
        if (!this.nodeToIdMap.has(s)) {
            throw new Error(`Can find Node # ${s}`);
        }
        return this.nodeToIdMap.get(s);
    }
    /**
     * Checks whether the graph contains a specific node ID.
     * @param id The node ID.
     * @returns Returns true if the node ID exists in the graph; otherwise, returns false.
     * @throws Throws an error if idToNodeMap is not initialized.
     */
    hasNode(id) {
        if (!this.idToNodeMap) {
            throw new Error(`initialize this.idToNodeMap first`);
        }
        return this.idToNodeMap.has(id);
    }
    /**
     * Gets the list of successor node IDs for a given node.
     * @param id The node ID.
     * @returns An array of successor node IDs. Returns an empty array if no successors are found.
     */
    succ(id) {
        var _a;
        return (_a = this.succMap.get(id)) !== null && _a !== void 0 ? _a : [];
    }
    /**
     * Gets the list of predecessor node IDs for a given node.
     * @param id The node ID.
     * @returns An array of predecessor node IDs. Returns an empty array if no predecessors are found.
     */
    pred(id) {
        var _a;
        return (_a = this.predMap.get(id)) !== null && _a !== void 0 ? _a : [];
    }
    /**
     * Gets the nodeToIdMap, which maps node objects to node IDs.
     * @returns The nodeToIdMap.
     */
    getNodeToIdMap() {
        return this.nodeToIdMap;
    }
}
exports.BaseImplicitGraph = BaseImplicitGraph;
