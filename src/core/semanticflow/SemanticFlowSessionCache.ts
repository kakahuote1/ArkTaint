import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { createSemanticFlowDraftId, stableSemanticFlowSliceKey } from "./SemanticFlowIncremental";
import type {
    SemanticFlowAnchor,
    SemanticFlowAssetDraft,
    SemanticFlowDecision,
    SemanticFlowDelta,
    SemanticFlowExpandPlan,
    SemanticFlowItemResult,
    SemanticFlowMarker,
    SemanticFlowResolution,
    SemanticFlowRoundRecord,
    SemanticFlowSlicePackage,
} from "./SemanticFlowTypes";
import type { AssetDocumentBase, AssetPlane } from "../assets/schema";

export const SEMANTIC_FLOW_SESSION_CACHE_KIND = "semanticflow_llm_session";

export type SemanticFlowSessionCacheMode = "off" | "read" | "write" | "rw";

export interface SemanticFlowSessionCacheStats {
    llmCacheHitCount: number;
    llmCacheMissCount: number;
    llmCacheWriteCount: number;
    itemCacheHitCount: number;
}

export interface SemanticFlowSessionCacheArtifactPaths {
    rootDir: string;
    statsPath: string;
    decisionsDir: string;
    itemsDir: string;
    anchorsDir: string;
}

export type SemanticFlowSessionCacheEvent =
    | { cache: "decision"; outcome: "hit" | "miss" | "write"; anchorId: string; round: number; key: string; keyPrefix: string }
    | { cache: "item"; outcome: "hit" | "write"; anchorId: string; key: string; keyPrefix: string };

export interface SemanticFlowSessionCacheOptions {
    rootDir: string;
    mode?: SemanticFlowSessionCacheMode;
    onEvent?: (event: SemanticFlowSessionCacheEvent) => void;
    now?: () => Date;
}

export interface SemanticFlowDecisionCacheKey {
    key: string;
    keyPrefix: string;
    anchorId: string;
    round: number;
    model: string;
    temperature: number;
    promptSchemaVersion: number;
    parserSchemaVersion: number;
}

export interface SemanticFlowDecisionCacheKeyInput {
    promptSchemaVersion: number;
    parserSchemaVersion: number;
    model: string;
    temperature: number;
    system: string;
    user: string;
    anchorId: string;
    round: number;
    slice: SemanticFlowSlicePackage;
    draft?: SemanticFlowAssetDraft;
    lastMarker?: SemanticFlowMarker;
    lastDelta?: SemanticFlowDelta;
}

export interface SemanticFlowItemCacheKey {
    key: string;
    keyPrefix: string;
    anchorId: string;
    anchorKey: string;
    semanticsFingerprint: string;
    anchorFingerprint: string;
    initialSliceKey: string;
    maxRounds: number;
    model: string;
    temperature: number;
    promptSchemaVersion: number;
    parserSchemaVersion: number;
}

export interface SemanticFlowItemCacheKeyInput {
    model: string;
    temperature: number;
    promptSchemaVersion: number;
    parserSchemaVersion: number;
    semanticsFingerprint: string;
    anchor: SemanticFlowAnchor;
    initialSlice: SemanticFlowSlicePackage;
    maxRounds: number;
}

export interface CachedSemanticFlowSlice {
    anchorId: string;
    round: number;
    template: SemanticFlowSlicePackage["template"];
    observations: string[];
    snippets: Array<{ label: string; code: string }>;
    companions: string[];
    notes: string[];
}

export interface CachedSemanticFlowRound {
    round: number;
    status: "done" | "need-more-evidence" | "reject" | "error";
    slice: CachedSemanticFlowSlice;
    decision?: SemanticFlowDecision;
    draft?: SemanticFlowAssetDraft;
    deficit?: SemanticFlowRoundRecord["deficit"];
    plan?: SemanticFlowExpandPlan;
    delta?: SemanticFlowDelta;
    marker?: SemanticFlowMarker;
    error?: string;
}

export interface CachedSemanticFlowItem {
    resolution: SemanticFlowResolution;
    plane?: AssetPlane;
    asset?: AssetDocumentBase;
    draft?: SemanticFlowAssetDraft;
    lastMarker?: SemanticFlowMarker;
    lastDelta?: SemanticFlowDelta;
    error?: string;
    finalSlice: CachedSemanticFlowSlice;
    finalRound: number;
    rounds: CachedSemanticFlowRound[];
}

