import type { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import type {
    CallbackRegistrationFlavor,
    CallbackRegistrationRecognitionLayer,
    CallbackRegistrationShape,
    CallbackRegistrationSlotFamily,
} from "../shared/FrameworkCallbackClassifier";

export type ArkMainRuleEndpoint = "base" | "result" | "matched_param" | `arg${number}`;

export interface ArkMainRuleEndpointRef {
    endpoint: ArkMainRuleEndpoint;
    path?: string[];
    pathFrom?: ArkMainRuleEndpoint;
    slotKind?: string;
}

export type ArkMainRuleEndpointOrRef = ArkMainRuleEndpoint | ArkMainRuleEndpointRef;

export type ArkMainPhaseName =
    | "bootstrap"
    | "composition"
    | "interaction"
    | "reactive_handoff"
    | "teardown";

export type ArkMainFactKind =
    | "ability_lifecycle"
    | "stage_lifecycle"
    | "extension_lifecycle"
    | "process_lifecycle"
    | "page_build"
    | "page_lifecycle"
    | "callback"
    | "scheduler_callback"
    | "watch_handler"
    | "watch_source"
    | "want_handoff"
    | "router_source"
    | "router_trigger";

export type ArkMainFactOwnership =
    | "root_entry"
    | "activation_support"
    | "propagation_modeling";

export type ArkMainOwnerKind =
    | "ability_owner"
    | "stage_owner"
    | "extension_owner"
    | "child_process_owner"
    | "component_owner"
    | "builder_owner"
    | "unknown_owner";

export type ArkMainSurfaceKind =
    | "lifecycle"
    | "callback"
    | "scheduler"
    | "watch"
    | "router"
    | "handoff";

export type ArkMainTriggerKind =
    | "root"
    | "callback"
    | "scheduler"
    | "state_watch"
    | "navigation_channel"
    | "ability_handoff";

export interface ArkMainContract {
    phase: ArkMainPhaseName;
    method: ArkMethod;
    ownerKind: ArkMainOwnerKind;
    surface: ArkMainSurfaceKind;
    trigger: ArkMainTriggerKind;
    boundary: ArkMainFactOwnership;
    kind: ArkMainFactKind;
    reason: string;
    sourceMethod?: ArkMethod;
    entryFamily?: string;
    entryShape?: string;
    recognitionLayer?: string;
    callbackFlavor?: CallbackRegistrationFlavor;
    callbackShape?: CallbackRegistrationShape;
    callbackSlotFamily?: CallbackRegistrationSlotFamily;
    callbackRecognitionLayer?: CallbackRegistrationRecognitionLayer;
    callbackRegistrationSignature?: string;
    callbackArgIndex?: number;
}

export const ARK_MAIN_LIFECYCLE_FACT_KINDS: ReadonlySet<ArkMainFactKind> = new Set([
    "ability_lifecycle",
    "stage_lifecycle",
    "extension_lifecycle",
    "process_lifecycle",
    "page_build",
    "page_lifecycle",
]);

export const ARK_MAIN_ROOT_ENTRY_FACT_KINDS: ReadonlySet<ArkMainFactKind> = new Set([
    "ability_lifecycle",
    "stage_lifecycle",
    "extension_lifecycle",
    "process_lifecycle",
    "page_build",
    "page_lifecycle",
]);

export const ARK_MAIN_ACTIVATION_SUPPORT_FACT_KINDS: ReadonlySet<ArkMainFactKind> = new Set([
    "callback",
    "scheduler_callback",
]);

export const ARK_MAIN_PROPAGATION_MODELING_FACT_KINDS: ReadonlySet<ArkMainFactKind> = new Set<ArkMainFactKind>([
    "want_handoff",
    "watch_handler",
    "watch_source",
    "router_source",
    "router_trigger",
]);

export interface ArkMainEntryFact {
    phase: ArkMainPhaseName;
    kind: ArkMainFactKind;
    method: ArkMethod;
    ownerKind?: ArkMainOwnerKind;
    reason: string;
    canonicalApiId?: string;
    semanticSurfaceId?: string;
    semanticBindingId?: string;
    semanticTemplateId?: string;
    semanticGate?: "exact_arkanalyzer_method_key" | "exact_decorator_qualified_owner_slot";
    schedule?: boolean;
    sourceMethod?: ArkMethod;
    reactiveFieldNames?: string[];
    watchTargets?: string[];
    callbackFlavor?: CallbackRegistrationFlavor;
    callbackShape?: CallbackRegistrationShape;
    callbackSlotFamily?: CallbackRegistrationSlotFamily;
    callbackRecognitionLayer?: CallbackRegistrationRecognitionLayer;
    callbackRegistrationSignature?: string;
    callbackArgIndex?: number;
    entryFamily?: string;
    entryShape?: string;
    recognitionLayer?: string;
}

export interface ArkMainPlanOptions {
    seedMethods?: ArkMethod[];
    seededMethods?: ArkMethod[];
    seededFacts?: ArkMainEntryFact[];
}

export interface ArkMainPhasePlan {
    phase: ArkMainPhaseName;
    facts: ArkMainEntryFact[];
    methods: ArkMethod[];
}

export interface ArkMainCorePlan {
    contracts: ArkMainContract[];
    orderedMethods: ArkMethod[];
}

export const ARK_MAIN_PHASE_ORDER: ArkMainPhaseName[] = [
    "bootstrap",
    "composition",
    "interaction",
    "reactive_handoff",
    "teardown",
];

export function classifyArkMainFactOwnership(
    fact: Pick<ArkMainEntryFact, "kind" | "entryFamily">,
): ArkMainFactOwnership {
    if (ARK_MAIN_ROOT_ENTRY_FACT_KINDS.has(fact.kind)) {
        return "root_entry";
    }
    if (ARK_MAIN_PROPAGATION_MODELING_FACT_KINDS.has(fact.kind)) {
        return "propagation_modeling";
    }
    return "activation_support";
}

export function isArkMainEntryLayerFact(
    fact: Pick<ArkMainEntryFact, "kind" | "entryFamily">,
): boolean {
    return classifyArkMainFactOwnership(fact) !== "propagation_modeling";
}
