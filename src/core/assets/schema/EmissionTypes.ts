import type { SourceLocation } from "./CommonTypes";

export type SemanticEmission =
    | AnalysisEmission
    | EvidenceEmission
    | DiagnosticEmission;

export type AnalysisEmission =
    | SourceFactEmission
    | SinkFactEmission
    | SanitizerFactEmission
    | TransferFactEmission
    | HandoffFactEmission
    | EntryFactEmission
    | DeferredUnitEmission;

export type EvidenceEmission =
    | ModelHitEmission
    | DerivationAtomEmission
    | BlockedAtomEmission
    | PathConditionAtomEmission;

export type DiagnosticEmission =
    | ValidationErrorEmission
    | UnresolvedIdentityEmission
    | LowConfidenceModelEmission;

export interface EmissionBase {
    emissionId: string;
    effectInstanceId: string;
    modelId: string;
    bindingId: string;
    templateId: string;
    location?: SourceLocation;
}

export interface SourceFactEmission extends EmissionBase {
    kind: "analysis.source";
}

export interface SinkFactEmission extends EmissionBase {
    kind: "analysis.sink";
}

export interface SanitizerFactEmission extends EmissionBase {
    kind: "analysis.sanitizer";
}

export interface TransferFactEmission extends EmissionBase {
    kind: "analysis.transfer";
}

export interface HandoffFactEmission extends EmissionBase {
    kind: "analysis.handoff";
}

export interface EntryFactEmission extends EmissionBase {
    kind: "analysis.entry";
}

export interface DeferredUnitEmission extends EmissionBase {
    kind: "analysis.deferred-unit";
}

export interface ModelHitEmission extends EmissionBase {
    kind: "evidence.model-hit";
}

export interface DerivationAtomEmission extends EmissionBase {
    kind: "evidence.derivation-atom";
}

export interface BlockedAtomEmission extends EmissionBase {
    kind: "evidence.blocked-atom";
}

export interface PathConditionAtomEmission extends EmissionBase {
    kind: "evidence.path-condition-atom";
}

export interface ValidationErrorEmission extends EmissionBase {
    kind: "diagnostic.validation-error";
    message: string;
}

export interface UnresolvedIdentityEmission extends EmissionBase {
    kind: "diagnostic.unresolved-identity";
    reason: string;
}

export interface LowConfidenceModelEmission extends EmissionBase {
    kind: "diagnostic.low-confidence-model";
    reason: string;
}
