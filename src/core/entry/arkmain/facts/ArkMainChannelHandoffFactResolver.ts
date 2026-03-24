import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { dedupeMethods } from "./ArkMainFactResolverUtils";
import { ArkMainFactCollectionContext } from "./ArkMainFactContext";
import { ARK_MAIN_ABILITY_HANDOFF_TARGET_METHOD_NAMES } from "../catalog/ArkMainFrameworkCatalog";
import { collectFrameworkManagedOwners } from "./ArkMainOwnerDiscovery";

export function collectChannelHandoffFacts(scene: Scene, context: ArkMainFactCollectionContext): void {
    const managedOwners = collectFrameworkManagedOwners(scene);
    const candidateMethods = dedupeMethods(
        scene.getClasses().flatMap(cls => {
            if (!managedOwners.isAbilityOwner(cls)) {
                return [];
            }
            return cls.getMethods().filter(method =>
                !method.isStatic()
                && ARK_MAIN_ABILITY_HANDOFF_TARGET_METHOD_NAMES.has(method.getName?.() || ""),
            );
        }),
    );

    for (const method of candidateMethods) {
        context.addFact({
            phase: "reactive_handoff",
            kind: "want_handoff",
            method,
            reason: `Ability handoff lifecycle ${method.getName()}`,
            schedule: false,
            sourceMethod: method,
            entryFamily: "ability_handoff",
            entryShape: "lifecycle_slot",
            recognitionLayer: managedOwners.getPrimaryRecognitionLayer(method.getDeclaringArkClass?.()) || "owner_qualified_inheritance",
        });
    }
}


