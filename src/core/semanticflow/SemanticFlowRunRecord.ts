import type { PreAnalysisEvidencePack } from "../preanalysis";
import type { SemanticFlowRunResult } from "./SemanticFlowTypes";

export interface SemanticFlowPromotionRecord {
    assetId: string;
    fromStatus: string;
    toStatus?: string;
    accepted: boolean;
    reason: string;
}

export interface SemanticFlowRunRecord {
    runId: string;
    projectId: string;
    inputLedgerId: string;
    inputSlicePackageIds: string[];
    llmCandidateIds: string[];
    generatedAssetIds: string[];
    rejectedCandidateIds: string[];
    needMoreEvidenceIds: string[];
    promotionResults: SemanticFlowPromotionRecord[];
}

export function buildSemanticFlowRunRecord(
    pack: PreAnalysisEvidencePack,
    run: SemanticFlowRunResult,
    promotionResults: SemanticFlowPromotionRecord[] = [],
): SemanticFlowRunRecord {
    const llmCandidateIds: string[] = [];
    const generatedAssetIds: string[] = [];
    const rejectedCandidateIds: string[] = [];
    const needMoreEvidenceIds: string[] = [];
    for (const item of run.items) {
        llmCandidateIds.push(item.anchor.id);
        if (item.asset) {
            generatedAssetIds.push(item.asset.id);
        }
        if (item.resolution === "rejected") {
            rejectedCandidateIds.push(item.anchor.id);
        }
        if (item.resolution === "unresolved" || item.resolution === "need-human-check") {
            needMoreEvidenceIds.push(item.anchor.id);
        }
    }
    return {
        runId: pack.runId,
        projectId: pack.projectId,
        inputLedgerId: coverageLedgerId(pack),
        inputSlicePackageIds: pack.semanticFlowSlicePackages.map(slice => slice.slicePackageId),
        llmCandidateIds,
        generatedAssetIds,
        rejectedCandidateIds,
        needMoreEvidenceIds,
        promotionResults: [...promotionResults],
    };
}

function coverageLedgerId(pack: PreAnalysisEvidencePack): string {
    return `${pack.projectId}:${pack.runId}:coverage-ledger`;
}
