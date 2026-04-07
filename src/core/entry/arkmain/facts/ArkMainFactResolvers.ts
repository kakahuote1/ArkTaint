import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { createArkMainFactCollectionContext } from "./ArkMainFactContext";
import { collectLifecycleFacts } from "./ArkMainLifecycleFactResolver";
import { expandEntryMethodsByDirectCalls } from "../../shared/ExplicitEntryScopeResolver";
import { ArkMainEntryFact, classifyArkMainFactOwnership } from "../ArkMainTypes";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";

export function collectArkMainEntryFacts(scene: Scene, explicitSeedMethods: ArkMethod[] = []): ArkMainEntryFact[] {
    const context = createArkMainFactCollectionContext(explicitSeedMethods);
    collectLifecycleFacts(scene, context);
    return context.facts.filter(fact => classifyArkMainFactOwnership(fact) === "root_entry");
}
export const expandSeedMethodsByDirectCalls = expandEntryMethodsByDirectCalls;

