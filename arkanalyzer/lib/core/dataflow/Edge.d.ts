import { Stmt } from '../base/Stmt';
export declare class PathEdgePoint<D> {
    node: Stmt;
    fact: D;
    constructor(node: Stmt, fact: D);
}
export declare class PathEdge<D> {
    edgeStart: PathEdgePoint<D>;
    edgeEnd: PathEdgePoint<D>;
    constructor(start: PathEdgePoint<D>, end: PathEdgePoint<D>);
}
//# sourceMappingURL=Edge.d.ts.map