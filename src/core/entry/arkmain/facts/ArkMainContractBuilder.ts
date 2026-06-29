import { Scene } from "../../../../../arkanalyzer/out/src/Scene";
import { ArkClass } from "../../../../../arkanalyzer/out/src/core/model/ArkClass";
import { ArkMethod } from "../../../../../arkanalyzer/out/src/core/model/ArkMethod";
import {
    ArkMainContract,
    ArkMainEntryFact,
    ArkMainFactKind,
    ArkMainFactOwnership,
    ArkMainOwnerKind,
    ArkMainSurfaceKind,
    ArkMainTriggerKind,
    ARK_MAIN_LIFECYCLE_FACT_KINDS,
    classifyArkMainFactOwnership,
} from "../ArkMainTypes";
import { ArkMainActivationGraph } from "../edges/ArkMainActivationGraph";
import { ArkMainSchedule } from "../scheduling/ArkMainScheduler";
import { collectFrameworkManagedOwners } from "./ArkMainOwnerDiscovery";

export function buildArkMainContracts(
    scene: Scene,
    facts: ArkMainEntryFact[],
    _graph: ArkMainActivationGraph,
    _schedule: ArkMainSchedule,
): ArkMainContract[] {
    const managedOwners = collectFrameworkManagedOwners(scene);
    const wantHandoffTargetMethodSignatures = new Set(
        facts
            .filter(fact => fact.kind === "want_handoff")
            .map(fact => fact.method.getSignature?.()?.toString?.())
            .filter((signature): signature is string => !!signature),
    );
    return facts.map(fact => buildContractForFact(
        scene,
        managedOwners,
        fact,
        wantHandoffTargetMethodSignatures,
    ));
}

function buildContractForFact(
    scene: Scene,
    managedOwners: ReturnType<typeof collectFrameworkManagedOwners>,
    fact: ArkMainEntryFact,
    wantHandoffTargetMethodSignatures: Set<string>,
): ArkMainContract {
    const ownerKind = resolveOwnerKind(fact, managedOwners);
    const contract: ArkMainContract = {
        phase: fact.phase,
        method: fact.method,
        ownerKind,
        surface: classifySurface(fact.kind),
        trigger: classifyTrigger(fact.kind),
        boundary: classifyArkMainFactOwnership(fact),
        kind: fact.kind,
        reason: fact.reason,
        sourceMethod: fact.sourceMethod,
        entryFamily: fact.entryFamily,
        entryShape: fact.entryShape,
        recognitionLayer: fact.recognitionLayer,
        callbackFlavor: fact.callbackFlavor,
        callbackShape: fact.callbackShape,
        callbackSlotFamily: fact.callbackSlotFamily,
        callbackRecognitionLayer: fact.callbackRecognitionLayer,
        callbackRegistrationSignature: fact.callbackRegistrationSignature,
        callbackArgIndex: fact.callbackArgIndex,
    };

    void wantHandoffTargetMethodSignatures;
    return contract;
}

function resolveOwnerKind(
    fact: ArkMainEntryFact,
    managedOwners: ReturnType<typeof collectFrameworkManagedOwners>,
): ArkMainOwnerKind {
    if (fact.ownerKind) {
        return fact.ownerKind;
    }
    const declaringClass = fact.method.getDeclaringArkClass?.();
    const sourceClass = fact.sourceMethod?.getDeclaringArkClass?.();
    return resolveOwnerKindFromClass(declaringClass, managedOwners)
        || resolveOwnerKindFromClass(sourceClass, managedOwners)
        || defaultOwnerKindForFact(fact.kind);
}

function resolveOwnerKindFromClass(
    cls: ArkClass | null | undefined,
    managedOwners: ReturnType<typeof collectFrameworkManagedOwners>,
): ArkMainOwnerKind | undefined {
    if (!cls) return undefined;
    if (managedOwners.isAbilityOwner(cls)) return "ability_owner";
    if (managedOwners.isStageOwner(cls)) return "stage_owner";
    if (managedOwners.isExtensionOwner(cls)) return "extension_owner";
    if (managedOwners.isChildProcessOwner(cls)) return "child_process_owner";
    if (managedOwners.isComponentOwner(cls)) return "component_owner";
    if (managedOwners.isBuilderOwner(cls)) return "builder_owner";
    return undefined;
}

function defaultOwnerKindForFact(kind: ArkMainFactKind): ArkMainOwnerKind {
    if (kind === "page_build" || kind === "page_lifecycle") {
        return "component_owner";
    }
    if (kind === "ability_lifecycle" || kind === "want_handoff") {
        return "ability_owner";
    }
    if (kind === "stage_lifecycle") {
        return "stage_owner";
    }
    if (kind === "extension_lifecycle") {
        return "extension_owner";
    }
    if (kind === "process_lifecycle") {
        return "child_process_owner";
    }
    return "unknown_owner";
}

function classifySurface(kind: ArkMainFactKind): ArkMainSurfaceKind {
    if (ARK_MAIN_LIFECYCLE_FACT_KINDS.has(kind)) return "lifecycle";
    if (kind === "callback") return "callback";
    if (kind === "scheduler_callback") return "scheduler";
    if (kind === "watch_handler" || kind === "watch_source") return "watch";
    if (kind === "router_source" || kind === "router_trigger") return "router";
    return "handoff";
}

function classifyTrigger(kind: ArkMainFactKind): ArkMainTriggerKind {
    if (ARK_MAIN_LIFECYCLE_FACT_KINDS.has(kind)) return "root";
    if (kind === "callback") return "callback";
    if (kind === "scheduler_callback") return "scheduler";
    if (kind === "watch_handler" || kind === "watch_source") return "state_watch";
    if (kind === "router_source" || kind === "router_trigger") return "navigation_channel";
    return "ability_handoff";
}
