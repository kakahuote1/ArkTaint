import type {
    DeferredBindingActivation,
    DeferredBindingCompletion,
    DeferredBindingContinuationRole,
} from "../model/DeferredBindingDeclaration";

export interface ModuleSpec {
    id: string;
    description?: string;
    enabled?: boolean;
    semantics: ModuleSemantic[];
}

export interface ModuleSpecDocument {
    modules: ModuleSpec[];
}

export interface ModuleInvokeSurfaceSelector {
    methodName?: string;
    declaringClassName?: string;
    declaringClassIncludes?: string;
    signature?: string;
    signatureIncludes?: string;
    minArgs?: number;
    instanceOnly?: boolean;
    staticOnly?: boolean;
}

export interface ModuleMethodSelector {
    methodSignature?: string;
    methodName?: string;
    declaringClassName?: string;
    declaringClassIncludes?: string;
}

export interface ModuleAnchorSelector {
    anchorMethodSignature?: string;
    anchorInvoke?: ModuleInvokeSurfaceSelector;
    stmtIndex?: number;
}

export interface ModuleDecoratedFieldSurfaceSelector {
    className?: string;
    classNameIncludes?: string;
    fieldName?: string;
    fieldSignature?: string;
    decoratorKind?: string;
    decoratorKinds?: string[];
    decoratorParam?: string;
    decoratorParams?: string[];
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
    surface: ModuleSemanticSurfaceRef | string;
    fieldPath?: ModuleFieldPathSpec;
}

export interface ModuleArgEndpoint extends ModuleEndpointBase {
    slot: "arg";
    index: number;
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

export interface ModuleDecoratedFieldValueEndpoint extends ModuleEndpointBase {
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
    | ModuleDecoratedFieldValueEndpoint;

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
    decoratorKind?: string;
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
    fallbackMode?: "none" | "all_targets_if_unmatched";
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
}

export interface ModuleAbilityHandoffSemantic {
    id?: string;
    kind: "ability_handoff";
    startMethods: string[];
    targetMethods: string[];
}

export interface ModuleEventEmitterSemantic {
    id?: string;
    kind: "event_emitter";
    onMethods?: string[];
    emitMethods?: string[];
    channelArgIndexes?: number[];
    payloadArgIndex?: number;
    callbackArgIndex?: number;
    callbackParamIndex?: number;
    maxCandidates?: number;
}

export interface ModuleWriteMethodSpec {
    methodName: string;
    valueIndex: number;
}

export interface ModuleKeyedStorageSemantic {
    id?: string;
    kind: "keyed_storage";
    storageClasses: string[];
    writeMethods: ModuleWriteMethodSpec[];
    readMethods: string[];
    propDecorators?: string[];
    linkDecorators?: string[];
}

export interface ModuleRoutePushMethodSpec {
    methodName: string;
    routeField?: string;
}

export interface ModuleRouteBridgeSemantic {
    id?: string;
    kind: "route_bridge";
    pushMethods: ModuleRoutePushMethodSpec[];
    getMethods: string[];
    navDestinationClassNames?: string[];
    navDestinationRegisterMethods?: string[];
    frameworkSignatureHints?: string[];
    payloadUnwrapPrefixes?: string[];
}

export interface ModuleStateBindingSemantic {
    id?: string;
    kind: "state_binding";
    stateDecorators: string[];
    propDecorators: string[];
    linkDecorators: string[];
    provideDecorators?: string[];
    consumeDecorators?: string[];
    eventDecorators?: string[];
}

export type ModuleSemantic =
    | ModuleBridgeSemantic
    | ModuleStateSemantic
    | ModuleDeclarativeBindingSemantic
    | ModuleContainerSemantic
    | ModuleAbilityHandoffSemantic
    | ModuleKeyedStorageSemantic
    | ModuleEventEmitterSemantic
    | ModuleRouteBridgeSemantic
    | ModuleStateBindingSemantic;
