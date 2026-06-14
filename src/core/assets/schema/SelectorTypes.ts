import type { AssetEndpoint } from "./EndpointTypes";

export type RuntimeSelectorKind =
    | "signature-contains"
    | "signature-equals"
    | "signature-regex"
    | "declaring-class-equals"
    | "method-name-equals"
    | "method-name-regex"
    | "local-name-regex";

export type RuntimeInvokeKind = "any" | "instance" | "static";

export type SelectorConstraintMode = "equals" | "contains" | "regex";

export interface SelectorStringConstraint {
    mode: SelectorConstraintMode;
    value: string;
}

export interface RuntimeSelectorScope {
    file?: SelectorStringConstraint;
    module?: SelectorStringConstraint;
    className?: SelectorStringConstraint;
    methodName?: SelectorStringConstraint;
    methodDecorators?: SelectorStringConstraint[];
}

export interface RuntimeSelector {
    kind: RuntimeSelectorKind;
    value: string;
    calleeClass?: SelectorStringConstraint;
    invokeKind?: RuntimeInvokeKind;
    argCount?: number;
    typeHint?: string;
    scope?: RuntimeSelectorScope;
    calleeScope?: RuntimeSelectorScope;
}

export interface EndpointSelectorRef {
    endpoint: AssetEndpoint;
    pathFrom?: AssetEndpoint;
    slotKind?: string;
    taintScope?: "self" | "contained-values";
}
