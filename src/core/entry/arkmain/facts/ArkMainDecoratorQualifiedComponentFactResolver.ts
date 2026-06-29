import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { CONSTRUCTOR_NAME } from "../../../../../arkanalyzer/out/src/core/common/TSConst";
import { resolveArkMainOfficialLifecycleDeclarationsByOwnerKindAndMethod } from "../catalog/ArkMainOfficialDeclarationCatalog";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";
import { resolveOfficialLifecycleContract } from "./ArkMainLifecycleContracts";
import { collectFrameworkManagedOwners } from "./ArkMainOwnerDiscovery";

export function collectDecoratorQualifiedComponentFacts(
    scene: Scene,
    context: ArkMainFactCollectionContext,
): void {
    const managedOwners = collectFrameworkManagedOwners(scene);
    for (const record of managedOwners.records) {
        if (!record.ownerKinds.includes("component_owner")) continue;
        const recognitionLayer = managedOwners.getPrimaryRecognitionLayer(record.ownerClass) || "qualified_decorator_first_layer";
        for (const method of record.ownerClass.getMethods?.() || []) {
            addFactsForDecoratorQualifiedComponentMethod(method, context, recognitionLayer);
        }
    }
}

function addFactsForDecoratorQualifiedComponentMethod(
    method: ArkMethod,
    context: ArkMainFactCollectionContext,
    recognitionLayer: string,
): void {
    if (!isEligibleComponentEntrypointMethod(method)) return;
    const methodName = String(method.getName?.() || "").trim();
    if (!methodName) return;
    const declarations = resolveArkMainOfficialLifecycleDeclarationsByOwnerKindAndMethod(
        "component_owner",
        methodName,
    );
    for (const declaration of declarations) {
        const contract = resolveOfficialLifecycleContract(declaration);
        if (!contract || contract.ownerKind !== "component_owner") continue;
        context.addFact({
            phase: contract.phase,
            kind: contract.kind,
            method,
            ownerKind: contract.ownerKind,
            reason: [
                "component owner is qualified by Arkanalyzer framework decorator evidence",
                `and official ArkMain declaration ${declaration.canonicalApiId}`,
            ].join(" "),
            canonicalApiId: declaration.canonicalApiId,
            semanticSurfaceId: declaration.surfaceId,
            semanticBindingId: declaration.bindingId,
            semanticTemplateId: declaration.templateId,
            semanticGate: "exact_decorator_qualified_owner_slot",
            entryFamily: contract.entryFamily,
            entryShape: contract.entryShape,
            recognitionLayer,
        });
        context.addPhaseCandidateMethod(contract.phase, method);
    }
}

function isEligibleComponentEntrypointMethod(method: ArkMethod): boolean {
    if (method.isStatic?.() || method.isPrivate?.()) return false;
    if (method.isGenerated?.() || method.isAnonymousMethod?.()) return false;
    return method.getName?.() !== CONSTRUCTOR_NAME;
}
