import { FlowQuery, FlowQueryResult, queryTraceGraphMany } from "./TraceGraphQuery";
import { TraceCoverageRecord, TraceEdge, TraceFact, TraceGate, TraceGraph } from "./TraceGraph";

export interface TraceDiff {
    beforeRunId: string;
    afterRunId: string;
    addedFacts: TraceFact[];
    removedFacts: TraceFact[];
    addedEdges: TraceEdge[];
    removedEdges: TraceEdge[];
    addedGates: TraceGate[];
    removedGates: TraceGate[];
    addedCoverage: TraceCoverageRecord[];
    removedCoverage: TraceCoverageRecord[];
    flowQueryDiffs: FlowQueryDiff[];
    summary: {
        addedFactCount: number;
        removedFactCount: number;
        addedEdgeCount: number;
        removedEdgeCount: number;
        addedGateCount: number;
        removedGateCount: number;
        addedCoverageCount: number;
        removedCoverageCount: number;
        closedCoverageGaps: number;
        newCoverageGaps: number;
        closedQueries: number;
        regressedQueries: number;
        movedQueries: number;
    };
}

export interface FlowQueryDiff {
    queryId: string;
    before: FlowQueryResult;
    after: FlowQueryResult;
    change: "closed" | "regressed" | "moved" | "unchanged";
    reason: string;
}

export function diffTraceGraphs(before: TraceGraph, after: TraceGraph, queries: FlowQuery[] = []): TraceDiff {
    const beforeFacts = new Map(before.facts.map(fact => [factKey(fact), fact]));
    const afterFacts = new Map(after.facts.map(fact => [factKey(fact), fact]));
    const beforeEdges = new Map(before.edges.map(edge => [edgeKey(edge), edge]));
    const afterEdges = new Map(after.edges.map(edge => [edgeKey(edge), edge]));
    const beforeGates = new Map(before.gates.map(gate => [gateKey(gate), gate]));
    const afterGates = new Map(after.gates.map(gate => [gateKey(gate), gate]));
    const beforeCoverage = new Map((before.coverage || []).map(record => [coverageKey(record), record]));
    const afterCoverage = new Map((after.coverage || []).map(record => [coverageKey(record), record]));

    const beforeResults = queryTraceGraphMany(before, queries);
    const afterResults = queryTraceGraphMany(after, queries);
    const flowQueryDiffs = beforeResults.map((result, index) => classifyFlowQueryDiff(result, afterResults[index]));

    return {
        beforeRunId: before.run.runId,
        afterRunId: after.run.runId,
        addedFacts: difference(afterFacts, beforeFacts),
        removedFacts: difference(beforeFacts, afterFacts),
        addedEdges: difference(afterEdges, beforeEdges),
        removedEdges: difference(beforeEdges, afterEdges),
        addedGates: difference(afterGates, beforeGates),
        removedGates: difference(beforeGates, afterGates),
        addedCoverage: difference(afterCoverage, beforeCoverage),
        removedCoverage: difference(beforeCoverage, afterCoverage),
        flowQueryDiffs,
        summary: {
            addedFactCount: difference(afterFacts, beforeFacts).length,
            removedFactCount: difference(beforeFacts, afterFacts).length,
            addedEdgeCount: difference(afterEdges, beforeEdges).length,
            removedEdgeCount: difference(beforeEdges, afterEdges).length,
            addedGateCount: difference(afterGates, beforeGates).length,
            removedGateCount: difference(beforeGates, afterGates).length,
            addedCoverageCount: difference(afterCoverage, beforeCoverage).length,
            removedCoverageCount: difference(beforeCoverage, afterCoverage).length,
            closedCoverageGaps: countClosedCoverageGaps(before.coverage || [], after.coverage || []),
            newCoverageGaps: countClosedCoverageGaps(after.coverage || [], before.coverage || []),
            closedQueries: flowQueryDiffs.filter(item => item.change === "closed").length,
            regressedQueries: flowQueryDiffs.filter(item => item.change === "regressed").length,
            movedQueries: flowQueryDiffs.filter(item => item.change === "moved").length,
        },
    };
}

