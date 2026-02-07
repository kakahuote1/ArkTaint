
import { PagNode } from "../../arkanalyzer/src/callgraph/pointerAnalysis/Pag";
import { Context } from "../../arkanalyzer/src/callgraph/pointerAnalysis/context/Context";

export class TaintFact {
    public node: PagNode;
    public context?: Context;
    public field?: string[];
    public source: string;

    constructor(node: PagNode, source: string, context?: Context, field?: string[]) {
        this.node = node;
        this.source = source;
        this.context = context;
        this.field = field;
    }

    public get id(): string {
        let id = `${this.node.id}`;
        if (this.context) {
            id += `_${this.context.id}`;
        }
        if (this.field && this.field.length > 0) {
            id += `_${this.field.join('.')}`;
        }
        return id;
    }
}
