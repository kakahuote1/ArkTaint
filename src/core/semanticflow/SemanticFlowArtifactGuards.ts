import type { SemanticFlowAnchor, SemanticFlowSlicePackage } from "./SemanticFlowTypes";

export interface SemanticFlowArtifactSuppression {
    resolution: "no-transfer";
    reason: string;
}

export function suppressKnownNonArtifactSemanticFlowCandidate(
    _anchor: SemanticFlowAnchor,
    _slice: SemanticFlowSlicePackage,
): SemanticFlowArtifactSuppression | undefined {
    return undefined;
}
