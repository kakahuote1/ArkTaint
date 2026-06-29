import type {
    DeferredBindingActivation,
    DeferredBindingCompletion,
    DeferredBindingContinuationRole,
} from "../model/DeferredBindingDeclaration";
import type {
    AssetEndpoint,
    Confidence,
    HandoffHandleTemplate,
} from "../../assets/schema";

export interface InternalModuleLoweringIR {
    id: string;
    description?: string;
    enabled?: boolean;
    semantics: ModuleSemantic[];
}

export interface ModuleInvokeSurfaceSelector {
    surfaceKind: "invoke";
    canonicalApiId: string;
}

export interface ModuleConstructSurfaceSelector {
    surfaceKind: "construct";
    canonicalApiId: string;
}

export type ModuleCallSurfaceSelector =
    | ModuleInvokeSurfaceSelector
    | ModuleConstructSurfaceSelector;

export interface ModuleMethodSelector {
    methodSignature: string;
}

export interface ModuleAnchorSelector {
    anchorMethodSignature?: string;
    anchorInvoke?: ModuleInvokeSurfaceSelector;
    stmtIndex?: number;
}

export interface ModuleDecoratedFieldSurfaceSelector {
    className?: string;
    fieldName?: string;
    fieldSignature?: string;
    decoratorCanonicalApiId?: string;
    decoratorCanonicalApiIds?: string[];
}

export interface ModuleInvokeSurfaceRef {
    kind: "invoke";
    selector: ModuleInvokeSurfaceSelector;
}

export interface ModuleMethodSurfaceRef {
    kind: "method";
    selector: ModuleMethodSelector;
}

export interface ModuleDecoratedFieldSurfaceRef {
    kind: "decorated_field";
    selector: ModuleDecoratedFieldSurfaceSelector;
}

export type ModuleSemanticSurfaceRef =
    | ModuleInvokeSurfaceRef
    | ModuleMethodSurfaceRef
    | ModuleDecoratedFieldSurfaceRef;

export interface ModuleLiteralFieldPathPart {
    kind: "literal";
    value: string;
}

export interface ModuleCurrentFieldPathPart {
    kind: "current_field";
}

export interface ModuleCurrentTailFieldPathPart {
    kind: "current_tail";
}

export interface ModuleCurrentFieldWithoutPrefixPart {
    kind: "current_field_without_prefix";
    prefixes: string[][];
}

export type ModuleFieldPathPart =
    | ModuleLiteralFieldPathPart
    | ModuleCurrentFieldPathPart
    | ModuleCurrentTailFieldPathPart
    | ModuleCurrentFieldWithoutPrefixPart;

export interface ModuleFieldPathTemplate {
    parts: ModuleFieldPathPart[];
}

export type ModuleFieldPathSpec =
    | string[]
    | ModuleFieldPathTemplate;

export type ModuleTransferMode =
    | "preserve"
    | "plain"
    | "current_field_tail";

export type ModuleBoundaryKind =
    | "identity"
    | "serialized_copy"
    | "clone_copy"
    | "stringify_result";

export interface ModuleBridgeEmitSpec {
    mode?: ModuleTransferMode;
    boundary?: ModuleBoundaryKind;
    reason?: string;
    allowUnreachableTarget?: boolean;
}

export interface ModuleEndpointBase {
    surface: ModuleSemanticSurfaceRef;
    fieldPath?: ModuleFieldPathSpec;
}

export interface ModuleArgEndpoint extends ModuleEndpointBase {
    slot: "arg";
    index: number;
    rest?: boolean;
}

export interface ModuleBaseEndpoint extends ModuleEndpointBase {
    slot: "base";
}

export interface ModuleResultEndpoint extends ModuleEndpointBase {
    slot: "result";
}

export interface ModuleCallbackParamEndpoint extends ModuleEndpointBase {
    slot: "callback_param";
    callbackArgIndex?: number;
    paramIndex?: number;
    rest?: boolean;
}

export interface ModuleMethodThisEndpoint extends ModuleEndpointBase {
    slot: "method_this";
}

export interface ModuleMethodParamEndpoint extends ModuleEndpointBase {
    slot: "method_param";
    paramIndex: number;
}

