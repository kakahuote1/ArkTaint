
import { PagNode } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import { ContextID } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/context/Context";

export class TaintTracker {
    // Key = "nodeId@contextId", Value = source signature
    private taintedNodes: Map<string, string> = new Map();
    // Key = "nodeId@contextId.field.path", Value = source signature
    private taintedFieldNodes: Map<string, string> = new Map();
    // Key = "nodeId@contextId", Value = taint fact ids
    private taintedNodeFactIds: Map<string, Set<string>> = new Map();
    // Key = "nodeId@contextId.field.path", Value = taint fact ids
    private taintedFieldFactIds: Map<string, Set<string>> = new Map();
    // Any-context indexes to avoid repeated full-map scans on hot paths.
    private taintedNodesAnyContext: Set<number> = new Set();
    private taintedNodeSourcesAnyContext: Map<number, string> = new Map();
    private taintedNodeFactIdsAnyContext: Map<number, Set<string>> = new Map();
    private taintedFieldPathsAnyContext: Map<number, Set<string>> = new Map();
    private taintedFieldSourcesAnyContext: Map<number, Map<string, string>> = new Map();
    private taintedFieldFactIdsAnyContext: Map<number, Map<string, Set<string>>> = new Map();

    private makeKey(nodeId: number, contextId: ContextID): string {
        return `${nodeId}@${contextId}`;
    }

    private makeFieldKey(nodeId: number, contextId: ContextID, fieldPath: string[]): string {
        return `${this.makeKey(nodeId, contextId)}.${fieldPath.join(".")}`;
    }

    private makeFieldPathKey(fieldPath: string[]): string {
        return fieldPath.join(".");
    }

    public markTainted(nodeId: number, contextId: ContextID, source: string, fieldPath?: string[], factId?: string): void {
        const hasFieldPath = !!(fieldPath && fieldPath.length > 0);
        const baseKey = this.makeKey(nodeId, contextId);
        if (!hasFieldPath) {
            this.taintedNodes.set(baseKey, source);
            this.taintedNodesAnyContext.add(nodeId);
            if (!this.taintedNodeSourcesAnyContext.has(nodeId)) {
                this.taintedNodeSourcesAnyContext.set(nodeId, source);
            }
            if (factId) {
                if (!this.taintedNodeFactIds.has(baseKey)) {
                    this.taintedNodeFactIds.set(baseKey, new Set<string>());
                }
                this.taintedNodeFactIds.get(baseKey)!.add(factId);
                if (!this.taintedNodeFactIdsAnyContext.has(nodeId)) {
                    this.taintedNodeFactIdsAnyContext.set(nodeId, new Set<string>());
                }
                this.taintedNodeFactIdsAnyContext.get(nodeId)!.add(factId);
            }
        }
        if (hasFieldPath) {
            const fieldKey = this.makeFieldKey(nodeId, contextId, fieldPath);
            const fieldPathKey = this.makeFieldPathKey(fieldPath);
            this.taintedFieldNodes.set(fieldKey, source);
            if (!this.taintedFieldPathsAnyContext.has(nodeId)) {
                this.taintedFieldPathsAnyContext.set(nodeId, new Set<string>());
            }
            this.taintedFieldPathsAnyContext.get(nodeId)!.add(fieldPathKey);
            if (!this.taintedFieldSourcesAnyContext.has(nodeId)) {
                this.taintedFieldSourcesAnyContext.set(nodeId, new Map<string, string>());
            }
            if (!this.taintedFieldSourcesAnyContext.get(nodeId)!.has(fieldPathKey)) {
                this.taintedFieldSourcesAnyContext.get(nodeId)!.set(fieldPathKey, source);
            }
            if (factId) {
                if (!this.taintedFieldFactIds.has(fieldKey)) {
                    this.taintedFieldFactIds.set(fieldKey, new Set<string>());
                }
                this.taintedFieldFactIds.get(fieldKey)!.add(factId);
                if (!this.taintedFieldFactIdsAnyContext.has(nodeId)) {
                    this.taintedFieldFactIdsAnyContext.set(nodeId, new Map<string, Set<string>>());
                }
                const byFieldPath = this.taintedFieldFactIdsAnyContext.get(nodeId)!;
                if (!byFieldPath.has(fieldPathKey)) {
                    byFieldPath.set(fieldPathKey, new Set<string>());
                }
                byFieldPath.get(fieldPathKey)!.add(factId);
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
     * 妫€鏌ヨ妭鐐瑰湪浠绘剰涓婁笅鏂囦笅鏄惁琚薄鏌擄紙鐢ㄤ簬 Sink 妫€娴嬶級
     */
    public isTaintedAnyContext(nodeId: number, fieldPath?: string[]): boolean {
        const prefix = `${nodeId}@`;
        if (fieldPath && fieldPath.length > 0) {
            const fieldPathKey = this.makeFieldPathKey(fieldPath);
            return this.taintedFieldPathsAnyContext.get(nodeId)?.has(fieldPathKey) || false;
        }

        return this.taintedNodesAnyContext.has(nodeId);
    }

    public getSource(nodeId: number, contextId: ContextID, fieldPath?: string[]): string | undefined {
        if (fieldPath && fieldPath.length > 0) {
            return this.taintedFieldNodes.get(this.makeFieldKey(nodeId, contextId, fieldPath));
        }
        return this.taintedNodes.get(this.makeKey(nodeId, contextId));
    }

    /**
     * 鑾峰彇鑺傜偣鍦ㄤ换鎰忎笂涓嬫枃涓嬬殑 source锛堢敤锟?Sink 妫€娴嬶級
     */
    public getSourceAnyContext(nodeId: number, fieldPath?: string[]): string | undefined {
        if (fieldPath && fieldPath.length > 0) {
            const fieldPathKey = this.makeFieldPathKey(fieldPath);
            return this.taintedFieldSourcesAnyContext.get(nodeId)?.get(fieldPathKey);
        }

        return this.taintedNodeSourcesAnyContext.get(nodeId);
    }

    public hasAnyFieldTaintAnyContext(nodeId: number): boolean {
        return (this.taintedFieldPathsAnyContext.get(nodeId)?.size || 0) > 0;
    }

    public getAnyFieldSourceAnyContext(nodeId: number): { source: string; fieldPath?: string[] } | undefined {
        const byFieldPath = this.taintedFieldSourcesAnyContext.get(nodeId);
        if (!byFieldPath) return undefined;
        for (const [fieldPathKey, source] of byFieldPath.entries()) {
            const fieldPath = fieldPathKey.length > 0 ? fieldPathKey.split(".") : undefined;
            return { source, fieldPath };
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

        if (fieldPath && fieldPath.length > 0) {
            const fieldPathKey = this.makeFieldPathKey(fieldPath);
            const ids = this.taintedFieldFactIdsAnyContext.get(nodeId)?.get(fieldPathKey);
            if (ids) {
                for (const id of ids) out.add(id);
            }
            return [...out];
        }

        const ids = this.taintedNodeFactIdsAnyContext.get(nodeId);
        if (ids) {
            for (const id of ids) out.add(id);
        }
        return [...out];
    }

    public clear(): void {
        this.taintedNodes.clear();
        this.taintedFieldNodes.clear();
        this.taintedNodeFactIds.clear();
        this.taintedFieldFactIds.clear();
        this.taintedNodesAnyContext.clear();
        this.taintedNodeSourcesAnyContext.clear();
        this.taintedNodeFactIdsAnyContext.clear();
        this.taintedFieldPathsAnyContext.clear();
        this.taintedFieldSourcesAnyContext.clear();
        this.taintedFieldFactIdsAnyContext.clear();
    }
}
