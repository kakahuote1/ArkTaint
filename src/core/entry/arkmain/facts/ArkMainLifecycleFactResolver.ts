import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";
import { resolveOfficialLifecycleContract } from "./ArkMainLifecycleContracts";
import { collectSdkOverrideCandidates } from "./ArkMainSdkDeclarationDiscovery";
import { arkanalyzerMethodKeyFromArkMethod } from "./ArkMainArkanalyzerMethodKey";
import {
    resolveArkMainOfficialLifecycleDeclarationsByMethodKey,
} from "../catalog/ArkMainOfficialDeclarationCatalog";

export function collectLifecycleFacts(scene: Scene, context: ArkMainFactCollectionContext): void {
    for (const candidate of collectSdkOverrideCandidates(scene)) {
        const declarations = resolveOfficialDeclarationsForSdkOverrideCandidate(candidate);
        for (const declaration of declarations) {
            const contract = resolveOfficialLifecycleContract(declaration);
            if (contract) {
                context.addFact({
                    phase: contract.phase,
                    kind: contract.kind,
                    method: candidate.method,
                    ownerKind: contract.ownerKind,
                    reason: `${contract.reason} overridden by ${candidate.method.getSignature?.()?.toString?.() || candidate.method.getName?.()}`,
                    canonicalApiId: declaration.canonicalApiId,
                    semanticSurfaceId: declaration.surfaceId,
                    semanticBindingId: declaration.bindingId,
                    semanticTemplateId: declaration.templateId,
                    semanticGate: "exact_arkanalyzer_method_key",
                    entryFamily: contract.entryFamily,
                    entryShape: contract.entryShape,
                    recognitionLayer: candidate.discoveryLayer,
                });
                context.addPhaseCandidateMethod(contract.phase, candidate.method);
            }
        }
    }
}

function resolveOfficialDeclarationsForSdkOverrideCandidate(
    candidate: ReturnType<typeof collectSdkOverrideCandidates>[number],
) {
    if (candidate.officialDeclarations?.length) {
        return candidate.officialDeclarations;
    }
    const baseMethodKey = candidate.baseMethod
        ? arkanalyzerMethodKeyFromArkMethod(candidate.baseMethod)
        : undefined;
    return baseMethodKey
        ? resolveArkMainOfficialLifecycleDeclarationsByMethodKey(baseMethodKey)
        : [];
}
