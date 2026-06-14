import * as fs from "fs";
import * as path from "path";
import { TaintFact } from "../kernel/model/TaintFact";
import { TaintFlow } from "../kernel/model/TaintFlow";

export type TraceEdgeStatus = "emitted" | "blocked" | "skipped";
export type TraceGraphView = "taint_fact" | "semantic_coverage";

export type TraceProducer =
    | "preanalysis"
    | "coverage_ledger"
    | "semanticflow"
    | "asset"
    | "entry"
    | "rule"
    | "ordinary"
    | "module"
    | "OCLFS"
    | "UDE"
    | "provenance"
    | "sink"
    | "reporting"
    | "postsolve";

export type TraceStage =
    | "preanalysis"
    | "coverage_ledger"
    | "semanticflow"
    | "semanticflow_llm"
    | "asset_validation"
    | "asset_promotion"
    | "asset_lowering"
    | "entry_recovery"
    | "source_seed"
    | "ordinary"
    | "rule"
    | "module_lowering"
    | "module"
    | "OCLFS"
    | "UDE"
    | "sink_candidate"
    | "sink"
    | "provenance"
    | "reporting"
    | "postsolve";

export type TraceGateKind =
    | "observed_surface"
    | "coverage"
    | "coverage_query"
    | "candidate"
    | "llm_batch"
    | "llm_output"
    | "validation"
    | "promotion"
    | "asset_lowering"
    | "entry_recovery"
    | "seed"
    | "propagation"
    | "lowering"
    | "effect"
    | "currentness"
    | "deferred"
    | "sink_candidate"
    | "sink_match"
    | "path_materialization"
    | "report_emission"
    | "postsolve_decision";

export interface FullTraceRun {
    runId: string;
    project: string;
    engineVersion: string;
    assetVersion: string;
    configHash: string;
    llmSession?: string;
    startedAt: string;
    completedAt?: string;
    status: "completed" | "completed_with_errors" | "partial" | "failed";
    notes?: string[];
}

export interface TraceFact {
    id: string;
    label: string;
    pagNode: number;
    context: number;
    fieldPath?: string[];
    method?: string;
    stmt?: string;
    value?: string;
}

export interface TraceEdge {
    id: string;
    fromFact?: string;
    toFact?: string;
    stage: TraceStage;
    reason: string;
    status: TraceEdgeStatus;
    producer: TraceProducer;
    evidence?: Record<string, unknown>;
}

export interface TraceGate {
    id: string;
    label?: string;
    fromFact?: string;
    toFact?: string;
    stage: TraceStage;
    producer: TraceProducer;
    gateKind?: TraceGateKind;
    scope?: string;
    attempted: boolean;
    matched: boolean;
    emitted: boolean;
    skippedReason?: string;
    blockedReason?: string;
    evidence?: Record<string, unknown>;
}

export type TraceCoverageStatus =
    | "observed"
    | "covered"
    | "gap"
    | "queued"
    | "emitted"
    | "skipped"
    | "blocked"
    | "failed";

export type TraceCoverageKind =
    | "observed_surface"
    | "coverage_query"
    | "semanticflow_candidate"
    | "llm_batch"
    | "llm_output"
    | "asset_validation"
    | "asset_promotion"
    | "asset_lowering"
    | "entry_recovery"
    | "source_seed"
    | "sink_candidate";

export interface TraceCoverageRecord {
    id: string;
    kind: TraceCoverageKind;
    stage: TraceStage;
    producer: TraceProducer;
    subject: string;
    status: TraceCoverageStatus;
    gateId?: string;
    label?: string;
    role?: string;
    endpoint?: string;
    surfaceId?: string;
    assetId?: string;
    reason?: string;
    evidence?: Record<string, unknown>;
}