export interface ModuleFieldLoadEndpoint extends ModuleEndpointBase {
    slot: "field_load";
    fieldName: string;
    baseThisOnly?: boolean;
}

export interface ModuleDecoratedFieldEndpoint extends ModuleEndpointBase {
    slot: "decorated_field_value";
}

export type ModuleEndpoint =
    | ModuleArgEndpoint
    | ModuleBaseEndpoint
    | ModuleResultEndpoint
    | ModuleCallbackParamEndpoint
    | ModuleMethodThisEndpoint
    | ModuleMethodParamEndpoint
    | ModuleFieldLoadEndpoint
    | ModuleDecoratedFieldEndpoint;

export interface ModuleLiteralAddress {
    kind: "literal";
    value: string;
}

export interface ModuleEndpointAddress {
    kind: "endpoint";
    endpoint: ModuleEndpoint;
}

export type ModuleDecoratedFieldAddressSource =
    | "field_name"
    | "decorator_param"
    | "decorator_param_or_field_name";

export interface ModuleDecoratedFieldMetaAddress {
    kind: "decorated_field_meta";
    surface: ModuleDecoratedFieldSurfaceSelector;
    source: ModuleDecoratedFieldAddressSource;
}

export type ModuleAddress =
    | ModuleLiteralAddress
    | ModuleEndpointAddress
    | ModuleDecoratedFieldMetaAddress;

export type ModuleDispatchPreset =
    | "callback_sync"
    | "callback_event"
    | "promise_fulfilled"
    | "promise_rejected"
    | "promise_any"
    | "declarative_field";

export interface ModuleDeferredSemanticsOverride {
    activation?: DeferredBindingActivation;
    completion?: DeferredBindingCompletion;
    preserve?: DeferredBindingActivation[];
    continuationRole?: DeferredBindingContinuationRole;
}

export interface ModuleDispatch {
    preset: ModuleDispatchPreset;
    via?: ModuleEndpoint;
    reason?: string;
    semantics?: ModuleDeferredSemanticsOverride;
}

export interface ModuleSameReceiverConstraint {
    kind: "same_receiver";
}

export interface ModuleSameAddressConstraint {
    kind: "same_address";
    left: ModuleAddress;
    right: ModuleAddress;
}

export type ModuleConstraint =
    | ModuleSameReceiverConstraint
    | ModuleSameAddressConstraint;

export interface ModuleBridgeSemantic {
    id?: string;
    kind: "bridge";
    from: ModuleEndpoint;
    to: ModuleEndpoint;
    sourceGuard?: ModuleEndpoint;
    constraints?: ModuleConstraint[];
    dispatch?: ModuleDispatch;
    emit?: ModuleBridgeEmitSpec;
}

export interface ModuleStateKeyedCell {
    kind: "keyed_state";
    label?: string;
}

export interface ModuleStateChannelCell {
    kind: "channel";
    label?: string;
}

export interface ModuleStateFieldCell {
    kind: "field";
    carrier: ModuleEndpoint;
    fieldPath: string[];
}

export type ModuleStateCell =
    | ModuleStateKeyedCell
    | ModuleStateChannelCell
    | ModuleStateFieldCell;

export interface ModuleStateWrite {
    from: ModuleEndpoint;
    address?: ModuleAddress;
    emit?: ModuleBridgeEmitSpec;
}

export interface ModuleStateRead {
    to: ModuleEndpoint;
    address?: ModuleAddress;
    dispatch?: ModuleDispatch;
    emit?: ModuleBridgeEmitSpec;
}

export interface ModuleStateSemantic {
    id?: string;
    kind: "state";
    cell: ModuleStateCell;
    writes: ModuleStateWrite[];
    reads: ModuleStateRead[];
}

export interface ModuleDeclarativeBindingSemantic {
    id?: string;
    kind: "declarative_binding";
    source: ModuleSemanticSurfaceRef;
    handler: ModuleSemanticSurfaceRef;
    anchor?: ModuleAnchorSelector;
    triggerLabel: string;
    dispatch?: ModuleDispatch;
}

export type ModuleContainerFamilyKind =
    | "array"
    | "map"
    | "weakmap"
    | "set"
    | "weakset"
    | "list"
    | "queue"
    | "stack"
    | "resultset";

