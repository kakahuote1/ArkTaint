import {
    buildSemanticFlowArtifact,
    buildSemanticFlowAnalysisAugment,
    buildSemanticFlowEngineAugment,
    classifySemanticFlowSummary,
} from "./SemanticFlowArtifacts";
import {
    createSemanticFlowDraftId,
    createSemanticFlowExpandPlan,
    createSemanticFlowMarker,
    materializeSemanticFlowDeficit,
    protectedMergeSemanticFlowDraft,
    stableSemanticFlowSliceKey,
} from "./SemanticFlowIncremental";
import type {
    SemanticFlowAnchor,
    SemanticFlowDecider,
    SemanticFlowDelta,
    SemanticFlowExpander,
    SemanticFlowItemResult,
    SemanticFlowMarker,
    SemanticFlowRoundRecord,
    SemanticFlowRunResult,
    SemanticFlowSessionResult,
    SemanticFlowSlicePackage,
    SemanticFlowSummary,
} from "./SemanticFlowTypes";

export interface SemanticFlowPipelineItemInput {
    anchor: SemanticFlowAnchor;
    initialSlice: SemanticFlowSlicePackage;
}

export interface SemanticFlowPipelineOptions {
    maxRounds?: number;
    concurrency?: number;
    onProgress?: (event: SemanticFlowProgressEvent) => void;
}

export type SemanticFlowProgressEvent =
    | { type: "session-start"; totalItems: number; concurrency: number; maxRounds: number }
    | { type: "item-start"; index: number; totalItems: number; anchorId: string; surface: string }
    | { type: "round-start"; index: number; totalItems: number; anchorId: string; round: number }
    | { type: "round-decision"; index: number; totalItems: number; anchorId: string; round: number; status: string }
    | { type: "round-expand"; index: number; totalItems: number; anchorId: string; round: number; kind: string }
    | { type: "item-done"; index: number; totalItems: number; anchorId: string; resolution: string; classification?: string }
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
        runSemanticFlowItem(item.anchor, item.initialSlice, decider, expander, maxRounds, index, items.length, options.onProgress),
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
    return {
        run,
        augment,
        engineAugment,
    };
}

async function runSemanticFlowItem(
    anchor: SemanticFlowAnchor,
    initialSlice: SemanticFlowSlicePackage,
    decider: SemanticFlowDecider,
    expander: SemanticFlowExpander,
    maxRounds: number,
    index: number,
    totalItems: number,
    onProgress?: SemanticFlowPipelineOptions["onProgress"],
): Promise<SemanticFlowItemResult> {
    let currentSlice = initialSlice;
    const draftId = createSemanticFlowDraftId(anchor);
    let currentDraft: SemanticFlowSummary | undefined;
    let lastMarker: SemanticFlowMarker | undefined;
    let lastDelta: SemanticFlowDelta | undefined;
    const history: SemanticFlowRoundRecord[] = [];
    const seenSliceKeys = new Set<string>([stableSemanticFlowSliceKey(initialSlice)]);
    onProgress?.({ type: "item-start", index: index + 1, totalItems, anchorId: anchor.id, surface: anchor.surface });

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
            history.push({
                round,
                draftId,
                slice: currentSlice,
                draft: currentDraft,
                marker: lastMarker,
                delta: lastDelta,
                error: String((error as any)?.message || error),
            });
            onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "need-human-check" });
            return {
                anchor,
                draftId,
                resolution: "need-human-check",
                draft: currentDraft,
                lastMarker,
                lastDelta,
                finalSlice: currentSlice,
                history,
                error: String((error as any)?.message || error),
            };
        }
        onProgress?.({ type: "round-decision", index: index + 1, totalItems, anchorId: anchor.id, round, status: decision.status });

        if (decision.status === "reject") {
            history.push({
                round,
                draftId,
                slice: currentSlice,
                draft: currentDraft,
                marker: lastMarker,
                delta: lastDelta,
                decision,
            });
            onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "rejected" });
            return {
                anchor,
                draftId,
                resolution: "rejected",
                draft: currentDraft,
                lastMarker,
                lastDelta,
                finalSlice: currentSlice,
                history,
                error: decision.reason,
            };
        }

        if (decision.status === "done") {
            const summary = protectedMergeSemanticFlowDraft(currentDraft, decision.summary, lastMarker?.kind);
            history.push({
                round,
                draftId,
                slice: currentSlice,
                draft: summary,
                marker: lastMarker,
                delta: lastDelta,
                decision: {
                    ...decision,
                    summary,
                },
            });
            currentDraft = summary;
            try {
                if (decision.resolution !== "resolved") {
                    onProgress?.({
                        type: "item-done",
                        index: index + 1,
                        totalItems,
                        anchorId: anchor.id,
                        resolution: decision.resolution,
                    });
                    return {
                        anchor,
                        draftId,
                        resolution: decision.resolution,
                        summary,
                        draft: summary,
                        lastMarker,
                        lastDelta,
                        finalSlice: currentSlice,
                        history,
                    };
                }
                const classification = classifySemanticFlowSummary(anchor, summary, decision.classification);
                if (!classification) {
                    onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "unresolved" });
                    return {
                        anchor,
                        draftId,
                        resolution: "unresolved",
                        summary,
                        draft: summary,
                        lastMarker,
                        lastDelta,
                        finalSlice: currentSlice,
                        history,
                        error: "unable to classify summary",
                    };
                }
                const artifact = buildSemanticFlowArtifact(anchor, summary, classification);
                onProgress?.({
                    type: "item-done",
                    index: index + 1,
                    totalItems,
                    anchorId: anchor.id,
                    resolution: decision.resolution,
                    classification,
                });
                return {
                    anchor,
                    draftId,
                    classification,
                    resolution: decision.resolution,
                    summary,
                    draft: summary,
                    lastMarker,
                    lastDelta,
                    artifact,
                    finalSlice: currentSlice,
                    history,
                };
            } catch (error) {
                onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "need-human-check" });
                return {
                    anchor,
                    draftId,
                    resolution: "need-human-check",
                    summary,
                    draft: summary,
                    lastMarker,
                    lastDelta,
                    finalSlice: currentSlice,
                    history,
                    error: String((error as any)?.message || error),
                };
            }
        }

        const deficit = materializeSemanticFlowDeficit(anchor, decision.request);
        const nextDraft = protectedMergeSemanticFlowDraft(currentDraft, decision.draft, deficit.kind);
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
            onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "unresolved" });
            return {
                anchor,
                draftId,
                resolution: "unresolved",
                draft: nextDraft,
                lastMarker,
                lastDelta,
                finalSlice: currentSlice,
                history,
                error: "maximum expansion rounds reached",
            };
        }

        onProgress?.({
            type: "round-expand",
            index: index + 1,
            totalItems,
            anchorId: anchor.id,
            round,
            kind: deficit.kind,
        });
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
            onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "unresolved" });
            return {
                anchor,
                draftId,
                resolution: "unresolved",
                draft: nextDraft,
                lastMarker,
                lastDelta: expanded.delta,
                finalSlice: currentSlice,
                history,
                error: noNewSlice
                    ? "expansion produced no new slice evidence"
                    : "expansion produced no effective delta",
            };
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

    onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "unresolved" });
    return {
        anchor,
        draftId,
        resolution: "unresolved",
        draft: currentDraft,
        lastMarker,
        lastDelta,
        finalSlice: currentSlice,
        history,
        error: "pipeline ended unexpectedly",
    };
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

