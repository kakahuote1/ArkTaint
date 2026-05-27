import type { AssetDocumentBase } from "../assets/schema";
import type { SemanticFlowAnalysisAugment, SemanticFlowSessionResult } from "./SemanticFlowTypes";

export function serializeSemanticFlowSession(session: SemanticFlowSessionResult): Record<string, unknown> {
    return {
        items: session.run.items.map(item => ({
            anchor: {
                id: item.anchor.id,
                owner: item.anchor.owner,
                surface: item.anchor.surface,
                methodSignature: item.anchor.methodSignature,
                filePath: item.anchor.filePath,
                metaTags: item.anchor.metaTags,
                arkMainSelector: item.anchor.arkMainSelector,
            },
            draftId: item.draftId,
            plane: item.plane,
            resolution: item.resolution,
            error: item.error,
            asset: item.asset,
            draft: item.draft,
            lastMarker: item.lastMarker,
            lastDelta: item.lastDelta,
            history: item.history.map(round => ({
                round: round.round,
                draftId: round.draftId,
                slice: {
                    anchorId: round.slice.anchorId,
                    round: round.slice.round,
                    template: round.slice.template,
                    observations: round.slice.observations,
                    snippets: round.slice.snippets,
                    companions: round.slice.companions,
                    notes: round.slice.notes,
                },
                draft: round.draft,
                deficit: round.deficit,
                plan: round.plan,
                delta: round.delta,
                marker: round.marker,
                decision: round.decision,
                error: round.error,
            })),
        })),
    };
}

export function serializeSemanticFlowAssets(augment: SemanticFlowAnalysisAugment): AssetDocumentBase[] {
    return augment.assets || [];
}
