import { TaintFlow } from "../kernel/model/TaintFlow";
import {
    MaterializedTaintFlow,
    PathMaterializationOptions,
    PathMaterializationStatus,
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
    const paths = deduplicateProvenancePaths(enumeration.paths).map((path, index) => ({
        ...path,
        id: path.id || `path|${flow.sinkFactId}|${index + 1}`,
        flowId: flow.sinkFactId,
        materializationStatus: path.materializationStatus || path.status,
    }));
    if (paths.length === 0) return undefined;
    const incompleteReasons = mergeIncompleteReasons([
        ...enumeration.incompleteReasons,
        ...paths.flatMap(path => path.incompleteReasons || []),
    ]);
    const materializationStatus = toMaterializationStatus(incompleteReasons);
    return {
        sinkFactId: flow.sinkFactId,
        status: materializationStatus,
        materializationStatus,
        incompleteReasons,
        paths,
        gaps: incompleteReasons.map((reason, index) => ({
            id: `path-gap|${flow.sinkFactId}|${index + 1}`,
            kind: reason === "max_depth" || reason === "max_paths"
                ? "truncated-materialization"
                : reasonToGapKind(reason),
            flowId: flow.sinkFactId,
            reason,
        })),
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
                currentnessEvidenceIds: [...(record.currentnessCertificateIds || [])],
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
                status: "truncated",
                materializationStatus: "truncated",
                incompleteReasons: ["max_depth", "truncated_materialization"],
                truncated: true,
                currentnessEvidenceIds: collectCurrentnessEvidenceIds(orderedEdges),
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
                materializationStatus: "complete",
                currentnessEvidenceIds: collectCurrentnessEvidenceIds(orderedEdges),
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
                currentnessEvidenceIds: [...(path.currentnessEvidenceIds || [])],
            });
            continue;
        }
        existing.truncated = existing.truncated || path.truncated;
        existing.incompleteReasons = mergeIncompleteReasons([
            ...(existing.incompleteReasons || []),
            ...(path.incompleteReasons || []),
        ]);
        existing.currentnessEvidenceIds = mergeIds([
            ...(existing.currentnessEvidenceIds || []),
            ...(path.currentnessEvidenceIds || []),
        ]);
        existing.materializationStatus = existing.incompleteReasons.length > 0
            ? toMaterializationStatus(existing.incompleteReasons)
            : existing.materializationStatus;
        existing.status = existing.materializationStatus || existing.status;
    }
    return [...dedup.values()];
}

function collectCurrentnessEvidenceIds(edges: ProvenanceDagEdge[]): string[] {
    return mergeIds(edges.flatMap(edge => edge.currentnessEvidenceIds || []));
}

function mergeIds(ids: string[]): string[] {
    return [...new Set(ids.filter(id => id.length > 0))].sort();
}

function mergeIncompleteReasons(reasons: ProvenancePathIncompleteReason[]): ProvenancePathIncompleteReason[] {
    return [...new Set(reasons)].sort();
}

function toMaterializationStatus(reasons: ProvenancePathIncompleteReason[]): PathMaterializationStatus {
    if (reasons.length === 0) return "complete";
    if (reasons.includes("materialization_failed")) return "failed";
    if (reasons.includes("max_depth")
        || reasons.includes("max_paths")
        || reasons.includes("truncated_materialization")) {
        return "truncated";
    }
    return "incomplete";
}

function reasonToGapKind(reason: ProvenancePathIncompleteReason): NonNullable<MaterializedTaintFlow["gaps"]>[number]["kind"] {
    if (reason === "missing_derivation") return "missing-derivation";
    if (reason === "missing_source_provenance") return "missing-source-provenance";
    if (reason === "missing_currentness") return "missing-currentness";
    if (reason === "missing_ude_edge") return "missing-ude-edge";
    if (reason === "missing_model_hit") return "missing-model-hit";
    if (reason === "ambiguous_predecessor") return "ambiguous-predecessor";
    if (reason === "unresolved_value_version") return "unresolved-value-version";
    return "truncated-materialization";
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
