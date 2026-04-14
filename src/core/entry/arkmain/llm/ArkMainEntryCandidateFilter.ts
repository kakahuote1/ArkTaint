import {
    resolveAbilityLifecycleContract,
    resolveComponentLifecycleContract,
    resolveExtensionLifecycleContract,
    resolveStageLifecycleContract,
} from "../facts/ArkMainLifecycleContracts";
import type { ArkMainEntryCandidate } from "./ArkMainEntryCandidateTypes";

export interface SplitArkMainEntryCandidatesResult {
    semanticFlowCandidates: ArkMainEntryCandidate[];
    kernelCoveredCandidates: ArkMainEntryCandidate[];
}

export function splitArkMainEntryCandidatesForSemanticFlow(
    candidates: ArkMainEntryCandidate[],
): SplitArkMainEntryCandidatesResult {
    const semanticFlowCandidates: ArkMainEntryCandidate[] = [];
    const kernelCoveredCandidates: ArkMainEntryCandidate[] = [];
    for (const candidate of candidates) {
        if (isArkMainCandidateCoveredByKernelContracts(candidate)) {
            kernelCoveredCandidates.push(candidate);
            continue;
        }
        semanticFlowCandidates.push(candidate);
    }
    return {
        semanticFlowCandidates,
        kernelCoveredCandidates,
    };
}

export function isArkMainCandidateCoveredByKernelContracts(candidate: ArkMainEntryCandidate): boolean {
    const ownerKinds = inferOwnerKinds(candidate);
    if (ownerKinds.has("ability_owner") && resolveAbilityLifecycleContract(candidate.methodName)) {
        return true;
    }
    if (ownerKinds.has("stage_owner") && resolveStageLifecycleContract(candidate.methodName)) {
        return true;
    }
    if (ownerKinds.has("extension_owner") && resolveExtensionLifecycleContract(candidate.methodName)) {
        return true;
    }
    if ((ownerKinds.has("component_owner") || ownerKinds.has("builder_owner"))
        && resolveComponentLifecycleContract(candidate.methodName)) {
        return true;
    }
    return false;
}

function inferOwnerKinds(candidate: ArkMainEntryCandidate): Set<string> {
    const out = new Set<string>();
    for (const signal of candidate.ownerSignals || []) {
        const match = String(signal).match(/^owner_contract:([^:]+):/);
        if (match?.[1]) {
            out.add(match[1]);
        }
    }
    const superClassName = String(candidate.superClassName || "");
    if (superClassName === "AbilityStage") {
        out.add("stage_owner");
    } else if (superClassName.endsWith("ExtensionAbility")) {
        out.add("extension_owner");
    } else if (superClassName === "UIAbility" || superClassName === "Ability") {
        out.add("ability_owner");
    }
    return out;
}
