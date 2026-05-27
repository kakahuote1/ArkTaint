import {
    buildSemanticFlowAnalysisAugment,
    buildSemanticFlowEngineAugment,
} from "./SemanticFlowArtifacts";
import {
    createSemanticFlowDraftId,
    createSemanticFlowExpandPlan,
    createSemanticFlowMarker,
    materializeSemanticFlowDeficit,
    protectedMergeSemanticFlowDraft,
    stableSemanticFlowSliceKey,
} from "./SemanticFlowIncremental";
import { SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION, SEMANTIC_FLOW_LLM_TEMPERATURE } from "./SemanticFlowLlm";
import { SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION } from "./SemanticFlowPrompt";
import {
    buildSemanticFlowItemCacheKey,
    type CachedSemanticFlowItem,
    type SemanticFlowSessionCache,
} from "./SemanticFlowSessionCache";
import { getSemanticFlowItemCacheSemanticsFingerprint } from "./SemanticFlowSessionSemantics";
import type {
    SemanticFlowAnchor,
    SemanticFlowAssetDraft,
    SemanticFlowDecider,
    SemanticFlowDelta,
    SemanticFlowExpander,
    SemanticFlowItemResult,
    SemanticFlowMarker,
    SemanticFlowRoundRecord,
    SemanticFlowRunResult,
    SemanticFlowSessionResult,
    SemanticFlowSlicePackage,
} from "./SemanticFlowTypes";

export interface SemanticFlowPipelineItemInput {
    anchor: SemanticFlowAnchor;
    initialSlice: SemanticFlowSlicePackage;
}

export interface SemanticFlowPipelineOptions {
    maxRounds?: number;
    concurrency?: number;
    model?: string;
    sessionCache?: SemanticFlowSessionCache;
    onProgress?: (event: SemanticFlowProgressEvent) => void;
}

export type SemanticFlowProgressEvent =
    | { type: "session-start"; totalItems: number; concurrency: number; maxRounds: number }
    | { type: "item-start"; index: number; totalItems: number; anchorId: string; surface: string }
    | { type: "round-start"; index: number; totalItems: number; anchorId: string; round: number }
    | { type: "round-decision"; index: number; totalItems: number; anchorId: string; round: number; status: string }
    | { type: "round-expand"; index: number; totalItems: number; anchorId: string; round: number; kind: string }
    | { type: "item-done"; index: number; totalItems: number; anchorId: string; resolution: string; plane?: string }
    | { type: "session-complete"; totalItems: number };

export async function runSemanticFlowPipeline(
    items: SemanticFlowPipelineItemInput[],
    decider: SemanticFlowDecider,
    expander: SemanticFlowExpander,
    options: SemanticFlowPipelineOptions = {},
): Promise<SemanticFlowRunResult> {
    const maxRounds = options.maxRounds ?? 2;
    const concurrency = Math.max(1, options.concurrency ?? 1);
    options.onProgress?.({ type: "session-start", totalItems: items.length, concurrency, maxRounds });
    const results = await mapWithConcurrency(items, concurrency, (item, index) =>
        runSemanticFlowItem(
            item.anchor,
            item.initialSlice,
            decider,
            expander,
            maxRounds,
            options.model,
            options.sessionCache,
            index,
            items.length,
            options.onProgress,
        ),
    );
    options.onProgress?.({ type: "session-complete", totalItems: items.length });

    return { items: results };
}

export async function runSemanticFlowSession(
    items: SemanticFlowPipelineItemInput[],
    decider: SemanticFlowDecider,
    expander: SemanticFlowExpander,
    options: SemanticFlowPipelineOptions = {},
): Promise<SemanticFlowSessionResult> {
    const run = await runSemanticFlowPipeline(items, decider, expander, options);
    const augment = buildSemanticFlowAnalysisAugment(run.items);
    const engineAugment = buildSemanticFlowEngineAugment(augment);
    return { run, augment, engineAugment };
}

