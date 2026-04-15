import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { createSemanticFlowDraftId, stableSemanticFlowSliceKey } from "./SemanticFlowIncremental";
import type {
    SemanticFlowAnchor,
    SemanticFlowArtifactClass,
    SemanticFlowDecision,
    SemanticFlowDelta,
    SemanticFlowItemResult,
    SemanticFlowMarker,
    SemanticFlowResolution,
    SemanticFlowRoundRecord,
    SemanticFlowSlicePackage,
    SemanticFlowSummary,
} from "./SemanticFlowTypes";

export const SEMANTIC_FLOW_SESSION_CACHE_KIND = "semanticflow_llm_session";
export const SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION = 1;

export type SemanticFlowSessionCacheMode = "off" | "read" | "write" | "rw";

export interface SemanticFlowSessionCacheStats {
    llmCacheHitCount: number;
    llmCacheMissCount: number;
    llmCacheWriteCount: number;
    itemCacheHitCount: number;
}

export type SemanticFlowSessionCacheEvent =
    | {
        cache: "decision";
        outcome: "hit" | "miss" | "write";
        anchorId: string;
        round: number;
        key: string;
        keyPrefix: string;
    }
    | {
        cache: "item";
        outcome: "hit" | "write";
        anchorId: string;
        key: string;
        keyPrefix: string;
    };

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
    draft?: SemanticFlowSummary;
    lastMarker?: SemanticFlowMarker;
    lastDelta?: SemanticFlowDelta;
}

export interface SemanticFlowItemCacheKey {
    key: string;
    keyPrefix: string;
    anchorId: string;
    anchorKey: string;
    anchorFingerprint: string;
    initialSliceKey: string;
    maxRounds: number;
    model: string;
}

export interface SemanticFlowItemCacheKeyInput {
    model: string;
    anchor: SemanticFlowAnchor;
    initialSlice: SemanticFlowSlicePackage;
    maxRounds: number;
}

export interface CachedSemanticFlowRound {
    round: number;
    status: "done" | "need-more-evidence" | "reject" | "error";
    decision?: SemanticFlowDecision;
    summary?: SemanticFlowSummary;
    error?: string;
}

export interface CachedSemanticFlowItem {
    resolution: SemanticFlowResolution;
    classification?: SemanticFlowArtifactClass;
    summary?: SemanticFlowSummary;
    draft?: SemanticFlowSummary;
    error?: string;
    finalRound: number;
    rounds: CachedSemanticFlowRound[];
}

interface DecisionCacheRecord {
    meta: {
        schemaVersion: number;
        cacheKind: string;
        key: string;
        keyPrefix: string;
        createdAt: string;
        lastHitAt: string;
        hitCount: number;
        anchorId: string;
        round: number;
        model: string;
        temperature: number;
        promptSchemaVersion: number;
        parserSchemaVersion: number;
    };
    decision: SemanticFlowDecision;
    summary?: SemanticFlowSummary;
}

interface ItemCacheRecord {
    meta: {
        schemaVersion: number;
        cacheKind: string;
        key: string;
        keyPrefix: string;
        createdAt: string;
        lastHitAt: string;
        hitCount: number;
        anchorId: string;
        anchorKey: string;
        anchorFingerprint: string;
        initialSliceKey: string;
        maxRounds: number;
        model: string;
        finalRound: number;
        roundCount: number;
    };
    result: CachedSemanticFlowItem;
}

interface AnchorRoundRecord {
    meta: {
        schemaVersion: number;
        cacheKind: string;
        anchorId: string;
        anchorKey: string;
        round: number;
        storedAt: string;
        model: string;
        decisionKey: string;
        decisionKeyPrefix: string;
    };
    decision: SemanticFlowDecision;
    summary?: SemanticFlowSummary;
}

interface AnchorLatestRecord {
    meta: {
        schemaVersion: number;
        cacheKind: string;
        anchorId: string;
        anchorKey: string;
        storedAt: string;
        model: string;
        itemKey: string;
        itemKeyPrefix: string;
    };
    result: CachedSemanticFlowItem;
}

interface CacheSchemaRecord {
    schemaVersion: number;
    cacheKind: string;
    createdAt: string;
    decisionKeyFields: string[];
    itemKeyFields: string[];
    storedArtifacts: string[];
}

interface CacheStatsRecord extends SemanticFlowSessionCacheStats {
    schemaVersion: number;
    cacheKind: string;
    generatedAt: string;
    mode: SemanticFlowSessionCacheMode;
}

