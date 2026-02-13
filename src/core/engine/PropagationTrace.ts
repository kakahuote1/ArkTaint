import { TaintFact } from "../TaintFact";

export interface PropagationTraceOptions {
    maxEdges?: number;
}

interface FactView {
    nodeId: number;
    contextID: number;
    source: string;
    fieldText: string;
}

export interface PropagationTraceSummary {
    nodeCount: number;
    edgeCount: number;
    droppedEdgeCount: number;
    maxEdges: number;
}

export class PropagationTrace {
    private readonly maxEdges: number;
    private readonly facts: Map<string, FactView> = new Map();
    private readonly edgeDedup: Set<string> = new Set();
    private readonly edges: Array<{ from: string; to: string; reason: string }> = [];
    private edgeCount = 0;
    private droppedEdgeCount = 0;

    constructor(options: PropagationTraceOptions = {}) {
        this.maxEdges = Math.max(1, options.maxEdges ?? 50000);
    }

    public recordFact(fact: TaintFact): void {
        const factId = fact.id;
        if (this.facts.has(factId)) return;

        this.facts.set(factId, {
            nodeId: fact.node.getID(),
            contextID: Number(fact.contextID),
            source: fact.source,
            fieldText: fact.field && fact.field.length > 0 ? fact.field.join(".") : "-",
        });
    }

    public recordEdge(from: TaintFact, to: TaintFact, reason: string): void {
        this.recordFact(from);
        this.recordFact(to);

        if (this.edgeCount >= this.maxEdges) {
            this.droppedEdgeCount++;
            return;
        }

        const key = `${from.id}\u0001${to.id}\u0001${reason}`;
        if (this.edgeDedup.has(key)) return;
        this.edgeDedup.add(key);
        this.edges.push({ from: from.id, to: to.id, reason });
        this.edgeCount++;
    }

    public summary(): PropagationTraceSummary {
        return {
            nodeCount: this.facts.size,
            edgeCount: this.edgeCount,
            droppedEdgeCount: this.droppedEdgeCount,
            maxEdges: this.maxEdges,
        };
    }

    public toDot(graphName: string = "arktaint_propagation"): string {
        const lines: string[] = [];
        lines.push(`digraph ${sanitizeId(graphName)} {`);
        lines.push('  rankdir=LR;');
        lines.push('  node [shape=box, fontsize=10];');

        for (const [factId, view] of this.facts.entries()) {
            const nodeId = toDotNodeId(factId);
            const label = `fact=${factId}\\nnode=${view.nodeId} ctx=${view.contextID}\\nfield=${view.fieldText}\\nsource=${view.source}`;
            lines.push(`  ${nodeId} [label="${escapeLabel(label)}"];`);
        }

        for (const edge of this.edges.values()) {
            lines.push(`  ${toDotNodeId(edge.from)} -> ${toDotNodeId(edge.to)} [label="${escapeLabel(edge.reason)}"];`);
        }

        if (this.droppedEdgeCount > 0) {
            lines.push(`  dropped_edges [shape=note, label="dropped_edges=${this.droppedEdgeCount}"];`);
        }

        lines.push("}");
        return lines.join("\n");
    }
}

function toDotNodeId(factId: string): string {
    return "n_" + Buffer.from(factId).toString("hex");
}

function escapeLabel(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sanitizeId(text: string): string {
    return text.replace(/[^A-Za-z0-9_]/g, "_");
}
