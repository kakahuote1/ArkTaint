import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { fieldPathKey, normalizeFieldPathSegments } from "./FieldPath";

export class FieldAccessIndex {
    private readonly fieldToVarIndex: Map<string, Set<number>>;

    constructor(fieldToVarIndex?: Map<string, Set<number>>) {
        this.fieldToVarIndex = fieldToVarIndex || new Map<string, Set<number>>();
    }

    public static fromFieldToVarIndex(fieldToVarIndex: Map<string, Set<number>>): FieldAccessIndex {
        return new FieldAccessIndex(fieldToVarIndex);
    }

    public getRawIndex(): Map<string, Set<number>> {
        return this.fieldToVarIndex;
    }

    public getLoadTargetNodeIds(ownerNodeId: number, fieldPath?: readonly unknown[]): Iterable<number> | undefined {
        const path = normalizeFieldPathSegments(fieldPath);
        if (!path || path.length === 0) return undefined;
        return this.fieldToVarIndex.get(this.key(ownerNodeId, path[0]));
    }

    public getDirectFieldLoadTargetNodeIds(ownerNodeId: number, fieldName: string): Iterable<number> | undefined {
        return this.fieldToVarIndex.get(this.key(ownerNodeId, fieldName));
    }

    public getExistingLoadFacts(pag: Pag, ownerNodeId: number, fieldPath?: readonly unknown[]): PagNode[] {
        const targets = this.getLoadTargetNodeIds(ownerNodeId, fieldPath);
        if (!targets) return [];
        const out: PagNode[] = [];
        for (const nodeId of targets) {
            const node = pag.getNode(nodeId) as PagNode;
            if (node) out.push(node);
        }
        return out;
    }

    private key(ownerNodeId: number, fieldName: string): string {
        return `${ownerNodeId}-${fieldPathKey([fieldName])}`;
    }
}
