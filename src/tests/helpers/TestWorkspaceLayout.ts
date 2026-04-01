import * as path from "path";

function normalizeSegments(input: string | string[]): string[] {
    const raw = Array.isArray(input) ? input : [input];
    const out: string[] = [];
    for (const item of raw) {
        for (const piece of item.split(/[\\/]+/)) {
            const trimmed = piece.trim();
            if (trimmed.length > 0) {
                out.push(trimmed);
            }
        }
    }
    return out;
}

export function resolveTestRunDir(group: string | string[], name: string, slot = "latest"): string {
    return path.resolve("tmp", "test_runs", ...normalizeSegments(group), name, slot);
}

export function resolveTestRunPath(group: string | string[], name: string, ...parts: string[]): string {
    return path.join(resolveTestRunDir(group, name), ...parts);
}

export function resolveTestManifestPath(group: string | string[], fileName: string): string {
    return path.resolve("tests", "manifests", ...normalizeSegments(group), fileName);
}
