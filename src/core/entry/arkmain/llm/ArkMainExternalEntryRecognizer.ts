import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
    ArkMainExternalEntryCandidate,
    ArkMainExternalEntryRecognition,
    ArkMainExternalEntryRecognizerOptions,
} from "./ArkMainExternalEntryTypes";

type RecognizedKind = NonNullable<ArkMainExternalEntryRecognition["kind"]>;
type RecognizedPhase = NonNullable<ArkMainExternalEntryRecognition["phase"]>;

export interface ArkMainExternalEntryModelInvokerInput {
    prompt: string;
    candidates: ArkMainExternalEntryCandidate[];
    model?: string;
}

export type ArkMainExternalEntryModelInvoker =
    (input: ArkMainExternalEntryModelInvokerInput) => Promise<string>;

export interface RecognizeExternalArkMainEntriesOptions extends ArkMainExternalEntryRecognizerOptions {
    modelInvoker?: ArkMainExternalEntryModelInvoker;
}

const ALLOWED_PHASES: Set<RecognizedPhase> = new Set([
    "bootstrap",
    "composition",
    "interaction",
    "reactive_handoff",
    "teardown",
]);

const ALLOWED_KINDS: Set<RecognizedKind> = new Set([
    "ability_lifecycle",
    "stage_lifecycle",
    "extension_lifecycle",
    "page_build",
    "page_lifecycle",
    "callback",
]);

const EXTERNAL_ENTRY_CACHE_VERSION = 1;

interface ExternalEntryRecognitionCacheFile {
    version: number;
    items: Record<string, ArkMainExternalEntryRecognition>;
}

export async function recognizeExternalArkMainEntries(
    candidates: ArkMainExternalEntryCandidate[],
    options: RecognizeExternalArkMainEntriesOptions = {},
): Promise<ArkMainExternalEntryRecognition[]> {
    if (!candidates.length) {
        return [];
    }

    const maxCandidates = options.maxCandidates ?? candidates.length;
    const minConfidence = options.minConfidence ?? 0.85;
    const batchSize = Math.max(1, options.batchSize ?? 12);
    const selectedCandidates = candidates.slice(0, maxCandidates);
    const candidateBySignature = new Map(
        selectedCandidates.map(candidate => [candidate.methodSignature, candidate]),
    );
    const cache = loadRecognitionCache(options);
    const cachedRecognitions: ArkMainExternalEntryRecognition[] = [];
    const uncachedCandidates: ArkMainExternalEntryCandidate[] = [];

    for (const candidate of selectedCandidates) {
        const cached = cache.items.get(buildCacheKey(candidate, options.model));
        if (cached) {
            cachedRecognitions.push(cached);
            continue;
        }
        uncachedCandidates.push(candidate);
    }

    if (!options.modelInvoker) {
        return dedupeAndSortRecognitions(cachedRecognitions.filter(item => item.isEntry && item.confidence >= minConfidence));
    }

    const results: ArkMainExternalEntryRecognition[] = [...cachedRecognitions];
    for (const batch of chunkCandidates(uncachedCandidates, batchSize)) {
        const prompt = buildRecognitionPrompt(batch);
        let rawResponse = "";
        try {
            rawResponse = await options.modelInvoker({
                prompt,
                candidates: batch,
                model: options.model,
            });
        } catch {
            continue;
        }

        const parsed = parseRecognitionResponse(rawResponse, candidateBySignature);
        if (parsed.length === 0) {
            continue;
        }

        const normalizedBatch = ensureBatchCoverage(batch, parsed);
        results.push(...normalizedBatch);
        persistRecognitionsToCache(cache, normalizedBatch, batch, options.model);
    }

    saveRecognitionCache(cache);
    return dedupeAndSortRecognitions(results.filter(item => item.isEntry && item.confidence >= minConfidence));
}

function buildRecognitionPrompt(candidates: ArkMainExternalEntryCandidate[]): string {
    const candidateBlocks = candidates.map((candidate, index) => {
        return [
            `Candidate #${index + 1}`,
            candidate.summaryText,
        ].join("\n");
    });

    return [
        "You are classifying ArkTS/Harmony methods as possible framework-managed external entry points.",
        "An entry point means a method that is invoked by framework/runtime lifecycle, page composition, router handoff, or framework callback dispatch.",
        "Do NOT classify ordinary business helpers, internal utility methods, or methods called directly by app code as entries.",
        "Be conservative: only return isEntry=true when evidence is strong.",
        "",
        "For each candidate, return a JSON array item with fields:",
        '- methodSignature: string',
        '- isEntry: boolean',
        '- confidence: number between 0 and 1',
        '- phase: one of "bootstrap", "composition", "interaction", "reactive_handoff", "teardown" (omit if isEntry=false)',
        '- kind: one of "ability_lifecycle", "stage_lifecycle", "extension_lifecycle", "page_build", "page_lifecycle", "callback" (omit if isEntry=false)',
        '- reason: short string',
        '- evidenceTags: string[]',
        "",
        "Output ONLY a JSON array. No markdown fences. No extra commentary.",
        "",
        "Candidates:",
        candidateBlocks.join("\n\n"),
    ].join("\n");
}

