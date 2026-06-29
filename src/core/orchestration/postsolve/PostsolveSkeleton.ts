import { MaterializedTaintFlow } from "../../provenance/ProvenancePathTypes";
import {
    PostsolveContext,
    PostsolveSkeleton,
} from "./PostsolveTypes";

export function buildPostsolveSkeleton(
    materialized: MaterializedTaintFlow | undefined,
    context: PostsolveContext,
): PostsolveSkeleton | undefined {
    if (!materialized) return undefined;

    const nodeMap = new Map<string, { factId: string; stmtText?: string; methodSignature?: string }>();
    const edgeMap = new Map<string, { fromFactId: string; toFactId: string; reason: string }>();

    for (const path of materialized.paths) {
        for (const factId of path.factIds) {
            if (nodeMap.has(factId)) continue;
            const fact = context.observedFactsById.get(factId);
            const value: any = fact?.node?.getValue?.();
            const stmt = fact?.node?.getStmt?.() || value?.getDeclaringStmt?.();
            const stmtText = stmt?.toString?.() || undefined;
            const methodSignature = stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || undefined;
            nodeMap.set(factId, {
                factId,
                stmtText,
                methodSignature,
            });
        }

        for (const edge of path.edges) {
            const key = `${edge.fromFactId}->${edge.toFactId}:${edge.reason}`;
            if (edgeMap.has(key)) continue;
            edgeMap.set(key, {
                fromFactId: edge.fromFactId,
                toFactId: edge.toFactId,
                reason: edge.reason,
            });
        }
    }

    return {
        sinkFactId: materialized.sinkFactId,
        materialization: {
            status: materialized.status,
            incompleteReasons: [...(materialized.incompleteReasons || [])],
            pathCount: materialized.paths.length,
        },
        nodes: [...nodeMap.values()],
        edges: [...edgeMap.values()],
    };
}
