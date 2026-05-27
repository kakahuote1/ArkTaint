import type { PreAnalysisEvidencePack, PreAnalysisSlicePackage } from "../preanalysis";
import type { SemanticFlowPipelineItemInput } from "./SemanticFlowPipeline";
import type { SemanticFlowSlicePackage } from "./SemanticFlowTypes";

export interface SemanticFlowSliceSelection {
    observedSurfaceId: string;
    ledgerEntryId: string;
    slicePackageId: string;
    item: SemanticFlowPipelineItemInput;
}

export function selectSemanticFlowPipelineItemsFromEvidencePack(
    pack: PreAnalysisEvidencePack,
): SemanticFlowPipelineItemInput[] {
    return selectSemanticFlowSlicesFromEvidencePack(pack).map(selection => selection.item);
}

export function selectSemanticFlowSlicesFromEvidencePack(
    pack: PreAnalysisEvidencePack,
): SemanticFlowSliceSelection[] {
    const ledgerByObservedId = new Map(pack.coverageLedger.entries.map(entry => [entry.observedSurfaceId, entry]));
    const selections: SemanticFlowSliceSelection[] = [];
    for (const slice of pack.semanticFlowSlicePackages) {
        const ledger = ledgerByObservedId.get(slice.observedSurfaceId);
        if (!ledger) {
            throw new Error(`semanticflow slice ${slice.slicePackageId} references missing ledger entry ${slice.observedSurfaceId}`);
        }
        if (ledger.decision !== "send-to-llm") {
            throw new Error(`semanticflow slice ${slice.slicePackageId} cannot be selected for ledger decision ${ledger.decision}`);
        }
        selections.push({
            observedSurfaceId: slice.observedSurfaceId,
            ledgerEntryId: ledgerEntryId(ledger),
            slicePackageId: slice.slicePackageId,
            item: buildPipelineItem(slice, ledgerEntryId(ledger)),
        });
    }
    return selections;
}

function ledgerEntryId(ledger: { observedSurfaceId: string }): string {
    return `ledger.${ledger.observedSurfaceId}`;
}

function buildPipelineItem(
    slice: PreAnalysisSlicePackage,
    ledgerEntryId: string,
): SemanticFlowPipelineItemInput {
    return {
        anchor: {
            id: slice.anchorId,
            surface: slice.observedSurfaceId,
            metaTags: [
                "preanalysis-evidence-pack",
                `ledgerEntry=${ledgerEntryId}`,
                `slicePackage=${slice.slicePackageId}`,
            ],
        },
        initialSlice: {
            anchorId: slice.anchorId,
            round: 0,
            template: "multi-surface",
            observations: [...slice.observations],
            snippets: slice.snippets.map(snippet => ({
                label: snippet.label,
                code: snippet.code,
            })),
            notes: slice.notes ? [...slice.notes] : undefined,
        } satisfies SemanticFlowSlicePackage,
    };
}