function parseRecognitionResponse(
    rawResponse: string,
    candidateBySignature: Map<string, ArkMainExternalEntryCandidate>,
): ArkMainExternalEntryRecognition[] {
    const jsonText = extractJsonArrayText(rawResponse);
    if (!jsonText) {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return [];
    }

    if (!Array.isArray(parsed)) {
        return [];
    }

    const out: ArkMainExternalEntryRecognition[] = [];
    for (const item of parsed) {
        const normalized = normalizeRecognitionItem(item, candidateBySignature);
        if (!normalized) {
            continue;
        }
        out.push(normalized);
    }
    return out;
}

function normalizeRecognitionItem(
    value: unknown,
    candidateBySignature: Map<string, ArkMainExternalEntryCandidate>,
): ArkMainExternalEntryRecognition | null {
    if (!isRecord(value)) {
        return null;
    }

    const methodSignature = asString(value.methodSignature);
    if (!methodSignature || !candidateBySignature.has(methodSignature)) {
        return null;
    }

    const isEntry = Boolean(value.isEntry);
    const confidence = clampConfidence(value.confidence);
    const reason = asString(value.reason) || (isEntry ? "llm classified as external entry" : "llm rejected candidate");
    const evidenceTags = asStringArray(value.evidenceTags);

    if (!isEntry) {
        return {
            methodSignature,
            isEntry: false,
            confidence,
            reason,
            evidenceTags,
        };
    }

    const phase = asAllowedPhase(value.phase) || inferPhaseFromCandidate(candidateBySignature.get(methodSignature)!);
    const kind = asAllowedKind(value.kind) || inferKindFromCandidate(candidateBySignature.get(methodSignature)!);

    if (!phase || !kind) {
        return null;
    }

    return {
        methodSignature,
        isEntry: true,
        confidence,
        phase,
        kind,
        reason,
        evidenceTags,
    };
}

function inferPhaseFromCandidate(candidate: ArkMainExternalEntryCandidate): RecognizedPhase | undefined {
    const text = buildSearchText(candidate);

    if (includesAny(text, ["build", "render", "compose"])) {
        return "composition";
    }
    if (includesAny(text, ["acceptwant", "newwant", "handoff", "route", "nav", "navigation"])) {
        return "reactive_handoff";
    }
    if (includesAny(text, ["destroy", "disconnect", "background", "stop", "dispose", "hide"])) {
        return "teardown";
    }
    if (includesAny(text, ["create", "init", "start", "load", "foreground", "show", "appear"])) {
        return "bootstrap";
    }
    return "interaction";
}

function inferKindFromCandidate(candidate: ArkMainExternalEntryCandidate): RecognizedKind | undefined {
    const text = buildSearchText(candidate);

    if (includesAny(text, ["component_owner", "builder_owner", "component", "page", "build", "render"])) {
        if (includesAny(text, ["build", "render", "compose"])) {
            return "page_build";
        }
        return "page_lifecycle";
    }

    if (includesAny(text, ["extension_owner", "extension"])) {
        return "extension_lifecycle";
    }

    if (includesAny(text, ["stage_owner", "stage"])) {
        return "stage_lifecycle";
    }

    if (includesAny(text, ["ability_owner", "ability"])) {
        return "ability_lifecycle";
    }

    if (includesAny(text, ["callback", "event"])) {
        return "callback";
    }

    return undefined;
}

function dedupeAndSortRecognitions(
    recognitions: ArkMainExternalEntryRecognition[],
): ArkMainExternalEntryRecognition[] {
    const bestBySignature = new Map<string, ArkMainExternalEntryRecognition>();

    for (const recognition of recognitions) {
        if (!recognition.isEntry) {
            continue;
        }

        const existing = bestBySignature.get(recognition.methodSignature);
        if (!existing || recognition.confidence > existing.confidence) {
            bestBySignature.set(recognition.methodSignature, recognition);
        }
    }

    return [...bestBySignature.values()].sort((left, right) => {
        if (left.confidence !== right.confidence) {
            return right.confidence - left.confidence;
        }
        return left.methodSignature.localeCompare(right.methodSignature);
    });
}

function extractJsonArrayText(rawResponse: string): string | null {
    const trimmed = String(rawResponse || "").trim();
    if (!trimmed) {
        return null;
    }

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch?.[1]) {
        const inner = fencedMatch[1].trim();
        if (inner.startsWith("[")) {
            return inner;
        }
    }

    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start >= 0 && end > start) {
        return trimmed.slice(start, end + 1);
    }

    return null;
}

function chunkCandidates(
    candidates: ArkMainExternalEntryCandidate[],
    batchSize: number,
): ArkMainExternalEntryCandidate[][] {
    const out: ArkMainExternalEntryCandidate[][] = [];
    for (let i = 0; i < candidates.length; i += batchSize) {
        out.push(candidates.slice(i, i + batchSize));
    }
    return out;
}

