import { TraceCoverageRecord, TraceEdge, TraceFact, TraceGate, TraceGraph, TraceStage } from "./TraceGraph";
import type { TraceExplanation } from "./TraceExplain";

export type FlowQueryKind = "should-report" | "should-not-report" | "duplicate" | "diagnostic";

export interface TraceWaypoint {
    id?: string;
    labelContains?: string;
    methodContains?: string;
    stmtContains?: string;
    valueContains?: string;
    fieldPathContains?: string;
    pagNode?: number;
}

export interface FlowQuery {
    id: string;
    kind: FlowQueryKind;
    source?: TraceWaypoint;
    expectedWaypoints?: TraceWaypoint[];
    forbiddenWaypoints?: TraceWaypoint[];
    sink?: TraceWaypoint;
    whyNotAllowed?: string;
}

export interface FlowQueryResult {
    queryId: string;
    kind: FlowQueryKind;
    verdict:
        | "reached"
        | "missing"
        | "source-ambiguous"
        | "illegal-propagation"
        | "duplicate"
        | "unresolved";
    lastReached?: TraceFact;
    firstMissing?: TraceWaypoint;
    sourceMatchCount?: number;
    ambiguousSourceMatches?: TraceFact[];
    unexpectedReachedNode?: TraceFact;
    firstIllegalPropagation?: TraceEdge;
    responsibleEdge?: TraceEdge;
    primaryLayer?: TraceStage;
    whyNotAllowed?: string;
    nearbyEdges: TraceEdge[];
    nearbyGates: TraceGate[];
    nearbyCoverage: TraceCoverageRecord[];
    evidenceChain: string[];
    explanation?: TraceExplanation;
}

export function queryTraceGraph(graph: TraceGraph, query: FlowQuery): FlowQueryResult {
    if (query.kind === "should-not-report") {
        return queryShouldNotReport(graph, query);
    }
    if (query.kind === "duplicate") {
        return queryDuplicate(graph, query);
    }
    return queryShouldReport(graph, query);
}

export function queryTraceGraphMany(graph: TraceGraph, queries: FlowQuery[]): FlowQueryResult[] {
    return queries.map(query => queryTraceGraph(graph, query));
}

function queryShouldReport(graph: TraceGraph, query: FlowQuery): FlowQueryResult {
    const sourceMatches = query.source ? resolveSourceMatches(graph, query.source) : [];
    if (query.source && sourceMatches.length > 1) {
        return sourceAmbiguousResult(graph, query, sourceMatches);
    }
    const scopedLabels = sourceMatches.length > 0
        ? new Set(sourceMatches.map(fact => fact.label))
        : undefined;
    let lastReached: TraceFact | undefined;
    if (query.source) {
        if (sourceMatches.length === 0) {
            const nearby = nearbyFor(graph, undefined, query.source);
            return {
                queryId: query.id,
                kind: query.kind,
                verdict: "missing",
                firstMissing: query.source,
                primaryLayer: inferPrimaryLayer(nearby.edges, nearby.gates, nearby.coverage, query.source, query.sink),
                nearbyEdges: nearby.edges,
                nearbyGates: nearby.gates,
                nearbyCoverage: nearby.coverage,
                evidenceChain: buildEvidenceChain(undefined, nearby.edges, nearby.gates, nearby.coverage),
            };
        }
        lastReached = sourceMatches[0];
    }

    const path = [
        ...(query.expectedWaypoints || []),
        ...(query.sink ? [query.sink] : []),
    ];
    for (const waypoint of path) {
        const fact = findFact(graph, waypoint, scopedLabels);
        if (!fact) {
            const nearby = nearbyFor(graph, lastReached, waypoint, scopedLabels, { missingAfterReached: Boolean(lastReached) });
            return {
                queryId: query.id,
                kind: query.kind,
                verdict: "missing",
                lastReached,
                firstMissing: waypoint,
                primaryLayer: inferPrimaryLayer(nearby.edges, nearby.gates, nearby.coverage, waypoint, query.sink),
                nearbyEdges: nearby.edges,
                nearbyGates: nearby.gates,
                nearbyCoverage: nearby.coverage,
                evidenceChain: buildEvidenceChain(lastReached, nearby.edges, nearby.gates, nearby.coverage),
            };
        }
        lastReached = fact;
    }
    const nearby = nearbyFor(graph, lastReached, undefined, scopedLabels);
    return {
        queryId: query.id,
        kind: query.kind,
        verdict: "reached",
        lastReached,
        primaryLayer: inferPrimaryLayer(nearby.edges, nearby.gates, nearby.coverage),
        nearbyEdges: nearby.edges,
        nearbyGates: nearby.gates,
        nearbyCoverage: nearby.coverage,
        evidenceChain: buildEvidenceChain(lastReached, nearby.edges, nearby.gates, nearby.coverage),
    };
}

