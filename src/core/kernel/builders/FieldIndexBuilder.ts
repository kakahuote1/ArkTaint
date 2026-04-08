import { Pag, PagInstanceFieldNode, PagNode } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { ArkInstanceFieldRef } from "../../../../arkanalyzer/lib/core/base/Ref";
import { appendOrdinaryArrayLoadIndices } from "../ordinary/OrdinaryLanguagePropagation";

export function buildFieldToVarIndex(
    pag: Pag,
    log: (msg: string) => void
): Map<string, Set<number>> {
    const fieldToVarIndex: Map<string, Set<number>> = new Map();
    log("Building Field-to-Var Index...");

    let fieldNodesCount = 0;
    let indexedLoads = 0;

    for (const node of pag.getNodesIter()) {
        if (!(node instanceof PagInstanceFieldNode)) continue;

        fieldNodesCount++;
        const fieldRef = node.getValue() as ArkInstanceFieldRef;
        const fieldName = fieldRef.getFieldSignature().getFieldName();
        const baseLocal = fieldRef.getBase();
        const baseNodesMap = pag.getNodesByValue(baseLocal);
        if (!baseNodesMap) continue;

        for (const baseNodeId of baseNodesMap.values()) {
            const baseNode = pag.getNode(baseNodeId) as PagNode;
            const pts = baseNode.getPointTo();
            let hasPointTo = false;

            for (const objId of pts) {
                hasPointTo = true;
                const key = `${objId}-${fieldName}`;
                const loadEdges = node.getOutgoingLoadEdges();
                if (!loadEdges) continue;

                for (const edge of loadEdges) {
                    const destVarId = edge.getDstID();
                    if (!fieldToVarIndex.has(key)) {
                        fieldToVarIndex.set(key, new Set());
                    }
                    fieldToVarIndex.get(key)!.add(destVarId);
                    indexedLoads++;
                }
            }
            if (!hasPointTo) {
                const key = `${baseNodeId}-${fieldName}`;
                const loadEdges = node.getOutgoingLoadEdges();
                if (!loadEdges) continue;
                for (const edge of loadEdges) {
                    const destVarId = edge.getDstID();
                    if (!fieldToVarIndex.has(key)) {
                        fieldToVarIndex.set(key, new Set());
                    }
                    fieldToVarIndex.get(key)!.add(destVarId);
                    indexedLoads++;
                }
            }
        }
    }

    const arrayIndexStats = appendOrdinaryArrayLoadIndices(pag, fieldToVarIndex);
    indexedLoads += arrayIndexStats.indexedLoads;
    log(
        `Field Index Built: ${fieldNodesCount} field nodes, `
        + `${arrayIndexStats.arrayNodesCount} array nodes, `
        + `${indexedLoads} loads indexed.`,
    );
    return fieldToVarIndex;
}
