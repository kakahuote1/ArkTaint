import { Pag, PagNode } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { TaintFact } from "../model/TaintFact";
import { ModuleEmission } from "./ModuleContract";

function cloneFieldPath(field?: string[]): string[] | undefined {
    return field && field.length > 0 ? [...field] : undefined;
}

function pushEmission(
    out: ModuleEmission[],
    dedup: Set<string>,
    reason: string,
    fact: TaintFact,
): void {
    const key = `${reason}|${fact.id}`;
    if (dedup.has(key)) return;
    dedup.add(key);
    out.push({ reason, fact });
}

export function emitNodeFactById(
    pag: Pag,
    nodeId: number,
    source: string,
    contextID: number,
    reason: string,
    field?: string[],
): ModuleEmission[] {
    const node = pag.getNode(nodeId) as PagNode | undefined;
    if (!node) return [];
    return [{ reason, fact: new TaintFact(node, source, contextID, cloneFieldPath(field)) }];
}

export function emitNodeFactsByIds(
    pag: Pag,
    nodeIds: Iterable<number>,
    source: string,
    contextID: number,
    reason: string,
    field?: string[],
): ModuleEmission[] {
    const out: ModuleEmission[] = [];
    const dedup = new Set<string>();
    for (const nodeId of nodeIds) {
        const node = pag.getNode(nodeId) as PagNode | undefined;
        if (!node) continue;
        pushEmission(out, dedup, reason, new TaintFact(node, source, contextID, cloneFieldPath(field)));
    }
    return out;
}

export function emitObjectFieldFactsByIds(
    pag: Pag,
    objectNodeIds: Iterable<number>,
    source: string,
    contextID: number,
    reason: string,
    fieldPath: string[],
): ModuleEmission[] {
    const out: ModuleEmission[] = [];
    const dedup = new Set<string>();
    for (const objectNodeId of objectNodeIds) {
        const objectNode = pag.getNode(objectNodeId) as PagNode | undefined;
        if (!objectNode) continue;
        pushEmission(out, dedup, reason, new TaintFact(objectNode, source, contextID, [...fieldPath]));
    }
    return out;
}

export function emitLoadLikeFactsByIds(
    pag: Pag,
    nodeIds: Iterable<number>,
    source: string,
    contextID: number,
    reason: string,
    remainingFieldPath?: string[],
): ModuleEmission[] {
    const out: ModuleEmission[] = [];
    const dedup = new Set<string>();
    const hasRemaining = !!remainingFieldPath && remainingFieldPath.length > 0;

    for (const nodeId of nodeIds) {
        const node = pag.getNode(nodeId) as PagNode | undefined;
        if (!node) continue;
        if (!hasRemaining) {
            pushEmission(out, dedup, reason, new TaintFact(node, source, contextID));
            continue;
        }

        let hasPointTo = false;
        for (const objectNodeId of node.getPointTo()) {
            const objectNode = pag.getNode(objectNodeId) as PagNode | undefined;
            if (!objectNode) continue;
            hasPointTo = true;
            pushEmission(
                out,
                dedup,
                reason,
                new TaintFact(objectNode, source, contextID, [...remainingFieldPath]),
            );
        }
        if (!hasPointTo) {
            pushEmission(
                out,
                dedup,
                reason,
                new TaintFact(node, source, contextID, [...remainingFieldPath]),
            );
        }
    }

    return out;
}