function queryShouldNotReport(graph: TraceGraph, query: FlowQuery): FlowQueryResult {
    const sourceMatches = query.source ? resolveSourceMatches(graph, query.source) : [];
    if (query.source && sourceMatches.length > 1) {
        return sourceAmbiguousResult(graph, query, sourceMatches);
    }
    const scopedLabels = sourceMatches.length > 0
        ? new Set(sourceMatches.map(fact => fact.label))
        : undefined;
    const forbidden = [
        ...(query.forbiddenWaypoints || []),
        ...(query.sink ? [query.sink] : []),
    ];
    for (const waypoint of forbidden) {
        const fact = findFact(graph, waypoint, scopedLabels);
        if (!fact) continue;
        const incoming = graph.edges.find(edge => edge.toFact === fact.id && edge.status === "emitted");
        const nearby = nearbyFor(graph, fact, waypoint, scopedLabels);
        return {
            queryId: query.id,
            kind: query.kind,
            verdict: "illegal-propagation",
            unexpectedReachedNode: fact,
            firstIllegalPropagation: incoming,
            responsibleEdge: incoming,
            primaryLayer: incoming?.stage || inferPrimaryLayer(nearby.edges, nearby.gates, nearby.coverage),
            whyNotAllowed: query.whyNotAllowed,
            nearbyEdges: nearby.edges,
            nearbyGates: nearby.gates,
            nearbyCoverage: nearby.coverage,
            evidenceChain: buildEvidenceChain(fact, nearby.edges, nearby.gates, nearby.coverage),
        };
    }
    const source = sourceMatches[0];
    const nearby = nearbyFor(graph, source, query.sink, scopedLabels);
    return {
        queryId: query.id,
        kind: query.kind,
        verdict: "reached",
        lastReached: source,
        primaryLayer: inferPrimaryLayer(nearby.edges, nearby.gates, nearby.coverage),
        whyNotAllowed: query.whyNotAllowed,
        nearbyEdges: nearby.edges,
        nearbyGates: nearby.gates,
        nearbyCoverage: nearby.coverage,
        evidenceChain: buildEvidenceChain(source, nearby.edges, nearby.gates, nearby.coverage),
    };
}

function sourceAmbiguousResult(
    graph: TraceGraph,
    query: FlowQuery,
    sourceMatches: TraceFact[],
): FlowQueryResult {
    const nearby = nearbyFor(graph, undefined, query.source);
    return {
        queryId: query.id,
        kind: query.kind,
        verdict: "source-ambiguous",
        firstMissing: query.source,
        sourceMatchCount: sourceMatches.length,
        ambiguousSourceMatches: sourceMatches.slice(0, 20),
        nearbyEdges: nearby.edges,
        nearbyGates: nearby.gates,
        nearbyCoverage: nearby.coverage,
        evidenceChain: [
            `source-ambiguous matches=${sourceMatches.length}`,
            ...sourceMatches.slice(0, 8).map(fact =>
                `candidate-source ${fact.id} label=${fact.label} node=${fact.pagNode} method=${fact.method || ""} value=${fact.value || ""}`,
            ),
            ...buildEvidenceChain(undefined, nearby.edges, nearby.gates, nearby.coverage),
        ],
    };
}