function buildSearchText(candidate: ArkMainExternalEntryCandidate): string {
    return [
        candidate.className,
        candidate.methodName,
        candidate.filePath || "",
        candidate.superClassName || "",
        candidate.parameterTypes.join(" "),
        candidate.returnType || "",
        candidate.ownerSignals.join(" "),
        candidate.overrideSignals.join(" "),
        candidate.frameworkSignals.join(" "),
        candidate.summaryText,
    ].join(" ").toLowerCase();
}

function includesAny(text: string, patterns: string[]): boolean {
    return patterns.some(pattern => text.includes(pattern));
}

function asAllowedPhase(value: unknown): RecognizedPhase | undefined {
    const text = asString(value) as RecognizedPhase | undefined;
    if (!text || !ALLOWED_PHASES.has(text)) {
        return undefined;
    }
    return text;
}

function asAllowedKind(value: unknown): RecognizedKind | undefined {
    const text = asString(value) as RecognizedKind | undefined;
    if (!text || !ALLOWED_KINDS.has(text)) {
        return undefined;
    }
    return text;
}

function clampConfidence(value: unknown): number {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num)) {
        return 0;
    }
    if (num < 0) return 0;
    if (num > 1) return 1;
    return num;
}

function asString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map(item => asString(item))
        .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function ensureBatchCoverage(
    batch: ArkMainExternalEntryCandidate[],
    recognitions: ArkMainExternalEntryRecognition[],
): ArkMainExternalEntryRecognition[] {
    const bySignature = new Map(recognitions.map(item => [item.methodSignature, item]));
    const out: ArkMainExternalEntryRecognition[] = [];

    for (const candidate of batch) {
        const existing = bySignature.get(candidate.methodSignature);
        if (existing) {
            out.push(existing);
            continue;
        }
        out.push({
            methodSignature: candidate.methodSignature,
            isEntry: false,
            confidence: 0,
            reason: "llm omitted candidate from response",
            evidenceTags: [],
        });
    }

    return out;
}

function buildCacheKey(candidate: ArkMainExternalEntryCandidate, model?: string): string {
    return crypto
        .createHash("sha256")
        .update([
            `v${EXTERNAL_ENTRY_CACHE_VERSION}`,
            model || "",
            candidate.methodSignature,
            candidate.summaryText,
        ].join("\n"))
        .digest("hex");
}

function loadRecognitionCache(
    options: RecognizeExternalArkMainEntriesOptions,
): {
    enabled: boolean;
    cachePath?: string;
    items: Map<string, ArkMainExternalEntryRecognition>;
    dirty: boolean;
} {
    const enabled = options.enableCache === true && !!options.cachePath;
    const cachePath = enabled ? path.resolve(options.cachePath as string) : undefined;
    if (!enabled || !cachePath || !fs.existsSync(cachePath)) {
        return {
            enabled: Boolean(enabled && cachePath),
            cachePath,
            items: new Map(),
            dirty: false,
        };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as ExternalEntryRecognitionCacheFile;
        if (!parsed || parsed.version !== EXTERNAL_ENTRY_CACHE_VERSION || typeof parsed.items !== "object") {
            return {
                enabled: true,
                cachePath,
                items: new Map(),
                dirty: false,
            };
        }
        return {
            enabled: true,
            cachePath,
            items: new Map(Object.entries(parsed.items || {})),
            dirty: false,
        };
    } catch {
        return {
            enabled: true,
            cachePath,
            items: new Map(),
            dirty: false,
        };
    }
}

function persistRecognitionsToCache(
    cache: {
        enabled: boolean;
        items: Map<string, ArkMainExternalEntryRecognition>;
        dirty: boolean;
    },
    recognitions: ArkMainExternalEntryRecognition[],
    candidates: ArkMainExternalEntryCandidate[],
    model?: string,
): void {
    if (!cache.enabled) {
        return;
    }

    const recognitionBySignature = new Map(recognitions.map(item => [item.methodSignature, item]));
    for (const candidate of candidates) {
        const recognition = recognitionBySignature.get(candidate.methodSignature) || {
            methodSignature: candidate.methodSignature,
            isEntry: false,
            confidence: 0,
            reason: "no recognition available",
            evidenceTags: [],
        };
        cache.items.set(buildCacheKey(candidate, model), recognition);
        cache.dirty = true;
    }
}

function saveRecognitionCache(cache: {
    enabled: boolean;
    cachePath?: string;
    items: Map<string, ArkMainExternalEntryRecognition>;
    dirty: boolean;
}): void {
    if (!cache.enabled || !cache.cachePath || !cache.dirty) {
        return;
    }

    try {
        fs.mkdirSync(path.dirname(cache.cachePath), { recursive: true });
        const payload: ExternalEntryRecognitionCacheFile = {
            version: EXTERNAL_ENTRY_CACHE_VERSION,
            items: Object.fromEntries(cache.items.entries()),
        };
        fs.writeFileSync(cache.cachePath, JSON.stringify(payload, null, 2), "utf-8");
    } catch {
        // Cache failures should never block analysis.
    }
}
