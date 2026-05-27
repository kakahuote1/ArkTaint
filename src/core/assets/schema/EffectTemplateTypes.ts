import type { Confidence } from "./CommonTypes";
import type { CellKindId } from "../../cellkind";
import type { AssetEndpoint, AssetGuard } from "./EndpointTypes";
import type { CallbackLocator } from "./EndpointTypes";
import type { EndpointSelectorRef } from "./SelectorTypes";

export type RuleValueRef = AssetEndpoint | EndpointSelectorRef;

export type SemanticEffectTemplate =
    | RuleSourceTemplate
    | RuleSinkTemplate
    | RuleSanitizerTemplate
    | RuleTransferTemplate
    | HandoffPutTemplate
    | HandoffGetTemplate
    | HandoffKillTemplate
    | HandoffLinkTemplate
    | EntryLifecycleTemplate
    | EntryCallbackRegisterTemplate
    | EntryScheduleUnitTemplate
    | EntryFrameworkInvokeTemplate
    | CoreCapabilityTemplate;

export type SemanticEffectKind = SemanticEffectTemplate["kind"];

export interface RuleSourceTemplate {
    id: string;
    kind: "rule.source";
    value: RuleValueRef;
    sourceKind: "seed_local_name" | "entry_param" | "call_return" | "call_arg" | "field_read" | "callback_param" | "bound_state";
    confidence?: Confidence;
}

export interface RuleSinkTemplate {
    id: string;
    kind: "rule.sink";
    value?: RuleValueRef;
    sinkKind: string;
    confidence?: Confidence;
}

export interface RuleSanitizerTemplate {
    id: string;
    kind: "rule.sanitizer";
    value?: RuleValueRef;
    sanitizerKind: string;
    strength: "strong" | "weak" | "unknown";
    confidence?: Confidence;
}

export interface RuleTransferTemplate {
    id: string;
    kind: "rule.transfer";
    from: RuleValueRef;
    to: RuleValueRef;
    transferKind?: string;
    confidence?: Confidence;
}

export type HandleKeyPartTemplate =
    | { kind: "const"; value: string }
    | { kind: "fromEndpoint"; endpoint: AssetEndpoint }
    | { kind: "fromEndpointPath"; endpoint: AssetEndpoint; accessPath: string[] }
    | { kind: "fromLiteralArg"; index: number }
    | { kind: "fromRouteTarget" }
    | { kind: "fromCallbackChannel" }
    | { kind: "unknown" };

export interface HandoffHandleTemplate {
    cellKind: CellKindId;
    family: string;
    scope?: HandleKeyPartTemplate[];
    key: HandleKeyPartTemplate[];
    owner?: HandleKeyPartTemplate[];
    index?: number;
    precision?: "infer" | "exact" | "partial" | "unknown";
}

export interface HandoffHandle {
    cellKind: CellKindId;
    family: string;
    scope: string[];
    key: string[];
    owner?: string[];
    index?: number;
    precision: "exact" | "partial" | "unknown";
}

export interface HandoffPutTemplate {
    id: string;
    kind: "handoff.put";
    handle: HandoffHandleTemplate;
    value: AssetEndpoint;
    updateStrength?: "strong" | "weak" | "infer";
    confidence?: Confidence;
}

export interface HandoffGetTemplate {
    id: string;
    kind: "handoff.get";
    handle: HandoffHandleTemplate;
    target: AssetEndpoint;
    confidence?: Confidence;
}

export interface HandoffKillTemplate {
    id: string;
    kind: "handoff.kill";
    handle: HandoffHandleTemplate;
    updateStrength?: "strong" | "weak" | "infer";
    confidence?: Confidence;
}

export interface HandoffLinkTemplate {
    id: string;
    kind: "handoff.link";
    left: HandoffHandleTemplate;
    right: HandoffHandleTemplate;
    scope?: AssetGuard;
    confidence?: Confidence;
}

export interface EntryLifecycleTemplate {
    id: string;
    kind: "entry.lifecycle";
    entryKind: string;
    method?: string;
    confidence?: Confidence;
}

export interface EntryCallbackRegisterTemplate {
    id: string;
    kind: "entry.callbackRegister";
    callback: CallbackLocator;
    callbackRole?: string;
    confidence?: Confidence;
}

export interface EntryScheduleUnitTemplate {
    id: string;
    kind: "entry.scheduleUnit";
    unit: AssetEndpoint;
    scheduleKind: string;
    confidence?: Confidence;
}

export interface EntryFrameworkInvokeTemplate {
    id: string;
    kind: "entry.frameworkInvoke";
    target: AssetEndpoint;
    invokePhase?: string;
    confidence?: Confidence;
}

export interface CoreCapabilityTemplate {
    id: string;
    kind: "core.capability";
    capability: string;
    payload: Record<string, unknown>;
    confidence?: Confidence;
}

export const SEMANTIC_EFFECT_KINDS: readonly SemanticEffectKind[] = [
    "rule.source",
    "rule.sink",
    "rule.sanitizer",
    "rule.transfer",
    "handoff.put",
    "handoff.get",
    "handoff.kill",
    "handoff.link",
    "entry.lifecycle",
    "entry.callbackRegister",
    "entry.scheduleUnit",
    "entry.frameworkInvoke",
    "core.capability",
] as const;