function queryDuplicate(graph: TraceGraph, query: FlowQuery): FlowQueryResult {
    const sinkMatches = query.sink
        ? graph.facts.filter(fact => matchesWaypoint(fact, query.sink!))
        : [];
    if (sinkMatches.length > 1) {
        const fact = sinkMatches[0];
        const nearby = nearbyFor(graph, fact, query.sink);
        return {
            queryId: query.id,
            kind: query.kind,
            verdict: "duplicate",
            unexpectedReachedNode: fact,
            primaryLayer: inferPrimaryLayer(nearby.edges, nearby.gates, nearby.coverage),
            nearbyEdges: nearby.edges,
            nearbyGates: nearby.gates,
            nearbyCoverage: nearby.coverage,
            evidenceChain: buildEvidenceChain(fact, nearby.edges, nearby.gates, nearby.coverage),
        };
    }
    return queryShouldReport(graph, { ...query, kind: "diagnostic" });
}

function findFact(
    graph: TraceGraph,
    waypoint: TraceWaypoint,
    scopedLabels?: Set<string>,
): TraceFact | undefined {
    return findFacts(graph, waypoint, scopedLabels)[0];
}

function resolveSourceMatches(graph: TraceGraph, waypoint: TraceWaypoint): TraceFact[] {
    const rawMatches = findFacts(graph, waypoint);
    if (rawMatches.length <= 1) return rawMatches;
    const emittedIncomingTargets = new Set(graph.edges
        .filter(edge => edge.status === "emitted" && edge.toFact)
        .map(edge => edge.toFact!));
    const seedLikeMatches = rawMatches.filter(fact => !emittedIncomingTargets.has(fact.id));
    return seedLikeMatches.length > 0 ? seedLikeMatches : rawMatches;
}

function findFacts(
    graph: TraceGraph,
    waypoint: TraceWaypoint,
    scopedLabels?: Set<string>,
): TraceFact[] {
    return graph.facts.filter(fact =>
        (!scopedLabels || scopedLabels.has(fact.label))
        && matchesWaypoint(fact, waypoint),
    );
}

function matchesWaypoint(fact: TraceFact, waypoint: TraceWaypoint): boolean {
    if (waypoint.id !== undefined && fact.id !== waypoint.id) return false;
    if (waypoint.pagNode !== undefined && fact.pagNode !== waypoint.pagNode) return false;
    if (waypoint.labelContains && !fact.label.includes(waypoint.labelContains)) return false;
    if (waypoint.methodContains && !textIncludesFragment(fact.method || "", waypoint.methodContains)) return false;
    if (waypoint.stmtContains && !textIncludesFragment(fact.stmt || "", waypoint.stmtContains)) return false;
    if (waypoint.valueContains && !textIncludesFragment(factValueSearchText(fact), waypoint.valueContains)) return false;
    if (waypoint.fieldPathContains && !textIncludesFragment((fact.fieldPath || []).join("."), waypoint.fieldPathContains)) return false;
    return true;
}

function factValueSearchText(fact: TraceFact): string {
    return [
        fact.value,
        fact.stmt,
        ...(fact.fieldPath || []),
    ].filter(Boolean).join(" ");
}

