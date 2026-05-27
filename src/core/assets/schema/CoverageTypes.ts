import type { AssetBinding, AssetRole } from "./BindingTypes";
import type { AssetPlane, SourceLocation, ValidationResult } from "./CommonTypes";
import type { AssetEndpoint, AssetGuard, EndpointRelation, GuardRelation } from "./EndpointTypes";
import type { AssetDocumentBase } from "./AssetTypes";
import type { AssetIdentity } from "./SurfaceTypes";

export type ObservedSurfaceKind =
    | "call"
    | "construct"
    | "access"
    | "entry"
    | "decorator"
    | "callback";

export type ObservedSurfaceResolutionStatus =
    | "resolved"
    | "partial"
    | "unresolved"
    | "ignored";

export interface AnalyzerEvidence {
    importPath?: string;
    receiverType?: string;
    calleeSignature?: string;
    argCount?: number;
    typeSignature?: string;
    decoratorName?: string;
    ownerName?: string;
}

export interface ObservedSurface {
    observedSurfaceId: string;
    rawKind: ObservedSurfaceKind;
    location: SourceLocation;
    analyzerEvidence: AnalyzerEvidence;
    candidateSurface?: import("./SurfaceTypes").AssetSurface;
    resolutionStatus: ObservedSurfaceResolutionStatus;
    unresolvedReason?: string;
    ignoredReason?: string;
}

export interface CoverageQuery {
    observedSurfaceId?: string;
    identity: AssetIdentity;
    plane?: AssetPlane;
    expectedRoles?: AssetRole[];
    endpoint?: AssetEndpoint;
    guard?: AssetGuard;
    candidatePurpose?: "source" | "sink" | "transfer" | "handoff" | "entry" | "unknown";
}

export interface CoverageResult {
    status:
        | "not-covered"
        | "covered-exact-role"
        | "covered-surface-but-role-missing"
        | "covered-partial"
        | "covered-conflict"
        | "identity-unresolved";
    matchedBindings: AssetBinding[];
    missingRoles?: AssetRole[];
    endpointRelation?: EndpointRelation;
    guardRelation?: GuardRelation;
    explanation: AssetCoverageExplanation;
}

export interface AssetCoverageExplanation {
    reason: string;
    matchedAssetIds?: string[];
    matchedBindingIds?: string[];
}

export interface IdentityResult {
    status: "resolved" | "unresolved";
    identity?: AssetIdentity;
    reason?: string;
}

export interface BindingFilter {
    plane?: AssetPlane;
    roles?: AssetRole[];
    endpoint?: AssetEndpoint;
    guard?: AssetGuard;
}

export interface AssetConflict {
    kind: string;
    message: string;
    assetIds: string[];
}

export interface UnmigratedAssetReport {
    assetId: string;
    reason: string;
}

export interface AssetSurfaceRegistry {
    addAsset(asset: AssetDocumentBase): void;
    resolveIdentity(surface: import("./SurfaceTypes").AssetSurface): IdentityResult;
    queryCoverage(query: CoverageQuery): CoverageResult;
    findBindings(identity: AssetIdentity, filter?: BindingFilter): AssetBinding[];
    explainCoverage(query: CoverageQuery): AssetCoverageExplanation;
    validateAsset(asset: AssetDocumentBase): ValidationResult;
    listConflicts(): AssetConflict[];
    listUnmigratedAssets(): UnmigratedAssetReport[];
}

export type CoverageLedgerStatus =
    | "covered-exact-role"
    | "covered-partial"
    | "covered-surface-but-role-missing"
    | "not-covered"
    | "covered-conflict"
    | "identity-unresolved"
    | "ignored-by-policy"
    | "need-more-evidence";

export interface CoverageLedgerEntry {
    observedSurfaceId: string;
    identity?: AssetIdentity;
    role?: AssetRole;
    endpoint?: AssetEndpoint;
    guard?: AssetGuard;
    coverageStatus: CoverageLedgerStatus;
    matchedAssetIds?: string[];
    matchedBindingIds?: string[];
    missingRoles?: AssetRole[];
    endpointRelation?: EndpointRelation;
    guardRelation?: GuardRelation;
    sentToLLM?: boolean;
    reason: string;
    evidence?: SourceLocation[];
}

export interface CoverageLedger {
    projectId: string;
    runId: string;
    entries: CoverageLedgerEntry[];
    summary: CoverageSummary;
}

export interface CoverageSummary {
    totalObservedSurfaces: number;
    exactCovered: number;
    partialCovered: number;
    roleMissing: number;
    notCovered: number;
    identityUnresolved: number;
    conflicts: number;
    ignoredByPolicy: number;
    sentToLLM: number;
    needMoreEvidence: number;
}
