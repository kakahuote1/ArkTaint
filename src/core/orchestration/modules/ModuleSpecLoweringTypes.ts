import type {
    ModuleAnchorSelector,
    ModuleBoundaryKind,
    ModuleBridgeEmitSpec,
    ModuleDecoratedFieldAddressSource,
    ModuleDecoratedFieldSurfaceSelector,
    ModuleFieldPathSpec,
    ModuleInvokeSurfaceSelector,
    ModuleMethodSelector,
    ModuleSpec as PublicModuleSpec,
    ModuleTransferMode,
} from "../../kernel/contracts/ModuleSpec";
import type {
    DeferredBindingActivation,
    DeferredBindingCarrierKind,
    DeferredBindingCompletion,
    DeferredBindingContinuationRole,
} from "../../kernel/model/DeferredBindingDeclaration";

export interface MaterializedModuleSpec extends PublicModuleSpec {
    surfaces: ModuleSurface[];
    ports: ModulePort[];
    cells: ModuleCell[];
    associations: ModuleAssociation[];
    transfers: ModuleTransfer[];
    triggers: ModuleTrigger[];
}

export interface ModuleInvokeSurface {
    id: string;
    kind: "invoke_surface";
    selector: ModuleInvokeSurfaceSelector;
}

export interface ModuleMethodSurface {
    id: string;
    kind: "method_surface";
    selector: ModuleMethodSelector;
}

export interface ModuleDecoratedFieldSurface {
    id: string;
    kind: "decorated_field_surface";
    selector: ModuleDecoratedFieldSurfaceSelector;
}

export type ModuleSurface =
    | ModuleInvokeSurface
    | ModuleMethodSurface
    | ModuleDecoratedFieldSurface;

export type ModulePortNodeKind = "node" | "carrier" | "object";
export type ModuleResultPortNodeKind = "node" | "carrier";

export interface ModuleInvokeArgPort {
    id: string;
    kind: "invoke_arg";
    surface: string;
    index: number;
    nodeKind?: ModulePortNodeKind;
}

export interface ModuleInvokeBasePort {
    id: string;
    kind: "invoke_base";
    surface: string;
    nodeKind?: ModulePortNodeKind;
}

export interface ModuleInvokeResultPort {
    id: string;
    kind: "invoke_result";
    surface: string;
    nodeKind?: ModuleResultPortNodeKind;
}

export interface ModuleCallbackParamPort {
    id: string;
    kind: "callback_param";
    surface: string;
    callbackArgIndex: number;
    paramIndex: number;
    maxCandidates?: number;
}

export interface ModuleMethodThisPort {
    id: string;
    kind: "method_this";
    surface: string;
}

export interface ModuleMethodParamPort {
    id: string;
    kind: "method_param";
    surface: string;
    paramIndex: number;
}

export interface ModuleFieldLoadPort {
    id: string;
    kind: "field_load";
    surface: string;
    fieldName: string;
    baseThisOnly?: boolean;
}

export interface ModuleDecoratedFieldValuePort {
    id: string;
    kind: "decorated_field_value";
    surface: string;
}

export type ModulePort =
    | ModuleInvokeArgPort
    | ModuleInvokeBasePort
    | ModuleInvokeResultPort
    | ModuleCallbackParamPort
    | ModuleMethodThisPort
    | ModuleMethodParamPort
    | ModuleFieldLoadPort
    | ModuleDecoratedFieldValuePort;

export interface ModuleKeyedStateCell {
    id: string;
    kind: "keyed_state_cell";
    label?: string;
}

export interface ModuleChannelCell {
    id: string;
    kind: "channel_cell";
    label?: string;
}

export interface ModuleCarrierFieldCell {
    id: string;
    kind: "carrier_field_cell";
    carrierPort: string;
    fieldPath: string[];
}

export type ModuleCell =
    | ModuleKeyedStateCell
    | ModuleChannelCell
    | ModuleCarrierFieldCell;

export interface ModuleSameCarrierAssociation {
    id: string;
    kind: "same_carrier";
    leftPort: string;
    rightPort: string;
}

export type ModuleAssociation =
    | ModuleSameCarrierAssociation;

export interface ModuleDeferredBindingSemanticsSpec {
    activation?: DeferredBindingActivation;
    completion?: DeferredBindingCompletion;
    preserve?: DeferredBindingActivation[];
    continuationRole?: DeferredBindingContinuationRole;
}

export interface ModuleCallbackDispatchTrigger {
    id: string;
    kind: "callback_dispatch";
    viaPort: string;
    reason: string;
    carrierKind?: DeferredBindingCarrierKind;
    semantics?: ModuleDeferredBindingSemanticsSpec;
}