function countClosedCoverageGaps(before: TraceCoverageRecord[], after: TraceCoverageRecord[]): number {
    const afterOpen = new Set(after
        .filter(record => isOpenCoverageGap(record))
        .map(record => coverageSubjectKey(record)));
    return before
        .filter(record => isOpenCoverageGap(record))
        .filter(record => !afterOpen.has(coverageSubjectKey(record)))
        .length;
}

function isOpenCoverageGap(record: TraceCoverageRecord): boolean {
    return record.status === "gap"
        || record.status === "blocked"
        || record.status === "failed"
        || record.status === "skipped";
}

function difference<T>(a: Map<string, T>, b: Map<string, T>): T[] {
    const out: T[] = [];
    for (const [key, value] of a.entries()) {
        if (!b.has(key)) out.push(value);
    }
    return out;
}

function classifyFlowQueryDiff(before: FlowQueryResult, after: FlowQueryResult): FlowQueryDiff {
    if (before.verdict !== "reached" && after.verdict === "reached") {
        return {
            queryId: before.queryId,
            before,
            after,
            change: "closed",
            reason: `verdict changed ${before.verdict} -> ${after.verdict}`,
        };
    }
    if (before.verdict === "reached" && after.verdict !== "reached") {
        return {
            queryId: before.queryId,
            before,
            after,
            change: "regressed",
            reason: `verdict changed ${before.verdict} -> ${after.verdict}`,
        };
    }
    if (
        before.firstMissing?.id !== after.firstMissing?.id
        || before.firstMissing?.methodContains !== after.firstMissing?.methodContains
        || before.firstMissing?.stmtContains !== after.firstMissing?.stmtContains
        || before.firstMissing?.valueContains !== after.firstMissing?.valueContains
        || before.firstMissing?.fieldPathContains !== after.firstMissing?.fieldPathContains
        || before.primaryLayer !== after.primaryLayer
    ) {
        return {
            queryId: before.queryId,
            before,
            after,
            change: "moved",
            reason: "breakpoint or primary layer changed",
        };
    }
    return {
        queryId: before.queryId,
        before,
        after,
        change: "unchanged",
        reason: "no query-level graph change",
    };
}

function factKey(fact: TraceFact): string {
    return [
        fact.label,
        fact.pagNode,
        fact.context,
        (fact.fieldPath || []).join("."),
        fact.method || "",
        fact.stmt || "",
        fact.value || "",
    ].join("\u0001");
}

function edgeKey(edge: TraceEdge): string {
    return [
        edge.fromFact || "",
        edge.toFact || "",
        edge.stage,
        edge.producer,
        edge.status,
        edge.reason,
        JSON.stringify(edge.evidence || {}),
    ].join("\u0001");
}

function gateKey(gate: TraceGate): string {
    return [
        gate.label || "",
        gate.fromFact || "",
        gate.toFact || "",
        gate.stage,
        gate.producer,
        String(gate.attempted),
        String(gate.matched),
        String(gate.emitted),
        gate.skippedReason || "",
        gate.blockedReason || "",
        JSON.stringify(gate.evidence || {}),
    ].join("\u0001");
}

function coverageKey(record: TraceCoverageRecord): string {
    return [
        record.kind,
        record.stage,
        record.producer,
        record.subject,
        record.status,
        record.label || "",
        record.role || "",
        record.endpoint || "",
        record.surfaceId || "",
        record.assetId || "",
        record.reason || "",
        JSON.stringify(record.evidence || {}),
    ].join("\u0001");
}

function coverageSubjectKey(record: TraceCoverageRecord): string {
    return [
        record.kind,
        record.stage,
        record.subject,
        record.label || "",
        record.role || "",
        record.endpoint || "",
        record.surfaceId || "",
        record.assetId || "",
    ].join("\u0001");
}
