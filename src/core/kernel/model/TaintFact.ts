
import { PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ContextID } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/context/Context";
import { fieldPathKey, normalizeFieldPathSegments } from "../field/FieldPath";

export class TaintFact {
    public node: PagNode;
    public contextID: ContextID;  // 上下�?ID�? = 空上下文�?
    public field?: string[];
    public source: string;
    private readonly cachedLocationId: string;
    private readonly cachedTaintId: string;

    constructor(node: PagNode, source: string, contextID: ContextID = 0, field?: string[]) {
        this.node = node;
        this.source = source;
        this.contextID = contextID;
        this.field = normalizeFieldPathSegments(field);
        this.cachedLocationId = buildLocationId(node.getID(), contextID, this.field);
        this.cachedTaintId = `${this.cachedLocationId}#src=${encodeTaintIdPart(this.source)}`;
    }

    public get id(): string {
        return this.locationId;
    }

    public get locationId(): string {
        return this.cachedLocationId;
    }

    public get taintId(): string {
        return this.cachedTaintId;
    }
}

function buildLocationId(nodeId: number, contextId: ContextID, fieldPath?: string[]): string {
    let id = `${nodeId}@${contextId}`;
    if (fieldPath && fieldPath.length > 0) {
        id += `.${fieldPathKey(fieldPath)}`;
    }
    return id;
}

function encodeTaintIdPart(value: string): string {
    return encodeURIComponent(String(value || ""));
}
