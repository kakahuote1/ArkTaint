import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";

export type ArkMainRuleEndpoint = "base" | "result" | "matched_param" | `arg${number}`;
export type ArkMainSourceRuleKind = "entry_param";

export interface ArkMainRuleStringConstraint {
    mode: "equals" | "contains" | "regex";
    value: string;
}

export interface ArkMainRuleScopeConstraint {
    className?: ArkMainRuleStringConstraint;
    methodName?: ArkMainRuleStringConstraint;
}

export interface ArkMainRuleEndpointRef {
    endpoint: ArkMainRuleEndpoint;
    path?: string[];
    pathFrom?: ArkMainRuleEndpoint;
    slotKind?: string;
}

export type ArkMainRuleEndpointOrRef = ArkMainRuleEndpoint | ArkMainRuleEndpointRef;

export interface ArkMainRuleMatch {
    kind: "signature_equals";
    value: string;
}

export interface ArkMainSourceRule {
    id: string;
    enabled?: boolean;
    description?: string;
    tags?: string[];
    family?: string;
    tier?: "A" | "B" | "C";
    match: ArkMainRuleMatch;
    scope?: ArkMainRuleScopeConstraint;
    sourceKind: ArkMainSourceRuleKind;
    target: ArkMainRuleEndpointOrRef;
}

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
    | "page_build"
    | "page_lifecycle";

export type ArkMainFactOwnership = "root_entry";

export type ArkMainOwnerKind =
    | "ability_owner"
    | "stage_owner"
    | "extension_owner"
    | "component_owner"
    | "unknown_owner";

export type ArkMainSurfaceKind = "lifecycle";

export type ArkMainTriggerKind = "root";

export interface ArkMainContractSourceSchema {
    id: string;
    sourceKind: ArkMainSourceRuleKind;
    family: string;
    tier: "A" | "B" | "C";
    description: string;
    tags?: string[];
    matchSignature: string;
    target: ArkMainRuleEndpointOrRef;
    scopeClassName?: string;
    scopeMethodName?: string;
}

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
    sourceSchemas: ArkMainContractSourceSchema[];
}

export const ARK_MAIN_LIFECYCLE_FACT_KINDS: ReadonlySet<ArkMainFactKind> = new Set([
    "ability_lifecycle",
    "stage_lifecycle",
    "extension_lifecycle",
    "page_build",
    "page_lifecycle",
]);

export const ARK_MAIN_ROOT_ENTRY_FACT_KINDS: ReadonlySet<ArkMainFactKind> = new Set([
    "ability_lifecycle",
    "stage_lifecycle",
    "extension_lifecycle",
    "page_build",
    "page_lifecycle",
]);

export interface ArkMainEntryFact {
    phase: ArkMainPhaseName;
    kind: ArkMainFactKind;
    method: ArkMethod;
    ownerKind?: ArkMainOwnerKind;
    reason: string;
    schedule?: boolean;
    sourceMethod?: ArkMethod;
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

export interface ArkMainCorePlan {
    contracts: ArkMainContract[];
    sourceRules: ArkMainSourceRule[];
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
    return "root_entry";
}

export function isArkMainEntryLayerFact(
    fact: Pick<ArkMainEntryFact, "kind" | "entryFamily">,
): boolean {
    return classifyArkMainFactOwnership(fact) === "root_entry";
}
