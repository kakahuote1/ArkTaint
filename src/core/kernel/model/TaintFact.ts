
import { PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ContextID } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/context/Context";

export class TaintFact {
    public node: PagNode;
    public contextID: ContextID;  // 上下�?ID�? = 空上下文�?
    public field?: string[];
    public source: string;

    constructor(node: PagNode, source: string, contextID: ContextID = 0, field?: string[]) {
        this.node = node;
        this.source = source;
        this.contextID = contextID;
        this.field = field;
    }

    public get id(): string {
        let id = `${this.node.getID()}@${this.contextID}`;
        if (this.field && this.field.length > 0) {
            id += `.${this.field.join('.')}`;
        }
        return id;
    }
}