export interface TraceGraph {
    format: "arktaint-full-trace-graph";
    run: FullTraceRun;
    facts: TraceFact[];
    edges: TraceEdge[];
    gates: TraceGate[];
    coverage: TraceCoverageRecord[];
    views: {
        taintFactGraph: {
            factCount: number;
            edgeCount: number;
            emittedEdges: number;
            blockedEdges: number;
            skippedEdges: number;
        };
        semanticCoverageGraph: {
            coverageCount: number;
            gateCount: number;
            gapCount: number;
            blockedCount: number;
            skippedCount: number;
            stages: TraceStage[];
        };
    };
    summary: {
        factCount: number;
        edgeCount: number;
        gateCount: number;
        coverageCount: number;
        labels: number;
        emittedEdges: number;
        blockedEdges: number;
        skippedEdges: number;
        coverageGaps: number;
    };
}

export interface TraceGraphRecorderOptions {
    run?: Partial<FullTraceRun>;
}

export class TraceGraphRecorder {
    private readonly run: FullTraceRun;
    private readonly facts = new Map<string, TraceFact>();
    private readonly edgeKeys = new Set<string>();
    private readonly gateKeys = new Set<string>();
    private readonly edges: TraceEdge[] = [];
    private readonly gates: TraceGate[] = [];
    private readonly coverageKeys = new Set<string>();
    private readonly coverage: TraceCoverageRecord[] = [];

    constructor(options: TraceGraphRecorderOptions = {}) {
        const now = new Date().toISOString();
        this.run = {
            runId: options.run?.runId || `trace-${Date.now()}`,
            project: options.run?.project || "unknown",
            engineVersion: options.run?.engineVersion || "unknown",
            assetVersion: options.run?.assetVersion || "unknown",
            configHash: options.run?.configHash || "unknown",
            llmSession: options.run?.llmSession,
            startedAt: options.run?.startedAt || now,
            completedAt: options.run?.completedAt,
            status: options.run?.status || "partial",
            notes: options.run?.notes ? [...options.run.notes] : undefined,
        };
    }

    public recordFact(fact: TaintFact): TraceFact {
        const view = factToTraceFact(fact);
        if (!this.facts.has(view.id)) {
            this.facts.set(view.id, view);
        }
        return this.facts.get(view.id)!;
    }

    public recordEdge(
        from: TaintFact | undefined,
        to: TaintFact | undefined,
        args: {
            reason: string;
            status?: TraceEdgeStatus;
            stage?: TraceStage;
            producer?: TraceProducer;
            evidence?: Record<string, unknown>;
        },
    ): TraceEdge | undefined {
        const status = args.status || "emitted";
        const classified = classifyTraceReason(args.reason, args.evidence);
        const stage = args.stage || classified.stage;
        const producer = args.producer || classified.producer;
        const fromFact = from ? this.recordFact(from).id : undefined;
        const toFact = to ? this.recordFact(to).id : undefined;
        const key = [
            fromFact || "",
            toFact || "",
            stage,
            status,
            producer,
            args.reason,
        ].join("\u0001");
        if (this.edgeKeys.has(key)) return undefined;
        this.edgeKeys.add(key);
        const edge: TraceEdge = {
            id: `edge:${this.edges.length + 1}`,
            fromFact,
            toFact,
            stage,
            reason: args.reason,
            status,
            producer,
            evidence: args.evidence,
        };
        this.edges.push(edge);
        return edge;
    }

    public recordGate(args: Omit<TraceGate, "id">): TraceGate | undefined {
        const key = [
            args.label || "",
            args.fromFact || "",
            args.toFact || "",
            args.stage,
            args.producer,
            args.gateKind || "",
            args.scope || "",
            String(args.attempted),
            String(args.matched),
            String(args.emitted),
            args.skippedReason || "",
            args.blockedReason || "",
        ].join("\u0001");
        if (this.gateKeys.has(key)) return undefined;
        this.gateKeys.add(key);
        const gate: TraceGate = {
            id: `gate:${this.gates.length + 1}`,
            ...args,
        };
        this.gates.push(gate);
        return gate;
    }