export function normalizeSemanticFlowSessionCacheMode(
    raw: string | undefined,
    flagName = "--llmSessionCacheMode",
): SemanticFlowSessionCacheMode {
    const normalized = String(raw || "").trim();
    if (!normalized) {
        return "rw";
    }
    if (normalized === "off" || normalized === "read" || normalized === "write" || normalized === "rw") {
        return normalized;
    }
    throw new Error(`invalid ${flagName}: ${raw}`);
}

export function resolveDefaultSemanticFlowSessionCacheDir(repo: string): string {
    return path.resolve(repo, "tmp", SEMANTIC_FLOW_SESSION_CACHE_KIND);
}

export function buildSemanticFlowDecisionCacheKey(
    input: SemanticFlowDecisionCacheKeyInput,
): SemanticFlowDecisionCacheKey {
    const payload = {
        cacheSchemaVersion: SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION,
        promptSchemaVersion: input.promptSchemaVersion,
        parserSchemaVersion: input.parserSchemaVersion,
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
    };
    const key = sha256Hex(stableJson(payload));
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

export function buildSemanticFlowItemCacheKey(
    input: SemanticFlowItemCacheKeyInput,
): SemanticFlowItemCacheKey {
    const anchorFingerprint = sha256Hex(stableJson(canonicalizeAnchor(input.anchor)));
    const initialSliceKey = sha256Hex(stableJson(canonicalizeSliceForItemKey(input.initialSlice)));
    const payload = {
        cacheSchemaVersion: SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION,
        model: input.model,
        anchorFingerprint,
        initialSliceKey,
        maxRounds: input.maxRounds,
    };
    const key = sha256Hex(stableJson(payload));
    return {
        key,
        keyPrefix: key.slice(0, 12),
        anchorId: input.anchor.id,
        anchorKey: buildAnchorKey(input.anchor.id),
        anchorFingerprint,
        initialSliceKey,
        maxRounds: input.maxRounds,
        model: input.model,
    };
}

export class SemanticFlowSessionCache {
    readonly rootDir: string;
    readonly mode: SemanticFlowSessionCacheMode;

    private readonly schemaPath: string;
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
        this.schemaPath = path.join(this.rootDir, "schema.json");
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
        return {
            llmCacheHitCount: this.stats.llmCacheHitCount,
            llmCacheMissCount: this.stats.llmCacheMissCount,
            llmCacheWriteCount: this.stats.llmCacheWriteCount,
            itemCacheHitCount: this.stats.itemCacheHitCount,
        };
    }

    lookupDecision(key: SemanticFlowDecisionCacheKey): SemanticFlowDecision | undefined {
        if (!this.canRead()) {
            return undefined;
        }
        const recordPath = path.join(this.decisionsDir, `${key.key}.json`);
        if (!fs.existsSync(recordPath)) {
            this.stats.llmCacheMissCount++;
            this.persistStats();
            this.onEvent?.({
                cache: "decision",
                outcome: "miss",
                anchorId: key.anchorId,
                round: key.round,
                key: key.key,
                keyPrefix: key.keyPrefix,
            });
            return undefined;
        }
        const record = validateDecisionCacheRecord(readJsonFile(recordPath), recordPath);
        this.stats.llmCacheHitCount++;
        if (this.canWrite()) {
            const updated: DecisionCacheRecord = {
                ...record,
                meta: {
                    ...record.meta,
                    hitCount: record.meta.hitCount + 1,
                    lastHitAt: this.isoNow(),
                },
            };
            writeJsonAtomic(recordPath, updated);
        }
        this.persistStats();
        this.onEvent?.({
            cache: "decision",
            outcome: "hit",
            anchorId: key.anchorId,
            round: key.round,
            key: key.key,
            keyPrefix: key.keyPrefix,
        });
        return record.decision;
    }

    storeDecision(
        key: SemanticFlowDecisionCacheKey,
        decision: SemanticFlowDecision,
    ): void {
        if (!this.canWrite()) {
            return;
        }
        const storedAt = this.isoNow();
        const record: DecisionCacheRecord = {
            meta: {
                schemaVersion: SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION,
                cacheKind: SEMANTIC_FLOW_SESSION_CACHE_KIND,
                key: key.key,
                keyPrefix: key.keyPrefix,
                createdAt: storedAt,
                lastHitAt: storedAt,
                hitCount: 0,
                anchorId: key.anchorId,
                round: key.round,
                model: key.model,
                temperature: key.temperature,
                promptSchemaVersion: key.promptSchemaVersion,
                parserSchemaVersion: key.parserSchemaVersion,
            },
            decision,
            summary: extractDecisionSummary(decision),
        };
        writeJsonAtomic(path.join(this.decisionsDir, `${key.key}.json`), record);
        this.writeAnchorRound(key, decision);
        this.stats.llmCacheWriteCount++;
        this.persistStats();
        this.onEvent?.({
            cache: "decision",
            outcome: "write",
            anchorId: key.anchorId,
            round: key.round,
            key: key.key,
            keyPrefix: key.keyPrefix,
        });
    }

    lookupItem(key: SemanticFlowItemCacheKey): CachedSemanticFlowItem | undefined {
        if (!this.canRead()) {
            return undefined;
        }
        const recordPath = path.join(this.itemsDir, `${key.key}.json`);
        if (!fs.existsSync(recordPath)) {
            return undefined;
        }
        const record = validateItemCacheRecord(readJsonFile(recordPath), recordPath);
        this.stats.itemCacheHitCount++;
        if (this.canWrite()) {
            const updated: ItemCacheRecord = {
                ...record,
                meta: {
                    ...record.meta,
                    hitCount: record.meta.hitCount + 1,
                    lastHitAt: this.isoNow(),
                },
            };
            writeJsonAtomic(recordPath, updated);
        }
        this.persistStats();
        this.onEvent?.({
            cache: "item",
            outcome: "hit",
            anchorId: key.anchorId,
            key: key.key,
            keyPrefix: key.keyPrefix,
        });
        return record.result;
    }

    storeItem(
        key: SemanticFlowItemCacheKey,
        result: SemanticFlowItemResult,
    ): void {
        if (!this.canWrite()) {
            return;
        }
        const storedAt = this.isoNow();
        const cachedResult = sanitizeItemResult(result);
        const record: ItemCacheRecord = {
            meta: {
                schemaVersion: SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION,
                cacheKind: SEMANTIC_FLOW_SESSION_CACHE_KIND,
                key: key.key,
                keyPrefix: key.keyPrefix,
                createdAt: storedAt,
                lastHitAt: storedAt,
                hitCount: 0,
                anchorId: key.anchorId,
                anchorKey: key.anchorKey,
                anchorFingerprint: key.anchorFingerprint,
                initialSliceKey: key.initialSliceKey,
                maxRounds: key.maxRounds,
                model: key.model,
                finalRound: cachedResult.finalRound,
                roundCount: cachedResult.rounds.length,
            },
            result: cachedResult,
        };
        writeJsonAtomic(path.join(this.itemsDir, `${key.key}.json`), record);
        this.writeAnchorLatest(key, cachedResult);
        this.persistStats();
        this.onEvent?.({
            cache: "item",
            outcome: "write",
            anchorId: key.anchorId,
            key: key.key,
            keyPrefix: key.keyPrefix,
        });
    }

    restoreItemResult(
        anchor: SemanticFlowAnchor,
        initialSlice: SemanticFlowSlicePackage,
        cached: CachedSemanticFlowItem,
    ): SemanticFlowItemResult {
        const draftId = createSemanticFlowDraftId(anchor);
        const history = cached.rounds.map(round => restoreRoundRecord(anchor.id, initialSlice.template, draftId, round));
        return {
            anchor,
            draftId,
            classification: cached.classification,
            resolution: cached.resolution,
            summary: cached.summary,
            draft: cached.draft,
            finalSlice: {
                anchorId: anchor.id,
                round: cached.finalRound,
                template: initialSlice.template,
                observations: [],
                snippets: [],
                companions: [],
                notes: [],
            },
            history,
            error: cached.error,
        };
    }

    private initialize(): void {
        if (!this.isActive()) {
            return;
        }
        if (fs.existsSync(this.rootDir)) {
            this.validateExistingSchema();
        }
        if (this.canWrite()) {
            fs.mkdirSync(this.decisionsDir, { recursive: true });
            fs.mkdirSync(this.itemsDir, { recursive: true });
            fs.mkdirSync(this.anchorsDir, { recursive: true });
            this.ensureSchema();
            this.persistStats();
        }
    }

    private validateExistingSchema(): void {
        if (!fs.existsSync(this.rootDir) || !fs.statSync(this.rootDir).isDirectory()) {
            throw new Error(`semanticflow session cache root is not a directory: ${this.rootDir}`);
        }
        const entries = fs.readdirSync(this.rootDir);
        if (entries.length === 0 && !fs.existsSync(this.schemaPath)) {
            return;
        }
        if (!fs.existsSync(this.schemaPath)) {
            throw new Error(`semanticflow session cache missing schema.json: ${this.rootDir}`);
        }
        const schema = readJsonFile(this.schemaPath) as CacheSchemaRecord;
        if (schema?.schemaVersion !== SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION) {
            throw new Error(
                `semanticflow session cache schema mismatch: expected ${SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION}, got ${schema?.schemaVersion}`,
            );
        }
        if (schema?.cacheKind !== SEMANTIC_FLOW_SESSION_CACHE_KIND) {
            throw new Error(`semanticflow session cache kind mismatch: ${this.schemaPath}`);
        }
    }

    private ensureSchema(): void {
        if (fs.existsSync(this.schemaPath)) {
            return;
        }
        const payload: CacheSchemaRecord = {
            schemaVersion: SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION,
            cacheKind: SEMANTIC_FLOW_SESSION_CACHE_KIND,
            createdAt: this.isoNow(),
            decisionKeyFields: [
                "cacheSchemaVersion",
                "promptSchemaVersion",
                "parserSchemaVersion",
                "model",
                "temperature",
                "systemHash",
                "userHash",
                "anchorId",
                "round",
                "sliceKey",
                "draftHash",
                "lastMarkerHash",
                "lastDeltaHash",
            ],
            itemKeyFields: [
                "cacheSchemaVersion",
                "model",
                "anchorFingerprint",
                "initialSliceKey",
                "maxRounds",
            ],
            storedArtifacts: [
                "decisions: structured decision + summary only",
                "items: final resolution/classification/error + round decisions/summaries only",
                "anchors: per-round/latest summaries only",
                "excludes: prompt text, raw LLM response, code slice raw content",
            ],
        };
        writeJsonAtomic(this.schemaPath, payload);
    }

    private writeAnchorRound(key: SemanticFlowDecisionCacheKey, decision: SemanticFlowDecision): void {
        const anchorKey = buildAnchorKey(key.anchorId);
        const anchorDir = path.join(this.anchorsDir, sanitizePathSegment(anchorKey));
        fs.mkdirSync(anchorDir, { recursive: true });
        const payload: AnchorRoundRecord = {
            meta: {
                schemaVersion: SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION,
                cacheKind: SEMANTIC_FLOW_SESSION_CACHE_KIND,
                anchorId: key.anchorId,
                anchorKey,
                round: key.round,
                storedAt: this.isoNow(),
                model: key.model,
                decisionKey: key.key,
                decisionKeyPrefix: key.keyPrefix,
            },
            decision,
            summary: extractDecisionSummary(decision),
        };
        writeJsonAtomic(path.join(anchorDir, `round-${key.round}.json`), payload);
    }

    private writeAnchorLatest(key: SemanticFlowItemCacheKey, result: CachedSemanticFlowItem): void {
        const anchorDir = path.join(this.anchorsDir, sanitizePathSegment(key.anchorKey));
        fs.mkdirSync(anchorDir, { recursive: true });
        const payload: AnchorLatestRecord = {
            meta: {
                schemaVersion: SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION,
                cacheKind: SEMANTIC_FLOW_SESSION_CACHE_KIND,
                anchorId: key.anchorId,
                anchorKey: key.anchorKey,
                storedAt: this.isoNow(),
                model: key.model,
                itemKey: key.key,
                itemKeyPrefix: key.keyPrefix,
            },
            result,
        };
        writeJsonAtomic(path.join(anchorDir, "latest.json"), payload);
    }

    private persistStats(): void {
        if (!this.canWrite()) {
            return;
        }
        const payload: CacheStatsRecord = {
            schemaVersion: SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION,
            cacheKind: SEMANTIC_FLOW_SESSION_CACHE_KIND,
            generatedAt: this.isoNow(),
            mode: this.mode,
            ...this.getStats(),
        };
        writeJsonAtomic(this.statsPath, payload);
    }

    private isoNow(): string {
        return this.now().toISOString();
    }
}

