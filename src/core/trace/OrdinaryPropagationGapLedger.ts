import type {
    TraceEdge,
    TraceFact,
    TraceGate,
    TraceGraph,
    TraceProducer,
    TraceStage,
} from "./TraceGraph";

export type OrdinaryPropagationGapFamily =
    | "field"
    | "container"
    | "JSON"
    | "callback"
    | "parser"
    | "result"
    | "receiver"
    | "buffer"
    | "ordinary";

export interface OrdinaryPropagationGapRow {
    recordKind: "ordinary_propagation_gap";
    gapLayer: "ordinary_propagation";
    gapFamily: OrdinaryPropagationGapFamily;
    gapKind: string;
    status: "gap" | "skipped" | "blocked";
    sourceDir?: string;
    entryName?: string;
    traceRunId?: string;
    id: string;
    gateId?: string;
    edgeId?: string;
    stage?: TraceStage;
    producer?: TraceProducer;
    gateKind?: string;
    scope?: string;
    reason?: string;
    skippedReason?: string;
    blockedReason?: string;
    fromFact?: TraceFact;
    toFact?: TraceFact;
    evidence?: Record<string, unknown>;
}

export interface OrdinaryPropagationGapEntry {
    sourceDir?: string;
    entryName?: string;
    traceGraph?: TraceGraph;
}

const MAX_ORDINARY_GAP_ROWS = 20000;

export function buildOrdinaryPropagationGapRowsFromEntries(
    entries: readonly OrdinaryPropagationGapEntry[],
): OrdinaryPropagationGapRow[] {
    const rows: OrdinaryPropagationGapRow[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        const graph = entry.traceGraph;
        if (!graph) continue;
        for (const row of buildOrdinaryPropagationGapRows({
            graph,
            sourceDir: entry.sourceDir,
            entryName: entry.entryName,
        })) {
            const key = [
                row.sourceDir || "",
                row.entryName || "",
                row.traceRunId || "",
                row.gateId || "",
                row.edgeId || "",
                row.gapKind,
                row.status,
            ].join("\u0001");
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push(row);
            if (rows.length >= MAX_ORDINARY_GAP_ROWS) {
                rows.push({
                    recordKind: "ordinary_propagation_gap",
                    gapLayer: "ordinary_propagation",
                    gapFamily: "ordinary",
                    gapKind: "ordinary_gap_ledger_truncated",
                    status: "blocked",
                    sourceDir: entry.sourceDir,
                    entryName: entry.entryName,
                    traceRunId: graph.run?.runId,
                    id: `ordinary-gap:truncated:${rows.length}`,
                    reason: `ordinary propagation gap ledger reached row limit ${MAX_ORDINARY_GAP_ROWS}`,
                });
                return rows;
            }
        }
    }
    return rows;
}

export function buildOrdinaryPropagationGapRows(input: {
    graph: TraceGraph;
    sourceDir?: string;
    entryName?: string;
}): OrdinaryPropagationGapRow[] {
    const factsById = new Map(input.graph.facts.map(fact => [fact.id, fact]));
    const rows: OrdinaryPropagationGapRow[] = [];

    for (const gate of input.graph.gates || []) {
        if (!isOrdinaryPropagationGate(gate, factsById)) continue;
        if (gate.emitted && !gate.skippedReason && !gate.blockedReason) continue;
        const fromFact = gate.fromFact ? factsById.get(gate.fromFact) : undefined;
        const toFact = gate.toFact ? factsById.get(gate.toFact) : undefined;
        const classification = classifyOrdinaryGap([
            gate.scope,
            gate.label,
            gate.skippedReason,
            gate.blockedReason,
            stringEvidence(gate.evidence, "reason"),
            JSON.stringify(gate.evidence || {}),
            factText(fromFact),
            factText(toFact),
        ]);
        rows.push({
            recordKind: "ordinary_propagation_gap",
            gapLayer: "ordinary_propagation",
            gapFamily: classification.family,
            gapKind: classification.kind,
            status: statusForGate(gate),
            sourceDir: input.sourceDir,
            entryName: input.entryName,
            traceRunId: input.graph.run?.runId,
            id: `ordinary-gap:gate:${rows.length + 1}`,
            gateId: gate.id,
            stage: gate.stage,
            producer: gate.producer,
            gateKind: gate.gateKind,
            scope: gate.scope,
            reason: stringEvidence(gate.evidence, "reason") || gate.scope,
            skippedReason: gate.skippedReason,
            blockedReason: gate.blockedReason,
            fromFact,
            toFact,
            evidence: gate.evidence,
        });
    }

    for (const edge of input.graph.edges || []) {
        if (!isOrdinaryPropagationEdge(edge, factsById)) continue;
        if (edge.status === "emitted") continue;
        const fromFact = edge.fromFact ? factsById.get(edge.fromFact) : undefined;
        const toFact = edge.toFact ? factsById.get(edge.toFact) : undefined;
        const classification = classifyOrdinaryGap([
            edge.reason,
            stringEvidence(edge.evidence, "reason"),
            stringEvidence(edge.evidence, "skippedReason"),
            stringEvidence(edge.evidence, "blockedReason"),
            JSON.stringify(edge.evidence || {}),
            factText(fromFact),
            factText(toFact),
        ]);
        rows.push({
            recordKind: "ordinary_propagation_gap",
            gapLayer: "ordinary_propagation",
            gapFamily: classification.family,
            gapKind: classification.kind,
            status: edge.status === "blocked" ? "blocked" : "skipped",
            sourceDir: input.sourceDir,
            entryName: input.entryName,
            traceRunId: input.graph.run?.runId,
            id: `ordinary-gap:edge:${rows.length + 1}`,
            edgeId: edge.id,
            stage: edge.stage,
            producer: edge.producer,
            reason: edge.reason,
            skippedReason: stringEvidence(edge.evidence, "skippedReason"),
            blockedReason: stringEvidence(edge.evidence, "blockedReason"),
            fromFact,
            toFact,
            evidence: edge.evidence,
        });
    }

    return rows;
}

