import type { CellKindId } from "../../cellkind";

export type OclfsConfidence = "certain" | "likely" | "unknown";

export type StateCellKind = CellKindId;

export type StateCellPrecision = "exact" | "partial" | "unknown";

export interface StateCell {
    id: string;
    kind: StateCellKind;
    scope?: string;
    owner?: string;
    key?: string;
    fieldPath?: string[];
    index?: number;
    allocSite?: string;
    valueVersion?: string;
    precision: StateCellPrecision;
}

export type StateEffectKind =
    | "source"
    | "copy"
    | "store"
    | "load"
    | "store-clean"
    | "kill"
    | "link"
    | "unlink"
    | "sink"
    | "sanitize";

export type StateUpdateStrength = "strong" | "weak" | "infer";

export interface StateEffectBase {
    id: string;
    kind: StateEffectKind;
    programPoint: string;
    sequence: number;
    origin: string;
    originAssetId?: string;
    confidence: OclfsConfidence;
}

export interface SourceStateEffect extends StateEffectBase {
    kind: "source";
    target: StateCell;
    label: string;
}

export interface CopyStateEffect extends StateEffectBase {
    kind: "copy";
    from: StateCell;
    to: StateCell;
    label?: string;
}

export interface StoreStateEffect extends StateEffectBase {
    kind: "store";
    location: StateCell;
    value: StateCell;
    label?: string;
    updateStrength?: StateUpdateStrength;
}

export interface LoadStateEffect extends StateEffectBase {
    kind: "load";
    location: StateCell;
    target: StateCell;
    label?: string;
}

export interface StoreCleanStateEffect extends StateEffectBase {
    kind: "store-clean";
    location: StateCell;
    updateStrength?: StateUpdateStrength;
}

export interface KillStateEffect extends StateEffectBase {
    kind: "kill";
    location: StateCell;
    updateStrength?: StateUpdateStrength;
}

export interface LinkStateEffect extends StateEffectBase {
    kind: "link";
    left: StateCell;
    right: StateCell;
}

export interface UnlinkStateEffect extends StateEffectBase {
    kind: "unlink";
    left: StateCell;
    right: StateCell;
}

export interface SinkStateEffect extends StateEffectBase {
    kind: "sink";
    value: StateCell;
    sinkId: string;
    label?: string;
}

export interface SanitizeStateEffect extends StateEffectBase {
    kind: "sanitize";
    from: StateCell;
    to: StateCell;
    sanitizerId: string;
}

export type StateEffect =
    | SourceStateEffect
    | CopyStateEffect
    | StoreStateEffect
    | LoadStateEffect
    | StoreCleanStateEffect
    | KillStateEffect
    | LinkStateEffect
    | UnlinkStateEffect
    | SinkStateEffect
    | SanitizeStateEffect;

export type CellCompatibility = "exact" | "may" | "no";

export interface CandidateFlow {
    id: string;
    producerEffectId: string;
    consumerEffectId: string;
    producerCell: StateCell;
    consumerCell: StateCell;
    label: string;
}

export type SliceCompleteness =
    | "complete-for-cell"
    | "bounded-complete"
    | "truncated"
    | "unknown";

export interface EffectSlice {
    id: string;
    candidateFlowId: string;
    effectIds: string[];
    completeness: SliceCompleteness;
}

export type CurrentnessVerdict =
    | "live"
    | "dead"
    | "may-live"
    | "unknown"
    | "blocked-mismatch";

export type CurrentnessObligationKind =
    | "identity"
    | "freshness"
    | "no-strong-invalidator"
    | "definite-effect-order"
    | "link-scope"
    | "slice-completeness"
    | "update-strength"
    | "model-confidence";

export type CurrentnessObligationStatus =
    | "discharged"
    | "refuted"
    | "unresolved";

export interface CurrentnessObligation {
    kind: CurrentnessObligationKind;
    status: CurrentnessObligationStatus;
    subject?: string[];
    evidenceEffectIds?: string[];
    reason?: string;
}

export type CurrentnessProofStatus =
    | "complete-proof"
    | "partial-proof"
    | "refutation-proof"
    | "unknown-proof";

export interface CurrentnessCertificate {
    id: string;
    candidateFlow: CandidateFlow;
    verdict: CurrentnessVerdict;
    obligations: CurrentnessObligation[];
    sliceCompleteness: SliceCompleteness;
    decisiveEffectIds?: string[];
    blockedByEffectIds?: string[];
    primaryReason: string;
    uncertaintyReasons?: string[];
    proofStatus: CurrentnessProofStatus;
    confidence: OclfsConfidence;
}

export interface OclfsValidationResult {
    valid: boolean;
    errors: string[];
}

export interface OclfsSolverOptions {
    maxSliceEffects?: number;
    conservativeMay?: boolean;
}
