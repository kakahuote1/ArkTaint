import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import type {
    CallbackRegistrationFlavor,
    CallbackRegistrationRecognitionLayer,
    CallbackRegistrationShape,
    CallbackRegistrationSlotFamily,
    StructuralCallbackEvidenceFamily,
} from "../shared/FrameworkCallbackClassifier";

export type ArkMainPhaseName =
    | "bootstrap"
    | "composition"
    | "interaction"
    | "reactive_handoff"
    | "teardown";

export type ArkMainFactKind =
    | "ability_lifecycle"
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

export const ARK_MAIN_ROOT_ENTRY_FACT_KINDS: ReadonlySet<ArkMainFactKind> = new Set([
    "ability_lifecycle",
    "page_build",
    "page_lifecycle",
    "callback",
    "scheduler_callback",
    "watch_handler",
    "want_handoff",
]);

export const ARK_MAIN_ACTIVATION_SUPPORT_FACT_KINDS: ReadonlySet<ArkMainFactKind> = new Set([
    "watch_source",
    "router_source",
    "router_trigger",
]);

export const ARK_MAIN_PROPAGATION_MODELING_FACT_KINDS: ReadonlySet<ArkMainFactKind> = new Set<ArkMainFactKind>();

export interface ArkMainEntryFact {
    phase: ArkMainPhaseName;
    kind: ArkMainFactKind;
    method: ArkMethod;
    reason: string;
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
    callbackStructuralEvidenceFamily?: StructuralCallbackEvidenceFamily;
    entryFamily?: string;
    entryShape?: string;
    recognitionLayer?: string;
}

export interface ArkMainPlanOptions {
    seedMethods?: ArkMethod[];
}

export interface ArkMainPhasePlan {
    phase: ArkMainPhaseName;
    facts: ArkMainEntryFact[];
    methods: ArkMethod[];
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
    if (fact.kind === "watch_source") {
        return "activation_support";
    }
    if (fact.kind === "router_source" || fact.kind === "router_trigger") {
        return fact.entryFamily?.startsWith("navigation_")
            ? "activation_support"
            : "propagation_modeling";
    }
    return "activation_support";
}

export function isArkMainEntryLayerFact(
    fact: Pick<ArkMainEntryFact, "kind" | "entryFamily">,
): boolean {
    return classifyArkMainFactOwnership(fact) !== "propagation_modeling";
}
