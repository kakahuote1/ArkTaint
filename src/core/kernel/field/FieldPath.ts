export const MAX_FIELD_PATH_SEGMENTS = 12;

const MAX_REPEATED_CONTAINER_WINDOWS = 2;
const MAX_REPEAT_WINDOW_SIZE = 4;

export type FieldPrecision = "exact" | "partial" | "unknown";

export interface NormalizedFieldPath {
    segments: string[];
    precision: FieldPrecision;
    truncated: boolean;
}

export function normalizeFieldPath(
    field?: readonly unknown[],
    precision: FieldPrecision = "exact",
): NormalizedFieldPath | undefined {
    const normalized = normalizeRawFieldSegments(field);
    if (!normalized) return undefined;
    const collapsed = collapseRepeatedContainerWindows(normalized);
    const truncated = collapsed.length > MAX_FIELD_PATH_SEGMENTS;
    const segments = truncated ? collapsed.slice(0, MAX_FIELD_PATH_SEGMENTS) : collapsed;
    return {
        segments,
        precision,
        truncated,
    };
}

export function normalizeFieldPathSegments(field?: readonly unknown[]): string[] | undefined {
    const normalized = normalizeRawFieldSegments(field);
    if (!normalized) return undefined;
    const collapsed = collapseRepeatedContainerWindows(normalized);
    return collapsed.length > MAX_FIELD_PATH_SEGMENTS
        ? collapsed.slice(0, MAX_FIELD_PATH_SEGMENTS)
        : collapsed;
}

export function appendFieldPath(base: readonly string[] | undefined, suffix: readonly unknown[] | undefined): string[] | undefined {
    return normalizeFieldPathSegments([...(base || []), ...(suffix || [])]);
}

export function prependFieldPath(prefix: readonly unknown[] | undefined, field: readonly string[] | undefined): string[] | undefined {
    return normalizeFieldPathSegments([...(prefix || []), ...(field || [])]);
}

export function cloneFieldPath(field?: readonly string[]): string[] | undefined {
    return field && field.length > 0 ? [...field] : undefined;
}

export function fieldPathKey(field?: readonly string[]): string {
    return field && field.length > 0 ? field.join(".") : "";
}

export function fieldPathEquals(left?: readonly string[], right?: readonly string[]): boolean {
    const a = left || [];
    const b = right || [];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

export function fieldPathStartsWith(field: readonly string[] | undefined, prefix: readonly string[] | undefined): boolean {
    if (!field || !prefix || prefix.length === 0 || field.length <= prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
        if (field[i] !== prefix[i]) return false;
    }
    return true;
}

export function degradeFieldPrecision(current: FieldPrecision, next: FieldPrecision): FieldPrecision {
    if (current === "unknown" || next === "unknown") return "unknown";
    if (current === "partial" || next === "partial") return "partial";
    return "exact";
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

function normalizeRawFieldSegments(field?: readonly unknown[]): string[] | undefined {
    if (!field || field.length === 0) return undefined;
    const normalized = field
        .map(segment => String(segment || "").trim())
        .filter(segment => segment.length > 0);
    return normalized.length > 0 ? normalized : undefined;
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
        segment.includes("$c$:") ||
        /^(arr|map|mapkey|weakmap|set|weakset|list|queue|stack|rs):/.test(segment),
    );
}
