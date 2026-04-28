import * as fs from "fs";
import * as path from "path";

export interface SourceDiscoveryOptions {
    maxDepth?: number;
    includeRootFallback?: boolean;
}

const DEFAULT_MAX_DEPTH = 8;
const SKIP_DIRS = new Set([
    ".git",
    ".hvigor",
    ".idea",
    ".preview",
    ".vscode",
    "build",
    "dist",
    "node_modules",
    "oh_modules",
    "out",
    "output",
    "tmp",
]);

export function normalizeSourceDirsForCli(sourceDirs: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const sourceDir of sourceDirs) {
        const normalized = sourceDir.replace(/\\/g, "/").replace(/\/+$/g, "") || ".";
        if (seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

export function discoverArkTsSourceDirs(
    repoRoot: string,
    options: SourceDiscoveryOptions = {},
): string[] {
    const root = path.resolve(repoRoot);
    const candidates: string[] = [];
    const exactCandidates = [
        "entry/src/main/ets",
        "src/main/ets",
    ];
    for (const rel of exactCandidates) {
        const abs = path.resolve(root, rel);
        if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && hasArkSourceFile(abs)) {
            candidates.push(rel);
        }
    }

    collectSrcMainEtsDirs(root, root, options.maxDepth ?? DEFAULT_MAX_DEPTH, candidates);
    const specific = normalizeSourceDirsForCli(candidates)
        .filter(rel => hasArkSourceFile(path.resolve(root, rel)))
        .sort(compareSourceDir);
    if (specific.length > 0) {
        return specific;
    }

    if (options.includeRootFallback !== false && hasArkSourceFile(root)) {
        return ["."];
    }
    return [];
}

function collectSrcMainEtsDirs(root: string, dir: string, remainingDepth: number, out: string[]): void {
    if (remainingDepth < 0) {
        return;
    }
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    if (isSrcMainEtsDir(root, dir)) {
        out.push(toRelativePosix(root, dir));
        return;
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || shouldSkipDir(entry.name)) {
            continue;
        }
        collectSrcMainEtsDirs(root, path.join(dir, entry.name), remainingDepth - 1, out);
    }
}

function isSrcMainEtsDir(root: string, dir: string): boolean {
    const rel = toRelativePosix(root, dir);
    return rel === "src/main/ets" || rel.endsWith("/src/main/ets");
}

function shouldSkipDir(name: string): boolean {
    return SKIP_DIRS.has(name) || name.startsWith(".");
}

function hasArkSourceFile(dir: string, maxVisited = 5000): boolean {
    let visited = 0;
    const stack = [dir];
    while (stack.length > 0 && visited < maxVisited) {
        const current = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            visited++;
            if (entry.isFile() && /\.(ets|ts)$/i.test(entry.name)) {
                return true;
            }
            if (entry.isDirectory() && !shouldSkipDir(entry.name)) {
                stack.push(path.join(current, entry.name));
            }
            if (visited >= maxVisited) {
                break;
            }
        }
    }
    return false;
}

function compareSourceDir(left: string, right: string): number {
    return sourceDirRank(left) - sourceDirRank(right)
        || left.split("/").length - right.split("/").length
        || left.localeCompare(right);
}

function sourceDirRank(rel: string): number {
    if (rel === "entry/src/main/ets") {
        return 0;
    }
    if (rel.endsWith("/src/main/ets")) {
        return 1;
    }
    if (rel === "src/main/ets") {
        return 2;
    }
    return 3;
}

function toRelativePosix(root: string, dir: string): string {
    const rel = path.relative(root, dir).replace(/\\/g, "/");
    return rel || ".";
}