export function normalizeSemanticFlowSessionCacheMode(
    raw: string | undefined,
    flagName = "--llmSessionCacheMode",
): SemanticFlowSessionCacheMode {
    const normalized = String(raw || "").trim();
    if (!normalized) return "rw";
    if (normalized === "off" || normalized === "read" || normalized === "write" || normalized === "rw") {
        return normalized;
    }
    throw new Error(`invalid ${flagName}: ${raw}`);
}

export function resolveDefaultSemanticFlowSessionCacheDir(repo: string): string {
    return path.resolve(repo, "tmp", SEMANTIC_FLOW_SESSION_CACHE_KIND);
}

export function buildSemanticFlowDecisionCacheKey(input: SemanticFlowDecisionCacheKeyInput): SemanticFlowDecisionCacheKey {
    const key = sha256Hex(stableJson({
        promptSchema: input.promptSchemaVersion,
        parserSchema: input.parserSchemaVersion,
        model: input.model,
        temperature: input.temperature,
        systemHash: sha256Hex(input.system),
        userHash: sha256Hex(input.user),
        anchorId: input.anchorId,
        round: input.round,
        sliceKey: stableSemanticFlowSliceKey(input.slice),
        draftHash: hashOptionalValue(input.draft),
        lastMarkerHash: hashOptionalValue(input.lastMarker),
        lastDeltaHash: hashOptionalValue(input.lastDelta),
    }));
    return {
        key,
        keyPrefix: key.slice(0, 12),
        anchorId: input.anchorId,
        round: input.round,
        model: input.model,
        temperature: input.temperature,
        promptSchemaVersion: input.promptSchemaVersion,
        parserSchemaVersion: input.parserSchemaVersion,
    };
}

export function buildSemanticFlowItemCacheKey(input: SemanticFlowItemCacheKeyInput): SemanticFlowItemCacheKey {
    const anchorFingerprint = sha256Hex(stableJson(canonicalizeAnchor(input.anchor)));
    const initialSliceKey = sha256Hex(stableJson(canonicalizeSliceForItemKey(input.initialSlice)));
    const key = sha256Hex(stableJson({
        model: input.model,
        temperature: input.temperature,
        promptSchema: input.promptSchemaVersion,
        parserSchema: input.parserSchemaVersion,
        semanticsFingerprint: input.semanticsFingerprint,
        anchorFingerprint,
        initialSliceKey,
        maxRounds: input.maxRounds,
    }));
    return {
        key,
        keyPrefix: key.slice(0, 12),
        anchorId: input.anchor.id,
        anchorKey: buildAnchorKey(input.anchor.id),
        semanticsFingerprint: input.semanticsFingerprint,
        anchorFingerprint,
        initialSliceKey,
        maxRounds: input.maxRounds,
        model: input.model,
        temperature: input.temperature,
        promptSchemaVersion: input.promptSchemaVersion,
        parserSchemaVersion: input.parserSchemaVersion,
    };
}

export class SemanticFlowSessionCache {
    readonly rootDir: string;
    readonly mode: SemanticFlowSessionCacheMode;

    private readonly statsPath: string;
    private readonly decisionsDir: string;
    private readonly itemsDir: string;
    private readonly anchorsDir: string;
    private readonly now: () => Date;
    private readonly onEvent?: (event: SemanticFlowSessionCacheEvent) => void;
    private readonly stats: SemanticFlowSessionCacheStats = {
        llmCacheHitCount: 0,
        llmCacheMissCount: 0,
        llmCacheWriteCount: 0,
        itemCacheHitCount: 0,
    };

    constructor(options: SemanticFlowSessionCacheOptions) {
        this.rootDir = path.resolve(options.rootDir);
        this.mode = normalizeSemanticFlowSessionCacheMode(options.mode);
        this.statsPath = path.join(this.rootDir, "stats.json");
        this.decisionsDir = path.join(this.rootDir, "decisions");
        this.itemsDir = path.join(this.rootDir, "items");
        this.anchorsDir = path.join(this.rootDir, "anchors");
        this.now = options.now || (() => new Date());
        this.onEvent = options.onEvent;
        this.initialize();
    }

    isActive(): boolean {
        return this.mode !== "off";
    }

    canRead(): boolean {
        return this.mode === "read" || this.mode === "rw";
    }

    canWrite(): boolean {
        return this.mode === "write" || this.mode === "rw";
    }

    getStats(): SemanticFlowSessionCacheStats {
        return { ...this.stats };
    }

    getArtifactPaths(): SemanticFlowSessionCacheArtifactPaths {
        return {
            rootDir: this.rootDir,
            statsPath: this.statsPath,
            decisionsDir: this.decisionsDir,
            itemsDir: this.itemsDir,
            anchorsDir: this.anchorsDir,
        };
    }