export interface ModuleDeclarativeDispatchTrigger {
    id: string;
    kind: "declarative_dispatch";
    sourceSurface: string;
    handlerSurface: string;
    anchor?: ModuleAnchorSelector;
    triggerLabel: string;
    carrierKind?: DeferredBindingCarrierKind;
    reason?: string;
    semantics?: ModuleDeferredBindingSemanticsSpec;
}

export type ModuleTrigger =
    | ModuleCallbackDispatchTrigger
    | ModuleDeclarativeDispatchTrigger;

export interface ModuleRecipeEndpointBase {
    surface: string;
    fieldPath?: ModuleFieldPathSpec;
}

export interface ModuleRecipeInvokeArgEndpoint extends ModuleRecipeEndpointBase {
    kind: "invoke_arg";
    index: number;
    nodeKind?: ModulePortNodeKind;
}

export interface ModuleRecipeInvokeBaseEndpoint extends ModuleRecipeEndpointBase {
    kind: "invoke_base";
    nodeKind?: ModulePortNodeKind;
}

export interface ModuleRecipeInvokeResultEndpoint extends ModuleRecipeEndpointBase {
    kind: "invoke_result";
    nodeKind?: ModuleResultPortNodeKind;
}

export interface ModuleRecipeCallbackParamEndpoint extends ModuleRecipeEndpointBase {
    kind: "callback_param";
    callbackArgIndex: number;
    paramIndex: number;
    maxCandidates?: number;
}

export interface ModuleRecipeMethodThisEndpoint extends ModuleRecipeEndpointBase {
    kind: "method_this";
}

export interface ModuleRecipeMethodParamEndpoint extends ModuleRecipeEndpointBase {
    kind: "method_param";
    paramIndex: number;
}

export interface ModuleRecipeFieldLoadEndpoint extends ModuleRecipeEndpointBase {
    kind: "field_load";
    fieldName: string;
    baseThisOnly?: boolean;
}

export interface ModuleRecipeDecoratedFieldValueEndpoint extends ModuleRecipeEndpointBase {
    kind: "decorated_field_value";
}

export type ModuleRecipeEndpoint =
    | ModuleRecipeInvokeArgEndpoint
    | ModuleRecipeInvokeBaseEndpoint
    | ModuleRecipeInvokeResultEndpoint
    | ModuleRecipeCallbackParamEndpoint
    | ModuleRecipeMethodThisEndpoint
    | ModuleRecipeMethodParamEndpoint
    | ModuleRecipeFieldLoadEndpoint
    | ModuleRecipeDecoratedFieldValueEndpoint;

export type ModuleRecipeTriggerPreset =
    | "callback_sync"
    | "callback_event"
    | "promise_fulfilled"
    | "promise_rejected"
    | "promise_any"
    | "declarative_field";

export interface ModuleRecipeCallbackTrigger {
    kind: "callback_dispatch";
    via?: ModuleRecipeEndpoint;
    reason: string;
    preset?: ModuleRecipeTriggerPreset;
    carrierKind?: DeferredBindingCarrierKind;
    semantics?: ModuleDeferredBindingSemanticsSpec;
}

export type ModuleRecipeInvokeSurfaceRef = ModuleInvokeSurfaceSelector;

export interface ModuleRecipeCallbackTarget {
    callbackArgIndex?: number;
    paramIndex?: number;
    maxCandidates?: number;
}

export interface ModuleRecipeArgValueSource {
    kind: "arg";
    index: number;
    fieldPath?: ModuleFieldPathSpec;
}

export interface ModuleRecipeBaseValueSource {
    kind: "base";
    fieldPath?: ModuleFieldPathSpec;
}

export interface ModuleRecipeResultValueSource {
    kind: "result";
    fieldPath?: ModuleFieldPathSpec;
}

export type ModuleRecipeValueSource =
    | ModuleRecipeArgValueSource
    | ModuleRecipeBaseValueSource
    | ModuleRecipeResultValueSource;

export type ModuleRecipeAssociationKind =
    | "same_receiver"
    | "same_carrier";

export interface ModuleRecipeCallbackChannel {
    id: string;
    kind: "callback_channel";
    send: ModuleRecipeInvokeSurfaceRef;
    receive: ModuleRecipeInvokeSurfaceRef;
    payload?: ModuleRecipeArgValueSource;
    callback?: ModuleRecipeCallbackTarget;
    association?: ModuleRecipeAssociationKind;
    fallbackMode?: "none" | "all_targets_if_unmatched";
    emit?: ModuleBridgeEmitSpec;
    trigger?: ModuleRecipeCallbackTrigger;
}

