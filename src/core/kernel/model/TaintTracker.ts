
import { PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ContextID } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/context/Context";
import { fieldPathKey, fieldPathStartsWith, normalizeFieldPathSegments } from "../field/FieldPath";

export class TaintTracker {
    // Key = "nodeId@contextId", Value = source signatures
    private taintedNodes: Map<string, Set<string>> = new Map();
    // Key = "nodeId@contextId.field.path", Value = source signatures
    private taintedFieldNodes: Map<string, Set<string>> = new Map();
    // Key = "nodeId@contextId", Value = taint fact ids
    private taintedNodeFactIds: Map<string, Set<string>> = new Map();
    // Key = "nodeId@contextId.field.path", Value = taint fact ids
    private taintedFieldFactIds: Map<string, Set<string>> = new Map();
    // Any-context indexes to avoid repeated full-map scans on hot paths.
    private taintedNodesAnyContext: Set<number> = new Set();
    private taintedNodeSourcesAnyContext: Map<number, Set<string>> = new Map();
    private taintedNodeFactIdsAnyContext: Map<number, Set<string>> = new Map();
    private taintedFieldPathsAnyContext: Map<number, Set<string>> = new Map();
    private taintedFieldSourcesAnyContext: Map<number, Map<string, Set<string>>> = new Map();
    private taintedFieldFactIdsAnyContext: Map<number, Map<string, Set<string>>> = new Map();

    private makeKey(nodeId: number, contextId: ContextID): string {
        return `${nodeId}@${contextId}`;
    }

    private makeFieldKey(nodeId: number, contextId: ContextID, fieldPath: string[]): string {
        return `${this.makeKey(nodeId, contextId)}.${fieldPathKey(fieldPath)}`;
    }

    private makeFieldPathKey(fieldPath: string[]): string {
        return fieldPathKey(fieldPath);
    }

    private addSource(map: Map<string, Set<string>>, key: string, source: string): void {
        if (!map.has(key)) {
            map.set(key, new Set<string>());
        }
        map.get(key)!.add(source);
    }

    private addAnyContextSource(map: Map<number, Set<string>>, nodeId: number, source: string): void {
        if (!map.has(nodeId)) {
            map.set(nodeId, new Set<string>());
        }
        map.get(nodeId)!.add(source);
    }

    private addFieldAnyContextSource(nodeId: number, fieldPathKey: string, source: string): void {
        if (!this.taintedFieldSourcesAnyContext.has(nodeId)) {
            this.taintedFieldSourcesAnyContext.set(nodeId, new Map<string, Set<string>>());
        }
        const byFieldPath = this.taintedFieldSourcesAnyContext.get(nodeId)!;
        if (!byFieldPath.has(fieldPathKey)) {
            byFieldPath.set(fieldPathKey, new Set<string>());
        }
        byFieldPath.get(fieldPathKey)!.add(source);
    }

    private firstSource(sources?: Set<string>): string | undefined {
        return sources ? sources.values().next().value : undefined;
    }