function nearbyFor(
    graph: TraceGraph,
    fact?: TraceFact,
    waypoint?: TraceWaypoint,
    scopedLabels?: Set<string>,
    options: { missingAfterReached?: boolean } = {},
): { edges: TraceEdge[]; gates: TraceGate[]; coverage: TraceCoverageRecord[] } {
    const factIds = new Set<string>();
    if (fact) factIds.add(fact.id);
    if (waypoint) {
        for (const candidate of findFacts(graph, waypoint, scopedLabels)) {
            factIds.add(candidate.id);
        }
    }
    const isMissingAfterReached = Boolean(options.missingAfterReached && fact && waypoint);
    const edges = graph.edges.filter(edge =>
        (isMissingAfterReached
            ? Boolean(edge.fromFact && factIds.has(edge.fromFact))
            : Boolean(
                (edge.fromFact && factIds.has(edge.fromFact))
                || (edge.toFact && factIds.has(edge.toFact)),
            ))
        || matchesTextByWaypoint(`${edge.reason} ${JSON.stringify(edge.evidence || {})}`, waypoint),
    ).slice(0, 40);
    const gates = graph.gates.filter(gate =>
        (isMissingAfterReached
            ? Boolean(gate.fromFact && factIds.has(gate.fromFact))
            : Boolean(
                (gate.fromFact && factIds.has(gate.fromFact))
                || (gate.toFact && factIds.has(gate.toFact)),
            ))
        || matchesGateByWaypoint(gate, waypoint),
    ).slice(0, 40);
    const coverage = (graph.coverage || []).filter(record =>
        matchesCoverageByWaypoint(record, waypoint)
        || (fact?.label && record.label === fact.label)
        || (waypoint?.labelContains && record.label?.includes(waypoint.labelContains))
    ).slice(0, 40);
    return { edges, gates, coverage };
}

function matchesGateByWaypoint(gate: TraceGate, waypoint?: TraceWaypoint): boolean {
    if (matchesSourceRuleZeroHitByWaypoint(
        gate.label,
        gate.scope,
        gate.skippedReason,
        gate.evidence,
        waypoint,
    )) {
        return true;
    }
    return matchesTextByWaypoint([
        gate.label,
        gate.scope,
        gate.skippedReason,
        gate.blockedReason,
        JSON.stringify(gate.evidence || {}),
    ].filter(Boolean).join(" "), waypoint);
}

function matchesCoverageByWaypoint(record: TraceCoverageRecord, waypoint?: TraceWaypoint): boolean {
    if (matchesSourceRuleZeroHitByWaypoint(
        record.label,
        record.subject,
        record.reason,
        record.evidence,
        waypoint,
    )) {
        return true;
    }
    return matchesTextByWaypoint(coverageSearchText(record), waypoint);
}

function matchesSourceRuleZeroHitByWaypoint(
    label: string | undefined,
    subject: string | undefined,
    reason: string | undefined,
    evidence: Record<string, unknown> | undefined,
    waypoint?: TraceWaypoint,
): boolean {
    if (!waypoint?.methodContains) return false;
    const skipped = reason === "source_rule_zero_hit"
        || String(evidence?.reason || "") === "source_rule_zero_hit";
    if (!skipped) return false;
    const methodText = [
        label,
        subject,
        String(evidence?.ruleId || ""),
        JSON.stringify((evidence as any)?.match || {}),
    ].filter(Boolean).join(" ");
    return textIncludesFragment(methodText, waypoint.methodContains);
}

function matchesTextByWaypoint(text: string, waypoint?: TraceWaypoint): boolean {
    const fragments = waypointSearchFragments(waypoint);
    if (fragments.length === 0) return false;
    return fragments.every(fragment => textIncludesFragment(text, fragment));
}

function textIncludesFragment(text: string, fragment: string): boolean {
    return textFragmentVariants(fragment).some(variant => text.includes(variant));
}

function textFragmentVariants(fragment: string): string[] {
    const variants = new Set<string>([fragment]);
    if (fragment.includes("[static]")) {
        variants.add(fragment.replace(/\.\[static\]/g, "."));
        variants.add(fragment.replace(/\[static\]/g, ""));
        variants.add(fragment.replace(/\.\[static\]/g, "._static_"));
        variants.add(fragment.replace(/\[static\]/g, "_static_"));
    }
    return [...variants].filter(item => item.length > 0);
}

function waypointSearchFragments(waypoint?: TraceWaypoint): string[] {
    if (!waypoint) return [];
    return [
        waypoint.labelContains,
        waypoint.methodContains,
        waypoint.stmtContains,
        waypoint.valueContains,
        waypoint.fieldPathContains,
        waypoint.pagNode === undefined ? undefined : String(waypoint.pagNode),
    ].filter((item): item is string => Boolean(item && item.length > 0));
}