export interface ModuleRecipeCallbackHandoff {
    id: string;
    kind: "callback_handoff";
    surface: ModuleRecipeInvokeSurfaceRef;
    source: ModuleRecipeValueSource;
    callback?: ModuleRecipeCallbackTarget;
    emit?: ModuleBridgeEmitSpec;
    trigger?: ModuleRecipeCallbackTrigger;
}

export interface ModuleRecipeAccessorPair {
    id: string;
    kind: "accessor_pair";
    write: ModuleRecipeInvokeSurfaceRef;
    read: ModuleRecipeInvokeSurfaceRef;
    value?: ModuleRecipeArgValueSource;
    association?: ModuleRecipeAssociationKind;
    fallbackMode?: "none" | "all_targets_if_unmatched";
    emit?: ModuleBridgeEmitSpec;
}

export interface ModuleRecipeFactoryReturn {
    id: string;
    kind: "factory_return";
    surface: ModuleRecipeInvokeSurfaceRef;
    source: ModuleRecipeValueSource;
    emit?: ModuleBridgeEmitSpec;
}

export interface ModuleRecipeDirectBridge {
    id: string;
    kind: "direct_bridge";
    from: ModuleRecipeEndpoint;
    to: ModuleRecipeEndpoint;
    emit?: ModuleBridgeEmitSpec;
    trigger?: ModuleRecipeCallbackTrigger;
}

export interface ModuleRecipeSameCarrierAssociation {
    kind: "same_carrier";
    left: ModuleRecipeEndpoint;
    right: ModuleRecipeEndpoint;
    fallbackMode?: "none" | "all_targets_if_unmatched";
}

export interface ModuleRecipeAssociatedBridge {
    id: string;
    kind: "associated_bridge";
    from: ModuleRecipeEndpoint;
    to: ModuleRecipeEndpoint;
    association: ModuleRecipeSameCarrierAssociation;
    emit?: ModuleBridgeEmitSpec;
    trigger?: ModuleRecipeCallbackTrigger;
}

export interface ModuleRecipeLiteralAddress {
    kind: "literal";
    value: string;
}

export interface ModuleRecipeEndpointAddress {
    kind: "endpoint";
    endpoint: ModuleRecipeEndpoint;
}

export interface ModuleRecipeDecoratedFieldAddress {
    kind: "decorated_field_meta";
    surface: string;
    source: ModuleDecoratedFieldAddressSource;
    decoratorKind?: string;
}

export type ModuleRecipeAddress =
    | ModuleRecipeLiteralAddress
    | ModuleRecipeEndpointAddress
    | ModuleRecipeDecoratedFieldAddress;

export interface ModuleRecipeKeyedStateCell {
    id: string;
    kind: "keyed_state_cell";
    label?: string;
}

export interface ModuleRecipeChannelCell {
    id: string;
    kind: "channel_cell";
    label?: string;
}

export interface ModuleRecipeCarrierFieldCell {
    id: string;
    kind: "carrier_field_cell";
    carrier: ModuleRecipeEndpoint;
    fieldPath: string[];
}

export type ModuleRecipeCell =
    | ModuleRecipeKeyedStateCell
    | ModuleRecipeChannelCell
    | ModuleRecipeCarrierFieldCell;

export interface ModuleRecipeCellWrite {
    from: ModuleRecipeEndpoint;
    address?: ModuleRecipeAddress;
}

export interface ModuleRecipeCellRead {
    to: ModuleRecipeEndpoint;
    address?: ModuleRecipeAddress;
}

export interface ModuleRecipeCellBridge {
    id: string;
    kind: "cell_bridge";
    cell: ModuleRecipeCell;
    write: ModuleRecipeCellWrite;
    read: ModuleRecipeCellRead;
    emit?: ModuleBridgeEmitSpec;
    trigger?: ModuleRecipeCallbackTrigger;
}

export interface ModuleRecipeDeclarativeDispatch {
    id: string;
    kind: "declarative_dispatch";
    sourceSurface: string;
    handlerSurface: string;
    anchor?: ModuleAnchorSelector;
    triggerLabel: string;
    preset?: ModuleRecipeTriggerPreset;
    carrierKind?: DeferredBindingCarrierKind;
    reason?: string;
    semantics?: ModuleDeferredBindingSemanticsSpec;
}

export interface ModuleTransferBase {
    id: string;
    reason?: string;
    mode?: ModuleTransferMode;
    boundary?: ModuleBoundaryKind;
    allowUnreachableTarget?: boolean;
}

export interface ModulePortToPortTransfer extends ModuleTransferBase {
    kind: "port_to_port";
    fromPort: string;
    toPort: string;
    association?: string;
    fallbackMode?: "none" | "all_targets_if_unmatched";
}

