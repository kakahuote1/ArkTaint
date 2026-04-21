import { BaseEdge, BaseExplicitGraph, BaseNode, NodeID } from '../core/graph/BaseExplicitGraph';
import { CallGraph } from '../callgraph/model/CallGraph';
import { Stmt } from '../core/base/Stmt';
/**
 * Direct value flow graph
 * Consist of stmt(node) and direct Def-Use edge
 * Is basic of VFG. And VFG is building on DVFG
 */
export declare class DVFG extends BaseExplicitGraph {
    private cg;
    private stmtToVFGMap;
    constructor(cg: CallGraph);
    getCG(): CallGraph;
    getGraphName(): string;
    getOrNewDVFGNode(stmt: Stmt): DVFGNode;
    addDVFGNode(stmt: Stmt, kind: DVFGNodeKind): DVFGNode;
    addDVFGEdge(src: DVFGNode, dst: DVFGNode): boolean;
    dump(name: string): void;
}
export declare enum DVFGNodeKind {
    assign = 0,
    copy = 1,
    write = 2,
    load = 3,
    addr = 4,
    if = 5,
    actualParm = 6,
    formalParm = 7,
    actualRet = 8,
    formalRet = 9,
    unary = 10,
    binary = 11,
    normal = 12
}
export declare class DVFGNode extends BaseNode {
    private stmt;
    constructor(i: NodeID, k: DVFGNodeKind, s: Stmt);
    getDotLabel(): string;
    getStmt(): Stmt;
}
export declare class DVFGEdge extends BaseEdge {
}
//# sourceMappingURL=DVFG.d.ts.map