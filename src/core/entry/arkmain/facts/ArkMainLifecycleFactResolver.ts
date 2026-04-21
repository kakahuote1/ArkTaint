import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";
import { collectFrameworkManagedOwners } from "./ArkMainOwnerDiscovery";
import {
    resolveAbilityLifecycleContract,
    resolveAbilityLifecycleContractFromOverride,
    resolveComponentLifecycleContract,
    resolveExtensionLifecycleContract,
    resolveExtensionLifecycleContractFromOverride,
    resolveStageLifecycleContract,
    resolveStageLifecycleContractFromOverride,
} from "./ArkMainLifecycleContracts";
import { collectSdkOverrideCandidates } from "./ArkMainStructuralDiscovery";

export function collectLifecycleFacts(scene: Scene, context: ArkMainFactCollectionContext): void {
    const sdkOverrideBySignature = new Map(
        collectSdkOverrideCandidates(scene).map(candidate => [candidate.method.getSignature().toString(), candidate]),
    );
    const managedOwners = collectFrameworkManagedOwners(scene);

    for (const cls of scene.getClasses()) {
        const methods = cls.getMethods().filter(method => !method.isStatic());
        const isAbilityOwner = managedOwners.isAbilityOwner(cls);
        const isStageOwner = managedOwners.isStageOwner(cls);
        const isExtensionOwner = managedOwners.isExtensionOwner(cls);
        const isComponentLikeOwner = managedOwners.isComponentOwner(cls) || managedOwners.isBuilderOwner(cls);
        const ownerRecognitionLayer = managedOwners.getPrimaryRecognitionLayer(cls);

        for (const method of methods) {
            const methodName = method.getName();
            const signature = method.getSignature().toString();
            const sdkOverrideCandidate = sdkOverrideBySignature.get(signature);

            if (isAbilityOwner || isStageOwner || isExtensionOwner) {
                const lifecycleContract = isAbilityOwner
                    ? (sdkOverrideCandidate
                        ? resolveAbilityLifecycleContractFromOverride(methodName)
                        : resolveAbilityLifecycleContract(methodName))
                    : isStageOwner
                        ? (sdkOverrideCandidate
                            ? resolveStageLifecycleContractFromOverride(methodName)
                            : resolveStageLifecycleContract(methodName))
                        : (sdkOverrideCandidate
                            ? resolveExtensionLifecycleContractFromOverride(methodName)
                            : resolveExtensionLifecycleContract(methodName));
                if (!lifecycleContract) {
                    continue;
                }
                context.addFact({
                    phase: lifecycleContract.phase,
                    kind: lifecycleContract.kind,
                    method,
                    reason: lifecycleContract.reason,
                    entryFamily: lifecycleContract.entryFamily,
                    entryShape: lifecycleContract.entryShape,
                    recognitionLayer: sdkOverrideCandidate
                        ? sdkOverrideCandidate.discoveryLayer
                        : (ownerRecognitionLayer || "owner_qualified_inheritance"),
                });
                context.addPhaseCandidateMethod(lifecycleContract.phase, method);
                continue;
            }

            const componentContract = isComponentLikeOwner
                ? resolveComponentLifecycleContract(methodName)
                : null;
            if (!componentContract) {
                continue;
            }

            context.addFact({
                phase: componentContract.phase,
                kind: componentContract.kind,
                method,
                reason: componentContract.reason,
                entryFamily: componentContract.entryFamily,
                entryShape: componentContract.entryShape,
                recognitionLayer: ownerRecognitionLayer || "qualified_decorator_first_layer",
            });
            context.addPhaseCandidateMethod(componentContract.phase, method);
        }
    }
}