function isOrdinaryPropagationGate(gate: TraceGate, factsById: ReadonlyMap<string, TraceFact>): boolean {
    if (gate.stage === "ordinary" || gate.producer === "ordinary") return true;
    if (gate.gateKind !== "propagation") return false;
    return isOrdinaryLikeText([
        gate.scope,
        gate.label,
        gate.skippedReason,
        gate.blockedReason,
        stringEvidence(gate.evidence, "reason"),
        JSON.stringify(gate.evidence || {}),
        factText(gate.fromFact ? factsById.get(gate.fromFact) : undefined),
        factText(gate.toFact ? factsById.get(gate.toFact) : undefined),
    ]);
}

function isOrdinaryPropagationEdge(edge: TraceEdge, factsById: ReadonlyMap<string, TraceFact>): boolean {
    if (edge.stage === "ordinary" || edge.producer === "ordinary") return true;
    return isOrdinaryLikeText([
        edge.reason,
        stringEvidence(edge.evidence, "reason"),
        JSON.stringify(edge.evidence || {}),
        factText(edge.fromFact ? factsById.get(edge.fromFact) : undefined),
        factText(edge.toFact ? factsById.get(edge.toFact) : undefined),
    ]);
}

function statusForGate(gate: TraceGate): "gap" | "skipped" | "blocked" {
    if (gate.blockedReason) return "blocked";
    if (gate.skippedReason) return "skipped";
    return "gap";
}

function classifyOrdinaryGap(parts: Array<string | undefined>): { family: OrdinaryPropagationGapFamily; kind: string } {
    const text = normalize(parts.filter((part): part is string => Boolean(part)).join(" "));
    if (/\bjson\b|stringify|serialized|serialize|deserialize/.test(text)) {
        return { family: "JSON", kind: "json_value_carrier_gap" };
    }
    if (/callback|call-back|hof|mapper|closure|lambda|then|catch|promise|continuation/.test(text)) {
        return { family: "callback", kind: "callback_propagation_gap" };
    }
    if (/resultset|data[-_ ]?share|query|rows|rowset|cursor|recordset|scalar|getstring|getlong|result[-_ ]?container/.test(text)) {
        return { family: "result", kind: "result_container_gap" };
    }
    if (/await|return[-_ ]?field|return|factory|wrapper|copy[-_ ]?like|result/.test(text)) {
        return { family: "result", kind: "ordinary_result_gap" };
    }
    if (/receiver|thisfield|this[-_ ]?field|write[-_ ]?back|property[-_ ]?write|instance[-_ ]?field/.test(text)) {
        return { family: "receiver", kind: "receiver_provenance_gap" };
    }
    if (/arraybuffer|uint8|int8|byte|bytes|buffer|typedarray|blob|binary/.test(text)) {
        return { family: "buffer", kind: "buffer_value_carrier_gap" };
    }
    if (/parser|parse|split|regex|regexp|match|exec|m3u8|html|text[-_ ]?parser/.test(text)) {
        return { family: "parser", kind: "parser_value_carrier_gap" };
    }
    if (/array|collection|map|set|weakmap|weakset|slot|index|element|fromentries|from[-_ ]?entries|container/.test(text)) {
        return { family: "container", kind: "container_item_gap" };
    }
    if (/field|accesspath|access[-_ ]?path|objectliteral|object[-_ ]?literal|property|dto|constructor|store|load|nested/.test(text)) {
        return { family: "field", kind: "field_access_path_gap" };
    }
    return { family: "ordinary", kind: "ordinary_propagation_gap" };
}

function isOrdinaryLikeText(parts: Array<string | undefined>): boolean {
    const text = normalize(parts.filter((part): part is string => Boolean(part)).join(" "));
    return /ordinary|field|accesspath|objectliteral|object[-_ ]?literal|property|dto|constructor|array|collection|map|set|json|parse|stringify|callback|hof|promise|await|receiver|factory|resultset|data[-_ ]?share|query|rows|buffer|bytes|parser|split|regex|m3u8|html|container|wrapper|return/.test(text);
}

function factText(fact: TraceFact | undefined): string | undefined {
    if (!fact) return undefined;
    return [
        fact.id,
        fact.label,
        fact.fieldPath?.join("."),
        fact.method,
        fact.stmt,
        fact.value,
    ].filter((item): item is string => Boolean(item)).join(" ");
}

function normalize(value: string): string {
    return value.toLowerCase().replace(/\\/g, "/");
}

function stringEvidence(evidence: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = evidence?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