function inferPrimaryLayer(
    edges: TraceEdge[],
    gates: TraceGate[],
    coverage: TraceCoverageRecord[] = [],
    firstMissing?: TraceWaypoint,
    sink?: TraceWaypoint,
): TraceStage | undefined {
    const negativeCoverage = selectPrimaryCoverage(coverage, firstMissing, sink);
    if (negativeCoverage) return negativeCoverage.stage;
    const blockedGate = gates.find(gate => gate.blockedReason || gate.skippedReason);
    if (blockedGate) return blockedGate.stage;
    const blockedEdge = edges.find(edge => edge.status !== "emitted");
    if (blockedEdge) return blockedEdge.stage;
    return edges[0]?.stage || gates[0]?.stage;
}

function selectPrimaryCoverage(
    coverage: TraceCoverageRecord[] = [],
    firstMissing?: TraceWaypoint,
    sink?: TraceWaypoint,
): TraceCoverageRecord | undefined {
    const negativeCoverage = coverage.filter(record =>
        record.status === "gap"
        || record.status === "blocked"
        || record.status === "failed"
        || record.status === "skipped",
    );
    const zeroHitSourceSeed = negativeCoverage.find(record => isSourceRuleZeroHitCoverage(record));
    if (zeroHitSourceSeed) return zeroHitSourceSeed;
    const firstMissingIsSink = Boolean(sink && firstMissing && sameWaypoint(sink, firstMissing));
    const preferredKinds: Array<TraceCoverageRecord["kind"]> = firstMissingIsSink
        ? [
            "sink_candidate",
            "coverage_query",
            "semanticflow_candidate",
            "llm_batch",
            "llm_output",
            "asset_validation",
            "asset_promotion",
            "asset_lowering",
            "source_seed",
            "entry_recovery",
        ]
        : [
            "coverage_query",
            "semanticflow_candidate",
            "llm_batch",
            "llm_output",
            "asset_validation",
            "asset_promotion",
            "asset_lowering",
            "source_seed",
            "entry_recovery",
            "sink_candidate",
        ];
    for (const kind of preferredKinds) {
        const match = negativeCoverage.find(record => record.kind === kind);
        if (match) return match;
    }
    return negativeCoverage[0] || coverage.find(record => record.status === "queued");
}

function isSourceRuleZeroHitCoverage(record: TraceCoverageRecord): boolean {
    return record.kind === "source_seed"
        && record.reason === "source_rule_zero_hit";
}

function sameWaypoint(a: TraceWaypoint, b: TraceWaypoint): boolean {
    return a.id === b.id
        && a.labelContains === b.labelContains
        && a.methodContains === b.methodContains
        && a.stmtContains === b.stmtContains
        && a.valueContains === b.valueContains
        && a.fieldPathContains === b.fieldPathContains
        && a.pagNode === b.pagNode;
}

function buildEvidenceChain(
    fact: TraceFact | undefined,
    edges: TraceEdge[],
    gates: TraceGate[],
    coverage: TraceCoverageRecord[] = [],
): string[] {
    const chain: string[] = [];
    if (fact) {
        chain.push(`fact ${fact.id} label=${fact.label} node=${fact.pagNode}`);
    }
    for (const edge of edges.slice(0, 8)) {
        chain.push(`edge ${edge.id} ${edge.status} ${edge.stage}/${edge.producer}: ${edge.reason}`);
    }
    for (const gate of gates.slice(0, 8)) {
        const reason = gate.blockedReason || gate.skippedReason || "matched";
        chain.push(`gate ${gate.id} ${gate.stage}/${gate.producer}: ${reason}`);
    }
    for (const record of coverage.slice(0, 8)) {
        chain.push(`coverage ${record.id} ${record.kind}/${record.stage} status=${record.status} subject=${record.subject}${record.reason ? ` reason=${record.reason}` : ""}`);
    }
    return chain;
}

function coverageSearchText(record: TraceCoverageRecord): string {
    return [
        record.subject,
        record.label,
        record.role,
        record.endpoint,
        record.surfaceId,
        record.assetId,
        record.reason,
        JSON.stringify(record.evidence || {}),
    ].filter(Boolean).join(" ");
}
