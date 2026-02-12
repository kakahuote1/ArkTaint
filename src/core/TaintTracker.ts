
import { PagNode } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ContextID } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/context/Context";

export class TaintTracker {
    // Key = "nodeId@contextId", Value = source signature
    private taintedNodes: Map<string, string> = new Map();

    private makeKey(nodeId: number, contextId: ContextID): string {
        return `${nodeId}@${contextId}`;
    }

    public markTainted(nodeId: number, contextId: ContextID, source: string): void {
        this.taintedNodes.set(this.makeKey(nodeId, contextId), source);
    }

    public isTainted(nodeId: number, contextId: ContextID): boolean {
        return this.taintedNodes.has(this.makeKey(nodeId, contextId));
    }

    /**
     * 检查节点在任意上下文下是否被污染（用于 Sink 检测）
     */
    public isTaintedAnyContext(nodeId: number): boolean {
        for (let key of this.taintedNodes.keys()) {
            if (key.startsWith(`${nodeId}@`)) {
                return true;
            }
        }
        return false;
    }

    public getSource(nodeId: number, contextId: ContextID): string | undefined {
        return this.taintedNodes.get(this.makeKey(nodeId, contextId));
    }

    /**
     * 获取节点在任意上下文下的 source（用于 Sink 检测）
     */
    public getSourceAnyContext(nodeId: number): string | undefined {
        for (let [key, source] of this.taintedNodes.entries()) {
            if (key.startsWith(`${nodeId}@`)) {
                return source;
            }
        }
        return undefined;
    }

    public clear(): void {
        this.taintedNodes.clear();
    }
}