export interface ModulePortToCellTransfer extends ModuleTransferBase {
    kind: "port_to_cell";
    fromPort: string;
    toCell: string;
    fromFieldPath?: string[];
    addressFrom?: string;
    addressLiteral?: string;
    addressMeta?: ModuleRecipeDecoratedFieldAddress;
    association?: string;
}

export interface ModuleCellToPortTransfer extends ModuleTransferBase {
    kind: "cell_to_port";
    fromCell: string;
    toPort: string;
    toFieldPath?: ModuleFieldPathSpec;
    addressFrom?: string;
    addressLiteral?: string;
    addressMeta?: ModuleRecipeDecoratedFieldAddress;
    association?: string;
}

export interface ModuleCellToCellTransfer extends ModuleTransferBase {
    kind: "cell_to_cell";
    fromCell: string;
    toCell: string;
}

export type ModuleTransfer =
    | ModulePortToPortTransfer
    | ModulePortToCellTransfer
    | ModuleCellToPortTransfer
    | ModuleCellToCellTransfer;

export type ModuleStringSlotSelector =
    | {
        kind: "arg";
        index: number;
    }
    | {
        kind: "base";
    }
    | {
        kind: "result";
    };

export type ModuleInvokeValueSlotSelector =
    | {
        kind: "arg";
        index: number;
    }
    | {
        kind: "base";
    }
    | {
        kind: "result";
    };

export interface ModuleArgNodeSlotSelector {
    kind: "arg";
    index: number;
    nodeKind?: ModulePortNodeKind;
}

export interface ModuleBaseNodeSlotSelector {
    kind: "base";
    nodeKind?: ModulePortNodeKind;
}

export interface ModuleResultNodeSlotSelector {
    kind: "result";
    nodeKind?: ModuleResultPortNodeKind;
}

export interface ModuleCallbackParamNodeSlotSelector {
    kind: "callback_param";
    callbackArgIndex: number;
    paramIndex: number;
    maxCandidates?: number;
}

export type ModuleNodeSlotSelector =
    | ModuleArgNodeSlotSelector
    | ModuleBaseNodeSlotSelector
    | ModuleResultNodeSlotSelector
    | ModuleCallbackParamNodeSlotSelector;

export type ModuleCarrierNodeSlotSelector =
    | ModuleArgNodeSlotSelector
    | ModuleBaseNodeSlotSelector
    | ModuleResultNodeSlotSelector;

export interface ModuleInvokeCarrierSetSelector {
    kind: "invoke_slot";
    surface: ModuleInvokeSurfaceSelector;
    slot: ModuleCarrierNodeSlotSelector;
}

export interface ModuleMethodThisCarrierSetSelector {
    kind: "method_this";
    method: ModuleMethodSelector;
}

export interface ModuleMethodParamCarrierSetSelector {
    kind: "method_param";
    method: ModuleMethodSelector;
    paramIndex: number;
}

export type ModuleCarrierSetSelector =
    | ModuleInvokeCarrierSetSelector
    | ModuleMethodThisCarrierSetSelector
    | ModuleMethodParamCarrierSetSelector;

export type ModuleInvokeEmitMode =
    | "generic"
    | "preserve_current"
    | "current_field_tail"
    | "explicit_field"
    | "load_like"
    | "load_like_current_tail";

export interface ModuleInvokeEmitNodeTarget {
    kind: "node_slot";
    slot: ModuleNodeSlotSelector;
    mode?: ModuleInvokeEmitMode;
    fieldPath?: ModuleFieldPathSpec;
}

export interface ModuleInvokeEmitCallbackTarget {
    kind: "callback_param";
    callbackArgIndex: number;
    paramIndex: number;
    maxCandidates?: number;
    mode?: ModuleInvokeEmitMode;
    fieldPath?: ModuleFieldPathSpec;
}

export interface ModuleInvokeEmitValueFieldTarget {
    kind: "value_field";
    value: ModuleInvokeValueSlotSelector;
    fieldPath: ModuleFieldPathSpec;
    mode?: ModuleTransferMode;
}

export type ModuleInvokeEmitTarget =
    | ModuleInvokeEmitNodeTarget
    | ModuleInvokeEmitCallbackTarget
    | ModuleInvokeEmitValueFieldTarget;

export interface ModuleImperativeDeferredBindingSpec {
    kind: "imperative";
    callbackArgIndex: number;
    reason: string;
    carrierKind?: DeferredBindingCarrierKind;
    semantics?: ModuleDeferredBindingSemanticsSpec;
}

export interface ModuleFieldBridgeEmitSpec {
    fieldReason?: string;
    loadReason?: string;
    boundary?: ModuleBoundaryKind;
    allowUnreachableTarget?: boolean;
}