function sanitizeItemResult(result: SemanticFlowItemResult): CachedSemanticFlowItem {
    const rounds = result.history.map(round => sanitizeRound(round));
    const finalRound = rounds.length > 0
        ? rounds[rounds.length - 1].round
        : result.finalSlice.round;
    return {
        resolution: result.resolution,
        classification: result.classification,
        summary: result.summary,
        draft: result.draft,
        error: result.error,
        finalRound,
        rounds,
    };
}

function sanitizeRound(round: SemanticFlowRoundRecord): CachedSemanticFlowRound {
    if (round.error) {
        return {
            round: round.round,
            status: "error",
            summary: round.draft,
            error: round.error,
        };
    }
    if (!round.decision) {
        throw new Error(`semanticflow round ${round.round} is missing a decision`);
    }
    return {
        round: round.round,
        status: round.decision.status,
        decision: round.decision,
        summary: round.decision.status === "done"
            ? round.decision.summary
            : round.decision.status === "need-more-evidence"
                ? round.decision.draft
                : undefined,
    };
}

function restoreRoundRecord(
    anchorId: string,
    template: SemanticFlowSlicePackage["template"],
    draftId: string,
    round: CachedSemanticFlowRound,
): SemanticFlowRoundRecord {
    return {
        round: round.round,
        draftId,
        slice: {
            anchorId,
            round: round.round,
            template,
            observations: [],
            snippets: [],
            companions: [],
            notes: [],
        },
        draft: round.summary,
        decision: round.decision,
        error: round.error,
    };
}

