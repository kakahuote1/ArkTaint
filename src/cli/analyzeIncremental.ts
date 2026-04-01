import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { LoadedRuleSet } from "../core/rules/RuleLoader";
import { AnalyzeProfile } from "./analyzeCliOptions";

export interface EntryFileStamp {
    sourceFile: string;
    mtimeMs: number;
    size: number;
    fingerprint: string;
}

export interface IncrementalCacheScope {
    repo: string;
    k: number;
    profile: AnalyzeProfile;
    analysisFingerprint: string;
}

export interface IncrementalCacheEntry<T> {
    stamp: EntryFileStamp;
    result: T;
}

interface IncrementalCacheFile<T> {
    version: number;
    scope: IncrementalCacheScope;
    entries: Record<string, IncrementalCacheEntry<T>>;
}

const INCREMENTAL_CACHE_VERSION = 3;
const IGNORED_STAMP_DIR_NAMES = new Set([
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    "node_modules",
    "out",
    "dist",
    "build",
    "tmp",
]);

function stableStringify(value: any): string {
    if (value === null || value === undefined) return JSON.stringify(value);
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(v => stableStringify(v)).join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    const pairs = keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
    return `{${pairs.join(",")}}`;
}

function sha256Hex(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex");
}

export function buildIncrementalFingerprint(payload: any): string {
    return sha256Hex(stableStringify(payload));
}

export function buildRuleFingerprint(loadedRules: LoadedRuleSet): string {
    const payload = {
        appliedLayerOrder: loadedRules.appliedLayerOrder || [],
        layerStatus: (loadedRules.layerStatus || []).map(s => ({
            name: s.name,
            path: s.path,
            applied: s.applied,
            exists: s.exists,
            source: s.source,
        })),
        ruleSet: loadedRules.ruleSet || {},
    };
    return buildIncrementalFingerprint(payload);
}

export function buildEntryCacheKey(
    sourceDir: string,
    candidate: { pathHint?: string; name: string }
): string {
    return `${sourceDir}|${candidate.pathHint || ""}|${candidate.name}`;
}

export function resolveEntryFileStamp(
    repo: string,
    sourceDir: string,
    entryPathHint?: string
): EntryFileStamp | undefined {
    if (!entryPathHint) return undefined;
    const repoBase = path.basename(repo).replace(/\\/g, "/");
    const normalizedHint = entryPathHint.replace(/\\/g, "/");
    const strippedHint = normalizedHint.startsWith(`${repoBase}/`)
        ? normalizedHint.slice(repoBase.length + 1)
        : normalizedHint;
    const candidates = [
        path.resolve(repo, sourceDir, normalizedHint),
        path.resolve(repo, normalizedHint),
        path.resolve(repo, strippedHint),
        path.resolve(path.dirname(repo), normalizedHint),
    ];
    for (const abs of candidates) {
        if (!fs.existsSync(abs)) continue;
        const stat = fs.statSync(abs);
        if (!stat.isFile()) continue;
        return {
            sourceFile: abs.replace(/\\/g, "/"),
            mtimeMs: Math.floor(stat.mtimeMs),
            size: stat.size,
            fingerprint: buildIncrementalFingerprint({
                sourceFile: abs.replace(/\\/g, "/"),
                mtimeMs: Math.floor(stat.mtimeMs),
                size: stat.size,
            }),
        };
    }
    return undefined;
}

export function resolveDirectoryTreeStamp(rootPath: string): EntryFileStamp | undefined {
    if (!fs.existsSync(rootPath)) return undefined;
    const stat = fs.statSync(rootPath);
    if (stat.isFile()) {
        return {
            sourceFile: rootPath.replace(/\\/g, "/"),
            mtimeMs: Math.floor(stat.mtimeMs),
            size: stat.size,
            fingerprint: buildIncrementalFingerprint({
                sourceFile: rootPath.replace(/\\/g, "/"),
                mtimeMs: Math.floor(stat.mtimeMs),
                size: stat.size,
            }),
        };
    }
    if (!stat.isDirectory()) return undefined;

    const normalizedRoot = path.resolve(rootPath);
    const queue = [normalizedRoot];
    const entries: Array<{ path: string; mtimeMs: number; size: number }> = [];
    let maxMtimeMs = 0;
    let totalSize = 0;

    for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, dirent.name);
            if (dirent.isDirectory()) {
                if (IGNORED_STAMP_DIR_NAMES.has(dirent.name)) continue;
                queue.push(fullPath);
                continue;
            }
            if (!dirent.isFile()) continue;
            const fileStat = fs.statSync(fullPath);
            const mtimeMs = Math.floor(fileStat.mtimeMs);
            const size = fileStat.size;
            entries.push({
                path: path.relative(normalizedRoot, fullPath).replace(/\\/g, "/"),
                mtimeMs,
                size,
            });
            maxMtimeMs = Math.max(maxMtimeMs, mtimeMs);
            totalSize += size;
        }
    }

    entries.sort((a, b) => a.path.localeCompare(b.path));
    return {
        sourceFile: normalizedRoot.replace(/\\/g, "/"),
        mtimeMs: maxMtimeMs,
        size: totalSize,
        fingerprint: buildIncrementalFingerprint(entries),
    };
}

export function sameEntryFileStamp(a?: EntryFileStamp, b?: EntryFileStamp): boolean {
    if (!a || !b) return false;
    return a.sourceFile === b.sourceFile && a.fingerprint === b.fingerprint;
}

export function loadIncrementalCache<T>(
    filePath: string,
    scope: IncrementalCacheScope
): Map<string, IncrementalCacheEntry<T>> {
    if (!fs.existsSync(filePath)) return new Map();
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as IncrementalCacheFile<T>;
        if (!raw || raw.version !== INCREMENTAL_CACHE_VERSION || !raw.scope || !raw.entries) return new Map();
        if (raw.scope.repo !== scope.repo) return new Map();
        if (raw.scope.k !== scope.k) return new Map();
        if (raw.scope.profile !== scope.profile) return new Map();
        if (raw.scope.analysisFingerprint !== scope.analysisFingerprint) return new Map();
        const out = new Map<string, IncrementalCacheEntry<T>>();
        for (const [k, v] of Object.entries(raw.entries)) {
            if (!v || !v.stamp || !v.result) continue;
            out.set(k, v);
        }
        return out;
    } catch {
        return new Map();
    }
}

export function saveIncrementalCache<T>(
    filePath: string,
    scope: IncrementalCacheScope,
    cache: Map<string, IncrementalCacheEntry<T>>
): void {
    const entries: Record<string, IncrementalCacheEntry<T>> = {};
    for (const [k, v] of cache.entries()) entries[k] = v;
    const payload: IncrementalCacheFile<T> = {
        version: INCREMENTAL_CACHE_VERSION,
        scope,
        entries,
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

interface CacheableEntryResult {
    score: number;
    fromCache?: boolean;
    elapsedMs: number;
    stageProfile: any;
}

export function cloneCachedEntryResult<T extends CacheableEntryResult>(
    result: T,
    score: number,
    emptyStageProfile: () => T["stageProfile"]
): T {
    const cloned = JSON.parse(JSON.stringify(result)) as T;
    cloned.score = score;
    cloned.fromCache = true;
    cloned.elapsedMs = 0;
    cloned.stageProfile = emptyStageProfile();
    return cloned;
}
