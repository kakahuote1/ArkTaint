import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { LoadedRuleSet } from "../core/rules/RuleLoader";
import { AnalyzeProfile } from "./analyzeCliOptions";

export interface EntryFileStamp {
    sourceFile: string;
    mtimeMs: number;
    size: number;
}

export interface IncrementalCacheScope {
    repo: string;
    k: number;
    profile: AnalyzeProfile;
    ruleFingerprint: string;
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

const INCREMENTAL_CACHE_VERSION = 1;

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
    return sha256Hex(stableStringify(payload));
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
        };
    }
    return undefined;
}

export function sameEntryFileStamp(a?: EntryFileStamp, b?: EntryFileStamp): boolean {
    if (!a || !b) return false;
    return a.sourceFile === b.sourceFile && a.mtimeMs === b.mtimeMs && a.size === b.size;
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
        if (raw.scope.ruleFingerprint !== scope.ruleFingerprint) return new Map();
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
