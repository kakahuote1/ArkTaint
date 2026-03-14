import { Pag, PagInstanceFieldNode, PagNode } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";

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

            for (const objId of pts) {
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
        }
    }

    log(`Field Index Built: ${fieldNodesCount} field nodes, ${indexedLoads} loads indexed.`);
    return fieldToVarIndex;
}
