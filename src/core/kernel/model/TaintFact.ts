
import { PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ContextID } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/context/Context";
import { fieldPathKey, normalizeFieldPathSegments } from "../field/FieldPath";

export class TaintFact {
    public node: PagNode;
    public contextID: ContextID;  // 上下�?ID�? = 空上下文�?
    public field?: string[];
    public source: string;

    constructor(node: PagNode, source: string, contextID: ContextID = 0, field?: string[]) {
        this.node = node;
        this.source = source;
        this.contextID = contextID;
        this.field = normalizeFieldPathSegments(field);
    }

    public get id(): string {
        return this.locationId;
    }

    public get locationId(): string {
        let id = `${this.node.getID()}@${this.contextID}`;
        if (this.field && this.field.length > 0) {
            id += `.${fieldPathKey(this.field)}`;
        }
        return id;
    }

    public get taintId(): string {
        return `${this.locationId}#src=${encodeTaintIdPart(this.source)}`;
    }
}

function encodeTaintIdPart(value: string): string {
    return encodeURIComponent(String(value || ""));
}