export type ModuleContainerCapability =
    | "store"
    | "nested_store"
    | "mutation_base"
    | "load"
    | "view"
    | "object_from_entries"
    | "promise_aggregate"
    | "resultset";

export interface ModuleContainerSemantic {
    id?: string;
    kind: "container";
    families?: ModuleContainerFamilyKind[];
    capabilities?: ModuleContainerCapability[];
    mutationCanonicalApiIds: string[];
    accessCanonicalApiIds: string[];
}

export interface ModuleAbilityHandoffSemantic {
    id?: string;
    kind: "ability_handoff";
    startCanonicalApiIds: string[];
    targetCanonicalApiIds: string[];
}

export interface ModuleEventEmitterSemantic {
    id?: string;
    kind: "event_emitter";
    onCanonicalApiIds: string[];
    emitCanonicalApiIds: string[];
    channelArgIndexes?: number[];
    /** Use -1 for dispatch methods that activate callbacks without carrying a payload argument. */
    payloadArgIndex?: number;
    callbackArgIndex?: number;
    callbackParamIndex?: number;
    maxCandidates?: number;
}

export type ModuleKeyedStorageUpdateStrength = "strong" | "weak";

export interface ModuleKeyedStorageWriteApiSpec {
    canonicalApiIds: string[];
    valueIndex: number;
    updateStrength?: ModuleKeyedStorageUpdateStrength;
}

export interface ModuleKeyedStorageSemantic {
    id?: string;
    kind: "keyed_storage";
    writeApis: ModuleKeyedStorageWriteApiSpec[];
    writeResultApis?: ModuleKeyedStorageWriteApiSpec[];
    readCanonicalApiIds: string[];
    killCanonicalApiIds?: string[];
    propDecoratorCanonicalApiIds?: string[];
    linkDecoratorCanonicalApiIds?: string[];
}

export interface ModuleHandoffEffectSpec {
    id: string;
    effectKind: "put" | "get" | "kill";
    surface: ModuleCallSurfaceSelector;
    handle: HandoffHandleTemplate;
    value?: AssetEndpoint;
    target?: AssetEndpoint;
    updateStrength?: "strong" | "weak";
    confidence?: Confidence;
}

export interface ModuleHandoffEffectSemantic {
    id?: string;
    kind: "handoff_effect";
    effects: ModuleHandoffEffectSpec[];
}

export interface ModuleRoutePushApiSpec {
    canonicalApiIds: string[];
    routeField?: string;
    routeArgIndex?: number;
    payloadArgIndex?: number;
    payloadField?: string;
}

export interface ModuleRouteRegisterApiSpec {
    canonicalApiIds: string[];
    callbackArgIndex: number;
    routeParamIndex?: number;
    payloadParamIndex: number;
}

export interface ModuleRouteGetApiSpec {
    canonicalApiIds: string[];
    routeArgIndex?: number;
    routeField?: string;
}

export interface ModuleRouteBridgeSemantic {
    id?: string;
    kind: "route_bridge";
    pushApis: ModuleRoutePushApiSpec[];
    getCanonicalApiIds: string[];
    getApis?: ModuleRouteGetApiSpec[];
    navDestinationRegisterApis?: ModuleRouteRegisterApiSpec[];
    navDestinationTriggerApis?: ModuleRoutePushApiSpec[];
    payloadUnwrapPrefixes?: string[];
}

export interface ModuleStateBindingSemantic {
    id?: string;
    kind: "state_binding";
    stateDecoratorCanonicalApiIds: string[];
    propDecoratorCanonicalApiIds: string[];
    linkDecoratorCanonicalApiIds: string[];
    provideDecoratorCanonicalApiIds?: string[];
    consumeDecoratorCanonicalApiIds?: string[];
    eventDecoratorCanonicalApiIds?: string[];
}

export type ModuleSemantic =
    | ModuleBridgeSemantic
    | ModuleStateSemantic
    | ModuleDeclarativeBindingSemantic
    | ModuleHandoffEffectSemantic
    | ModuleContainerSemantic
    | ModuleAbilityHandoffSemantic
    | ModuleKeyedStorageSemantic
    | ModuleEventEmitterSemantic
    | ModuleRouteBridgeSemantic
    | ModuleStateBindingSemantic;
