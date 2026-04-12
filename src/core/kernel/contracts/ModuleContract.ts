import type { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import type { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { fromContainerFieldKey, toContainerFieldKey } from "../model/ContainerSlotKeys";
import type {
    DeferredBindingActivation,
    DeferredBindingCarrierKind,
    DeferredBindingCompletion,
    DeferredBindingContinuationRole,
    DeferredBindingSourceSelector,
    ModuleExplicitDeferredBindingRecord,
} from "../model/DeferredBindingDeclaration";
import type { TaintFact } from "../model/TaintFact";

export interface ModuleRuleChain {
    sourceRuleId?: string;
    transferRuleIds: string[];
}

export interface ModuleMethodsApi {
    all(): any[];
    byName(methodName: string): any[];
    byClassName(className: string): any[];
}

export interface ModuleInvokeScanFilter {
    methodName?: string;
    declaringClassName?: string;
    declaringClassIncludes?: string;
    signature?: string;
    signatureIncludes?: string;
    minArgs?: number;
    instanceOnly?: boolean;
    staticOnly?: boolean;
}

export interface ModuleScannedInvoke {
    readonly ownerMethodSignature: string;
    readonly ownerDeclaringClassName: string;
    readonly stmt: any;
    readonly invokeExpr: any;
    readonly call: ModuleCallView;
    arg(index: number): any | undefined;
    args(): any[];
    base(): any | undefined;
    result(): any | undefined;
    argNodeIds(index: number): number[];
    argObjectNodeIds(index: number): number[];
    argCarrierNodeIds(index: number): number[];
    baseNodeIds(): number[];
    baseObjectNodeIds(): number[];
    baseCarrierNodeIds(): number[];
    resultNodeIds(): number[];
    resultCarrierNodeIds(): number[];
    callbackParamNodeIds(
        callbackArgIndex: number,
        paramIndex: number,
        options?: { maxCandidates?: number },
    ): number[];
}

export interface ModuleParameterBindingScanFilter {
    ownerMethodSignature?: string;
    ownerMethodName?: string;
    declaringClassName?: string;
    declaringClassIncludes?: string;
    paramIndex?: number;
    paramNameIncludes?: string;
    paramTypeIncludes?: string;
    localName?: string;
}

export interface ModuleScannedParameterBinding {
    readonly ownerMethodSignature: string;
    readonly ownerMethodName: string;
    readonly declaringClassName: string;
    readonly stmt: any;
    readonly paramIndex: number;
    readonly paramName: string;
    readonly paramType: string;
    local(): any | undefined;
    localName(): string | undefined;
    localNodeIds(): number[];
    localObjectNodeIds(): number[];
    localCarrierNodeIds(): number[];
}

export interface ModuleAssignScanFilter {
    ownerMethodSignature?: string;
    ownerMethodName?: string;
    declaringClassName?: string;
    declaringClassIncludes?: string;
    leftLocalName?: string;
    rightLocalName?: string;
}

export interface ModuleScannedAssign {
    readonly ownerMethodSignature: string;
    readonly ownerMethodName: string;
    readonly declaringClassName: string;
    readonly stmt: any;
    left(): any | undefined;
    leftLocalName(): string | undefined;
    right(): any | undefined;
    rightLocalName(): string | undefined;
    leftNodeIds(): number[];
    leftCarrierNodeIds(): number[];
    rightNodeIds(): number[];
    rightCarrierNodeIds(): number[];
}

export interface ModuleFieldLoadScanFilter {
    ownerMethodSignature?: string;
    ownerMethodName?: string;
    declaringClassName?: string;
    declaringClassIncludes?: string;
    fieldName?: string;
    fieldSignature?: string;
    baseLocalName?: string;
    baseLocalNames?: string[];
    baseThisOnly?: boolean;
}

export interface ModuleScannedFieldLoad {
    readonly ownerMethodSignature: string;
    readonly ownerMethodName: string;
    readonly declaringClassName: string;
    readonly stmt: any;
    readonly fieldName: string;
    readonly fieldSignature: string;
    base(): any | undefined;
    baseIsThis(): boolean;
    baseLocalName(): string | undefined;
    result(): any | undefined;
    resultLocalName(): string | undefined;
    baseNodeIds(): number[];
    baseObjectNodeIds(): number[];
    baseCarrierNodeIds(): number[];
    resultNodeIds(): number[];
    resultObjectNodeIds(): number[];
    resultCarrierNodeIds(): number[];
}

export interface ModuleFieldStoreScanFilter {
    ownerMethodSignature?: string;
    ownerMethodName?: string;
    declaringClassName?: string;
    declaringClassIncludes?: string;
    fieldName?: string;
    fieldSignature?: string;
    baseThisOnly?: boolean;
    sourceLocalName?: string;
    sourceLocalNames?: string[];
}

export interface ModuleScannedFieldStore {
    readonly ownerMethodSignature: string;
    readonly ownerMethodName: string;
    readonly declaringClassName: string;
    readonly stmt: any;
    readonly fieldName: string;
    readonly fieldSignature: string;
    base(): any | undefined;
    baseIsThis(): boolean;
    baseLocalName(): string | undefined;
    value(): any | undefined;
    valueLocalName(): string | undefined;
    baseNodeIds(): number[];
    baseObjectNodeIds(): number[];
    baseCarrierNodeIds(): number[];
    valueNodeIds(): number[];
    valueObjectNodeIds(): number[];
    valueCarrierNodeIds(): number[];
}

export interface ModuleDecoratedFieldScanFilter {
    className?: string;
    classNameIncludes?: string;
    fieldName?: string;
    fieldSignature?: string;
    decoratorKind?: string;
    decoratorKinds?: string[];
    decoratorParam?: string;
    decoratorParams?: string[];
}

export interface ModuleScannedDecorator {
    readonly kind: string;
    readonly param?: string;
    readonly content?: string;
}

export interface ModuleScannedDecoratedField {
    readonly className: string;
    readonly fieldName: string;
    readonly fieldSignature: string;
    decorators(): ModuleScannedDecorator[];
    decoratorKinds(): string[];
    hasDecorator(kind: string): boolean;
    decoratorParams(kind: string): string[];
}

export interface ModuleScanApi {
    invokes(filter?: ModuleInvokeScanFilter): ModuleScannedInvoke[];
    parameterBindings(filter?: ModuleParameterBindingScanFilter): ModuleScannedParameterBinding[];
    assigns(filter?: ModuleAssignScanFilter): ModuleScannedAssign[];
    fieldLoads(filter?: ModuleFieldLoadScanFilter): ModuleScannedFieldLoad[];
    fieldStores(filter?: ModuleFieldStoreScanFilter): ModuleScannedFieldStore[];
    decoratedFields(filter?: ModuleDecoratedFieldScanFilter): ModuleScannedDecoratedField[];
}

export interface ModuleSetupCallbackApi {
    methods(callbackValue: any, options?: ModuleCallbackResolveOptions): ModuleResolvedCallbackMethod[];
    paramBindings(
        callbackValue: any,
        paramIndex: number,
        options?: ModuleCallbackResolveOptions,
    ): ModuleResolvedCallbackParamBinding[];
    paramNodeIds(callbackValue: any, paramIndex: number, options?: { maxCandidates?: number }): number[];
}

export interface RawModuleSetupContext {
    scene: Scene;
    pag: Pag;
    allowedMethodSignatures?: Set<string>;
    fieldToVarIndex: Map<string, Set<number>>;
    log: (msg: string) => void;
}

export interface ModuleSetupDebugApi {
    summary(
        label: string,
        metrics: Record<string, unknown>,
        options?: {
            enabled?: boolean;
            omitEmpty?: boolean;
        },
    ): void;
}

export interface RawModuleFactEvent extends RawModuleSetupContext {
    fact: TaintFact;
    node: PagNode;
}

export interface RawModuleInvokeEvent extends RawModuleFactEvent {
    stmt: any;
    invokeExpr: any;
    callSignature: string;
    methodName: string;
    declaringClassName: string;
    args: any[];
    baseValue?: any;
    resultValue?: any;
}

export interface RawModuleCopyEdgeEvent {
    scene: Scene;
    pag: Pag;
    node: PagNode;
    contextId: number;
}

export interface ModuleSetupContext {
    raw: RawModuleSetupContext;
    methods: ModuleMethodsApi;
    scan: ModuleScanApi;
    bridge: ModuleBridgeApi;
    deferred: ModuleDeferredBindingApi;
    callbacks: ModuleSetupCallbackApi;
    analysis: ModuleAnalysisApi;
    log: (msg: string) => void;
    debug: ModuleSetupDebugApi;
}

export interface ModuleCurrentFactView {
    readonly nodeId: number;
    readonly source: string;
    readonly contextId: number;
    readonly field?: string[];
    readonly value: any;
    hasField(): boolean;
    fieldHead(): string | undefined;
    fieldTail(): string[] | undefined;
    cloneField(): string[] | undefined;
}

export interface ModuleCurrentNodeView {
    readonly nodeId: number;
    readonly contextId: number;
    readonly value: any;
}

export interface ModuleEmitOptions {
    source?: string;
    contextId?: number;
    chain?: ModuleRuleChain;
    allowUnreachableTarget?: boolean;
}

export interface ModuleValueEmitOptions extends ModuleEmitOptions {
    anchorStmt?: any;
}

export interface ModuleEmitCollector {
    push(items?: ModuleEmission[] | void): void;
    size(): number;
    done(): ModuleEmission[] | undefined;
}

export interface ModuleNodeRelay {
    connect(sourceNodeId: number, targetNodeId: number): void;
    connectMany(sourceNodeIds: Iterable<number>, targetNodeIds: Iterable<number>): void;
    connectInvokeArgToCallbackParam(
        call: ModuleScannedInvoke,
        sourceArgIndex: number,
        callbackArgIndex: number,
        paramIndex: number,
        options?: {
            sourceKind?: "node" | "carrier" | "object";
            maxCandidates?: number;
        },
    ): number;
    emit(event: ModuleFactEvent, reason: string, options?: ModuleEmitOptions): ModuleEmission[] | undefined;
    emitPreserve(event: ModuleFactEvent, reason: string, options?: ModuleEmitOptions): ModuleEmission[] | undefined;
    emitCurrentFieldTail(event: ModuleFactEvent, reason: string, options?: ModuleEmitOptions): ModuleEmission[] | undefined;
    emitLoadLike(event: ModuleFactEvent, reason: string, options?: ModuleEmitOptions): ModuleEmission[] | undefined;
    emitLoadLikeCurrentFieldTail(event: ModuleFactEvent, reason: string, options?: ModuleEmitOptions): ModuleEmission[] | undefined;
}

export interface ModuleKeyedNodeRelay {
    addSource(key: string, sourceNodeId: number): void;
    addSources(key: string, sourceNodeIds: Iterable<number>): void;
    addTarget(key: string, targetNodeId: number): void;
    addTargets(key: string, targetNodeIds: Iterable<number>): void;
    materialize(): number;
    emit(event: ModuleFactEvent, reason: string, options?: ModuleEmitOptions): ModuleEmission[] | undefined;
    emitPreserve(event: ModuleFactEvent, reason: string, options?: ModuleEmitOptions): ModuleEmission[] | undefined;
    emitCurrentFieldTail(event: ModuleFactEvent, reason: string, options?: ModuleEmitOptions): ModuleEmission[] | undefined;
    emitLoadLike(event: ModuleFactEvent, reason: string, options?: ModuleEmitOptions): ModuleEmission[] | undefined;
    emitLoadLikeCurrentFieldTail(event: ModuleFactEvent, reason: string, options?: ModuleEmitOptions): ModuleEmission[] | undefined;
}

export interface ModuleFieldRelay {
    connectField(
        sourceNodeId: number,
        sourceFieldName: string,
        targetNodeId: number,
        fieldPath: string | string[],
    ): void;
    connectFields(
        sourceNodeIds: Iterable<number>,
        sourceFieldName: string,
        targetNodeIds: Iterable<number>,
        fieldPath: string | string[],
    ): void;
    connectFieldPath(
        sourceNodeId: number,
        sourceFieldPath: string | string[],
        targetNodeId: number,
        targetFieldPath: string | string[],
    ): void;
    connectFieldPaths(
        sourceNodeIds: Iterable<number>,
        sourceFieldPath: string | string[],
        targetNodeIds: Iterable<number>,
        targetFieldPath: string | string[],
    ): void;
    connectLoadCurrentFieldTail(
        sourceNodeId: number,
        sourceFieldName: string,
        targetNodeId: number,
    ): void;
    connectLoadCurrentFieldTails(
        sourceNodeIds: Iterable<number>,
        sourceFieldName: string,
        targetNodeIds: Iterable<number>,
    ): void;
    connectLoadFieldTail(
        sourceNodeId: number,
        sourceFieldPath: string | string[],
        targetNodeId: number,
    ): void;
    connectLoadFieldTails(
        sourceNodeIds: Iterable<number>,
        sourceFieldPath: string | string[],
        targetNodeIds: Iterable<number>,
    ): void;
    emit(
        event: ModuleFactEvent,
        fieldReason: string,
        loadReason?: string,
        options?: ModuleEmitOptions,
    ): ModuleEmission[] | undefined;
}

export interface ModuleBridgeApi {
    nodeRelay(): ModuleNodeRelay;
    keyedNodeRelay(): ModuleKeyedNodeRelay;
    fieldRelay(): ModuleFieldRelay;
}

export interface ModuleDeferredBindingSemanticsOptions {
    activation?: DeferredBindingActivation;
    completion?: DeferredBindingCompletion;
    preserve?: DeferredBindingActivation[];
    continuationRole?: DeferredBindingContinuationRole;
}

export interface ModuleDeclarativeDeferredBindingDeclaration {
    sourceMethod?: any;
    sourceMethodSignature?: string;
    handlerMethod?: any;
    handlerMethodSignature?: string;
    anchorStmt: any;
    triggerLabel: string;
    carrierKind?: DeferredBindingCarrierKind;
    reason?: string;
    semantics?: ModuleDeferredBindingSemanticsOptions;
    activationSource?: DeferredBindingSourceSelector;
    payloadSource?: DeferredBindingSourceSelector;
}

export interface ModuleDeferredBindingApi {
    imperativeFromInvoke(
        invoke: ModuleScannedInvoke,
        callbackArgIndex: number,
        options?: {
            carrierKind?: DeferredBindingCarrierKind;
            reason?: string;
            maxCandidates?: number;
            semantics?: ModuleDeferredBindingSemanticsOptions;
        },
    ): number;
    declarative(
        declaration: ModuleDeclarativeDeferredBindingDeclaration,
    ): void;
}

export interface ModuleEmitApi {
    toNode(target: number | PagNode | null | undefined, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    toNodes(targets: Iterable<number | PagNode>, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    preserveToNode(target: number | PagNode | null | undefined, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    preserveToNodes(targets: Iterable<number | PagNode>, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    toCurrentFieldTailNode(target: number | PagNode | null | undefined, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    toCurrentFieldTailNodes(targets: Iterable<number | PagNode>, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    toField(target: number | PagNode | null | undefined, fieldPath: string | string[], reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    toFields(targets: Iterable<number | PagNode>, fieldPath: string | string[], reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    toValueField(targetValue: any, fieldPath: string | string[], reason: string, options?: ModuleValueEmitOptions): ModuleEmission[];
    loadLikeToNode(target: number | PagNode | null | undefined, reason: string, fieldPath?: string[], options?: ModuleEmitOptions): ModuleEmission[];
    loadLikeToNodes(targets: Iterable<number | PagNode>, reason: string, fieldPath?: string[], options?: ModuleEmitOptions): ModuleEmission[];
    loadLikeCurrentFieldTailToNode(target: number | PagNode | null | undefined, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    loadLikeCurrentFieldTailToNodes(targets: Iterable<number | PagNode>, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    collector(): ModuleEmitCollector;
}

export interface ModuleAnalysisApi {
    nodeIdsForValue(value: any, anchorStmt?: any): number[];
    objectNodeIdsForValue(value: any): number[];
    carrierNodeIdsForValue(value: any, anchorStmt?: any): number[];
    aliasLocalsForCarrier(carrierNodeId: number): any[];
    stringCandidates(value: any, maxDepth?: number): string[];
}

export interface ModuleCallbackResolveOptions {
    maxCandidates?: number;
}

export interface ModuleResolvedCallbackMethod {
    readonly method: any;
    readonly methodSignature: string;
    readonly methodName: string;
    readonly declaringClassName: string;
}

export interface ModuleResolvedCallbackParamBinding extends ModuleResolvedCallbackMethod {
    readonly stmt: any;
    readonly paramIndex: number;
    local(): any | undefined;
    localName(): string | undefined;
    localNodeIds(): number[];
    localObjectNodeIds(): number[];
    localCarrierNodeIds(): number[];
}

export interface ModuleCallbackApi {
    methods(callbackValue: any, options?: ModuleCallbackResolveOptions): ModuleResolvedCallbackMethod[];
    paramBindings(
        callbackValue: any,
        paramIndex: number,
        options?: ModuleCallbackResolveOptions,
    ): ModuleResolvedCallbackParamBinding[];
    paramNodeIds(callbackValue: any, paramIndex: number, options?: { maxCandidates?: number }): number[];
    toParam(callbackValue: any, paramIndex: number, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    preserveToParam(callbackValue: any, paramIndex: number, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    toCurrentFieldTailParam(callbackValue: any, paramIndex: number, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    toFieldParam(callbackValue: any, paramIndex: number, fieldPath: string | string[], reason: string, options?: ModuleEmitOptions): ModuleEmission[];
    loadLikeToParam(callbackValue: any, paramIndex: number, reason: string, fieldPath?: string[], options?: ModuleEmitOptions): ModuleEmission[];
    loadLikeCurrentFieldTailToParam(callbackValue: any, paramIndex: number, reason: string, options?: ModuleEmitOptions): ModuleEmission[];
}

export interface ModuleCallView {
    readonly signature: string;
    readonly methodName: string;
    readonly declaringClassName: string;
    readonly argCount: number;
    matchesSignature(expected: string): boolean;
    matchesMethod(expected: string): boolean;
    matchesClass(expected: string): boolean;
}

export interface ModuleValuesView {
    arg(index: number): any | undefined;
    args(): any[];
    base(): any | undefined;
    result(): any | undefined;
    stringArg(index: number, maxDepth?: number): string[];
    stringCandidates(value: any, maxDepth?: number): string[];
}

export interface ModuleDebugApi {
    hit(message: string): void;
    skip(message: string): void;
    log(message: string): void;
    summary(
        label: string,
        metrics: Record<string, unknown>,
        options?: {
            enabled?: boolean;
            omitEmpty?: boolean;
        },
    ): void;
}

export interface ModuleInvokeMatchApi {
    value(value: any): boolean;
    arg(index: number): boolean;
    base(): boolean;
    result(): boolean;
}

export interface ModuleFactEvent extends ModuleSetupContext {
    raw: RawModuleFactEvent;
    current: ModuleCurrentFactView;
    emit: ModuleEmitApi;
    debug: ModuleDebugApi;
}

export interface ModuleInvokeEvent extends ModuleFactEvent {
    raw: RawModuleInvokeEvent;
    call: ModuleCallView;
    values: ModuleValuesView;
    callbacks: ModuleCallbackApi;
    match: ModuleInvokeMatchApi;
}

export interface ModuleCopyEdgeEvent {
    raw: RawModuleCopyEdgeEvent;
    current: ModuleCurrentNodeView;
    debug: ModuleDebugApi;
}

export interface ModuleEmission {
    reason: string;
    fact: TaintFact;
    chain?: ModuleRuleChain;
    allowUnreachableTarget?: boolean;
}

export interface ModuleSession {
    onFact?(event: ModuleFactEvent): ModuleEmission[] | void;
    onInvoke?(event: ModuleInvokeEvent): ModuleEmission[] | void;
    shouldSkipCopyEdge?(event: ModuleCopyEdgeEvent): boolean;
}

export interface ModuleFailureEvent {
    moduleId: string;
    phase: "setup" | "onFact" | "onInvoke" | "shouldSkipCopyEdge";
    message: string;
    code?: string;
    advice?: string;
    path?: string;
    line?: number;
    column?: number;
    stackExcerpt?: string;
    userMessage: string;
}

export interface ModuleAuditEntry {
    moduleId: string;
    sourcePath?: string;
    factHookCalls: number;
    invokeHookCalls: number;
    copyEdgeChecks: number;
    factEmissionCount: number;
    invokeEmissionCount: number;
    totalEmissionCount: number;
    skipCopyEdgeCount: number;
    debugHitCount: number;
    debugSkipCount: number;
    debugLogCount: number;
    recentDebugMessages: string[];
}

export interface ModuleAuditSnapshot {
    loadedModuleIds: string[];
    failedModuleIds: string[];
    failureEvents: ModuleFailureEvent[];
    moduleStats: Record<string, ModuleAuditEntry>;
}

export interface TaintModule {
    readonly id: string;
    readonly description: string;
    readonly enabled?: boolean;
    setup?(ctx: ModuleSetupContext): ModuleSession | void;
}

export interface ModuleRuntime {
    listModuleIds(): string[];
    getAuditSnapshot(): ModuleAuditSnapshot;
    getDeferredBindingDeclarations(): ModuleExplicitDeferredBindingRecord[];
    emitForFact(event: RawModuleFactEvent): ModuleEmission[];
    emitForInvoke(event: RawModuleInvokeEvent): ModuleEmission[];
    shouldSkipCopyEdge(event: RawModuleCopyEdgeEvent): boolean;
}

export function emptyModuleAuditSnapshot(): ModuleAuditSnapshot {
    return {
        loadedModuleIds: [],
        failedModuleIds: [],
        failureEvents: [],
        moduleStats: {},
    };
}

export function defineModule<T extends TaintModule>(module: T): T {
    return module;
}

export {
    fromContainerFieldKey,
    toContainerFieldKey,
};
