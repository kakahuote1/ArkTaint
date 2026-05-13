import { TaintFlow } from "../../kernel/model/TaintFlow";
import {
    MaterializedTaintFlow,
    PostsolveContext,
    WitnessDag,
    WitnessDagEdge,
    WitnessPath,
} from "./PostsolveTypes";
import { FactPredecessorRecord } from "../../kernel/propagation/PropagationTypes";

const DEFAULT_MAX_PATHS = 128;
const DEFAULT_MAX_DEPTH = 128;

export function materializeTaintFlowPaths(
    flow: TaintFlow,
    context: PostsolveContext,
    options?: {
        maxPaths?: number;
        maxDepth?: number;
    },
): MaterializedTaintFlow | undefined {
    if (!flow.sinkFactId) return undefined;
    const dag = buildWitnessDag(flow.sinkFactId, context);
    if (dag.factIds.size === 0) return undefined;
    const paths = enumerateWitnessPaths(dag, context, options);
    if (paths.length === 0) return undefined;
    return {
        sinkFactId: flow.sinkFactId,
        paths: deduplicateWitnessPaths(paths),
    };
}

export function buildWitnessDag(sinkFactId: string, context: PostsolveContext): WitnessDag {
    const factIds = new Set<string>();
    const edges: WitnessDagEdge[] = [];
    const sourceFactIds = new Set<string>();
    const visited = new Set<string>();
    const stack = [sinkFactId];

    while (stack.length > 0) {
        const currentFactId = stack.pop()!;
        if (visited.has(currentFactId)) continue;
        visited.add(currentFactId);
        factIds.add(currentFactId);

        const predecessors = context.factPredecessorsByFactId.get(currentFactId) || [];
        if (predecessors.length === 0) {
            sourceFactIds.add(currentFactId);
            continue;
        }

        for (const record of predecessors) {
            edges.push({
                fromFactId: record.fromFactId,
                toFactId: record.toFactId,
                reason: record.reason,
            });
            factIds.add(record.fromFactId);
            stack.push(record.fromFactId);
        }
    }

    return {
        sinkFactId,
        factIds,
        edges,
        sourceFactIds,
    };
}

export function enumerateWitnessPaths(
    dag: WitnessDag,
    context: PostsolveContext,
    options?: {
        maxPaths?: number;
        maxDepth?: number;
    },
): WitnessPath[] {
    const maxPaths = options?.maxPaths || DEFAULT_MAX_PATHS;
    const maxDepth = options?.maxDepth || DEFAULT_MAX_DEPTH;
    const predecessorAdjacency = new Map<string, WitnessDagEdge[]>();
    for (const edge of dag.edges) {
        const bucket = predecessorAdjacency.get(edge.toFactId) || [];
        if (!predecessorAdjacency.has(edge.toFactId)) predecessorAdjacency.set(edge.toFactId, bucket);
        bucket.push(edge);
    }

    const paths: WitnessPath[] = [];
    const pathFactIds: string[] = [];
    const pathEdges: WitnessDagEdge[] = [];
    const visitedOnPath = new Set<string>();

    const dfs = (currentFactId: string, depth: number): void => {
        if (paths.length >= maxPaths) return;
        if (depth > maxDepth) {
            const orderedFactIds = [...pathFactIds, currentFactId].reverse();
            const orderedEdges = [...pathEdges].reverse();
            paths.push({
                factIds: orderedFactIds,
                edges: orderedEdges,
                truncated: true,
            });
            return;
        }
        if (visitedOnPath.has(currentFactId)) {
            return;
        }

        pathFactIds.push(currentFactId);
        visitedOnPath.add(currentFactId);

        const predecessors = predecessorAdjacency.get(currentFactId) || [];
        if (dag.sourceFactIds.has(currentFactId) || predecessors.length === 0) {
            const orderedFactIds = [...pathFactIds].reverse();
            const orderedEdges = [...pathEdges].reverse();
            paths.push({
                factIds: orderedFactIds,
                edges: orderedEdges,
            });
        } else {
            for (const edge of predecessors) {
                if (paths.length >= maxPaths) break;
                pathEdges.push(edge);
                dfs(edge.fromFactId, depth + 1);
                pathEdges.pop();
            }
        }

        visitedOnPath.delete(currentFactId);
        pathFactIds.pop();
    };

    dfs(dag.sinkFactId, 0);
    return paths;
}

function deduplicateWitnessPaths(paths: WitnessPath[]): WitnessPath[] {
    const dedup = new Map<string, WitnessPath>();
    for (const path of paths) {
        const key = path.factIds.join("->");
        const existing = dedup.get(key);
        if (!existing) {
            dedup.set(key, {
                factIds: [...path.factIds],
                edges: [...path.edges],
                truncated: path.truncated,
            });
            continue;
        }
        existing.truncated = existing.truncated || path.truncated;
    }
    return [...dedup.values()];
}

export function materializeWitnessFactSummaries(
    path: WitnessPath,
    context: PostsolveContext,
): Array<{
    factId: string;
    methodSignature?: string;
    stmtText?: string;
}> {
    return path.factIds.map(factId => {
        const fact = context.observedFactsById.get(factId);
        const stmt = resolveAnchorStmtFromFact(fact);
        return {
            factId,
            methodSignature: stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "",
            stmtText: stmt?.toString?.() || "",
        };
    });
}

function resolveAnchorStmtFromFact(fact: any): any | undefined {
    const nodeStmt = fact?.node?.getStmt?.();
    if (nodeStmt) return nodeStmt;
    const value = fact?.node?.getValue?.();
    if (value?.getDeclaringStmt) return value.getDeclaringStmt?.();
    return undefined;
}