    public recordPropagationGate(
        from: TaintFact | undefined,
        to: TaintFact | undefined,
        args: {
            reason: string;
            status?: TraceEdgeStatus;
            stage?: TraceStage;
            producer?: TraceProducer;
            gateKind?: TraceGateKind;
            attempted?: boolean;
            matched?: boolean;
            emitted?: boolean;
            skippedReason?: string;
            blockedReason?: string;
            evidence?: Record<string, unknown>;
        },
    ): TraceGate | undefined {
        const status = args.status || "emitted";
        const classified = classifyTraceReason(args.reason, args.evidence);
        const stage = args.stage || classified.stage;
        const producer = args.producer || classified.producer;
        const fromFact = from ? this.recordFact(from).id : undefined;
        const toFact = to ? this.recordFact(to).id : undefined;
        return this.recordGate({
            label: from?.source || to?.source,
            fromFact,
            toFact,
            stage,
            producer,
            gateKind: args.gateKind || defaultGateKindForStage(stage),
            scope: args.reason,
            attempted: args.attempted ?? true,
            matched: args.matched ?? status === "emitted",
            emitted: args.emitted ?? status === "emitted",
            skippedReason: args.skippedReason || (status === "skipped" ? stringEvidence(args.evidence, "skippedReason") : undefined),
            blockedReason: args.blockedReason || (status === "blocked" ? stringEvidence(args.evidence, "blockedReason") : undefined),
            evidence: {
                ...args.evidence,
                reason: args.reason,
            },
        });
    }

    public recordCoverage(args: Omit<TraceCoverageRecord, "id">): TraceCoverageRecord | undefined {
        const key = coverageKey(args);
        if (this.coverageKeys.has(key)) return undefined;
        this.coverageKeys.add(key);
        const record: TraceCoverageRecord = {
            id: `coverage:${this.coverage.length + 1}`,
            ...args,
        };
        this.coverage.push(record);
        return record;
    }

    public recordAuditGate(args: {
        stage: TraceStage;
        producer: TraceProducer;
        gateKind?: TraceGateKind;
        label?: string;
        fromFact?: string;
        toFact?: string;
        scope?: string;
        attempted: boolean;
        matched: boolean;
        emitted: boolean;
        skippedReason?: string;
        blockedReason?: string;
        evidence?: Record<string, unknown>;
    }): TraceGate | undefined {
        return this.recordGate({
            ...args,
            gateKind: args.gateKind || defaultGateKindForStage(args.stage),
        });
    }

    public recordSinkFlow(flow: TaintFlow): void {
        this.recordEdge(undefined, undefined, {
            reason: flow.sinkRuleId ? `sink-hit:${flow.sinkRuleId}` : "sink-hit",
            status: "emitted",
            stage: "sink",
            producer: "sink",
            evidence: {
                source: flow.source,
                sink: flow.sink.toString(),
                sinkFactId: flow.sinkFactId,
                sinkNodeId: flow.sinkNodeId,
                sinkFieldPath: flow.sinkFieldPath,
                sinkEndpoint: flow.sinkEndpoint,
            },
        });
        this.recordGate({
            label: flow.source,
            toFact: flow.sinkFactId,
            stage: "sink",
            producer: "sink",
            gateKind: "sink_match",
            scope: flow.sinkFactId ? `sink:${flow.sinkFactId}` : `sink:${flow.toString()}`,
            attempted: true,
            matched: true,
            emitted: true,
            evidence: {
                sink: flow.sink.toString(),
                sinkRuleId: flow.sinkRuleId,
                sinkEndpoint: flow.sinkEndpoint,
            },
        });
    }

    public recordPostsolveDecision(args: {
        flowId?: string;
        sinkFactId?: string;
        label?: string;
        judgement: string;
        reason?: string;
        evidence?: Record<string, unknown>;
    }): void {
        const refuted = args.judgement === "Refuted-Strong" || args.judgement === "Refuted-Weak";
        this.recordEdge(undefined, undefined, {
            reason: args.reason || `postsolve:${args.judgement}`,
            status: refuted ? "blocked" : "emitted",
            stage: "postsolve",
            producer: "postsolve",
            evidence: {
                ...args.evidence,
                flowId: args.flowId,
                sinkFactId: args.sinkFactId,
                judgement: args.judgement,
            },
        });
        this.recordGate({
            label: args.label,
            toFact: args.sinkFactId,
            stage: "postsolve",
            producer: "postsolve",
            gateKind: "postsolve_decision",
            scope: args.sinkFactId ? `postsolve:${args.sinkFactId}` : (args.flowId ? `postsolve:${args.flowId}` : "postsolve"),
            attempted: true,
            matched: true,
            emitted: !refuted,
            blockedReason: refuted ? args.judgement : undefined,
            evidence: args.evidence,
        });
    }

