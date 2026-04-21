import { BaseEdge, BaseNode, NodeID } from '../core/graph/BaseExplicitGraph';
import { GraphTraits } from '../core/graph/GraphTraits';
import { Printer } from './Printer';
export declare class GraphPrinter<GraphType extends GraphTraits<BaseNode>> extends Printer {
    graph: GraphType;
    title: string;
    startID: NodeID | undefined;
    constructor(g: GraphType, t?: string);
    setStartID(n: NodeID): void;
    dump(): string;
    writeGraph(): void;
    writeNodes(): void;
    writeEdge(edge: BaseEdge): void;
    writeHeader(): void;
    writeFooter(): void;
}
//# sourceMappingURL=GraphPrinter.d.ts.map