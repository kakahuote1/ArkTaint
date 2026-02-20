
import { PagNode } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ContextID } from "../../arkanalyzer/out/src/callgraph/pointerAnalysis/context/Context";

export class TaintTracker {
    // Key = "nodeId@contextId", Value = source signature
    private taintedNodes: Map<string, string> = new Map();
    // Key = "nodeId@contextId.field.path", Value = source signature
    private taintedFieldNodes: Map<string, string> = new Map();
    // Key = "nodeId@contextId", Value = taint fact ids
    private taintedNodeFactIds: Map<string, Set<string>> = new Map();
    // Key = "nodeId@contextId.field.path", Value = taint fact ids
    private taintedFieldFactIds: Map<string, Set<string>> = new Map();

    private makeKey(nodeId: number, contextId: ContextID): string {
        return `${nodeId}@${contextId}`;
    }

    private makeFieldKey(nodeId: number, contextId: ContextID, fieldPath: string[]): string {
        return `${this.makeKey(nodeId, contextId)}.${fieldPath.join(".")}`;
    }

    public markTainted(nodeId: number, contextId: ContextID, source: string, fieldPath?: string[], factId?: string): void {
        const baseKey = this.makeKey(nodeId, contextId);
        this.taintedNodes.set(baseKey, source);
        if (factId) {
            if (!this.taintedNodeFactIds.has(baseKey)) {
                this.taintedNodeFactIds.set(baseKey, new Set<string>());
            }
            this.taintedNodeFactIds.get(baseKey)!.add(factId);
        }
        if (fieldPath && fieldPath.length > 0) {
            const fieldKey = this.makeFieldKey(nodeId, contextId, fieldPath);
            this.taintedFieldNodes.set(fieldKey, source);
            if (factId) {
                if (!this.taintedFieldFactIds.has(fieldKey)) {
                    this.taintedFieldFactIds.set(fieldKey, new Set<string>());
                }
                this.taintedFieldFactIds.get(fieldKey)!.add(factId);
            }
        }
    }

    public isTainted(nodeId: number, contextId: ContextID, fieldPath?: string[]): boolean {
        if (fieldPath && fieldPath.length > 0) {
            return this.taintedFieldNodes.has(this.makeFieldKey(nodeId, contextId, fieldPath));
        }
        return this.taintedNodes.has(this.makeKey(nodeId, contextId));
    }

    /**
     * 检查节点在任意上下文下是否被污染（用于 Sink 检测）
     */
    public isTaintedAnyContext(nodeId: number, fieldPath?: string[]): boolean {
        const prefix = `${nodeId}@`;
        if (fieldPath && fieldPath.length > 0) {
            const suffix = `.${fieldPath.join(".")}`;
            for (let key of this.taintedFieldNodes.keys()) {
                if (key.startsWith(prefix) && key.endsWith(suffix)) {
                    return true;
                }
            }
            return false;
        }

        for (let key of this.taintedNodes.keys()) {
            if (key.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    public getSource(nodeId: number, contextId: ContextID, fieldPath?: string[]): string | undefined {
        if (fieldPath && fieldPath.length > 0) {
            return this.taintedFieldNodes.get(this.makeFieldKey(nodeId, contextId, fieldPath));
        }
        return this.taintedNodes.get(this.makeKey(nodeId, contextId));
    }

    /**
     * 获取节点在任意上下文下的 source（用于 Sink 检测）
     */
    public getSourceAnyContext(nodeId: number, fieldPath?: string[]): string | undefined {
        const prefix = `${nodeId}@`;
        if (fieldPath && fieldPath.length > 0) {
            const suffix = `.${fieldPath.join(".")}`;
            for (let [key, source] of this.taintedFieldNodes.entries()) {
                if (key.startsWith(prefix) && key.endsWith(suffix)) {
                    return source;
                }
            }
            return undefined;
        }

        for (let [key, source] of this.taintedNodes.entries()) {
            if (key.startsWith(prefix)) {
                return source;
            }
        }
        return undefined;
    }

    public getTaintFactIds(nodeId: number, contextId: ContextID, fieldPath?: string[]): string[] {
        if (fieldPath && fieldPath.length > 0) {
            const ids = this.taintedFieldFactIds.get(this.makeFieldKey(nodeId, contextId, fieldPath));
            return ids ? [...ids] : [];
        }
        const ids = this.taintedNodeFactIds.get(this.makeKey(nodeId, contextId));
        return ids ? [...ids] : [];
    }

    public getTaintFactIdsAnyContext(nodeId: number, fieldPath?: string[]): string[] {
        const out = new Set<string>();
        const prefix = `${nodeId}@`;

        if (fieldPath && fieldPath.length > 0) {
            const suffix = `.${fieldPath.join(".")}`;
            for (const [key, ids] of this.taintedFieldFactIds.entries()) {
                if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
                for (const id of ids) out.add(id);
            }
            return [...out];
        }

        for (const [key, ids] of this.taintedNodeFactIds.entries()) {
            if (!key.startsWith(prefix)) continue;
            for (const id of ids) out.add(id);
        }
        return [...out];
    }

    public clear(): void {
        this.taintedNodes.clear();
        this.taintedFieldNodes.clear();
        this.taintedNodeFactIds.clear();
        this.taintedFieldFactIds.clear();
    }
}
