export type NodeID = number;
export type Kind = number;
export interface GraphTraits<Node> {
    nodesItor(): IterableIterator<Node>;
    getGraphName(): string;
    getNode(id: NodeID): Node | undefined;
}
//# sourceMappingURL=GraphTraits.d.ts.map