    lookupDecision(key: SemanticFlowDecisionCacheKey): SemanticFlowDecision | undefined {
        if (!this.canRead()) return undefined;
        const recordPath = path.join(this.decisionsDir, `${key.key}.json`);
        if (!fs.existsSync(recordPath)) {
            this.stats.llmCacheMissCount++;
            this.persistStats();
            this.onEvent?.({ cache: "decision", outcome: "miss", anchorId: key.anchorId, round: key.round, key: key.key, keyPrefix: key.keyPrefix });
            return undefined;
        }
        const record = readJsonFile(recordPath) as { decision: SemanticFlowDecision };
        this.stats.llmCacheHitCount++;
        this.persistStats();
        this.onEvent?.({ cache: "decision", outcome: "hit", anchorId: key.anchorId, round: key.round, key: key.key, keyPrefix: key.keyPrefix });
        return record.decision;
    }

    storeDecision(key: SemanticFlowDecisionCacheKey, decision: SemanticFlowDecision): void {
        if (!this.canWrite()) return;
        const record = {
            meta: this.cacheMeta(key.anchorId, key.model),
            decision,
        };
        writeJsonAtomic(path.join(this.decisionsDir, `${key.key}.json`), record);
        this.writeAnchorRound(key, decision);
        this.stats.llmCacheWriteCount++;
        this.persistStats();
        this.onEvent?.({ cache: "decision", outcome: "write", anchorId: key.anchorId, round: key.round, key: key.key, keyPrefix: key.keyPrefix });
    }

    lookupItem(key: SemanticFlowItemCacheKey): CachedSemanticFlowItem | undefined {
        if (!this.canRead()) return undefined;
        const recordPath = path.join(this.itemsDir, `${key.key}.json`);
        if (!fs.existsSync(recordPath)) return undefined;
        const record = readJsonFile(recordPath) as { result: CachedSemanticFlowItem };
        this.stats.itemCacheHitCount++;
        this.persistStats();
        this.onEvent?.({ cache: "item", outcome: "hit", anchorId: key.anchorId, key: key.key, keyPrefix: key.keyPrefix });
        return record.result;
    }

    storeItem(key: SemanticFlowItemCacheKey, result: SemanticFlowItemResult): void {
        if (!this.canWrite()) return;
        const cachedResult = sanitizeItemResult(result);
        const record = {
            meta: this.cacheMeta(key.anchorId, key.model),
            result: cachedResult,
        };
        writeJsonAtomic(path.join(this.itemsDir, `${key.key}.json`), record);
        this.writeAnchorLatest(key, cachedResult);
        this.persistStats();
        this.onEvent?.({ cache: "item", outcome: "write", anchorId: key.anchorId, key: key.key, keyPrefix: key.keyPrefix });
    }

    restoreItemResult(anchor: SemanticFlowAnchor, cached: CachedSemanticFlowItem): SemanticFlowItemResult {
        const draftId = createSemanticFlowDraftId(anchor);
        return {
            anchor,
            draftId,
            plane: cached.plane,
            resolution: cached.resolution,
            asset: cached.asset,
            draft: cached.draft,
            lastMarker: cached.lastMarker,
            lastDelta: cached.lastDelta,
            finalSlice: restoreSlice(cached.finalSlice),
            history: cached.rounds.map(round => restoreRoundRecord(draftId, round)),
            error: cached.error,
        };
    }

    private initialize(): void {
        if (!this.isActive()) return;
        if (fs.existsSync(this.rootDir) && !fs.statSync(this.rootDir).isDirectory()) {
            throw new Error(`semanticflow session cache root is not a directory: ${this.rootDir}`);
        }
        if (this.canWrite()) {
            fs.mkdirSync(this.decisionsDir, { recursive: true });
            fs.mkdirSync(this.itemsDir, { recursive: true });
            fs.mkdirSync(this.anchorsDir, { recursive: true });
            this.persistStats();
        } else if (this.canRead() && !fs.existsSync(this.rootDir)) {
            throw new Error(`semanticflow session cache root missing for read mode: ${this.rootDir}`);
        }
    }

    private writeAnchorRound(key: SemanticFlowDecisionCacheKey, decision: SemanticFlowDecision): void {
        const anchorKey = buildAnchorKey(key.anchorId);
        const anchorDir = path.join(this.anchorsDir, sanitizePathSegment(anchorKey));
        fs.mkdirSync(anchorDir, { recursive: true });
        writeJsonAtomic(path.join(anchorDir, `round-${key.round}.json`), {
            meta: this.cacheMeta(key.anchorId, key.model),
            decision,
        });
    }

