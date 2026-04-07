export type DeferredBindingActivation =
    | "event(c)"
    | "settle(fulfilled)"
    | "settle(rejected)"
    | "settle(any)";

export type DeferredBindingCompletion = "none" | "promise_chain" | "await_site";
export type DeferredBindingCarrierKind = "direct" | "returned" | "relay" | "field" | "slot";
export type DeferredBindingContinuationRole = "none" | "value" | "error" | "observe";

export interface DeferredBindingSemantics {
    activation: DeferredBindingActivation;
    completion?: DeferredBindingCompletion;
    preserve?: DeferredBindingActivation[];
    continuationRole?: DeferredBindingContinuationRole;
}

interface ModuleExplicitDeferredBindingBase {
    moduleId: string;
    sourceMethod: any;
    unit: any;
    anchorStmt: any;
    carrierKind: DeferredBindingCarrierKind;
    reason: string;
    semantics: DeferredBindingSemantics;
}

export interface ModuleExplicitImperativeDeferredBindingRecord extends ModuleExplicitDeferredBindingBase {
    bindingKind: "imperative";
    invokeText?: string;
}

export interface ModuleExplicitDeclarativeDeferredBindingRecord extends ModuleExplicitDeferredBindingBase {
    bindingKind: "declarative";
    triggerLabel: string;
}

export type ModuleExplicitDeferredBindingRecord =
    | ModuleExplicitImperativeDeferredBindingRecord
    | ModuleExplicitDeclarativeDeferredBindingRecord;
