
import { PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ContextID } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/context/Context";

export const MAX_TAINT_FIELD_PATH_SEGMENTS = 12;
const MAX_REPEATED_CONTAINER_WINDOWS = 2;
const MAX_REPEAT_WINDOW_SIZE = 4;

export class TaintFact {
    public node: PagNode;
    public contextID: ContextID;  // 上下�?ID�? = 空上下文�?
    public field?: string[];
    public source: string;

    constructor(node: PagNode, source: string, contextID: ContextID = 0, field?: string[]) {
        this.node = node;
        this.source = source;
        this.contextID = contextID;
        this.field = normalizeFieldPath(field);
    }

    public get id(): string {
        let id = `${this.node.getID()}@${this.contextID}`;
        if (this.field && this.field.length > 0) {
            id += `.${this.field.join('.')}`;
        }
        return id;
    }
}

function normalizeFieldPath(field?: string[]): string[] | undefined {
    if (!field || field.length === 0) return undefined;
    const normalized = field
        .map(segment => String(segment || "").trim())
        .filter(segment => segment.length > 0);
    if (normalized.length === 0) return undefined;
    const collapsed = collapseRepeatedContainerWindows(normalized);
    return collapsed.length > MAX_TAINT_FIELD_PATH_SEGMENTS
        ? collapsed.slice(0, MAX_TAINT_FIELD_PATH_SEGMENTS)
        : collapsed;
}

function collapseRepeatedContainerWindows(field: string[]): string[] {
    const out: string[] = [];
    for (const segment of field) {
        out.push(segment);
        let changed = true;
        while (changed) {
            changed = false;
            const maxWindow = Math.min(
                MAX_REPEAT_WINDOW_SIZE,
                Math.floor(out.length / (MAX_REPEATED_CONTAINER_WINDOWS + 1)),
            );
            for (let windowSize = 1; windowSize <= maxWindow; windowSize++) {
                if (!hasTrailingRepeatedWindow(out, windowSize, MAX_REPEATED_CONTAINER_WINDOWS + 1)) continue;
                const window = out.slice(out.length - windowSize, out.length);
                if (!isCollapsibleContainerWindow(window)) continue;
                out.splice(out.length - windowSize, windowSize);
                changed = true;
                break;
            }
        }
    }
    return out;
}

function hasTrailingRepeatedWindow(field: string[], windowSize: number, repeatCount: number): boolean {
    if (windowSize <= 0 || repeatCount <= 1 || field.length < windowSize * repeatCount) return false;
    const start = field.length - windowSize;
    for (let repeat = 1; repeat < repeatCount; repeat++) {
        const compareStart = start - repeat * windowSize;
        for (let offset = 0; offset < windowSize; offset++) {
            if (field[start + offset] !== field[compareStart + offset]) return false;
        }
    }
    return true;
}

function isCollapsibleContainerWindow(window: string[]): boolean {
    return window.some(segment =>
        segment.includes("$c$:")
        || /^(arr|map|mapkey|weakmap|set|weakset|list|queue|stack|rs):/.test(segment),
    );
}