    public snapshot(overrides: Partial<FullTraceRun> = {}): TraceGraph {
        const run: FullTraceRun = {
            ...this.run,
            ...overrides,
            completedAt: overrides.completedAt || this.run.completedAt || new Date().toISOString(),
        };
        return buildTraceGraph(run, [...this.facts.values()], [...this.edges], [...this.gates], [...this.coverage]);
    }
}

export function buildTraceGraph(
    run: FullTraceRun,
    facts: TraceFact[],
    edges: TraceEdge[],
    gates: TraceGate[],
    coverage: TraceCoverageRecord[] = [],
): TraceGraph {
    const labels = new Set(facts.map(fact => fact.label));
    const inferredCoverage = inferCoverageFromGates(gates);
    const coverageRecords = dedupeCoverageRecords([...coverage, ...inferredCoverage]);
    const semanticCoverageStages = [...new Set(coverageRecords.map(record => record.stage))].sort();
    const emittedEdges = edges.filter(edge => edge.status === "emitted").length;
    const blockedEdges = edges.filter(edge => edge.status === "blocked").length;
    const skippedEdges = edges.filter(edge => edge.status === "skipped").length;
    return {
        format: "arktaint-full-trace-graph",
        run,
        facts,
        edges,
        gates,
        coverage: coverageRecords,
        views: {
            taintFactGraph: {
                factCount: facts.length,
                edgeCount: edges.length,
                emittedEdges,
                blockedEdges,
                skippedEdges,
            },
            semanticCoverageGraph: {
                coverageCount: coverageRecords.length,
                gateCount: gates.filter(gate => isSemanticCoverageStage(gate.stage)).length,
                gapCount: coverageRecords.filter(record => record.status === "gap").length,
                blockedCount: coverageRecords.filter(record => record.status === "blocked" || record.status === "failed").length,
                skippedCount: coverageRecords.filter(record => record.status === "skipped").length,
                stages: semanticCoverageStages,
            },
        },
        summary: {
            factCount: facts.length,
            edgeCount: edges.length,
            gateCount: gates.length,
            coverageCount: coverageRecords.length,
            labels: labels.size,
            emittedEdges,
            blockedEdges,
            skippedEdges,
            coverageGaps: coverageRecords.filter(record => record.status === "gap").length,
        },
    };
}

export function mergeTraceGraphs(
    run: FullTraceRun,
    graphs: Array<{ graph: TraceGraph; prefix: string }>,
): TraceGraph {
    const facts: TraceFact[] = [];
    const edges: TraceEdge[] = [];
    const gates: TraceGate[] = [];
    const coverage: TraceCoverageRecord[] = [];

    for (const item of graphs) {
        const factIdMap = new Map<string, string>();
        for (const fact of item.graph.facts) {
            const id = `${item.prefix}:${fact.id}`;
            factIdMap.set(fact.id, id);
            facts.push({ ...fact, id });
        }
        for (const edge of item.graph.edges) {
            edges.push({
                ...edge,
                id: `${item.prefix}:${edge.id}`,
                fromFact: edge.fromFact ? factIdMap.get(edge.fromFact) || `${item.prefix}:${edge.fromFact}` : undefined,
                toFact: edge.toFact ? factIdMap.get(edge.toFact) || `${item.prefix}:${edge.toFact}` : undefined,
            });
        }
        for (const gate of item.graph.gates) {
            gates.push({
                ...gate,
                id: `${item.prefix}:${gate.id}`,
                fromFact: gate.fromFact ? factIdMap.get(gate.fromFact) || `${item.prefix}:${gate.fromFact}` : undefined,
                toFact: gate.toFact ? factIdMap.get(gate.toFact) || `${item.prefix}:${gate.toFact}` : undefined,
            });
        }
        for (const record of item.graph.coverage || []) {
            coverage.push({
                ...record,
                id: `${item.prefix}:${record.id}`,
                gateId: record.gateId ? `${item.prefix}:${record.gateId}` : undefined,
            });
        }
    }

    return buildTraceGraph(run, facts, edges, gates, coverage);
}