    public markTainted(nodeId: number, contextId: ContextID, source: string, fieldPath?: string[], factId?: string): void {
        const normalizedFieldPath = normalizeFieldPathSegments(fieldPath);
        const hasFieldPath = !!(normalizedFieldPath && normalizedFieldPath.length > 0);
        const baseKey = this.makeKey(nodeId, contextId);
        if (!hasFieldPath) {
            this.addSource(this.taintedNodes, baseKey, source);
            this.taintedNodesAnyContext.add(nodeId);
            this.addAnyContextSource(this.taintedNodeSourcesAnyContext, nodeId, source);
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
        if (hasFieldPath && normalizedFieldPath) {
            const fieldKey = this.makeFieldKey(nodeId, contextId, normalizedFieldPath);
            const normalizedFieldPathKey = this.makeFieldPathKey(normalizedFieldPath);
            this.addSource(this.taintedFieldNodes, fieldKey, source);
            if (!this.taintedFieldPathsAnyContext.has(nodeId)) {
                this.taintedFieldPathsAnyContext.set(nodeId, new Set<string>());
            }
            this.taintedFieldPathsAnyContext.get(nodeId)!.add(normalizedFieldPathKey);
            this.addFieldAnyContextSource(nodeId, normalizedFieldPathKey, source);
            if (factId) {
                if (!this.taintedFieldFactIds.has(fieldKey)) {
                    this.taintedFieldFactIds.set(fieldKey, new Set<string>());
                }
                this.taintedFieldFactIds.get(fieldKey)!.add(factId);
                if (!this.taintedFieldFactIdsAnyContext.has(nodeId)) {
                    this.taintedFieldFactIdsAnyContext.set(nodeId, new Map<string, Set<string>>());
                }
                const byFieldPath = this.taintedFieldFactIdsAnyContext.get(nodeId)!;
                if (!byFieldPath.has(normalizedFieldPathKey)) {
                    byFieldPath.set(normalizedFieldPathKey, new Set<string>());
                }
                byFieldPath.get(normalizedFieldPathKey)!.add(factId);
            }
        }
    }

    public isTainted(nodeId: number, contextId: ContextID, fieldPath?: string[]): boolean {
        const normalizedFieldPath = normalizeFieldPathSegments(fieldPath);
        if (normalizedFieldPath && normalizedFieldPath.length > 0) {
            return this.taintedFieldNodes.has(this.makeFieldKey(nodeId, contextId, normalizedFieldPath));
        }
        return this.taintedNodes.has(this.makeKey(nodeId, contextId));
    }

    public hasSource(nodeId: number, contextId: ContextID, source: string, fieldPath?: string[]): boolean {
        const normalizedFieldPath = normalizeFieldPathSegments(fieldPath);
        if (normalizedFieldPath && normalizedFieldPath.length > 0) {
            return this.taintedFieldNodes.get(this.makeFieldKey(nodeId, contextId, normalizedFieldPath))?.has(source) || false;
        }
        return this.taintedNodes.get(this.makeKey(nodeId, contextId))?.has(source) || false;
    }

    /**
     * 检查节点在任意上下文下是否被污染（用于 Sink 检测）
     */
    public isTaintedAnyContext(nodeId: number, fieldPath?: string[]): boolean {
        const normalizedFieldPath = normalizeFieldPathSegments(fieldPath);
        if (normalizedFieldPath && normalizedFieldPath.length > 0) {
            const normalizedFieldPathKey = this.makeFieldPathKey(normalizedFieldPath);
            return this.taintedFieldPathsAnyContext.get(nodeId)?.has(normalizedFieldPathKey) || false;
        }

        return this.taintedNodesAnyContext.has(nodeId);
    }

    public getSource(nodeId: number, contextId: ContextID, fieldPath?: string[]): string | undefined {
        const normalizedFieldPath = normalizeFieldPathSegments(fieldPath);
        if (normalizedFieldPath && normalizedFieldPath.length > 0) {
            return this.firstSource(this.taintedFieldNodes.get(this.makeFieldKey(nodeId, contextId, normalizedFieldPath)));
        }
        return this.firstSource(this.taintedNodes.get(this.makeKey(nodeId, contextId)));
    }

    /**
     * 获取节点在任意上下文下的 source（用�?Sink 检测）
     */
    public getSourceAnyContext(nodeId: number, fieldPath?: string[]): string | undefined {
        return this.firstSource(new Set(this.getSourcesAnyContext(nodeId, fieldPath)));
    }

    public getSourcesAnyContext(nodeId: number, fieldPath?: string[]): string[] {
        const normalizedFieldPath = normalizeFieldPathSegments(fieldPath);
        if (normalizedFieldPath && normalizedFieldPath.length > 0) {
            const normalizedFieldPathKey = this.makeFieldPathKey(normalizedFieldPath);
            return [...(this.taintedFieldSourcesAnyContext.get(nodeId)?.get(normalizedFieldPathKey) || [])];
        }

        return [...(this.taintedNodeSourcesAnyContext.get(nodeId) || [])];
    }

    public hasAnyFieldTaintAnyContext(nodeId: number): boolean {
        return (this.taintedFieldPathsAnyContext.get(nodeId)?.size || 0) > 0;
    }

    public getAnyFieldSourceAnyContext(nodeId: number): { source: string; fieldPath?: string[] } | undefined {
        const byFieldPath = this.taintedFieldSourcesAnyContext.get(nodeId);
        if (!byFieldPath) return undefined;
        for (const [fieldPathKey, sources] of byFieldPath.entries()) {
            const source = this.firstSource(sources);
            if (!source) continue;
            const fieldPath = fieldPathKey.length > 0 ? fieldPathKey.split(".") : undefined;
            return { source, fieldPath };
        }
        return undefined;
    }

    public getFieldSourcesAnyContext(nodeId: number): Array<{ source: string; fieldPath: string[] }> {
        const byFieldPath = this.taintedFieldSourcesAnyContext.get(nodeId);
        if (!byFieldPath) return [];
        const out: Array<{ source: string; fieldPath: string[] }> = [];
        for (const [fieldPathKey, sources] of byFieldPath.entries()) {
            if (!fieldPathKey) continue;
            for (const source of sources) {
                out.push({
                    source,
                    fieldPath: fieldPathKey.split("."),
                });
            }
        }
        return out;
    }

    public hasDescendantFieldSourceAnyContext(nodeId: number, source: string, prefix: string[]): boolean {
        const normalizedPrefix = normalizeFieldPathSegments(prefix);
        if (!normalizedPrefix || normalizedPrefix.length === 0) return false;
        const byFieldPath = this.taintedFieldSourcesAnyContext.get(nodeId);
        if (!byFieldPath) return false;
        for (const [fieldPathKey, sources] of byFieldPath.entries()) {
            if (!sources.has(source)) continue;
            const fieldPath = fieldPathKey.split(".");
            if (fieldPathStartsWith(fieldPath, normalizedPrefix)) return true;
        }
        return false;
    }

    public getTaintFactIds(nodeId: number, contextId: ContextID, fieldPath?: string[]): string[] {
        const normalizedFieldPath = normalizeFieldPathSegments(fieldPath);
        if (normalizedFieldPath && normalizedFieldPath.length > 0) {
            const ids = this.taintedFieldFactIds.get(this.makeFieldKey(nodeId, contextId, normalizedFieldPath));
            return ids ? [...ids] : [];
        }
        const ids = this.taintedNodeFactIds.get(this.makeKey(nodeId, contextId));
        return ids ? [...ids] : [];
    }

    public getTaintFactIdsAnyContext(nodeId: number, fieldPath?: string[]): string[] {
        const out = new Set<string>();

        const normalizedFieldPath = normalizeFieldPathSegments(fieldPath);
        if (normalizedFieldPath && normalizedFieldPath.length > 0) {
            const normalizedFieldPathKey = this.makeFieldPathKey(normalizedFieldPath);
            const ids = this.taintedFieldFactIdsAnyContext.get(nodeId)?.get(normalizedFieldPathKey);
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