function extractDecisionSummary(decision: SemanticFlowDecision): SemanticFlowSummary | undefined {
    if (decision.status === "done") {
        return decision.summary;
    }
    if (decision.status === "need-more-evidence") {
        return decision.draft;
    }
    return undefined;
}

function canonicalizeAnchor(anchor: SemanticFlowAnchor): Record<string, unknown> {
    return canonicalizeValue({
        id: anchor.id,
        owner: anchor.owner,
        surface: anchor.surface,
        methodSignature: anchor.methodSignature,
        filePath: anchor.filePath,
        line: anchor.line,
        importSource: anchor.importSource,
        stringLiterals: anchor.stringLiterals,
        metaTags: anchor.metaTags,
        arkMainSelector: anchor.arkMainSelector,
    }) as Record<string, unknown>;
}

function canonicalizeSliceForItemKey(slice: SemanticFlowSlicePackage): Record<string, unknown> {
    return canonicalizeValue({
        template: slice.template,
        observations: slice.observations,
        snippets: slice.snippets,
        companions: slice.companions,
        notes: slice.notes,
    }) as Record<string, unknown>;
}

function stableJson(value: unknown): string {
    return JSON.stringify(canonicalizeValue(value));
}

function hashOptionalValue(value: unknown): string {
    if (value === undefined) {
        return "absent";
    }
    return sha256Hex(stableJson(value));
}