async function runSemanticFlowItem(
    anchor: SemanticFlowAnchor,
    initialSlice: SemanticFlowSlicePackage,
    decider: SemanticFlowDecider,
    expander: SemanticFlowExpander,
    maxRounds: number,
    model: string | undefined,
    sessionCache: SemanticFlowSessionCache | undefined,
    index: number,
    totalItems: number,
    onProgress?: SemanticFlowPipelineOptions["onProgress"],
): Promise<SemanticFlowItemResult> {
    let currentSlice = initialSlice;
    const draftId = createSemanticFlowDraftId(anchor);
    let currentDraft: SemanticFlowAssetDraft | undefined;
    let lastMarker: SemanticFlowMarker | undefined;
    let lastDelta: SemanticFlowDelta | undefined;
    const history: SemanticFlowRoundRecord[] = [];
    const seenSliceKeys = new Set<string>([stableSemanticFlowSliceKey(initialSlice)]);
    if (sessionCache?.isActive() && !model) {
        throw new Error("semanticflow session cache requires an explicit model");
    }
    const itemCacheKey = sessionCache?.isActive()
        ? buildSemanticFlowItemCacheKey({
            model: model as string,
            temperature: SEMANTIC_FLOW_LLM_TEMPERATURE,
            promptSchemaVersion: SEMANTIC_FLOW_PROMPT_SCHEMA_VERSION,
            parserSchemaVersion: SEMANTIC_FLOW_DECISION_PARSER_SCHEMA_VERSION,
            semanticsFingerprint: getSemanticFlowItemCacheSemanticsFingerprint(),
            anchor,
            initialSlice,
            maxRounds,
        })
        : undefined;
    onProgress?.({ type: "item-start", index: index + 1, totalItems, anchorId: anchor.id, surface: anchor.surface });
    const finalize = (
        result: SemanticFlowItemResult,
        options: { skipCacheWrite?: boolean } = {},
    ): SemanticFlowItemResult => {
        if (!options.skipCacheWrite && itemCacheKey) {
            sessionCache!.storeItem(itemCacheKey, result);
        }
        onProgress?.({
            type: "item-done",
            index: index + 1,
            totalItems,
            anchorId: anchor.id,
            resolution: result.resolution,
            plane: result.plane,
        });
        return result;
    };
    if (itemCacheKey) {
        const cachedItem = sessionCache!.lookupItem(itemCacheKey);
        if (cachedItem) {
            return finalize(
                restoreCachedItemResult(sessionCache!, anchor, cachedItem),
                { skipCacheWrite: true },
            );
        }
    }

    for (let round = 0; round <= maxRounds; round++) {
        onProgress?.({ type: "round-start", index: index + 1, totalItems, anchorId: anchor.id, round });
        let decision;
        try {
            decision = await decider.decide({
                anchor,
                draftId,
                slice: currentSlice,
                draft: currentDraft,
                lastMarker,
                lastDelta,
                round,
                history,
            });
        } catch (error) {
            const errorMessage = String((error as any)?.message || error);
            history.push({
                round,
                draftId,
                slice: currentSlice,
                draft: currentDraft,
                marker: lastMarker,
                delta: lastDelta,
                error: errorMessage,
            });
            return finalize({
                anchor,
                draftId,
                resolution: "need-human-check",
                draft: currentDraft,
                lastMarker,
                lastDelta,
                finalSlice: currentSlice,
                history,
                error: errorMessage,
            }, {
                skipCacheWrite: isTransientSemanticFlowLlmError(errorMessage),
            });
        }
        onProgress?.({ type: "round-decision", index: index + 1, totalItems, anchorId: anchor.id, round, status: decision.status });

        if (decision.status === "reject") {
            history.push({ round, draftId, slice: currentSlice, draft: currentDraft, marker: lastMarker, delta: lastDelta, decision });
            return finalize({
                anchor,
                draftId,
                resolution: "rejected",
                draft: currentDraft,
                lastMarker,
                lastDelta,
                finalSlice: currentSlice,
                history,
                error: decision.reason,
            });
        }

        if (decision.status === "done") {
            history.push({ round, draftId, slice: currentSlice, draft: currentDraft, marker: lastMarker, delta: lastDelta, decision });
            return finalize({
                anchor,
                draftId,
                plane: decision.asset.plane,
                resolution: "resolved",
                asset: decision.asset,
                draft: currentDraft,
                lastMarker,
                lastDelta,
                finalSlice: currentSlice,
                history,
            });
        }

        const deficit = materializeSemanticFlowDeficit(anchor, decision.request);
        const nextDraft = protectedMergeSemanticFlowDraft(currentDraft, decision.draft);
        const plan = createSemanticFlowExpandPlan(anchor, deficit);
        const roundRecord: SemanticFlowRoundRecord = {
            round,
            draftId,
            slice: currentSlice,
            draft: nextDraft,
            deficit,
            plan,
            decision: {
                ...decision,
                draft: nextDraft,
            },
        };

        if (round >= maxRounds) {
            history.push(roundRecord);
            return finalize({
                anchor,
                draftId,
                resolution: "unresolved",
                draft: nextDraft,
                lastMarker,
                lastDelta,
                finalSlice: currentSlice,
                history,
                error: "maximum expansion rounds reached",
            });
        }

        onProgress?.({ type: "round-expand", index: index + 1, totalItems, anchorId: anchor.id, round, kind: deficit.kind });
        const expanded = await expander.expand({
            anchor,
            draftId,
            slice: currentSlice,
            draft: nextDraft,
            round,
            deficit,
            plan,
            lastMarker,
            lastDelta,
            history,
        });
        roundRecord.delta = expanded.delta;
        const expandedKey = stableSemanticFlowSliceKey(expanded.slice);
        const noNewSlice = seenSliceKeys.has(expandedKey);
        if (!expanded.delta.effective || noNewSlice) {
            history.push(roundRecord);
            return finalize({
                anchor,
                draftId,
                resolution: "unresolved",
                draft: nextDraft,
                lastMarker,
                lastDelta: expanded.delta,
                finalSlice: currentSlice,
                history,
                error: noNewSlice ? "expansion produced no new slice evidence" : "expansion produced no effective delta",
            });
        }
        const marker = createSemanticFlowMarker(draftId, deficit, expanded.delta);
        roundRecord.marker = marker;
        history.push(roundRecord);
        currentDraft = nextDraft;
        currentSlice = expanded.slice;
        lastMarker = marker;
        lastDelta = expanded.delta;
        seenSliceKeys.add(expandedKey);
    }

    return finalize({
        anchor,
        draftId,
        resolution: "unresolved",
        draft: currentDraft,
        lastMarker,
        lastDelta,
        finalSlice: currentSlice,
        history,
        error: "pipeline ended unexpectedly",
    });
}

function isTransientSemanticFlowLlmError(message: string): boolean {
    const text = String(message || "");
    if (!text) return false;
    return /LLM request failed: status=(429|5\d\d)\b/i.test(text)
        || /This operation was aborted/i.test(text)
        || /semanticflow LLM circuit open/i.test(text)
        || /UND_ERR_|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|socket|ConnectTimeout|headers timeout|body timeout/i.test(text);
}

function restoreCachedItemResult(
    sessionCache: SemanticFlowSessionCache,
    anchor: SemanticFlowAnchor,
    cachedItem: CachedSemanticFlowItem,
): SemanticFlowItemResult {
    return sessionCache.restoreItemResult(anchor, cachedItem);
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }
    const out = new Array<R>(items.length);
    let next = 0;
    const limit = Math.min(Math.max(1, concurrency), items.length);

    const worker = async (): Promise<void> => {
        while (true) {
            const index = next++;
            if (index >= items.length) {
                return;
            }
            out[index] = await fn(items[index], index);
        }
    };

    await Promise.all(Array.from({ length: limit }, () => worker()));
    return out;
}