export function appendTraceGraphFragments(
    base: TraceGraph,
    fragments: Array<{ graph: TraceGraph; prefix: string }>,
): TraceGraph {
    const facts: TraceFact[] = [...base.facts];
    const edges: TraceEdge[] = [...base.edges];
    const gates: TraceGate[] = [...base.gates];
    const coverage: TraceCoverageRecord[] = [...(base.coverage || [])];

    for (const item of fragments) {
        const factIdMap = new Map<string, string>();
        for (const fact of item.graph.facts) {
            const id = `${item.prefix}:${fact.id}`;
            factIdMap.set(fact.id, id);
            facts.push({ ...fact, id });
        }
        for (const edge of item.graph.edges) {
            edges.push({
                ...edge,
                id: `${item.prefix}:${edge.id}`,
                fromFact: edge.fromFact ? factIdMap.get(edge.fromFact) || `${item.prefix}:${edge.fromFact}` : undefined,
                toFact: edge.toFact ? factIdMap.get(edge.toFact) || `${item.prefix}:${edge.toFact}` : undefined,
            });
        }
        for (const gate of item.graph.gates) {
            gates.push({
                ...gate,
                id: `${item.prefix}:${gate.id}`,
                fromFact: gate.fromFact ? factIdMap.get(gate.fromFact) || `${item.prefix}:${gate.fromFact}` : undefined,
                toFact: gate.toFact ? factIdMap.get(gate.toFact) || `${item.prefix}:${gate.toFact}` : undefined,
            });
        }
        for (const record of item.graph.coverage || []) {
            coverage.push({
                ...record,
                id: `${item.prefix}:${record.id}`,
                gateId: record.gateId ? `${item.prefix}:${record.gateId}` : undefined,
            });
        }
    }

    return buildTraceGraph(base.run, facts, edges, gates, coverage);
}

export function writeTraceGraphArtifacts(outputDir: string, graph: TraceGraph): { jsonPath: string; markdownPath: string } {
    fs.mkdirSync(outputDir, { recursive: true });
    const jsonPath = path.join(outputDir, "full_trace_graph.json");
    const markdownPath = path.join(outputDir, "full_trace_graph.md");
    fs.writeFileSync(jsonPath, JSON.stringify(graph, null, 2), "utf-8");
    fs.writeFileSync(markdownPath, renderTraceGraphMarkdown(graph), "utf-8");
    return { jsonPath, markdownPath };
}

export function renderTraceGraphMarkdown(graph: TraceGraph): string {
    const lines: string[] = [];
    lines.push("# ArkTaint Full Trace Graph");
    lines.push("");
    lines.push(`- Run: ${graph.run.runId}`);
    lines.push(`- Project: ${graph.run.project}`);
    lines.push(`- Status: ${graph.run.status}`);
    lines.push(`- Facts: ${graph.summary.factCount}`);
    lines.push(`- Edges: ${graph.summary.edgeCount}`);
    lines.push(`- Gates: ${graph.summary.gateCount}`);
    lines.push(`- Coverage records: ${graph.summary.coverageCount}`);
    lines.push(`- Coverage gaps: ${graph.summary.coverageGaps}`);
    lines.push(`- Labels: ${graph.summary.labels}`);
    lines.push("");
    lines.push("## Edge Status");
    lines.push("");
    lines.push(`- emitted: ${graph.summary.emittedEdges}`);
    lines.push(`- blocked: ${graph.summary.blockedEdges}`);
    lines.push(`- skipped: ${graph.summary.skippedEdges}`);
    lines.push("");
    lines.push("## Semantic Coverage Graph");
    lines.push("");
    lines.push(`- records: ${graph.views.semanticCoverageGraph.coverageCount}`);
    lines.push(`- gaps: ${graph.views.semanticCoverageGraph.gapCount}`);
    lines.push(`- blocked/failed: ${graph.views.semanticCoverageGraph.blockedCount}`);
    lines.push(`- skipped: ${graph.views.semanticCoverageGraph.skippedCount}`);
    lines.push(`- stages: ${graph.views.semanticCoverageGraph.stages.join(", ") || "none"}`);
    return lines.join("\n");
}

