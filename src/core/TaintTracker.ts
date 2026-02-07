
import { PagNode } from "../../arkanalyzer/src/callgraph/pointerAnalysis/Pag";

export class TaintTracker {
    private taintedNodes: Map<number, string> = new Map();

    public markTainted(nodeId: number, source: string): void {
        this.taintedNodes.set(nodeId, source);
    }

    public isTainted(nodeId: number): boolean {
        return this.taintedNodes.has(nodeId);
    }

    public getSource(nodeId: number): string | undefined {
        return this.taintedNodes.get(nodeId);
    }

    public clear(): void {
        this.taintedNodes.clear();
    }
}
