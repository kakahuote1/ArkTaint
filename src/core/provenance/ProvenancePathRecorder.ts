import { TaintFlow } from "../kernel/model/TaintFlow";
import {
    MaterializedTaintFlow,
    PathMaterializationOptions,
    ProvenanceDag,
    ProvenanceDagEdge,
    ProvenancePath,
    ProvenancePathContext,
    ProvenancePathEnumeration,
    ProvenancePathIncompleteReason,
} from "./ProvenancePathTypes";

const DEFAULT_MAX_PATHS = 128;
const DEFAULT_MAX_DEPTH = 128;

export function materializeTaintFlowPaths(
    flow: TaintFlow,
    context: ProvenancePathContext,
    options?: PathMaterializationOptions,
): MaterializedTaintFlow | undefined {
    if (!flow.sinkFactId) return undefined;
    const dag = buildProvenanceDag(flow.sinkFactId, context);
    if (dag.factIds.size === 0) return undefined;
    const enumeration = enumerateProvenancePaths(dag, options);
    const paths = deduplicateProvenancePaths(enumeration.paths);
    if (paths.length === 0) return undefined;
    const incompleteReasons = mergeIncompleteReasons([
        ...enumeration.incompleteReasons,
        ...paths.flatMap(path => path.incompleteReasons || []),
    ]);
    return {
        sinkFactId: flow.sinkFactId,
        status: incompleteReasons.length > 0 ? "incomplete" : "complete",
        incompleteReasons,
        paths,
    };
}

export function buildProvenanceDag(sinkFactId: string, context: ProvenancePathContext): ProvenanceDag {
    const factIds = new Set<string>();
    const edges: ProvenanceDagEdge[] = [];
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

export function enumerateProvenancePaths(
    dag: ProvenanceDag,
    options?: PathMaterializationOptions,
): ProvenancePathEnumeration {
    const maxPaths = options?.maxPaths || DEFAULT_MAX_PATHS;
    const maxDepth = options?.maxDepth || DEFAULT_MAX_DEPTH;
    const predecessorAdjacency = new Map<string, ProvenanceDagEdge[]>();
    for (const edge of dag.edges) {
        const bucket = predecessorAdjacency.get(edge.toFactId) || [];
        if (!predecessorAdjacency.has(edge.toFactId)) predecessorAdjacency.set(edge.toFactId, bucket);
        bucket.push(edge);
    }

    const paths: ProvenancePath[] = [];
    const pathFactIds: string[] = [];
    const pathEdges: ProvenanceDagEdge[] = [];
    const visitedOnPath = new Set<string>();
    const incompleteReasons = new Set<ProvenancePathIncompleteReason>();

    const dfs = (currentFactId: string, depth: number): void => {
        if (paths.length >= maxPaths) {
            incompleteReasons.add("max_paths");
            return;
        }
        if (depth > maxDepth) {
            incompleteReasons.add("max_depth");
            const orderedFactIds = [...pathFactIds, currentFactId].reverse();
            const orderedEdges = [...pathEdges].reverse();
            paths.push({
                factIds: orderedFactIds,
                edges: orderedEdges,
                status: "incomplete",
                incompleteReasons: ["max_depth"],
                truncated: true,
            });
            return;
        }
        if (visitedOnPath.has(currentFactId)) {
            incompleteReasons.add("cycle_skipped");
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
                status: "complete",
            });
        } else {
            for (const edge of predecessors) {
                if (paths.length >= maxPaths) {
                    incompleteReasons.add("max_paths");
                    break;
                }
                pathEdges.push(edge);
                dfs(edge.fromFactId, depth + 1);
                pathEdges.pop();
            }
        }

        visitedOnPath.delete(currentFactId);
        pathFactIds.pop();
    };

    dfs(dag.sinkFactId, 0);
    const reasons = mergeIncompleteReasons([...incompleteReasons]);
    return {
        paths,
        status: reasons.length > 0 ? "incomplete" : "complete",
        incompleteReasons: reasons,
    };
}

function deduplicateProvenancePaths(paths: ProvenancePath[]): ProvenancePath[] {
    const dedup = new Map<string, ProvenancePath>();
    for (const path of paths) {
        const key = path.factIds.join("->");
        const existing = dedup.get(key);
        if (!existing) {
            dedup.set(key, {
                factIds: [...path.factIds],
                edges: [...path.edges],
                status: path.status,
                incompleteReasons: [...(path.incompleteReasons || [])],
                truncated: path.truncated,
            });
            continue;
        }
        existing.truncated = existing.truncated || path.truncated;
        existing.incompleteReasons = mergeIncompleteReasons([
            ...(existing.incompleteReasons || []),
            ...(path.incompleteReasons || []),
        ]);
        existing.status = existing.incompleteReasons.length > 0 ? "incomplete" : existing.status;
    }
    return [...dedup.values()];
}

function mergeIncompleteReasons(reasons: ProvenancePathIncompleteReason[]): ProvenancePathIncompleteReason[] {
    return [...new Set(reasons)].sort();
}

export function materializeProvenanceFactSummaries(
    path: ProvenancePath,
    context: ProvenancePathContext,
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