function factToTraceFact(fact: TaintFact): TraceFact {
    const node: any = fact.node;
    const value = node.getValue?.();
    const stmt = node.getStmt?.() || value?.getDeclaringStmt?.();
    const method = stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()
        || value?.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.();
    return {
        id: fact.taintId,
        label: fact.source,
        pagNode: Number(fact.node.getID()),
        context: Number(fact.contextID),
        fieldPath: fact.field ? [...fact.field] : undefined,
        method: method ? String(method) : undefined,
        stmt: stmt ? String(stmt) : undefined,
        value: value ? String(value) : undefined,
    };
}

export function classifyTraceReason(reason: string, evidence?: Record<string, unknown>): { stage: TraceStage; producer: TraceProducer } {
    const text = `${reason || ""} ${JSON.stringify(evidence || {})}`.toLowerCase();
    if (text.includes("postsolve")) return { stage: "postsolve", producer: "postsolve" };
    if (text.includes("report")) return { stage: "reporting", producer: "reporting" };
    if (text.includes("sink candidate") || text.includes("sink_candidate")) return { stage: "sink_candidate", producer: "sink" };
    if (text.includes("sink")) return { stage: "sink", producer: "sink" };
    if (text.includes("materialization") || text.includes("pathmaterial") || text.includes("path-gap")) {
        return { stage: "provenance", producer: "provenance" };
    }
    if (text.includes("currentness") || text.includes("oclfs")) return { stage: "OCLFS", producer: "OCLFS" };
    if (text.includes("asset lowering") || text.includes("asset_lowering")) return { stage: "asset_lowering", producer: "asset" };
    if (text.includes("entry recovery") || text.includes("entry_recovery") || text.includes("arkmain")) return { stage: "entry_recovery", producer: "entry" };
    if (text.includes("coverage ledger") || text.includes("coverage_ledger")) return { stage: "coverage_ledger", producer: "coverage_ledger" };
    if (text.includes("llm output") || text.includes("llm_output") || text.includes("llm batch") || text.includes("llm_batch")) {
        return { stage: "semanticflow_llm", producer: "semanticflow" };
    }
    if (text.includes("lowering")) return { stage: "module_lowering", producer: "module" };
    if (text.includes("module")) return { stage: "module", producer: "module" };
    if (text.includes("ude") || text.includes("handoff") || text.includes("synthetic") || text.includes("capture")) {
        return { stage: "UDE", producer: "UDE" };
    }
    if (text.includes("semanticflow") || text.includes("llm")) return { stage: "semanticflow", producer: "semanticflow" };
    if (text.includes("asset validation") || text.includes("schema") || text.includes("promotion")) {
        return { stage: text.includes("promotion") ? "asset_promotion" : "asset_validation", producer: "asset" };
    }
    if (text.includes("source") && text.includes("seed")) return { stage: "source_seed", producer: "rule" };
    if (text.includes("rule") || text.includes("transfer")) return { stage: "rule", producer: "rule" };
    return { stage: "ordinary", producer: "ordinary" };
}