    private writeAnchorLatest(key: SemanticFlowItemCacheKey, result: CachedSemanticFlowItem): void {
        const anchorDir = path.join(this.anchorsDir, sanitizePathSegment(key.anchorKey));
        fs.mkdirSync(anchorDir, { recursive: true });
        writeJsonAtomic(path.join(anchorDir, "latest.json"), {
            meta: this.cacheMeta(key.anchorId, key.model),
            result,
        });
    }

    private persistStats(): void {
        if (!this.canWrite()) return;
        writeJsonAtomic(this.statsPath, {
            cacheKind: SEMANTIC_FLOW_SESSION_CACHE_KIND,
            generatedAt: this.isoNow(),
            mode: this.mode,
            ...this.getStats(),
        });
    }

    private cacheMeta(anchorId: string, model: string): Record<string, unknown> {
        return {
            cacheKind: SEMANTIC_FLOW_SESSION_CACHE_KIND,
            anchorId,
            model,
            storedAt: this.isoNow(),
        };
    }

    private isoNow(): string {
        return this.now().toISOString();
    }
}

function sanitizeItemResult(result: SemanticFlowItemResult): CachedSemanticFlowItem {
    const rounds = result.history.map(round => sanitizeRound(round));
    const finalRound = rounds.length > 0 ? rounds[rounds.length - 1].round : result.finalSlice.round;
    return {
        resolution: result.resolution,
        plane: result.plane,
        asset: result.asset,
        draft: result.draft,
        lastMarker: result.lastMarker,
        lastDelta: result.lastDelta,
        error: result.error,
        finalSlice: sanitizeCachedSlice(result.finalSlice),
        finalRound,
        rounds,
    };
}

function sanitizeRound(round: SemanticFlowRoundRecord): CachedSemanticFlowRound {
    return {
        round: round.round,
        status: round.error ? "error" : (round.decision?.status || "error"),
        slice: sanitizeCachedSlice(round.slice),
        decision: round.decision,
        draft: round.draft,
        deficit: round.deficit,
        plan: round.plan,
        delta: round.delta,
        marker: round.marker,
        error: round.error,
    };
}

function restoreRoundRecord(draftId: string, round: CachedSemanticFlowRound): SemanticFlowRoundRecord {
    return {
        round: round.round,
        draftId,
        slice: restoreSlice(round.slice),
        draft: round.draft,
        deficit: round.deficit,
        plan: round.plan,
        delta: round.delta,
        marker: round.marker,
        decision: round.decision,
        error: round.error,
    };
}

function sanitizeCachedSlice(slice: SemanticFlowSlicePackage): CachedSemanticFlowSlice {
    return {
        anchorId: slice.anchorId,
        round: slice.round,
        template: slice.template,
        observations: [...slice.observations],
        snippets: slice.snippets.map(snippet => ({ label: snippet.label, code: snippet.code })),
        companions: [...(slice.companions || [])],
        notes: [...(slice.notes || [])],
    };
}

function restoreSlice(slice: CachedSemanticFlowSlice): SemanticFlowSlicePackage {
    return {
        anchorId: slice.anchorId,
        round: slice.round,
        template: slice.template,
        observations: [...slice.observations],
        snippets: slice.snippets.map(snippet => ({ label: snippet.label, code: snippet.code })),
        companions: [...slice.companions],
        notes: [...slice.notes],
    };
}

function readJsonFile(filePath: string): unknown {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJsonAtomic(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), "utf-8");
    fs.renameSync(tmpPath, filePath);
}

function buildAnchorKey(anchorId: string): string {
    return sha256Hex(anchorId).slice(0, 16);
}

function sanitizePathSegment(value: string): string {
    return String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "unknown";
}

function canonicalizeAnchor(anchor: SemanticFlowAnchor): unknown {
    return {
        id: anchor.id,
        owner: anchor.owner,
        surface: anchor.surface,
        methodSignature: anchor.methodSignature,
        filePath: anchor.filePath,
        importSource: anchor.importSource,
        metaTags: anchor.metaTags,
        arkMainSelector: anchor.arkMainSelector,
    };
}

function canonicalizeSliceForItemKey(slice: SemanticFlowSlicePackage): unknown {
    return {
        anchorId: slice.anchorId,
        template: slice.template,
        observations: slice.observations,
        snippets: slice.snippets,
        companions: slice.companions,
        notes: slice.notes,
    };
}

function hashOptionalValue(value: unknown): string | undefined {
    return value === undefined ? undefined : sha256Hex(stableJson(value));
}

function stableJson(value: unknown): string {
    return JSON.stringify(canonicalizeValue(value));
}

function canonicalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalizeValue);
    if (!value || typeof value !== "object") return value;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries) out[key] = canonicalizeValue(item);
    return out;
}

function sha256Hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}