function sha256Hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function buildAnchorKey(anchorId: string): string {
    return sha256Hex(stableJson({
        cacheSchemaVersion: SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION,
        anchorId,
    }));
}

function canonicalizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(item => canonicalizeValue(item));
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries) {
        out[key] = canonicalizeValue(item);
    }
    return out;
}

function writeJsonAtomic(targetPath: string, payload: unknown): void {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf-8");
    fs.rmSync(targetPath, { force: true });
    fs.renameSync(tempPath, targetPath);
}

function readJsonFile(filePath: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (error) {
        const detail = String((error as any)?.message || error);
        throw new Error(`semanticflow session cache invalid JSON: ${filePath}; ${detail}`);
    }
}

function validateDecisionCacheRecord(raw: unknown, filePath: string): DecisionCacheRecord {
    const obj = expectObject(raw, filePath);
    const meta = expectObject(obj.meta, `${filePath}.meta`);
    if (expectNumber(meta.schemaVersion, `${filePath}.meta.schemaVersion`) !== SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION) {
        throw new Error(`semanticflow session cache schema mismatch in ${filePath}`);
    }
    if (expectString(meta.cacheKind, `${filePath}.meta.cacheKind`) !== SEMANTIC_FLOW_SESSION_CACHE_KIND) {
        throw new Error(`semanticflow session cache kind mismatch in ${filePath}`);
    }
    expectString(meta.key, `${filePath}.meta.key`);
    expectString(meta.keyPrefix, `${filePath}.meta.keyPrefix`);
    expectString(meta.anchorId, `${filePath}.meta.anchorId`);
    expectNumber(meta.round, `${filePath}.meta.round`);
    expectString(meta.model, `${filePath}.meta.model`);
    expectNumber(meta.temperature, `${filePath}.meta.temperature`);
    expectNumber(meta.promptSchemaVersion, `${filePath}.meta.promptSchemaVersion`);
    expectNumber(meta.parserSchemaVersion, `${filePath}.meta.parserSchemaVersion`);
    expectString(meta.createdAt, `${filePath}.meta.createdAt`);
    expectString(meta.lastHitAt, `${filePath}.meta.lastHitAt`);
    expectNumber(meta.hitCount, `${filePath}.meta.hitCount`);
    if (!obj.decision || typeof obj.decision !== "object" || Array.isArray(obj.decision)) {
        throw new Error(`semanticflow session cache decision missing or invalid: ${filePath}`);
    }
    return obj as DecisionCacheRecord;
}

