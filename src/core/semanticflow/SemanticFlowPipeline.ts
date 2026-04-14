import {
    buildSemanticFlowArtifact,
    buildSemanticFlowAnalysisAugment,
    buildSemanticFlowEngineAugment,
    classifySemanticFlowSummary,
} from "./SemanticFlowArtifacts";
import type {
    SemanticFlowAnchor,
    SemanticFlowDecider,
    SemanticFlowExpander,
    SemanticFlowItemResult,
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
    const history: SemanticFlowRoundRecord[] = [];
    const seenSliceKeys = new Set<string>([stableSliceKey(initialSlice)]);
    onProgress?.({ type: "item-start", index: index + 1, totalItems, anchorId: anchor.id, surface: anchor.surface });

    for (let round = 0; round <= maxRounds; round++) {
        onProgress?.({ type: "round-start", index: index + 1, totalItems, anchorId: anchor.id, round });
        let decision;
        try {
            decision = await decider.decide({
                anchor,
                slice: currentSlice,
                round,
                history,
            });
        } catch (error) {
            history.push({
                round,
                slice: currentSlice,
                error: String((error as any)?.message || error),
            });
            onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "need-human-check" });
            return {
                anchor,
                resolution: "need-human-check",
                finalSlice: currentSlice,
                history,
                error: String((error as any)?.message || error),
            };
        }
        onProgress?.({ type: "round-decision", index: index + 1, totalItems, anchorId: anchor.id, round, status: decision.status });
        history.push({ round, slice: currentSlice, decision });

        if (decision.status === "reject") {
            onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "rejected" });
            return {
                anchor,
                resolution: "rejected",
                finalSlice: currentSlice,
                history,
                error: decision.reason,
            };
        }

        if (decision.status === "done") {
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
                        resolution: decision.resolution,
                        summary: decision.summary,
                        finalSlice: currentSlice,
                        history,
                    };
                }
                const classification = classifySemanticFlowSummary(anchor, decision.summary, decision.classification);
                if (!classification) {
                    onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "unresolved" });
                    return {
                        anchor,
                        resolution: "unresolved",
                        summary: decision.summary,
                        finalSlice: currentSlice,
                        history,
                        error: "unable to classify summary",
                    };
                }
                const artifact = buildSemanticFlowArtifact(anchor, decision.summary, classification);
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
                    classification,
                    resolution: decision.resolution,
                    summary: decision.summary,
                    artifact,
                    finalSlice: currentSlice,
                    history,
                };
            } catch (error) {
                onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "need-human-check" });
                return {
                    anchor,
                    resolution: "need-human-check",
                    summary: decision.summary,
                    finalSlice: currentSlice,
                    history,
                    error: String((error as any)?.message || error),
                };
            }
        }

        if (round >= maxRounds) {
            onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "unresolved" });
            return {
                anchor,
                resolution: "unresolved",
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
            kind: decision.request.kind,
        });
        const expanded = await expander.expand({
            anchor,
            slice: currentSlice,
            round,
            request: decision.request,
            history,
        });
        const expandedKey = stableSliceKey(expanded);
        if (seenSliceKeys.has(expandedKey)) {
            onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "unresolved" });
            return {
                anchor,
                resolution: "unresolved",
                finalSlice: currentSlice,
                history,
                error: "expansion produced no new evidence",
            };
        }
        currentSlice = expanded;
        seenSliceKeys.add(expandedKey);
    }

    onProgress?.({ type: "item-done", index: index + 1, totalItems, anchorId: anchor.id, resolution: "unresolved" });
    return {
        anchor,
        resolution: "unresolved",
        finalSlice: currentSlice,
        history,
        error: "pipeline ended unexpectedly",
    };
}

function stableSliceKey(slice: SemanticFlowSlicePackage): string {
    return JSON.stringify({
        template: slice.template,
        observations: slice.observations,
        snippets: slice.snippets,
        companions: slice.companions,
        notes: slice.notes,
    });
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

