export interface ArkMainExplainabilitySummary {
    activationCount: number;
    phaseCounts: Record<string, number>;
    activationEdgeKindCounts: Record<string, number>;
    activationEdgeFamilyCounts: Record<string, number>;
    scheduling: ArkMainExplainabilitySchedulingSummary;
}

export interface ArkMainExplainabilitySchedulingSummary {
    maxRounds: number;
    roundsExecuted: number;
    lastChangedRound: number;
    converged: boolean;
    truncated: boolean;
    warnings: string[];
}

export interface ArkMainReasonRecord {
    kind: string;
    summary: string;
    evidenceFactKind?: string;
    evidenceMethodSignature?: string;
    evidenceMethodName?: string;
    entryFamily?: string;
    recognitionLayer?: string;
    callbackShape?: string;
    callbackSlotFamily?: string;
}

export interface ArkMainSupportingEdgeRecord {
    kind: string;
    edgeFamily: string;
    phaseHint: string;
    fromSignature?: string;
    fromName?: string;
    toSignature: string;
    toName: string;
}

export interface ArkMainActivationExplanation {
    signature: string;
    methodName: string;
    declaringClass: string;
    phase: string;
    round: number;
    activationEdgeKinds: string[];
    activationEdgeFamilies: string[];
    reasons: ArkMainReasonRecord[];
    supportingEdges: ArkMainSupportingEdgeRecord[];
}

export interface ArkMainExplainabilityReport {
    schemaVersion: "arkmain.explainability.v2";
    summary: ArkMainExplainabilitySummary;
    activations: ArkMainActivationExplanation[];
}