function validateItemCacheRecord(raw: unknown, filePath: string): ItemCacheRecord {
    const obj = expectObject(raw, filePath);
    const meta = expectObject(obj.meta, `${filePath}.meta`);
    if (expectNumber(meta.schemaVersion, `${filePath}.meta.schemaVersion`) !== SEMANTIC_FLOW_SESSION_CACHE_SCHEMA_VERSION) {
        throw new Error(`semanticflow session cache schema mismatch in ${filePath}`);
    }
    if (expectString(meta.cacheKind, `${filePath}.meta.cacheKind`) !== SEMANTIC_FLOW_SESSION_CACHE_KIND) {
        throw new Error(`semanticflow session cache kind mismatch in ${filePath}`);
    }
    expectString(meta.key, `${filePath}.meta.key`);
    expectString(meta.keyPrefix, `${filePath}.meta.keyPrefix`);
    expectString(meta.anchorId, `${filePath}.meta.anchorId`);
    expectString(meta.anchorKey, `${filePath}.meta.anchorKey`);
    expectString(meta.anchorFingerprint, `${filePath}.meta.anchorFingerprint`);
    expectString(meta.initialSliceKey, `${filePath}.meta.initialSliceKey`);
    expectNumber(meta.maxRounds, `${filePath}.meta.maxRounds`);
    expectString(meta.model, `${filePath}.meta.model`);
    expectNumber(meta.finalRound, `${filePath}.meta.finalRound`);
    expectNumber(meta.roundCount, `${filePath}.meta.roundCount`);
    expectString(meta.createdAt, `${filePath}.meta.createdAt`);
    expectString(meta.lastHitAt, `${filePath}.meta.lastHitAt`);
    expectNumber(meta.hitCount, `${filePath}.meta.hitCount`);
    const result = expectObject(obj.result, `${filePath}.result`);
    expectString(result.resolution, `${filePath}.result.resolution`);
    if (!Array.isArray(result.rounds)) {
        throw new Error(`semanticflow cached item rounds must be an array: ${filePath}`);
    }
    for (let index = 0; index < result.rounds.length; index++) {
        validateCachedRound(result.rounds[index], `${filePath}.result.rounds[${index}]`);
    }
    expectNumber(result.finalRound, `${filePath}.result.finalRound`);
    if (expectNumber(meta.roundCount, `${filePath}.meta.roundCount`) !== result.rounds.length) {
        throw new Error(`semanticflow cached item round count mismatch: ${filePath}`);
    }
    return obj as ItemCacheRecord;
}

function validateCachedRound(raw: unknown, pathName: string): void {
    const obj = expectObject(raw, pathName);
    expectNumber(obj.round, `${pathName}.round`);
    const status = expectString(obj.status, `${pathName}.status`);
    if (!new Set(["done", "need-more-evidence", "reject", "error"]).has(status)) {
        throw new Error(`${pathName}.status invalid: ${status}`);
    }
    if (obj.decision !== undefined && (!obj.decision || typeof obj.decision !== "object" || Array.isArray(obj.decision))) {
        throw new Error(`${pathName}.decision must be an object`);
    }
    if (obj.summary !== undefined && (!obj.summary || typeof obj.summary !== "object" || Array.isArray(obj.summary))) {
        throw new Error(`${pathName}.summary must be an object`);
    }
    if (obj.error !== undefined) {
        expectString(obj.error, `${pathName}.error`);
    }
}

function expectObject(value: unknown, pathName: string): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${pathName} must be an object`);
    }
    return value as Record<string, any>;
}

function expectString(value: unknown, pathName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${pathName} must be a non-empty string`);
    }
    return value.trim();
}

function expectNumber(value: unknown, pathName: string): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        throw new Error(`${pathName} must be a finite number`);
    }
    return numeric;
}

function sanitizePathSegment(value: string): string {
    const normalized = String(value || "").trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_");
    if (!normalized) {
        throw new Error("semanticflow session cache path segment must not be empty");
    }
    return normalized;
}