function defaultGateKindForStage(stage: TraceStage): TraceGateKind {
    switch (stage) {
        case "preanalysis":
            return "observed_surface";
        case "coverage_ledger":
            return "coverage_query";
        case "semanticflow_llm":
            return "llm_output";
        case "asset_lowering":
            return "asset_lowering";
        case "entry_recovery":
            return "entry_recovery";
        case "sink_candidate":
            return "sink_candidate";
        case "semanticflow":
            return "candidate";
        case "asset_validation":
            return "validation";
        case "asset_promotion":
            return "promotion";
        case "source_seed":
            return "seed";
        case "rule":
        case "ordinary":
            return "propagation";
        case "module_lowering":
            return "lowering";
        case "module":
            return "effect";
        case "OCLFS":
            return "currentness";
        case "UDE":
            return "deferred";
        case "sink":
            return "sink_match";
        case "provenance":
            return "path_materialization";
        case "reporting":
            return "report_emission";
        case "postsolve":
            return "postsolve_decision";
    }
}

function stringEvidence(evidence: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = evidence?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isSemanticCoverageStage(stage: TraceStage): boolean {
    switch (stage) {
        case "preanalysis":
        case "coverage_ledger":
        case "semanticflow":
        case "semanticflow_llm":
        case "asset_validation":
        case "asset_promotion":
        case "asset_lowering":
        case "entry_recovery":
        case "source_seed":
        case "sink_candidate":
        case "module_lowering":
            return true;
        default:
            return false;
    }
}

function coverageKindForGate(gate: TraceGate): TraceCoverageKind {
    switch (gate.stage) {
        case "preanalysis":
            return "observed_surface";
        case "coverage_ledger":
            return "coverage_query";
        case "semanticflow":
            return "semanticflow_candidate";
        case "semanticflow_llm":
            return gate.gateKind === "llm_batch" ? "llm_batch" : "llm_output";
        case "asset_validation":
            return "asset_validation";
        case "asset_promotion":
            return "asset_promotion";
        case "asset_lowering":
        case "module_lowering":
            return "asset_lowering";
        case "entry_recovery":
            return "entry_recovery";
        case "source_seed":
            return "source_seed";
        case "sink_candidate":
            return "sink_candidate";
        default:
            return "coverage_query";
    }
}

function coverageStatusForGate(gate: TraceGate): TraceCoverageStatus {
    if (gate.blockedReason) return "blocked";
    if (gate.skippedReason) return "skipped";
    if (gate.emitted) return "emitted";
    if (gate.matched) return "covered";
    if (gate.attempted) return "gap";
    return "observed";
}

function inferCoverageFromGates(gates: TraceGate[]): TraceCoverageRecord[] {
    const records: TraceCoverageRecord[] = [];
    for (const gate of gates) {
        if (!isSemanticCoverageStage(gate.stage)) continue;
        records.push({
            id: `coverage:${records.length + 1}`,
            kind: coverageKindForGate(gate),
            stage: gate.stage,
            producer: gate.producer,
            subject: gate.scope || gate.label || gate.id,
            status: coverageStatusForGate(gate),
            gateId: gate.id,
            label: gate.label,
            role: stringEvidence(gate.evidence, "role"),
            endpoint: stringEvidence(gate.evidence, "endpoint"),
            surfaceId: stringEvidence(gate.evidence, "surfaceId"),
            assetId: stringEvidence(gate.evidence, "assetId"),
            reason: gate.blockedReason || gate.skippedReason || stringEvidence(gate.evidence, "reason"),
            evidence: gate.evidence,
        });
    }
    return records;
}

function dedupeCoverageRecords(records: TraceCoverageRecord[]): TraceCoverageRecord[] {
    const seen = new Set<string>();
    const out: TraceCoverageRecord[] = [];
    for (const record of records) {
        const key = coverageKey(record);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...record, id: `coverage:${out.length + 1}` });
    }
    return out;
}

function coverageKey(record: Omit<TraceCoverageRecord, "id">): string {
    return [
        record.kind,
        record.stage,
        record.producer,
        record.subject,
        record.status,
        record.gateId || "",
        record.label || "",
        record.role || "",
        record.endpoint || "",
        record.surfaceId || "",
        record.assetId || "",
        record.reason || "",
        JSON.stringify(record.evidence || {}),
    ].join("\u0001");
}
