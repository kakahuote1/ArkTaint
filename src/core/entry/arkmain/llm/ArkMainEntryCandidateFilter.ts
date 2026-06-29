import {
    hasArkMainOfficialComponentDeclarationForMethod,
    hasArkMainOfficialDeclarationForOwnerKindAndMethod,
} from "../catalog/ArkMainOfficialDeclarationCatalog";
import type { ArkMainEntryCandidate } from "./ArkMainEntryCandidateTypes";

export interface SplitArkMainEntryCandidatesResult {
    semanticFlowCandidates: ArkMainEntryCandidate[];
    kernelCoveredCandidates: ArkMainEntryCandidate[];
    ineligibleCandidates: ArkMainEntryCandidate[];
}

export function splitArkMainEntryCandidatesForSemanticFlow(
    candidates: ArkMainEntryCandidate[],
): SplitArkMainEntryCandidatesResult {
    const semanticFlowCandidates: ArkMainEntryCandidate[] = [];
    const kernelCoveredCandidates: ArkMainEntryCandidate[] = [];
    const ineligibleCandidates: ArkMainEntryCandidate[] = [];
    for (const candidate of candidates) {
        if (inferOwnerKinds(candidate).size === 0) {
            ineligibleCandidates.push(candidate);
            continue;
        }
        if (isArkMainCandidateCoveredByKernelContracts(candidate)) {
            kernelCoveredCandidates.push(candidate);
            continue;
        }
        if (isRuntimeOwnerCandidateWithoutOverrideEvidence(candidate)) {
            ineligibleCandidates.push(candidate);
            continue;
        }
        if (isComponentCandidateOutsideFormalArkMain(candidate)) {
            ineligibleCandidates.push(candidate);
            continue;
        }
        semanticFlowCandidates.push(candidate);
    }
    return {
        semanticFlowCandidates,
        kernelCoveredCandidates,
        ineligibleCandidates,
    };
}

export function isArkMainCandidateCoveredByKernelContracts(candidate: ArkMainEntryCandidate): boolean {
    const ownerKinds = inferOwnerKinds(candidate);
    if (ownerKinds.has("ability_owner")
        && hasArkMainOfficialDeclarationForOwnerKindAndMethod("ability_owner", candidate.methodName)) {
        return true;
    }
    if (ownerKinds.has("stage_owner")
        && hasArkMainOfficialDeclarationForOwnerKindAndMethod("stage_owner", candidate.methodName)) {
        return true;
    }
    if (ownerKinds.has("extension_owner")
        && hasArkMainOfficialDeclarationForOwnerKindAndMethod("extension_owner", candidate.methodName)) {
        return true;
    }
    if (ownerKinds.has("child_process_owner")
        && hasArkMainOfficialDeclarationForOwnerKindAndMethod("child_process_owner", candidate.methodName)) {
        return true;
    }
    return false;
}

function isRuntimeOwnerCandidateWithoutOverrideEvidence(candidate: ArkMainEntryCandidate): boolean {
    const ownerKinds = inferOwnerKinds(candidate);
    const hasRuntimeOwner = ownerKinds.has("ability_owner")
        || ownerKinds.has("stage_owner")
        || ownerKinds.has("extension_owner")
        || ownerKinds.has("child_process_owner");
    if (!hasRuntimeOwner) {
        return false;
    }
    return (candidate.overrideSignals || []).length === 0;
}

function isComponentCandidateOutsideFormalArkMain(candidate: ArkMainEntryCandidate): boolean {
    const ownerKinds = inferOwnerKinds(candidate);
    const hasComponentOwner = ownerKinds.has("component_owner") || ownerKinds.has("builder_owner");
    if (!hasComponentOwner) {
        return false;
    }
    const hasRuntimeOwner = ownerKinds.has("ability_owner")
        || ownerKinds.has("stage_owner")
        || ownerKinds.has("extension_owner")
        || ownerKinds.has("child_process_owner");
    if (hasRuntimeOwner) {
        return false;
    }
    return !hasArkMainOfficialComponentDeclarationForMethod(candidate.methodName);
}

function inferOwnerKinds(candidate: ArkMainEntryCandidate): Set<string> {
    const out = new Set<string>();
    for (const signal of candidate.ownerSignals || []) {
        const parts = String(signal || "").split(":");
        if (parts[0] === "owner_contract" && parts[1]) {
            out.add(parts[1]);
        }
    }
    return out;
}
