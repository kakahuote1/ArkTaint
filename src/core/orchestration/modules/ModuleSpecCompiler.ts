import {
    defineModule,
    type ModuleCallbackApi,
    type ModuleDeferredBindingSemanticsOptions,
    type ModuleEmission,
    type ModuleFactEvent,
    type ModuleInvokeEvent,
    type ModuleKeyedNodeRelay,
    type ModuleNodeRelay,
    type ModuleScannedInvoke,
    type TaintModule,
} from "../../kernel/contracts/ModuleContract";
import type {
    ModuleBoundaryKind,
    ModuleBridgeEmitSpec,
    ModuleDecoratedFieldAddressSource,
    ModuleDecoratedFieldSurfaceSelector,
    ModuleFieldPathSpec,
    ModuleMethodSelector,
    ModuleSemantic,
    ModuleBridgeSemantic,
    ModuleStateSemantic,
    ModuleDeclarativeBindingSemantic,
    ModuleEndpoint,
    ModuleAddress,
    ModuleDispatch,
    ModuleSameReceiverConstraint,
    ModuleSameAddressConstraint,
    ModuleSemanticSurfaceRef,
    ModuleInvokeSurfaceSelector,
    ModuleSpec as PublicModuleSpec,
    ModuleTransferMode,
} from "../../kernel/contracts/ModuleSpec";
import type {
    MaterializedModuleSpec,
    ModuleAssociation,
    ModuleCallbackDispatchTrigger,
    ModuleCarrierFieldCell,
    ModuleCarrierNodeSlotSelector,
    ModuleCarrierSetSelector,
    ModuleCell,
    ModuleCellToCellTransfer,
    ModuleCellToPortTransfer,
    ModuleChannelCell,
    ModuleDecoratedFieldSurface,
    ModuleDecoratedFieldValuePort,
    ModuleDeferredBindingSemanticsSpec,
    ModuleDeclarativeDispatchTrigger,
    ModuleFieldBridgeEmitSpec,
    ModuleFieldLoadPort,
    ModuleImperativeDeferredBindingSpec,
    ModuleInvokeArgPort,
    ModuleInvokeBasePort,
    ModuleInvokeEmitCallbackTarget,
    ModuleInvokeEmitMode,
    ModuleInvokeEmitNodeTarget,
    ModuleInvokeEmitTarget,
    ModuleInvokeEmitValueFieldTarget,
    ModuleInvokeResultPort,
    ModuleInvokeSurface,
    ModuleInvokeValueSlotSelector,
    ModuleKeyedStateCell,
    ModuleMethodParamPort,
    ModuleMethodSurface,
    ModuleMethodThisPort,
    ModuleNodeSlotSelector,
    ModulePort,
    ModulePortToCellTransfer,
    ModulePortToPortTransfer,
    ModuleRecipeAccessorPair,
    ModuleRecipeAddress,
    ModuleRecipeAssociatedBridge,
    ModuleRecipeCallbackChannel,
    ModuleRecipeCallbackHandoff,
    ModuleRecipeCallbackTarget,
    ModuleRecipeCallbackTrigger,
    ModuleRecipeCell,
    ModuleRecipeCellBridge,
    ModuleRecipeDeclarativeDispatch,
    ModuleRecipeDirectBridge,
    ModuleRecipeEndpoint,
    ModuleRecipeFactoryReturn,
    ModuleRecipeInvokeSurfaceRef,
    ModuleRecipeTriggerPreset,
    ModuleRecipeValueSource,
    ModuleResultPortNodeKind,
    ModuleStringSlotSelector,
    ModuleSurface,
    ModuleTransfer,
    ModuleTrigger,
} from "./ModuleSpecLoweringTypes";
import { getMethodBySignature } from "../../kernel/contracts/MethodLookup";
import { validateModuleSpecOrThrow } from "./ModuleSpecValidator";
import { canonicalizeModuleSpec, normalizeSurfaceRef } from "./ModuleSpecCanonicalizer";
import { compileRuntimeSemanticModule } from "./ModuleSpecRuntimeSemanticCompiler";

type ModuleSpec = Omit<MaterializedModuleSpec, "description" | "semantics"> & {
    description: string;
    semantics: Array<ModuleSemantic & { id: string }>;
};

function invariant(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

interface KeyedBridgeSideSpec {
    surface: ModuleInvokeSurfaceSelector;
    key: ModuleStringSlotSelector;
    value: ModuleNodeSlotSelector;
}

interface CarrierBridgeSideSpec {
    surface: ModuleInvokeSurfaceSelector;
    carrier: ModuleCarrierNodeSlotSelector;
    value: ModuleNodeSlotSelector;
}

interface KeyedBridgeModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "keyed_bridge";
    source: KeyedBridgeSideSpec;
    target: KeyedBridgeSideSpec;
    targetDeferredBinding?: ModuleImperativeDeferredBindingSpec;
    emit?: ModuleBridgeEmitSpec;
}

interface CarrierBridgeModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "carrier_bridge";
    source: CarrierBridgeSideSpec;
    target: CarrierBridgeSideSpec;
    targetDeferredBinding?: ModuleImperativeDeferredBindingSpec;
    emit?: ModuleBridgeEmitSpec;
}

interface DirectCallbackBridgeModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "direct_callback_bridge";
    surface: ModuleInvokeSurfaceSelector;
    source: Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>;
    target: Extract<ModuleNodeSlotSelector, { kind: "callback_param" }>;
    deferredBinding?: ModuleImperativeDeferredBindingSpec;
    emit?: ModuleBridgeEmitSpec;
}

interface DirectNodeBridgeModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "direct_node_bridge";
    surface: ModuleInvokeSurfaceSelector;
    source: Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>;
    target: Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>;
    emit?: ModuleBridgeEmitSpec;
}

interface ModuleFieldBridgeWriteTargetSpec {
    carrier: ModuleCarrierSetSelector;
    fieldPath: string[];
}

interface ModuleFieldBridgeLoadTargetSpec {
    kind: "field_load";
    method: ModuleMethodSelector;
    fieldName: string;
}

interface ModuleFieldBridgeInvokePortTargetSpec {
    kind: "invoke_port";
    surface: ModuleInvokeSurfaceSelector;
    port: ModuleNodeSlotSelector;
    deferredBinding?: ModuleImperativeDeferredBindingSpec;
}

interface ModuleFieldBridgeMethodParamTargetSpec {
    kind: "method_param";
    method: ModuleMethodSelector;
    paramIndex: number;
}

type ModuleFieldBridgeTargetSpec =
    | ModuleFieldBridgeLoadTargetSpec
    | ModuleFieldBridgeInvokePortTargetSpec
    | ModuleFieldBridgeMethodParamTargetSpec;

interface FieldBridgeModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "field_bridge";
    source: {
        carrier: ModuleCarrierSetSelector;
        fieldName: string;
        fieldPath?: string[];
    };
    targetWrites?: ModuleFieldBridgeWriteTargetSpec[];
    targetLoads?: ModuleFieldBridgeTargetSpec[];
    emit?: ModuleFieldBridgeEmitSpec;
}

interface InvokeEmitModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "invoke_emit";
    surface: ModuleInvokeSurfaceSelector;
    when: ModuleInvokeValueSlotSelector;
    target: ModuleInvokeEmitTarget;
    boundary?: ModuleBoundaryKind;
    reason: string;
    allowUnreachableTarget?: boolean;
}

interface PairedNodeFieldWriteModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "paired_node_field_write";
    surface: ModuleInvokeSurfaceSelector;
    source: Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>;
    targetCarrier: ModuleCarrierNodeSlotSelector;
    fieldPath: string[];
    emit?: ModuleBridgeEmitSpec;
}

interface MethodPortSelectorSpec {
    kind: "method_this" | "method_param";
    paramIndex?: number;
}

interface MethodFieldWriteModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "method_field_write";
    method: ModuleMethodSelector;
    source: MethodPortSelectorSpec;
    target: MethodPortSelectorSpec;
    fieldPath: string[];
    emit?: ModuleBridgeEmitSpec;
}

interface DeclarativeBindingModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "declarative_binding";
    sourceMethod: ModuleMethodSelector;
    handlerMethod: ModuleMethodSelector;
    anchor?: {
        anchorMethodSignature?: string;
        anchorInvoke?: ModuleInvokeSurfaceSelector;
        stmtIndex?: number;
    };
    triggerLabel: string;
    carrierKind?: ModuleImperativeDeferredBindingSpec["carrierKind"];
    reason?: string;
    semantics?: ModuleImperativeDeferredBindingSpec["semantics"];
}

interface ScopedAddressedBridgeModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "scoped_addressed_bridge";
    sourceSurface: ModuleInvokeSurfaceSelector;
    targetSurface: ModuleInvokeSurfaceSelector;
    sourceValue: ModuleNodeSlotSelector;
    sourceAddress: ModuleStringSlotSelector;
    targetValue: ModuleNodeSlotSelector;
    targetAddress: ModuleStringSlotSelector;
    sourceScope: ModuleCarrierNodeSlotSelector;
    targetScope: ModuleCarrierNodeSlotSelector;
    targetDeferredBinding?: ModuleImperativeDeferredBindingSpec;
    emit?: ModuleBridgeEmitSpec;
}

interface CrossMethodParamBridgeModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "cross_method_param_bridge";
    sourceSurface: ModuleInvokeSurfaceSelector;
    sourceValue: Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>;
    targetMethod: ModuleMethodSelector;
    targetParamIndex: number;
    emit?: ModuleBridgeEmitSpec;
}

interface LiteralAddressKeySpec {
    kind: "literal";
    value: string;
}

interface InvokeSlotAddressKeySpec {
    kind: "invoke_slot";
    slot: ModuleStringSlotSelector;
}

interface DecoratedFieldMetaAddressKeySpec {
    kind: "decorated_field_meta";
    surface: ModuleDecoratedFieldSurfaceSelector;
    source: ModuleDecoratedFieldAddressSource;
    decoratorKind?: string;
}

type AddressKeySpec =
    | LiteralAddressKeySpec
    | InvokeSlotAddressKeySpec
    | DecoratedFieldMetaAddressKeySpec;

interface SemanticInvokeEndpointSpec {
    kind: "invoke";
    surface: ModuleInvokeSurfaceSelector;
    value: ModuleNodeSlotSelector;
    fieldPath?: ModuleFieldPathSpec;
    deferredBinding?: ModuleImperativeDeferredBindingSpec;
}

interface SemanticDecoratedFieldEndpointSpec {
    kind: "decorated_field";
    surface: ModuleDecoratedFieldSurfaceSelector;
}

type SemanticEndpointSpec =
    | SemanticInvokeEndpointSpec
    | SemanticDecoratedFieldEndpointSpec;

interface SemanticAddressedBridgeModuleSpec {
    id: string;
    description: string;
    enabled?: boolean;
    type: "semantic_addressed_bridge";
    source: SemanticEndpointSpec;
    target: SemanticEndpointSpec;
    sourceAddress: AddressKeySpec;
    targetAddress: AddressKeySpec;
    emit?: ModuleBridgeEmitSpec;
}

type LoweredModuleSpec =
    | KeyedBridgeModuleSpec
    | CarrierBridgeModuleSpec
    | DirectNodeBridgeModuleSpec
    | DirectCallbackBridgeModuleSpec
    | FieldBridgeModuleSpec
    | InvokeEmitModuleSpec
    | PairedNodeFieldWriteModuleSpec
    | MethodFieldWriteModuleSpec
    | DeclarativeBindingModuleSpec
    | ScopedAddressedBridgeModuleSpec
    | CrossMethodParamBridgeModuleSpec
    | SemanticAddressedBridgeModuleSpec;

type NormalizedBridgeEmitSpec = Required<ModuleBridgeEmitSpec>;
type NormalizedFieldBridgeEmitSpec = Required<ModuleFieldBridgeEmitSpec>;

function normalizeEmitSpec(spec?: ModuleBridgeEmitSpec): NormalizedBridgeEmitSpec {
    return {
        mode: spec?.mode || "preserve",
        boundary: spec?.boundary || "identity",
        reason: spec?.reason || "ModuleSpec-Bridge",
        allowUnreachableTarget: spec?.allowUnreachableTarget === true,
    };
}

function normalizeFieldBridgeEmitSpec(spec?: ModuleFieldBridgeEmitSpec): NormalizedFieldBridgeEmitSpec {
    return {
        fieldReason: spec?.fieldReason || "ModuleSpec-FieldBridge",
        loadReason: spec?.loadReason || spec?.fieldReason || "ModuleSpec-FieldBridge",
        boundary: spec?.boundary || "identity",
        allowUnreachableTarget: spec?.allowUnreachableTarget === true,
    };
}

function pushStructuredBridgeEmission(
    collector: ReturnType<ModuleFactEvent["emit"]["collector"]>,
    event: ModuleFactEvent,
    targetNodeIds: Iterable<number>,
    emitSpec: NormalizedBridgeEmitSpec,
): void {
    const options = {
        allowUnreachableTarget: emitSpec.allowUnreachableTarget,
    };
    switch (emitSpec.mode) {
        case "plain":
            collector.push(event.emit.preserveToNodes(targetNodeIds, emitSpec.reason, options));
            break;
        case "current_field_tail":
            collector.push(event.emit.toCurrentFieldTailNodes(targetNodeIds, emitSpec.reason, options));
            break;
        case "preserve":
        default:
            collector.push(event.emit.preserveToNodes(targetNodeIds, emitSpec.reason, options));
            break;
    }
}

function resolveStringSlotValue(call: ModuleScannedInvoke, selector: ModuleStringSlotSelector): any | undefined {
    switch (selector.kind) {
        case "arg":
            return call.arg(selector.index);
        case "base":
            return call.base();
        case "result":
            return call.result();
    }
}

function resolveInvokeValueFromCall(call: ModuleScannedInvoke, selector: ModuleInvokeValueSlotSelector): any | undefined {
    switch (selector.kind) {
        case "arg":
            return call.arg(selector.index);
        case "base":
            return call.base();
        case "result":
            return call.result();
    }
}

function resolveInvokeValueFromEvent(event: ModuleInvokeEvent, selector: ModuleInvokeValueSlotSelector): any | undefined {
    switch (selector.kind) {
        case "arg":
            return event.values.arg(selector.index);
        case "base":
            return event.values.base();
        case "result":
            return event.values.result();
    }
}

function resolveStringCandidates(
    analysis: { stringCandidates(value: any, maxDepth?: number): string[] },
    call: ModuleScannedInvoke,
    selector: ModuleStringSlotSelector,
): string[] {
    const value = resolveStringSlotValue(call, selector);
    if (value === undefined || value === null) {
        return [];
    }
    return [...new Set(
        analysis
            .stringCandidates(value)
            .map(item => String(item || "").trim())
            .filter(Boolean),
    )];
}

function resolveAddressKeys(
    analysis: { stringCandidates(value: any, maxDepth?: number): string[] },
    call: ModuleScannedInvoke | undefined,
    spec: AddressKeySpec,
): string[] {
    if (spec.kind === "literal") {
        return spec.value ? [spec.value] : [];
    }
    if (spec.kind === "decorated_field_meta") {
        return [];
    }
    if (!call) {
        return [];
    }
    return resolveStringCandidates(analysis, call, spec.slot);
}

function addMapSetValue(map: Map<string, Set<number>>, key: string, value: number): void {
    let bucket = map.get(key);
    if (!bucket) {
        bucket = new Set<number>();
        map.set(key, bucket);
    }
    bucket.add(value);
}

function addMapSetText(map: Map<string, Set<string>>, key: string, value: string): void {
    let bucket = map.get(key);
    if (!bucket) {
        bucket = new Set<string>();
        map.set(key, bucket);
    }
    bucket.add(value);
}

function addMapEndpointValue(
    map: Map<string, Map<string, { objectNodeId: number; fieldName: string }>>,
    key: string,
    endpoint: { objectNodeId: number; fieldName: string },
): void {
    let bucket = map.get(key);
    if (!bucket) {
        bucket = new Map<string, { objectNodeId: number; fieldName: string }>();
        map.set(key, bucket);
    }
    bucket.set(`${endpoint.objectNodeId}#${endpoint.fieldName}`, endpoint);
}

function addMapFieldPathValue(
    map: Map<string, Map<number, string[][]>>,
    key: string,
    nodeId: number,
    fieldPath: string[],
): void {
    let nodeMap = map.get(key);
    if (!nodeMap) {
        nodeMap = new Map<number, string[][]>();
        map.set(key, nodeMap);
    }
    const existing = nodeMap.get(nodeId) || [];
    if (!existing.some(item => item.length === fieldPath.length && item.every((part, index) => part === fieldPath[index]))) {
        existing.push([...fieldPath]);
        nodeMap.set(nodeId, existing);
    }
}

function startsWithFieldPath(fieldPath: string[] | undefined, prefix: string[]): boolean {
    if (!fieldPath || fieldPath.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i++) {
        if (fieldPath[i] !== prefix[i]) return false;
    }
    return true;
}

function hasFieldPathSpec(spec: ModuleFieldPathSpec | undefined): boolean {
    if (!spec) return false;
    if (Array.isArray(spec)) {
        return spec.length > 0;
    }
    return Array.isArray(spec.parts) && spec.parts.length > 0;
}

function cloneFieldPathSpec(spec: ModuleFieldPathSpec | undefined): ModuleFieldPathSpec | undefined {
    if (!spec) return undefined;
    if (Array.isArray(spec)) {
        return [...spec];
    }
    return {
        parts: spec.parts.map(part => {
            if (part.kind === "literal") {
                return {
                    kind: "literal" as const,
                    value: part.value,
                };
            }
            if (part.kind === "current_field_without_prefix") {
                return {
                    kind: "current_field_without_prefix" as const,
                    prefixes: part.prefixes.map(prefix => [...prefix]),
                };
            }
            return { ...part };
        }),
    };
}

function resolveTemplateFieldPath(
    event: ModuleFactEvent,
    spec: Exclude<ModuleFieldPathSpec, string[]>,
): string[] {
    const currentField = event.current.cloneField() || [];
    const currentTail = event.current.fieldTail() || [];
    const out: string[] = [];

    for (const part of spec.parts) {
        switch (part.kind) {
            case "literal":
                if (part.value) {
                    out.push(part.value);
                }
                break;
            case "current_field":
                out.push(...currentField);
                break;
            case "current_tail":
                out.push(...currentTail);
                break;
            case "current_field_without_prefix": {
                let bestMatch: string[] | undefined;
                for (const prefix of part.prefixes || []) {
                    if (!startsWithFieldPath(currentField, prefix)) continue;
                    if (!bestMatch || prefix.length > bestMatch.length) {
                        bestMatch = prefix;
                    }
                }
                if (bestMatch) {
                    out.push(...currentField.slice(bestMatch.length));
                } else {
                    out.push(...currentField);
                }
                break;
            }
        }
    }

    return out;
}

function resolveExplicitFieldPath(
    event: ModuleFactEvent,
    spec: ModuleFieldPathSpec | undefined,
): string[] | undefined {
    if (!spec) return undefined;
    if (Array.isArray(spec)) {
        return [...spec];
    }
    return resolveTemplateFieldPath(event, spec);
}

function resolveInvokeNodeIds(call: ModuleScannedInvoke, selector: ModuleNodeSlotSelector): number[] {
    switch (selector.kind) {
        case "arg":
            switch (selector.nodeKind || "node") {
                case "carrier":
                    return call.argCarrierNodeIds(selector.index);
                case "object":
                    return call.argObjectNodeIds(selector.index);
                default:
                    return call.argNodeIds(selector.index);
            }
        case "base":
            switch (selector.nodeKind || "node") {
                case "carrier":
                    return call.baseCarrierNodeIds();
                case "object":
                    return call.baseObjectNodeIds();
                default:
                    return call.baseNodeIds();
            }
        case "result":
            switch (selector.nodeKind || "node") {
                case "carrier":
                    return call.resultCarrierNodeIds();
                default:
                    return call.resultNodeIds();
            }
        case "callback_param":
            return call.callbackParamNodeIds(
                selector.callbackArgIndex,
                selector.paramIndex,
                { maxCandidates: selector.maxCandidates },
            );
    }
}

function resolveInvokeCarrierNodeIds(call: ModuleScannedInvoke, selector: ModuleCarrierNodeSlotSelector): number[] {
    return resolveInvokeNodeIds(call, selector);
}

function resolveBridgeSourceNodeIds(
    call: ModuleScannedInvoke,
    selector: Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>,
): number[] {
    const out = new Set<number>(resolveInvokeNodeIds(call, selector));
    switch (selector.kind) {
        case "arg":
            for (const nodeId of call.argCarrierNodeIds(selector.index)) {
                out.add(nodeId);
            }
            for (const nodeId of call.argObjectNodeIds(selector.index)) {
                out.add(nodeId);
            }
            break;
        case "base":
            for (const nodeId of call.baseCarrierNodeIds()) {
                out.add(nodeId);
            }
            for (const nodeId of call.baseObjectNodeIds()) {
                out.add(nodeId);
            }
            break;
        case "result":
            for (const nodeId of call.resultCarrierNodeIds()) {
                out.add(nodeId);
            }
            for (const nodeId of call.resultNodeIds()) {
                out.add(nodeId);
            }
            break;
    }
    return [...out.values()];
}

function hasIntersection(left: Iterable<number>, right: Iterable<number>): boolean {
    const leftSet = new Set<number>(left);
    const rightSet = new Set<number>(right);
    const [small, large] = leftSet.size <= rightSet.size
        ? [leftSet, rightSet]
        : [rightSet, leftSet];
    for (const item of small) {
        if (large.has(item)) {
            return true;
        }
    }
    return false;
}

function emitViaRelay(
    relay: ModuleNodeRelay | ModuleKeyedNodeRelay,
    event: any,
    emitSpec: NormalizedBridgeEmitSpec,
): any[] | undefined {
    const options = {
        allowUnreachableTarget: emitSpec.allowUnreachableTarget,
    };
    if (emitSpec.boundary === "stringify_result") {
        const collector = event.emit.collector();
        collector.push(relay.emit(event, emitSpec.reason, options));
        switch (emitSpec.mode) {
            case "current_field_tail":
                collector.push(relay.emitCurrentFieldTail(event, emitSpec.reason, options));
                break;
            case "plain":
            case "preserve":
            default:
                collector.push(relay.emitPreserve(event, emitSpec.reason, options));
                break;
        }
        return collector.done();
    }
    if (emitSpec.boundary === "clone_copy") {
        switch (emitSpec.mode) {
            case "plain":
                return relay.emit(event, emitSpec.reason, options);
            case "current_field_tail":
                return relay.emitLoadLikeCurrentFieldTail(event, emitSpec.reason, options);
            case "preserve":
            default:
                return relay.emitLoadLike(event, emitSpec.reason, options);
        }
    }
    switch (emitSpec.mode) {
        case "plain":
            return relay.emit(event, emitSpec.reason, options);
        case "current_field_tail":
            return relay.emitCurrentFieldTail(event, emitSpec.reason, options);
        case "preserve":
        default:
            return relay.emitPreserve(event, emitSpec.reason, options);
    }
}

function toDeferredBindingOptions(spec: ModuleImperativeDeferredBindingSpec): {
    carrierKind?: ModuleImperativeDeferredBindingSpec["carrierKind"];
    reason: string;
    semantics?: ModuleDeferredBindingSemanticsOptions;
} {
    return {
        carrierKind: spec.carrierKind,
        reason: spec.reason,
        semantics: spec.semantics
            ? {
                activation: spec.semantics.activation,
                completion: spec.semantics.completion,
                preserve: spec.semantics.preserve,
                continuationRole: spec.semantics.continuationRole,
            }
            : undefined,
    };
}

function matchesInvokeSurface(
    surface: ModuleInvokeSurfaceSelector,
    call: {
        signature: string;
        methodName: string;
        declaringClassName: string;
        argCount: number;
        isInstanceInvoke?: boolean;
    },
): boolean {
    if (surface.methodName && surface.methodName !== call.methodName) return false;
    if (surface.declaringClassName && surface.declaringClassName !== call.declaringClassName) return false;
    if (surface.declaringClassIncludes && !call.declaringClassName.includes(surface.declaringClassIncludes)) return false;
    if (surface.signature && surface.signature !== call.signature) return false;
    if (surface.signatureIncludes && !call.signature.includes(surface.signatureIncludes)) return false;
    if (surface.minArgs !== undefined && call.argCount < surface.minArgs) return false;
    if (surface.instanceOnly && call.isInstanceInvoke === false) return false;
    if (surface.staticOnly && call.isInstanceInvoke === true) return false;
    return true;
}

function matchesEventInvokeSurface(surface: ModuleInvokeSurfaceSelector, event: ModuleInvokeEvent): boolean {
    return matchesInvokeSurface(surface, {
        signature: event.call.signature,
        methodName: event.call.methodName,
        declaringClassName: event.call.declaringClassName,
        argCount: event.call.argCount,
        isInstanceInvoke: event.raw.baseValue !== undefined,
    });
}

function matchesInvokeFactSlot(event: ModuleInvokeEvent, selector: ModuleInvokeValueSlotSelector): boolean {
    switch (selector.kind) {
        case "arg":
            return event.match.arg(selector.index);
        case "base":
            return event.match.base();
        case "result":
            return event.match.result();
    }
}

function matchesMethodSelector(
    selector: ModuleMethodSelector,
    method: {
        signature: string;
        methodName: string;
        declaringClassName: string;
    },
): boolean {
    if (selector.methodSignature && selector.methodSignature !== method.signature) return false;
    if (selector.methodName && selector.methodName !== method.methodName) return false;
    if (selector.declaringClassName && selector.declaringClassName !== method.declaringClassName) return false;
    if (selector.declaringClassIncludes && !method.declaringClassName.includes(selector.declaringClassIncludes)) return false;
    return true;
}

function resolveMethodMeta(method: any): {
    signature: string;
    methodName: string;
    declaringClassName: string;
} {
    const methodSig = method.getSignature?.();
    return {
        signature: methodSig?.toString?.() || "",
        methodName: method.getName?.() || methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "",
        declaringClassName: methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "",
    };
}

function resolveMethodThisLocal(method: any): any | undefined {
    const locals = method?.getBody?.()?.getLocals?.();
    if (!locals) {
        return undefined;
    }
    if (typeof locals.get === "function") {
        const direct = locals.get("this");
        if (direct) {
            return direct;
        }
    }
    if (typeof locals.values === "function") {
        for (const local of locals.values()) {
            if (local?.getName?.() === "this") {
                return local;
            }
        }
    }
    if (Array.isArray(locals)) {
        return locals.find(local => local?.getName?.() === "this");
    }
    return undefined;
}

function toMethodPortSelector(
    port: ModuleMethodThisPort | ModuleMethodParamPort,
): MethodPortSelectorSpec {
    if (port.kind === "method_this") {
        return {
            kind: "method_this",
        };
    }
    return {
        kind: "method_param",
        paramIndex: port.paramIndex,
    };
}

function resolveMethodPortNodeIdsForMethod(
    ctx: any,
    method: any,
    selector: MethodPortSelectorSpec,
): number[] {
    const out = new Set<number>();
    if (selector.kind === "method_this") {
        const thisLocal = resolveMethodThisLocal(method);
        if (!thisLocal) {
            return [];
        }
        for (const nodeId of ctx.analysis.nodeIdsForValue(thisLocal, undefined)) {
            out.add(nodeId);
        }
        for (const nodeId of ctx.analysis.objectNodeIdsForValue(thisLocal)) {
            out.add(nodeId);
        }
        for (const nodeId of ctx.analysis.carrierNodeIdsForValue(thisLocal, undefined)) {
            out.add(nodeId);
        }
        return [...out.values()];
    }

    const ownerMethodSignature = method?.getSignature?.()?.toString?.() || "";
    if (!ownerMethodSignature) {
        return [];
    }
    for (const binding of ctx.scan.parameterBindings({
        ownerMethodSignature,
        paramIndex: selector.paramIndex!,
    })) {
        for (const nodeId of binding.localNodeIds()) {
            out.add(nodeId);
        }
        for (const nodeId of binding.localObjectNodeIds()) {
            out.add(nodeId);
        }
        for (const nodeId of binding.localCarrierNodeIds()) {
            out.add(nodeId);
        }
    }
    return [...out.values()];
}

function resolveMethodCarrierNodeIdsForMethod(
    ctx: any,
    method: any,
    selector: MethodPortSelectorSpec,
): number[] {
    const out = new Set<number>();
    if (selector.kind === "method_this") {
        const thisLocal = resolveMethodThisLocal(method);
        if (!thisLocal) {
            return [];
        }
        for (const nodeId of ctx.analysis.objectNodeIdsForValue(thisLocal)) {
            out.add(nodeId);
        }
        for (const nodeId of ctx.analysis.carrierNodeIdsForValue(thisLocal, undefined)) {
            out.add(nodeId);
        }
        return [...out.values()];
    }

    const ownerMethodSignature = method?.getSignature?.()?.toString?.() || "";
    if (!ownerMethodSignature) {
        return [];
    }
    for (const binding of ctx.scan.parameterBindings({
        ownerMethodSignature,
        paramIndex: selector.paramIndex!,
    })) {
        for (const nodeId of binding.localObjectNodeIds()) {
            out.add(nodeId);
        }
        for (const nodeId of binding.localCarrierNodeIds()) {
            out.add(nodeId);
        }
    }
    return [...out.values()];
}

function resolveCarrierSetNodeIds(ctx: any, selector: ModuleCarrierSetSelector): number[] {
    const out = new Set<number>();
    switch (selector.kind) {
        case "invoke_slot":
            for (const call of ctx.scan.invokes({ ...selector.surface })) {
                for (const nodeId of resolveInvokeCarrierNodeIds(call, selector.slot)) {
                    out.add(nodeId);
                }
                switch (selector.slot.kind) {
                    case "arg":
                        for (const nodeId of call.argObjectNodeIds(selector.slot.index)) {
                            out.add(nodeId);
                        }
                        break;
                    case "base":
                        for (const nodeId of call.baseObjectNodeIds()) {
                            out.add(nodeId);
                        }
                        break;
                    case "result":
                        for (const nodeId of call.resultNodeIds()) {
                            out.add(nodeId);
                        }
                        break;
                }
            }
            break;
        case "method_this":
            for (const method of ctx.methods.all()) {
                const signature = method?.getSignature?.()?.toString?.() || "";
                const methodName = method?.getName?.() || "";
                const declaringClassName = method?.getDeclaringArkClass?.()?.getName?.()
                    || method?.getSignature?.()?.getDeclaringClassSignature?.()?.getClassName?.()
                    || "";
                if (!matchesMethodSelector(selector.method, {
                    signature,
                    methodName,
                    declaringClassName,
                })) {
                    continue;
                }
                const thisLocal = resolveMethodThisLocal(method);
                if (!thisLocal) continue;
                for (const nodeId of ctx.analysis.objectNodeIdsForValue(thisLocal)) {
                    out.add(nodeId);
                }
                for (const nodeId of ctx.analysis.carrierNodeIdsForValue(thisLocal, undefined)) {
                    out.add(nodeId);
                }
            }
            break;
        case "method_param":
            for (const binding of ctx.scan.parameterBindings({
                ownerMethodSignature: selector.method.methodSignature,
                ownerMethodName: selector.method.methodName,
                declaringClassName: selector.method.declaringClassName,
                declaringClassIncludes: selector.method.declaringClassIncludes,
                paramIndex: selector.paramIndex,
            })) {
                for (const nodeId of binding.localObjectNodeIds()) {
                    out.add(nodeId);
                }
                for (const nodeId of binding.localCarrierNodeIds()) {
                    out.add(nodeId);
                }
            }
            break;
    }
    return [...out.values()];
}

function resolveFieldLoadTargetNodeIds(
    ctx: any,
    target: ModuleFieldBridgeTargetSpec,
): number[] {
    if (target.kind === "invoke_port") {
        const out = new Set<number>();
        for (const call of ctx.scan.invokes({ ...target.surface })) {
            for (const nodeId of resolveInvokeNodeIds(call, target.port)) {
                out.add(nodeId);
            }
            if (target.deferredBinding?.kind === "imperative") {
                ctx.deferred.imperativeFromInvoke(
                    call,
                    target.deferredBinding.callbackArgIndex,
                    toDeferredBindingOptions(target.deferredBinding),
                );
            }
        }
        return [...out.values()];
    }
    if (target.kind === "method_param") {
        const out = new Set<number>();
        for (const binding of ctx.scan.parameterBindings({
            ownerMethodSignature: target.method.methodSignature,
            ownerMethodName: target.method.methodName,
            declaringClassName: target.method.declaringClassName,
            declaringClassIncludes: target.method.declaringClassIncludes,
            paramIndex: target.paramIndex,
        })) {
            for (const nodeId of binding.localNodeIds()) {
                out.add(nodeId);
            }
            for (const nodeId of binding.localObjectNodeIds()) {
                out.add(nodeId);
            }
            for (const nodeId of binding.localCarrierNodeIds()) {
                out.add(nodeId);
            }
        }
        return [...out.values()];
    }
    const filter = {
        fieldName: target.fieldName,
        baseThisOnly: true,
        ownerMethodSignature: target.method.methodSignature,
        ownerMethodName: target.method.methodName,
        declaringClassName: target.method.declaringClassName,
        declaringClassIncludes: target.method.declaringClassIncludes,
    };
    const out = new Set<number>();
    for (const load of ctx.scan.fieldLoads(filter)) {
        for (const nodeId of load.resultNodeIds()) {
            out.add(nodeId);
        }
        for (const nodeId of load.resultCarrierNodeIds()) {
            out.add(nodeId);
        }
        for (const nodeId of load.resultObjectNodeIds()) {
            out.add(nodeId);
        }
    }
    return [...out.values()];
}

function emitToNodeTarget(
    event: ModuleInvokeEvent,
    target: ModuleInvokeEmitNodeTarget,
    boundary: ModuleBoundaryKind,
    reason: string,
    allowUnreachableTarget: boolean,
): any[] | undefined {
    const nodeIds = resolveInvokeNodeIds(
        {
            ownerMethodSignature: event.raw.callSignature,
            ownerDeclaringClassName: event.call.declaringClassName,
            stmt: event.raw.stmt,
            invokeExpr: event.raw.invokeExpr,
            call: event.call,
            arg: index => event.values.arg(index),
            args: () => event.values.args(),
            base: () => event.values.base(),
            result: () => event.values.result(),
            argNodeIds: index => event.raw.args[index] !== undefined ? event.analysis.nodeIdsForValue(event.raw.args[index], event.raw.stmt) : [],
            argObjectNodeIds: index => event.raw.args[index] !== undefined ? event.analysis.objectNodeIdsForValue(event.raw.args[index]) : [],
            argCarrierNodeIds: index => event.raw.args[index] !== undefined ? event.analysis.carrierNodeIdsForValue(event.raw.args[index], event.raw.stmt) : [],
            baseNodeIds: () => event.raw.baseValue !== undefined ? event.analysis.nodeIdsForValue(event.raw.baseValue, event.raw.stmt) : [],
            baseObjectNodeIds: () => event.raw.baseValue !== undefined ? event.analysis.objectNodeIdsForValue(event.raw.baseValue) : [],
            baseCarrierNodeIds: () => event.raw.baseValue !== undefined ? event.analysis.carrierNodeIdsForValue(event.raw.baseValue, event.raw.stmt) : [],
            resultNodeIds: () => event.raw.resultValue !== undefined ? event.analysis.nodeIdsForValue(event.raw.resultValue, event.raw.stmt) : [],
            resultCarrierNodeIds: () => event.raw.resultValue !== undefined ? event.analysis.carrierNodeIdsForValue(event.raw.resultValue, event.raw.stmt) : [],
            callbackParamNodeIds: (callbackArgIndex: number, paramIndex: number, options?: { maxCandidates?: number }) =>
                event.callbacks.paramNodeIds(event.values.arg(callbackArgIndex), paramIndex, options),
        } as ModuleScannedInvoke,
        target.slot,
    );
    if (nodeIds.length === 0) return undefined;
    const options = { allowUnreachableTarget };
    const explicitFieldPath = resolveExplicitFieldPath(event, target.fieldPath);
    if (boundary === "clone_copy") {
        switch (target.mode || "generic") {
            case "current_field_tail":
                return event.emit.loadLikeCurrentFieldTailToNodes(nodeIds, reason, options);
            case "explicit_field":
                return event.emit.loadLikeToNodes(nodeIds, reason, explicitFieldPath || [], options);
            case "load_like":
                return event.emit.loadLikeToNodes(nodeIds, reason, explicitFieldPath, options);
            case "load_like_current_tail":
                return event.emit.loadLikeCurrentFieldTailToNodes(nodeIds, reason, options);
            case "generic":
            case "preserve_current":
            default:
                return event.emit.loadLikeToNodes(nodeIds, reason, event.current.cloneField(), options);
        }
    }
    if (boundary === "stringify_result") {
        const collector = event.emit.collector();
        collector.push(event.emit.toNodes(nodeIds, reason, options));
        switch (target.mode || "generic") {
            case "current_field_tail":
                collector.push(event.emit.toCurrentFieldTailNodes(nodeIds, reason, options));
                break;
            case "explicit_field":
                collector.push(event.emit.toFields(nodeIds, explicitFieldPath || [], reason, options));
                break;
            case "load_like":
                collector.push(event.emit.loadLikeToNodes(nodeIds, reason, explicitFieldPath, options));
                break;
            case "load_like_current_tail":
                collector.push(event.emit.loadLikeCurrentFieldTailToNodes(nodeIds, reason, options));
                break;
            case "generic":
            case "preserve_current":
            default:
                collector.push(event.emit.preserveToNodes(nodeIds, reason, options));
                break;
        }
        return collector.done();
    }
    switch (target.mode || "generic") {
        case "preserve_current":
            return event.emit.preserveToNodes(nodeIds, reason, options);
        case "current_field_tail":
            return event.emit.toCurrentFieldTailNodes(nodeIds, reason, options);
        case "explicit_field":
            return event.emit.toFields(nodeIds, explicitFieldPath || [], reason, options);
        case "load_like":
            return event.emit.loadLikeToNodes(nodeIds, reason, explicitFieldPath, options);
        case "load_like_current_tail":
            return event.emit.loadLikeCurrentFieldTailToNodes(nodeIds, reason, options);
        case "generic":
        default:
            return event.emit.toNodes(nodeIds, reason, options);
    }
}

function emitToCallbackTarget(
    event: ModuleInvokeEvent,
    target: ModuleInvokeEmitCallbackTarget,
    boundary: ModuleBoundaryKind,
    reason: string,
    allowUnreachableTarget: boolean,
): any[] | undefined {
    const callbackValue = event.values.arg(target.callbackArgIndex);
    if (!callbackValue) return undefined;
    const options = { allowUnreachableTarget };
    const explicitFieldPath = resolveExplicitFieldPath(event, target.fieldPath);
    if (boundary === "clone_copy") {
        switch (target.mode || "generic") {
            case "current_field_tail":
                return event.callbacks.loadLikeCurrentFieldTailToParam(callbackValue, target.paramIndex, reason, options);
            case "explicit_field":
                return event.callbacks.loadLikeToParam(callbackValue, target.paramIndex, reason, explicitFieldPath || [], options);
            case "load_like":
                return event.callbacks.loadLikeToParam(callbackValue, target.paramIndex, reason, explicitFieldPath, options);
            case "load_like_current_tail":
                return event.callbacks.loadLikeCurrentFieldTailToParam(callbackValue, target.paramIndex, reason, options);
            case "generic":
            case "preserve_current":
            default:
                return event.callbacks.loadLikeToParam(callbackValue, target.paramIndex, reason, event.current.cloneField(), options);
        }
    }
    if (boundary === "stringify_result") {
        const collector = event.emit.collector();
        collector.push(event.callbacks.toParam(callbackValue, target.paramIndex, reason, options));
        switch (target.mode || "generic") {
            case "current_field_tail":
                collector.push(event.callbacks.toCurrentFieldTailParam(callbackValue, target.paramIndex, reason, options));
                break;
            case "explicit_field":
                collector.push(event.callbacks.toFieldParam(callbackValue, target.paramIndex, explicitFieldPath || [], reason, options));
                break;
            case "load_like": {
                const targetNodeIds = event.callbacks.paramNodeIds(callbackValue, target.paramIndex, { maxCandidates: target.maxCandidates });
                collector.push(event.emit.loadLikeToNodes(targetNodeIds, reason, explicitFieldPath, options));
                break;
            }
            case "load_like_current_tail": {
                const targetNodeIds = event.callbacks.paramNodeIds(callbackValue, target.paramIndex, { maxCandidates: target.maxCandidates });
                collector.push(event.emit.loadLikeCurrentFieldTailToNodes(targetNodeIds, reason, options));
                break;
            }
            case "generic":
            case "preserve_current":
            default:
                collector.push(event.callbacks.preserveToParam(callbackValue, target.paramIndex, reason, options));
                break;
        }
        return collector.done();
    }
    switch (target.mode || "generic") {
        case "preserve_current":
            return event.callbacks.preserveToParam(callbackValue, target.paramIndex, reason, options);
        case "current_field_tail":
            return event.callbacks.toCurrentFieldTailParam(callbackValue, target.paramIndex, reason, options);
        case "explicit_field":
            return event.callbacks.toFieldParam(callbackValue, target.paramIndex, explicitFieldPath || [], reason, options);
        case "load_like": {
            const targetNodeIds = event.callbacks.paramNodeIds(callbackValue, target.paramIndex, { maxCandidates: target.maxCandidates });
            return event.emit.loadLikeToNodes(targetNodeIds, reason, explicitFieldPath, options);
        }
        case "load_like_current_tail": {
            const targetNodeIds = event.callbacks.paramNodeIds(callbackValue, target.paramIndex, { maxCandidates: target.maxCandidates });
            return event.emit.loadLikeCurrentFieldTailToNodes(targetNodeIds, reason, options);
        }
        case "generic":
        default:
            return event.callbacks.toParam(callbackValue, target.paramIndex, reason, options);
    }
}

function emitToValueFieldTarget(
    event: ModuleInvokeEvent,
    target: ModuleInvokeEmitValueFieldTarget,
    boundary: ModuleBoundaryKind,
    reason: string,
    allowUnreachableTarget: boolean,
): any[] | undefined {
    const value = resolveInvokeValueFromEvent(event, target.value);
    if (value === undefined || value === null) return undefined;
    const targetFieldPath = buildProjectedTargetFieldPath(event, target.fieldPath, target.mode || "preserve");
    const options = {
        allowUnreachableTarget,
    };
    if (boundary === "clone_copy") {
        const targetNodeIds = event.analysis.carrierNodeIdsForValue(value, event.raw.stmt);
        if (targetNodeIds.length === 0) return undefined;
        return event.emit.loadLikeToNodes(targetNodeIds, reason, targetFieldPath, options);
    }
    return event.emit.toValueField(value, targetFieldPath, reason, options);
}

function emitInvokeTarget(
    event: ModuleInvokeEvent,
    target: ModuleInvokeEmitTarget,
    boundary: ModuleBoundaryKind,
    reason: string,
    allowUnreachableTarget: boolean,
): any[] | undefined {
    switch (target.kind) {
        case "node_slot":
            return emitToNodeTarget(event, target, boundary, reason, allowUnreachableTarget);
        case "callback_param":
            return emitToCallbackTarget(event, target, boundary, reason, allowUnreachableTarget);
        case "value_field":
            return emitToValueFieldTarget(event, target, boundary, reason, allowUnreachableTarget);
    }
}

function emitToCarrierFieldTargets(
    event: ModuleFactEvent,
    targetNodeIds: Iterable<number>,
    targetFieldPath: string[],
    emitSpec: NormalizedBridgeEmitSpec,
): ModuleEmission[] | undefined {
    const nodeIds = [...new Set<number>(targetNodeIds)];
    if (nodeIds.length === 0) return undefined;
    const projectedFieldPath = buildProjectedTargetFieldPath(event, targetFieldPath, emitSpec.mode);
    const options = {
        allowUnreachableTarget: emitSpec.allowUnreachableTarget,
    };
    if (emitSpec.boundary === "clone_copy") {
        return event.emit.loadLikeToNodes(nodeIds, emitSpec.reason, projectedFieldPath, options);
    }
    return event.emit.toFields(nodeIds, projectedFieldPath, emitSpec.reason, options);
}

function resolveMethodBySignature(scene: any, signature: string): any | undefined {
    return getMethodBySignature(scene, signature)
        || scene?.getMethods?.().find((method: any) => method.getSignature?.()?.toString?.() === signature);
}

function resolveMethodBySelector(scene: any, selector: ModuleMethodSelector): any | undefined {
    if (selector.methodSignature) {
        return resolveMethodBySignature(scene, selector.methodSignature);
    }
    const matches = (scene?.getMethods?.() || [])
        .filter((method: any) => matchesMethodSelector(selector, resolveMethodMeta(method)));
    if (matches.length === 1) {
        return matches[0];
    }
    return undefined;
}

function resolveAnchorStmt(ctx: any, spec: DeclarativeBindingModuleSpec, sourceMethod: any): any | undefined {
    const anchorMethod = spec.anchor?.anchorMethodSignature
        ? resolveMethodBySignature(ctx.raw.scene, spec.anchor.anchorMethodSignature)
        : sourceMethod;
    const cfg = anchorMethod?.getCfg?.();
    const stmts = cfg?.getStmts?.() || [];
    if (stmts.length === 0) {
        return undefined;
    }
    if (spec.anchor?.anchorInvoke) {
        for (const stmt of stmts) {
            if (!stmt?.containsInvokeExpr?.()) continue;
            const invokeExpr = stmt.getInvokeExpr?.();
            const signature = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
            const methodName = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
            const declaringClassName = invokeExpr?.getMethodSignature?.()?.getDeclaringClassSignature?.()?.getClassName?.() || "";
            const argCount = invokeExpr?.getArgs?.()?.length || 0;
            const isInstanceInvoke = typeof invokeExpr?.getBase === "function";
            if (matchesInvokeSurface(spec.anchor.anchorInvoke, {
                signature,
                methodName,
                declaringClassName,
                argCount,
                isInstanceInvoke,
            })) {
                return stmt;
            }
        }
    }
    if (spec.anchor?.stmtIndex !== undefined) {
        return stmts[spec.anchor.stmtIndex];
    }
    return stmts[0];
}

interface ResolvedDecoratedFieldFacts {
    byAddress: Map<string, {
        writeNodeIds: Set<number>;
        loadNodeIds: Set<number>;
        endpoints: Map<string, { objectNodeId: number; fieldName: string }>;
    }>;
}

function ensureDecoratedFieldAddressBucket(
    buckets: ResolvedDecoratedFieldFacts["byAddress"],
    key: string,
): {
    writeNodeIds: Set<number>;
    loadNodeIds: Set<number>;
    endpoints: Map<string, { objectNodeId: number; fieldName: string }>;
} {
    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = {
            writeNodeIds: new Set<number>(),
            loadNodeIds: new Set<number>(),
            endpoints: new Map<string, { objectNodeId: number; fieldName: string }>(),
        };
        buckets.set(key, bucket);
    }
    return bucket;
}

function resolveDecoratedFieldAddressKeys(
    field: {
        fieldName: string;
        decoratorKinds(): string[];
        decoratorParams(kind: string): string[];
    },
    address: LiteralAddressKeySpec | DecoratedFieldMetaAddressKeySpec,
): string[] {
    if (address.kind === "literal") {
        return address.value ? [address.value] : [];
    }

    if (address.source === "field_name") {
        return field.fieldName ? [field.fieldName] : [];
    }

    const decoratorKinds = address.decoratorKind
        ? [address.decoratorKind]
        : field.decoratorKinds();
    const params = [...new Set(
        decoratorKinds
            .flatMap(kind => field.decoratorParams(kind))
            .map(item => String(item || "").trim())
            .filter(Boolean),
    )];
    if (params.length > 0) {
        return params;
    }
    if (address.source === "decorator_param_or_field_name" && field.fieldName) {
        return [field.fieldName];
    }
    return [];
}

function resolveDecoratedFieldFacts(
    ctx: any,
    selector: ModuleDecoratedFieldSurfaceSelector,
    address: LiteralAddressKeySpec | DecoratedFieldMetaAddressKeySpec,
): ResolvedDecoratedFieldFacts {
    const byAddress = new Map<string, {
        writeNodeIds: Set<number>;
        loadNodeIds: Set<number>;
        endpoints: Map<string, { objectNodeId: number; fieldName: string }>;
    }>();

    for (const field of ctx.scan.decoratedFields({ ...selector })) {
        const keys = resolveDecoratedFieldAddressKeys(field, address);
        if (keys.length === 0) {
            continue;
        }

        for (const method of ctx.methods.byClassName(field.className)) {
            const thisLocal = resolveMethodThisLocal(method);
            if (!thisLocal) continue;
            for (const objectNodeId of ctx.analysis.objectNodeIdsForValue(thisLocal)) {
                for (const key of keys) {
                    ensureDecoratedFieldAddressBucket(byAddress, key).endpoints.set(
                        `${objectNodeId}#${field.fieldName}`,
                        {
                            objectNodeId,
                            fieldName: field.fieldName,
                        },
                    );
                }
            }
        }

        for (const load of ctx.scan.fieldLoads({ fieldSignature: field.fieldSignature })) {
            for (const objectNodeId of load.baseObjectNodeIds()) {
                for (const key of keys) {
                    ensureDecoratedFieldAddressBucket(byAddress, key).endpoints.set(
                        `${objectNodeId}#${field.fieldName}`,
                        {
                            objectNodeId,
                            fieldName: field.fieldName,
                        },
                    );
                }
            }
            for (const nodeId of load.resultNodeIds()) {
                for (const key of keys) {
                    ensureDecoratedFieldAddressBucket(byAddress, key).loadNodeIds.add(nodeId);
                }
            }
            for (const nodeId of load.resultCarrierNodeIds()) {
                for (const key of keys) {
                    ensureDecoratedFieldAddressBucket(byAddress, key).loadNodeIds.add(nodeId);
                }
            }
            for (const nodeId of load.resultObjectNodeIds()) {
                for (const key of keys) {
                    ensureDecoratedFieldAddressBucket(byAddress, key).loadNodeIds.add(nodeId);
                }
            }
        }

        for (const store of ctx.scan.fieldStores({ fieldSignature: field.fieldSignature })) {
            for (const objectNodeId of store.baseObjectNodeIds()) {
                for (const key of keys) {
                    ensureDecoratedFieldAddressBucket(byAddress, key).endpoints.set(
                        `${objectNodeId}#${field.fieldName}`,
                        {
                            objectNodeId,
                            fieldName: field.fieldName,
                        },
                    );
                }
            }
            for (const nodeId of store.valueNodeIds()) {
                for (const key of keys) {
                    ensureDecoratedFieldAddressBucket(byAddress, key).writeNodeIds.add(nodeId);
                }
            }
            for (const nodeId of store.valueCarrierNodeIds()) {
                for (const key of keys) {
                    ensureDecoratedFieldAddressBucket(byAddress, key).writeNodeIds.add(nodeId);
                }
            }
            for (const nodeId of store.valueObjectNodeIds()) {
                for (const key of keys) {
                    ensureDecoratedFieldAddressBucket(byAddress, key).writeNodeIds.add(nodeId);
                }
            }
        }
    }

    return {
        byAddress,
    };
}

function emitSemanticAddressedTargetNodes(
    event: ModuleFactEvent,
    targetNodeIds: Iterable<number>,
    targetFieldPath: ModuleFieldPathSpec | undefined,
    emitSpec: NormalizedBridgeEmitSpec,
): ModuleEmission[] | undefined {
    const nodeIds = [...new Set<number>(targetNodeIds)];
    if (nodeIds.length === 0) return undefined;
    const options = {
        allowUnreachableTarget: emitSpec.allowUnreachableTarget,
    };
    if (hasFieldPathSpec(targetFieldPath)) {
        const projectedFieldPath = buildProjectedTargetFieldPath(event, targetFieldPath, emitSpec.mode);
        if (projectedFieldPath.length === 0) {
            if (emitSpec.boundary === "clone_copy") {
                return event.emit.loadLikeToNodes(nodeIds, emitSpec.reason, [], options);
            }
            return event.emit.toNodes(nodeIds, emitSpec.reason, options);
        }
        if (emitSpec.boundary === "clone_copy") {
            return event.emit.loadLikeToNodes(nodeIds, emitSpec.reason, projectedFieldPath, options);
        }
        return event.emit.toFields(nodeIds, projectedFieldPath, emitSpec.reason, options);
    }
    if (emitSpec.boundary === "clone_copy") {
        switch (emitSpec.mode) {
            case "plain":
                return event.emit.toNodes(nodeIds, emitSpec.reason, options);
            case "current_field_tail":
                return event.emit.loadLikeCurrentFieldTailToNodes(nodeIds, emitSpec.reason, options);
            case "preserve":
            default:
                return event.emit.loadLikeToNodes(nodeIds, emitSpec.reason, event.current.cloneField(), options);
        }
    }
    if (emitSpec.boundary === "stringify_result") {
        const collector = event.emit.collector();
        collector.push(event.emit.toNodes(nodeIds, emitSpec.reason, options));
        pushStructuredBridgeEmission(collector, event, nodeIds, emitSpec);
        return collector.done();
    }
    switch (emitSpec.mode) {
        case "plain":
            return event.emit.toNodes(nodeIds, emitSpec.reason, options);
        case "current_field_tail":
            return event.emit.toCurrentFieldTailNodes(nodeIds, emitSpec.reason, options);
        case "preserve":
        default:
            return event.emit.preserveToNodes(nodeIds, emitSpec.reason, options);
    }
}

function buildDecoratedTargetFieldPath(
    event: ModuleFactEvent,
    fieldName: string,
    mode: ModuleTransferMode,
    boundary: ModuleBoundaryKind,
): string[] {
    if (boundary === "stringify_result" || boundary === "clone_copy") {
        return [fieldName];
    }
    switch (mode) {
        case "plain":
            return [fieldName];
        case "current_field_tail": {
            const tail = event.current.fieldTail();
            return tail && tail.length > 0
                ? [fieldName, ...tail]
                : [fieldName];
        }
        case "preserve":
        default: {
            const fieldPath = event.current.cloneField();
            return fieldPath && fieldPath.length > 0
                ? [fieldName, ...fieldPath]
                : [fieldName];
        }
    }
}

function buildProjectedTargetFieldPath(
    event: ModuleFactEvent,
    targetFieldPath: ModuleFieldPathSpec,
    mode: ModuleTransferMode,
): string[] {
    if (!Array.isArray(targetFieldPath)) {
        return resolveTemplateFieldPath(event, targetFieldPath);
    }
    switch (mode) {
        case "plain":
            return [...targetFieldPath];
        case "current_field_tail": {
            const tail = event.current.fieldTail();
            return tail && tail.length > 0
                ? [...targetFieldPath, ...tail]
                : [...targetFieldPath];
        }
        case "preserve":
        default: {
            const fieldPath = event.current.cloneField();
            return fieldPath && fieldPath.length > 0
                ? [...targetFieldPath, ...fieldPath]
                : [...targetFieldPath];
        }
    }
}

function emitSemanticAddressedTargetEndpoints(
    event: ModuleFactEvent,
    endpoints: Iterable<{ objectNodeId: number; fieldName: string }>,
    emitSpec: NormalizedBridgeEmitSpec,
): ModuleEmission[] | undefined {
    const out: ModuleEmission[] = [];
    const options = {
        allowUnreachableTarget: emitSpec.allowUnreachableTarget,
    };
    for (const endpoint of endpoints) {
        const isSelfEcho = event.current.nodeId === endpoint.objectNodeId
            && event.current.fieldHead() === endpoint.fieldName;
        if (isSelfEcho) continue;
        out.push(...event.emit.toField(
            endpoint.objectNodeId,
            buildDecoratedTargetFieldPath(event, endpoint.fieldName, emitSpec.mode, emitSpec.boundary),
            emitSpec.reason,
            options,
        ));
    }
    return out.length > 0 ? out : undefined;
}

function compileKeyedBridgeModule(spec: KeyedBridgeModuleSpec): TaintModule {
    const emitSpec = normalizeEmitSpec(spec.emit);
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup(ctx) {
            const relay = ctx.bridge.keyedNodeRelay();

            for (const call of ctx.scan.invokes({ ...spec.target.surface })) {
                const keys = resolveStringCandidates(ctx.analysis, call, spec.target.key);
                if (keys.length === 0) continue;
                const targetNodeIds = resolveInvokeNodeIds(call, spec.target.value);
                if (targetNodeIds.length === 0) continue;
                for (const key of keys) {
                    relay.addTargets(key, targetNodeIds);
                }
                if (spec.targetDeferredBinding?.kind === "imperative") {
                    ctx.deferred.imperativeFromInvoke(
                        call,
                        spec.targetDeferredBinding.callbackArgIndex,
                        toDeferredBindingOptions(spec.targetDeferredBinding),
                    );
                }
            }

            for (const call of ctx.scan.invokes({ ...spec.source.surface })) {
                const keys = resolveStringCandidates(ctx.analysis, call, spec.source.key);
                if (keys.length === 0) continue;
                const sourceNodeIds = resolveInvokeNodeIds(call, spec.source.value);
                if (sourceNodeIds.length === 0) continue;
                for (const key of keys) {
                    relay.addSources(key, sourceNodeIds);
                }
            }

            relay.materialize();
            return {
                onFact(event) {
                    return emitViaRelay(relay, event, emitSpec);
                },
            };
        },
    });
}

function compileCarrierBridgeModule(spec: CarrierBridgeModuleSpec): TaintModule {
    const emitSpec = normalizeEmitSpec(spec.emit);
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup(ctx) {
            const relay = ctx.bridge.nodeRelay();
            const targetEntries: Array<{ carrierNodeIds: Set<number>; valueNodeIds: number[] }> = [];
            const allTargetValueNodeIds = new Set<number>();

            for (const call of ctx.scan.invokes({ ...spec.target.surface })) {
                const carrierNodeIds = new Set<number>(resolveInvokeCarrierNodeIds(call, spec.target.carrier));
                const valueNodeIds = resolveInvokeNodeIds(call, spec.target.value);
                if (carrierNodeIds.size === 0 || valueNodeIds.length === 0) continue;
                targetEntries.push({ carrierNodeIds, valueNodeIds });
                for (const nodeId of valueNodeIds) {
                    allTargetValueNodeIds.add(nodeId);
                }
                if (spec.targetDeferredBinding?.kind === "imperative") {
                    ctx.deferred.imperativeFromInvoke(
                        call,
                        spec.targetDeferredBinding.callbackArgIndex,
                        toDeferredBindingOptions(spec.targetDeferredBinding),
                    );
                }
            }

            for (const call of ctx.scan.invokes({ ...spec.source.surface })) {
                const sourceCarrierNodeIds = resolveInvokeCarrierNodeIds(call, spec.source.carrier);
                const sourceValueNodeIds = resolveInvokeNodeIds(call, spec.source.value);
                if (sourceCarrierNodeIds.length === 0 || sourceValueNodeIds.length === 0) continue;

                const matchedTargets = new Set<number>();
                for (const target of targetEntries) {
                    if (!hasIntersection(sourceCarrierNodeIds, target.carrierNodeIds)) continue;
                    for (const nodeId of target.valueNodeIds) {
                        matchedTargets.add(nodeId);
                    }
                }

                if (matchedTargets.size === 0) continue;
                relay.connectMany(sourceValueNodeIds, matchedTargets);
            }

            return {
                onFact(event) {
                    return emitViaRelay(relay, event, emitSpec);
                },
            };
        },
    });
}

function compileScopedAddressedBridgeModule(spec: ScopedAddressedBridgeModuleSpec): TaintModule {
    const emitSpec = normalizeEmitSpec(spec.emit);
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup(ctx) {
            const relay = ctx.bridge.keyedNodeRelay();

            for (const call of ctx.scan.invokes({ ...spec.targetSurface })) {
                const targetNodeIds = resolveInvokeNodeIds(call, spec.targetValue);
                if (targetNodeIds.length === 0) continue;
                const scopeNodeIds = resolveInvokeCarrierNodeIds(call, spec.targetScope);
                if (scopeNodeIds.length === 0) continue;
                const keys = resolveStringCandidates(ctx.analysis, call, spec.targetAddress);
                if (keys.length === 0) continue;
                for (const scopeNodeId of scopeNodeIds) {
                    for (const key of keys) {
                        relay.addTargets(`${scopeNodeId}::${key}`, targetNodeIds);
                    }
                }
                if (spec.targetDeferredBinding?.kind === "imperative") {
                    ctx.deferred.imperativeFromInvoke(
                        call,
                        spec.targetDeferredBinding.callbackArgIndex,
                        toDeferredBindingOptions(spec.targetDeferredBinding),
                    );
                }
            }

            for (const call of ctx.scan.invokes({ ...spec.sourceSurface })) {
                const sourceNodeIds = resolveInvokeNodeIds(call, spec.sourceValue);
                if (sourceNodeIds.length === 0) continue;
                const scopeNodeIds = resolveInvokeCarrierNodeIds(call, spec.sourceScope);
                if (scopeNodeIds.length === 0) continue;
                const keys = resolveStringCandidates(ctx.analysis, call, spec.sourceAddress);
                if (keys.length === 0) continue;
                for (const scopeNodeId of scopeNodeIds) {
                    for (const key of keys) {
                        relay.addSources(`${scopeNodeId}::${key}`, sourceNodeIds);
                    }
                }
            }

            relay.materialize();
            return {
                onFact(event) {
                    return emitViaRelay(relay, event, emitSpec);
                },
            };
        },
    });
}

function compileSemanticAddressedBridgeModule(spec: SemanticAddressedBridgeModuleSpec): TaintModule {
    const emitSpec = normalizeEmitSpec(spec.emit);
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup(ctx) {
            const sourceNodeIdsByKey = new Map<string, Set<number>>();
            const sourceProjectedNodeIdsByKey = new Map<string, Map<number, string[][]>>();
            const sourceFieldKeysByKey = new Map<string, Set<string>>();
            const targetNodeIdsByKey = new Map<string, Set<number>>();
            const targetEndpointsByKey = new Map<string, Map<string, { objectNodeId: number; fieldName: string }>>();
            const emittedFactStates = new Set<string>();

            if (spec.target.kind === "invoke") {
                for (const call of ctx.scan.invokes({ ...spec.target.surface })) {
                    const keys = resolveAddressKeys(ctx.analysis, call, spec.targetAddress);
                    if (keys.length === 0) continue;
                    const targetNodeIds = resolveInvokeNodeIds(call, spec.target.value);
                    if (targetNodeIds.length === 0) continue;
                    for (const key of keys) {
                        for (const nodeId of targetNodeIds) {
                            addMapSetValue(targetNodeIdsByKey, key, nodeId);
                        }
                    }
                    if (spec.target.deferredBinding?.kind === "imperative") {
                        ctx.deferred.imperativeFromInvoke(
                            call,
                            spec.target.deferredBinding.callbackArgIndex,
                            toDeferredBindingOptions(spec.target.deferredBinding),
                        );
                    }
                }
            } else {
                invariant(
                    spec.targetAddress.kind === "literal" || spec.targetAddress.kind === "decorated_field_meta",
                    `semantic addressed bridge target decorated field requires literal or decorated_field_meta address`,
                );
                const resolvedTarget = resolveDecoratedFieldFacts(ctx, spec.target.surface, spec.targetAddress);
                for (const [key, bucket] of resolvedTarget.byAddress.entries()) {
                    for (const nodeId of bucket.loadNodeIds) {
                        addMapSetValue(targetNodeIdsByKey, key, nodeId);
                    }
                    for (const endpoint of bucket.endpoints.values()) {
                        addMapEndpointValue(targetEndpointsByKey, key, endpoint);
                    }
                }
            }

            if (spec.source.kind === "invoke") {
                for (const call of ctx.scan.invokes({ ...spec.source.surface })) {
                    const keys = resolveAddressKeys(ctx.analysis, call, spec.sourceAddress);
                    if (keys.length === 0) continue;
                    const sourceFieldPath = Array.isArray(spec.source.fieldPath) && spec.source.fieldPath.length > 0
                        ? spec.source.fieldPath
                        : undefined;
                    const sourceNodeIds = sourceFieldPath
                        ? resolveBridgeSourceNodeIds(
                            call,
                            spec.source.value as Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>,
                        )
                        : resolveInvokeNodeIds(call, spec.source.value);
                    if (sourceNodeIds.length === 0) continue;
                    for (const key of keys) {
                        if (sourceFieldPath) {
                            for (const nodeId of sourceNodeIds) {
                                addMapFieldPathValue(sourceProjectedNodeIdsByKey, key, nodeId, sourceFieldPath);
                            }
                        } else {
                            for (const nodeId of sourceNodeIds) {
                                addMapSetValue(sourceNodeIdsByKey, key, nodeId);
                            }
                        }
                    }
                }
            } else {
                invariant(
                    spec.sourceAddress.kind === "literal" || spec.sourceAddress.kind === "decorated_field_meta",
                    `semantic addressed bridge source decorated field requires literal or decorated_field_meta address`,
                );
                const resolvedSource = resolveDecoratedFieldFacts(ctx, spec.source.surface, spec.sourceAddress);
                for (const [key, bucket] of resolvedSource.byAddress.entries()) {
                    for (const nodeId of bucket.writeNodeIds) {
                        addMapSetValue(sourceNodeIdsByKey, key, nodeId);
                    }
                    for (const endpointKey of bucket.endpoints.keys()) {
                        addMapSetText(sourceFieldKeysByKey, key, endpointKey);
                    }
                }
            }

            return {
                onFact(event) {
                    const matchedKeys = new Set<string>();
                    for (const [key, sourceNodeIds] of sourceNodeIdsByKey.entries()) {
                        if (sourceNodeIds.has(event.current.nodeId)) {
                            matchedKeys.add(key);
                        }
                    }
                    const currentFieldPath = event.current.cloneField();
                    for (const [key, nodeMap] of sourceProjectedNodeIdsByKey.entries()) {
                        const prefixes = nodeMap.get(event.current.nodeId);
                        if (!prefixes || prefixes.length === 0) continue;
                        if (prefixes.some(prefix => startsWithFieldPath(currentFieldPath, prefix))) {
                            matchedKeys.add(key);
                        }
                    }
                    const fieldHead = event.current.fieldHead();
                    if (fieldHead) {
                        const endpointKey = `${event.current.nodeId}#${fieldHead}`;
                        for (const [key, sourceFieldKeys] of sourceFieldKeysByKey.entries()) {
                            if (sourceFieldKeys.has(endpointKey)) {
                                matchedKeys.add(key);
                            }
                        }
                    }
                    if (matchedKeys.size === 0) {
                        return;
                    }

                    const emissions = event.emit.collector();
                    for (const key of matchedKeys) {
                        const factStateKey = [
                            key,
                            String(event.current.nodeId),
                            String(event.current.source),
                            String(event.current.contextId),
                            currentFieldPath ? currentFieldPath.join(".") : "",
                        ].join("|");
                        if (emittedFactStates.has(factStateKey)) {
                            continue;
                        }
                        emittedFactStates.add(factStateKey);
                        emissions.push(emitSemanticAddressedTargetNodes(
                            event,
                            targetNodeIdsByKey.get(key) || [],
                            spec.target.kind === "invoke" ? spec.target.fieldPath : undefined,
                            emitSpec,
                        ));
                        emissions.push(emitSemanticAddressedTargetEndpoints(
                            event,
                            targetEndpointsByKey.get(key)?.values() || [],
                            emitSpec,
                        ));
                    }
                    return emissions.done();
                },
            };
        },
    });
}

function compileCrossMethodParamBridgeModule(spec: CrossMethodParamBridgeModuleSpec): TaintModule {
    const emitSpec = normalizeEmitSpec(spec.emit);
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup(ctx) {
            const relay = ctx.bridge.nodeRelay();
            const targetNodeIds = new Set<number>();
            for (const binding of ctx.scan.parameterBindings({
                ownerMethodSignature: spec.targetMethod.methodSignature,
                ownerMethodName: spec.targetMethod.methodName,
                declaringClassName: spec.targetMethod.declaringClassName,
                declaringClassIncludes: spec.targetMethod.declaringClassIncludes,
                paramIndex: spec.targetParamIndex,
            })) {
                for (const nodeId of binding.localNodeIds()) {
                    targetNodeIds.add(nodeId);
                }
                for (const nodeId of binding.localObjectNodeIds()) {
                    targetNodeIds.add(nodeId);
                }
                for (const nodeId of binding.localCarrierNodeIds()) {
                    targetNodeIds.add(nodeId);
                }
            }
            if (targetNodeIds.size === 0) {
                return;
            }
            for (const call of ctx.scan.invokes({ ...spec.sourceSurface })) {
                const sourceNodeIds = resolveInvokeNodeIds(call, spec.sourceValue);
                if (sourceNodeIds.length === 0) continue;
                relay.connectMany(sourceNodeIds, targetNodeIds);
            }
            return {
                onFact(event) {
                    return emitViaRelay(relay, event, emitSpec);
                },
            };
        },
    });
}

function compileDirectNodeBridgeModule(spec: DirectNodeBridgeModuleSpec): TaintModule {
    const emitSpec = normalizeEmitSpec(spec.emit);
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup(ctx) {
            const relay = ctx.bridge.nodeRelay();
            for (const call of ctx.scan.invokes({ ...spec.surface })) {
                const sourceNodeIds = resolveBridgeSourceNodeIds(call, spec.source);
                if (sourceNodeIds.length === 0) continue;
                const targetNodeIds = resolveInvokeNodeIds(call, spec.target);
                if (targetNodeIds.length === 0) continue;
                relay.connectMany(sourceNodeIds, targetNodeIds);
            }
            return {
                onFact(event) {
                    return emitViaRelay(relay, event, emitSpec);
                },
            };
        },
    });
}

function compileDirectCallbackBridgeModule(spec: DirectCallbackBridgeModuleSpec): TaintModule {
    const emitSpec = normalizeEmitSpec(spec.emit);
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup(ctx) {
            const relay = ctx.bridge.nodeRelay();
            for (const call of ctx.scan.invokes({ ...spec.surface })) {
                const sourceNodeIds = resolveBridgeSourceNodeIds(call, spec.source);
                if (sourceNodeIds.length === 0) continue;
                const targetNodeIds = resolveInvokeNodeIds(call, spec.target);
                if (targetNodeIds.length === 0) continue;
                relay.connectMany(sourceNodeIds, targetNodeIds);
                if (spec.deferredBinding?.kind === "imperative") {
                    ctx.deferred.imperativeFromInvoke(
                        call,
                        spec.deferredBinding.callbackArgIndex,
                        toDeferredBindingOptions(spec.deferredBinding),
                    );
                }
            }
            return {
                onFact(event) {
                    return emitViaRelay(relay, event, emitSpec);
                },
            };
        },
    });
}

function compileFieldBridgeModule(spec: FieldBridgeModuleSpec): TaintModule {
    const emitSpec = normalizeFieldBridgeEmitSpec(spec.emit);
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup(ctx) {
            invariant(
                (spec.targetWrites && spec.targetWrites.length > 0)
                    || (spec.targetLoads && spec.targetLoads.length > 0),
                `module spec ${spec.id} field_bridge requires at least one targetWrites/targetLoads entry`,
            );
            const relay = ctx.bridge.fieldRelay();
            const sourceCarrierNodeIds = resolveCarrierSetNodeIds(ctx, spec.source.carrier);
            invariant(
                sourceCarrierNodeIds.length > 0,
                `module spec ${spec.id} field_bridge resolved zero source carrier nodes`,
            );
            const sourceFieldPath = spec.source.fieldPath && spec.source.fieldPath.length > 0
                ? [...spec.source.fieldPath]
                : [spec.source.fieldName];

            for (const target of spec.targetWrites || []) {
                invariant(
                    Array.isArray(target.fieldPath),
                    `module spec ${spec.id} field_bridge target fieldPath must be an array`,
                );
                const targetCarrierNodeIds = resolveCarrierSetNodeIds(ctx, target.carrier);
                if (targetCarrierNodeIds.length === 0) continue;
                relay.connectFieldPaths(
                    sourceCarrierNodeIds,
                    sourceFieldPath,
                    targetCarrierNodeIds,
                    target.fieldPath,
                );
            }

            for (const target of spec.targetLoads || []) {
                const targetLoadNodeIds = resolveFieldLoadTargetNodeIds(ctx, target);
                if (targetLoadNodeIds.length === 0) continue;
                relay.connectLoadFieldTails(
                    sourceCarrierNodeIds,
                    sourceFieldPath,
                    targetLoadNodeIds,
                );
            }

            return {
                onFact(event) {
                    return relay.emit(
                        event,
                        emitSpec.fieldReason,
                        emitSpec.loadReason,
                        {
                            allowUnreachableTarget: emitSpec.allowUnreachableTarget,
                        },
                    );
                },
            };
        },
    });
}

function compileMethodFieldWriteModule(spec: MethodFieldWriteModuleSpec): TaintModule {
    const emitSpec = normalizeEmitSpec(spec.emit);
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup(ctx) {
            const sourceToTargetCarrier = new Map<number, Set<number>>();
            for (const method of ctx.methods.all()) {
                const meta = resolveMethodMeta(method);
                if (!matchesMethodSelector(spec.method, {
                    signature: meta.signature,
                    methodName: meta.methodName,
                    declaringClassName: meta.declaringClassName,
                })) {
                    continue;
                }
                const sourceNodeIds = resolveMethodPortNodeIdsForMethod(ctx, method, spec.source);
                const targetCarrierNodeIds = resolveMethodCarrierNodeIdsForMethod(ctx, method, spec.target);
                if (sourceNodeIds.length === 0 || targetCarrierNodeIds.length === 0) {
                    continue;
                }
                for (const sourceNodeId of sourceNodeIds) {
                    let bucket = sourceToTargetCarrier.get(sourceNodeId);
                    if (!bucket) {
                        bucket = new Set<number>();
                        sourceToTargetCarrier.set(sourceNodeId, bucket);
                    }
                    for (const targetNodeId of targetCarrierNodeIds) {
                        bucket.add(targetNodeId);
                    }
                }
            }

            if (sourceToTargetCarrier.size === 0) {
                return;
            }

            return {
                onFact(event) {
                    const targetCarrierNodeIds = sourceToTargetCarrier.get(event.current.nodeId);
                    if (!targetCarrierNodeIds || targetCarrierNodeIds.size === 0) {
                        return;
                    }
                    return emitToCarrierFieldTargets(event, targetCarrierNodeIds, spec.fieldPath, emitSpec);
                },
            };
        },
    });
}

function compilePairedNodeFieldWriteModule(spec: PairedNodeFieldWriteModuleSpec): TaintModule {
    const emitSpec = normalizeEmitSpec(spec.emit);
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup(ctx) {
            const sourceToTargetCarrier = new Map<number, Set<number>>();
            for (const call of ctx.scan.invokes({ ...spec.surface })) {
                const sourceNodeIds = resolveBridgeSourceNodeIds(call, spec.source);
                const targetCarrierNodeIds = resolveInvokeCarrierNodeIds(call, spec.targetCarrier);
                if (sourceNodeIds.length === 0 || targetCarrierNodeIds.length === 0) {
                    continue;
                }
                for (const sourceNodeId of sourceNodeIds) {
                    let bucket = sourceToTargetCarrier.get(sourceNodeId);
                    if (!bucket) {
                        bucket = new Set<number>();
                        sourceToTargetCarrier.set(sourceNodeId, bucket);
                    }
                    for (const targetNodeId of targetCarrierNodeIds) {
                        bucket.add(targetNodeId);
                    }
                }
            }

            if (sourceToTargetCarrier.size === 0) {
                return;
            }

            return {
                onFact(event) {
                    const targetCarrierNodeIds = sourceToTargetCarrier.get(event.current.nodeId);
                    if (!targetCarrierNodeIds || targetCarrierNodeIds.size === 0) {
                        return;
                    }
                    return emitToCarrierFieldTargets(event, targetCarrierNodeIds, spec.fieldPath, emitSpec);
                },
            };
        },
    });
}

function compileInvokeEmitModule(spec: InvokeEmitModuleSpec): TaintModule {
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup() {
            return {
                onInvoke(event) {
                    if (!matchesEventInvokeSurface(spec.surface, event)) return;
                    if (!matchesInvokeFactSlot(event, spec.when)) return;
                    return emitInvokeTarget(
                        event,
                        spec.target,
                        spec.boundary || "identity",
                        spec.reason,
                        spec.allowUnreachableTarget === true,
                    );
                },
            };
        },
    });
}

function compileDeclarativeBindingModule(spec: DeclarativeBindingModuleSpec): TaintModule {
    return defineModule({
        id: spec.id,
        description: spec.description,
        enabled: spec.enabled,
        setup(ctx) {
            const sourceMethod = resolveMethodBySelector(ctx.raw.scene, spec.sourceMethod);
            const handlerMethod = resolveMethodBySelector(ctx.raw.scene, spec.handlerMethod);
            invariant(sourceMethod?.getCfg?.(), `module spec ${spec.id} source method not found`);
            invariant(handlerMethod?.getCfg?.(), `module spec ${spec.id} handler method not found`);
            const anchorStmt = resolveAnchorStmt(ctx, spec, sourceMethod);
            invariant(anchorStmt, `module spec ${spec.id} anchor statement not found`);
            ctx.deferred.declarative({
                sourceMethod,
                handlerMethod,
                anchorStmt,
                triggerLabel: spec.triggerLabel,
                carrierKind: spec.carrierKind || "field",
                reason: spec.reason,
                semantics: spec.semantics
                    ? {
                        activation: spec.semantics.activation,
                        completion: spec.semantics.completion,
                        preserve: spec.semantics.preserve,
                        continuationRole: spec.semantics.continuationRole,
                    }
                    : undefined,
            });
        },
    });
}

interface ModuleSpecIndex {
    surfaces: Map<string, ModuleSurface>;
    ports: Map<string, ModulePort>;
    cells: Map<string, ModuleCell>;
    associations: Map<string, ModuleAssociation>;
    callbackTriggersByPort: Map<string, ModuleCallbackDispatchTrigger[]>;
    declarativeTriggers: ModuleDeclarativeDispatchTrigger[];
}

interface AddressedWriteCandidate {
    cell: ModuleKeyedStateCell | ModuleChannelCell;
    fromPort: ModuleInvokeArgPort | ModuleInvokeBasePort | ModuleInvokeResultPort | ModuleDecoratedFieldValuePort;
    address: AddressKeySpec;
    association?: Extract<ModuleAssociation, { kind: "same_carrier" }>;
    transfer: ModulePortToCellTransfer;
}

interface AddressedReadCandidate {
    cell: ModuleKeyedStateCell | ModuleChannelCell;
    toPort: ModulePort;
    address: AddressKeySpec;
    association?: Extract<ModuleAssociation, { kind: "same_carrier" }>;
    transfer: ModuleCellToPortTransfer;
}

interface FieldTargetGroup {
    sourceCellId: string;
    emit: NormalizedFieldBridgeEmitSpec;
    writes: Array<{
        targetCell: ModuleCarrierFieldCell;
        transfer: ModuleCellToCellTransfer;
    }>;
    loads: Array<{
        targetPort: ModulePort;
        transfer: ModuleCellToPortTransfer;
    }>;
}

function registerById<T extends { id: string }>(
    map: Map<string, T>,
    items: T[] | undefined,
    kindLabel: string,
    specId: string,
): void {
    for (const item of items || []) {
        invariant(!!item && typeof item.id === "string" && item.id.trim().length > 0, `${kindLabel} id must be a non-empty string in module spec ${specId}`);
        invariant(!map.has(item.id), `duplicate ${kindLabel} id '${item.id}' in module spec ${specId}`);
        map.set(item.id, item);
    }
}

function buildModuleSpecIndex(spec: ModuleSpec): ModuleSpecIndex {
    invariant(Array.isArray(spec.surfaces) && spec.surfaces.length > 0, `module spec ${spec.id} requires at least one surface`);
    const surfaces = new Map<string, ModuleSurface>();
    const ports = new Map<string, ModulePort>();
    const cells = new Map<string, ModuleCell>();
    const associations = new Map<string, ModuleAssociation>();
    registerById(surfaces, spec.surfaces, "surface", spec.id);
    registerById(ports, spec.ports || [], "port", spec.id);
    registerById(cells, spec.cells || [], "cell", spec.id);
    registerById(associations, spec.associations || [], "association", spec.id);

    const callbackTriggersByPort = new Map<string, ModuleCallbackDispatchTrigger[]>();
    const declarativeTriggers: ModuleDeclarativeDispatchTrigger[] = [];
    for (const trigger of spec.triggers || []) {
        invariant(!!trigger && typeof trigger.id === "string" && trigger.id.trim().length > 0, `trigger id must be a non-empty string in module spec ${spec.id}`);
        switch (trigger.kind) {
            case "callback_dispatch": {
                const list = callbackTriggersByPort.get(trigger.viaPort) || [];
                list.push(trigger);
                callbackTriggersByPort.set(trigger.viaPort, list);
                break;
            }
            case "declarative_dispatch":
                declarativeTriggers.push(trigger);
                break;
            default:
                invariant(false, `unsupported trigger kind ${(trigger as any)?.kind} in module spec ${spec.id}`);
        }
    }

    return {
        surfaces,
        ports,
        cells,
        associations,
        callbackTriggersByPort,
        declarativeTriggers,
    };
}

function isInvokeSurface(surface: ModuleSurface): surface is ModuleInvokeSurface {
    return surface.kind === "invoke_surface";
}

function isMethodSurface(surface: ModuleSurface): surface is ModuleMethodSurface {
    return surface.kind === "method_surface";
}

function isDecoratedFieldSurface(surface: ModuleSurface): surface is ModuleDecoratedFieldSurface {
    return surface.kind === "decorated_field_surface";
}

function isInvokeValuePort(
    port: ModulePort,
): port is ModuleInvokeArgPort | ModuleInvokeBasePort | ModuleInvokeResultPort {
    return port.kind === "invoke_arg" || port.kind === "invoke_base" || port.kind === "invoke_result";
}

function isDecoratedFieldValuePort(port: ModulePort): port is ModuleDecoratedFieldValuePort {
    return port.kind === "decorated_field_value";
}

function isCarrierFieldCell(cell: ModuleCell): cell is ModuleCarrierFieldCell {
    return cell.kind === "carrier_field_cell";
}

function isAddressedCell(cell: ModuleCell): cell is ModuleKeyedStateCell | ModuleChannelCell {
    return cell.kind === "keyed_state_cell" || cell.kind === "channel_cell";
}

function requireSurface(index: ModuleSpecIndex, spec: ModuleSpec, id: string): ModuleSurface {
    const surface = index.surfaces.get(id);
    invariant(surface, `module spec ${spec.id} references unknown surface '${id}'`);
    return surface;
}

function requirePort(index: ModuleSpecIndex, spec: ModuleSpec, id: string): ModulePort {
    const port = index.ports.get(id);
    invariant(port, `module spec ${spec.id} references unknown port '${id}'`);
    return port;
}

function requireCell(index: ModuleSpecIndex, spec: ModuleSpec, id: string): ModuleCell {
    const cell = index.cells.get(id);
    invariant(cell, `module spec ${spec.id} references unknown cell '${id}'`);
    return cell;
}

function requireAssociation(index: ModuleSpecIndex, spec: ModuleSpec, id: string): ModuleAssociation {
    const association = index.associations.get(id);
    invariant(association, `module spec ${spec.id} references unknown association '${id}'`);
    return association;
}

function portSurfaceId(port: ModulePort): string {
    return port.surface;
}

function requireInvokeSurfaceForPort(index: ModuleSpecIndex, spec: ModuleSpec, port: ModulePort): ModuleInvokeSurface {
    const surface = requireSurface(index, spec, portSurfaceId(port));
    invariant(isInvokeSurface(surface), `module spec ${spec.id} port '${port.id}' must reference an invoke surface`);
    return surface;
}

function requireMethodSurfaceForPort(index: ModuleSpecIndex, spec: ModuleSpec, port: ModulePort): ModuleMethodSurface {
    const surface = requireSurface(index, spec, portSurfaceId(port));
    invariant(isMethodSurface(surface), `module spec ${spec.id} port '${port.id}' must reference a method surface`);
    return surface;
}

function requireDecoratedFieldSurfaceForPort(
    index: ModuleSpecIndex,
    spec: ModuleSpec,
    port: ModulePort,
): ModuleDecoratedFieldSurface {
    const surface = requireSurface(index, spec, portSurfaceId(port));
    invariant(isDecoratedFieldSurface(surface), `module spec ${spec.id} port '${port.id}' must reference a decorated_field surface`);
    return surface;
}

function buildLoweredModuleId(specId: string, localId: string): string {
    return `${specId}::${localId}`;
}

function buildTransferReason(spec: ModuleSpec, transfer: { id: string; reason?: string }, fallback: string): string {
    return transfer.reason || `${spec.id}:${fallback}:${transfer.id}`;
}

function buildBridgeEmitSpec(
    spec: ModuleSpec,
    transfer: { id: string; reason?: string; mode?: ModuleTransferMode; boundary?: ModuleBoundaryKind; allowUnreachableTarget?: boolean },
    fallback: string,
): ModuleBridgeEmitSpec {
    return {
        mode: transfer.mode || "preserve",
        boundary: transfer.boundary || "identity",
        reason: buildTransferReason(spec, transfer, fallback),
        allowUnreachableTarget: transfer.allowUnreachableTarget === true,
    };
}

function buildFieldBridgeEmitSpec(
    spec: ModuleSpec,
    transfer: ModuleCellToCellTransfer | ModuleCellToPortTransfer,
    fallback: string,
): NormalizedFieldBridgeEmitSpec {
    invariant(
        transfer.boundary !== "stringify_result",
        `module spec ${spec.id} transfer '${transfer.id}' field bridge does not support boundary 'stringify_result'`,
    );
    return normalizeFieldBridgeEmitSpec({
        fieldReason: buildTransferReason(spec, transfer, fallback),
        loadReason: buildTransferReason(spec, transfer, fallback),
        boundary: transfer.boundary || "identity",
        allowUnreachableTarget: transfer.allowUnreachableTarget === true,
    });
}

function buildFieldWriteEmitSpec(
    spec: ModuleSpec,
    transfer: ModulePortToCellTransfer,
    fallback: string,
): ModuleBridgeEmitSpec {
    invariant(
        transfer.boundary !== "stringify_result",
        `module spec ${spec.id} transfer '${transfer.id}' direct field write does not support boundary 'stringify_result'`,
    );
    return buildBridgeEmitSpec(spec, transfer, fallback);
}

function resolveAddressSpec(
    spec: ModuleSpec,
    index: ModuleSpecIndex,
    transfer: ModulePortToCellTransfer | ModuleCellToPortTransfer,
): AddressKeySpec {
    const hasPort = typeof transfer.addressFrom === "string" && transfer.addressFrom.length > 0;
    const hasLiteral = typeof transfer.addressLiteral === "string" && transfer.addressLiteral.trim().length > 0;
    const hasMeta = !!transfer.addressMeta;
    invariant(hasPort || hasLiteral || hasMeta, `module spec ${spec.id} transfer '${transfer.id}' addressed edge requires addressFrom, addressLiteral, or addressMeta`);
    invariant(
        Number(hasPort) + Number(hasLiteral) + Number(hasMeta) === 1,
        `module spec ${spec.id} transfer '${transfer.id}' must use exactly one of addressFrom, addressLiteral, or addressMeta`,
    );
    if (hasLiteral) {
        return {
            kind: "literal",
            value: transfer.addressLiteral!.trim(),
        };
    }
    if (hasMeta) {
        const surface = requireSurface(index, spec, transfer.addressMeta!.surface);
        invariant(
            surface.kind === "decorated_field_surface",
            `module spec ${spec.id} transfer '${transfer.id}' addressMeta surface '${transfer.addressMeta!.surface}' must be a decorated_field_surface`,
        );
        return {
            kind: "decorated_field_meta",
            surface: { ...surface.selector },
            source: transfer.addressMeta!.source,
            decoratorKind: transfer.addressMeta!.decoratorKind,
        };
    }
    const addressPort = requirePort(index, spec, transfer.addressFrom!);
    invariant(isInvokeValuePort(addressPort), `module spec ${spec.id} transfer '${transfer.id}' addressFrom must reference invoke_arg/base/result`);
    return {
        kind: "invoke_slot",
        slot: toStringSlotSelector(addressPort),
    };
}

function toSemanticEndpointSpec(
    index: ModuleSpecIndex,
    spec: ModuleSpec,
    port: ModulePort,
    role: "source" | "target",
    fieldPath?: ModuleFieldPathSpec,
): SemanticEndpointSpec {
    if (isDecoratedFieldValuePort(port)) {
        const surface = requireDecoratedFieldSurfaceForPort(index, spec, port);
        return {
            kind: "decorated_field",
            surface: { ...surface.selector },
        };
    }

    const surface = requireInvokeSurfaceForPort(index, spec, port);
    invariant(
        role === "source"
            ? isInvokeValuePort(port)
            : (isInvokeValuePort(port) || port.kind === "callback_param"),
        `module spec ${spec.id} port '${port.id}' cannot be used as ${role} endpoint for semantic_addressed_bridge`,
    );
    return {
        kind: "invoke",
        surface: { ...surface.selector },
        value: toNodeSlotSelector(port),
        fieldPath: cloneFieldPathSpec(fieldPath),
        deferredBinding: port.kind === "callback_param"
            ? toDeferredBindingSpec(index, spec, port)
            : undefined,
    };
}

function toStringSlotSelector(
    port: ModuleInvokeArgPort | ModuleInvokeBasePort | ModuleInvokeResultPort,
): ModuleStringSlotSelector {
    switch (port.kind) {
        case "invoke_arg":
            return { kind: "arg", index: port.index };
        case "invoke_base":
            return { kind: "base" };
        case "invoke_result":
            return { kind: "result" };
    }
}

function toInvokeValueSelector(
    port: ModuleInvokeArgPort | ModuleInvokeBasePort | ModuleInvokeResultPort,
): ModuleInvokeValueSlotSelector {
    switch (port.kind) {
        case "invoke_arg":
            return { kind: "arg", index: port.index };
        case "invoke_base":
            return { kind: "base" };
        case "invoke_result":
            return { kind: "result" };
    }
}

function toNodeSlotSelector(port: ModulePort): ModuleNodeSlotSelector {
    switch (port.kind) {
        case "invoke_arg":
            return { kind: "arg", index: port.index, nodeKind: port.nodeKind };
        case "invoke_base":
            return { kind: "base", nodeKind: port.nodeKind };
        case "invoke_result":
            return { kind: "result", nodeKind: port.nodeKind };
        case "callback_param":
            return {
                kind: "callback_param",
                callbackArgIndex: port.callbackArgIndex,
                paramIndex: port.paramIndex,
                maxCandidates: port.maxCandidates,
            };
        default:
            invariant(false, `unsupported node slot port kind ${(port as any)?.kind}`);
    }
}

function toCarrierNodeSelector(
    port: ModuleInvokeArgPort | ModuleInvokeBasePort | ModuleInvokeResultPort,
): ModuleCarrierNodeSlotSelector {
    switch (port.kind) {
        case "invoke_arg":
            return {
                kind: "arg",
                index: port.index,
                nodeKind: port.nodeKind === "object" ? "object" : "carrier",
            };
        case "invoke_base":
            return {
                kind: "base",
                nodeKind: port.nodeKind === "object" ? "object" : "carrier",
            };
        case "invoke_result":
            return {
                kind: "result",
                nodeKind: port.nodeKind === "carrier" ? "carrier" : "carrier",
            };
    }
}

function toCarrierSetSelector(
    index: ModuleSpecIndex,
    spec: ModuleSpec,
    port: ModulePort,
): ModuleCarrierSetSelector {
    if (port.kind === "method_this") {
        const surface = requireMethodSurfaceForPort(index, spec, port);
        return {
            kind: "method_this",
            method: { ...surface.selector },
        };
    }
    if (port.kind === "method_param") {
        const surface = requireMethodSurfaceForPort(index, spec, port);
        return {
            kind: "method_param",
            method: { ...surface.selector },
            paramIndex: port.paramIndex,
        };
    }
    invariant(isInvokeValuePort(port), `module spec ${spec.id} port '${port.id}' is not carrier-capable`);
    const surface = requireInvokeSurfaceForPort(index, spec, port);
    return {
        kind: "invoke_slot",
        surface: { ...surface.selector },
        slot: toCarrierNodeSelector(port),
    };
}

function toInvokeEmitTarget(port: ModulePort): ModuleInvokeEmitTarget {
    if (port.kind === "callback_param") {
        return {
            kind: "callback_param",
            callbackArgIndex: port.callbackArgIndex,
            paramIndex: port.paramIndex,
            maxCandidates: port.maxCandidates,
            mode: "generic",
        };
    }
    invariant(isInvokeValuePort(port), `unsupported invoke emit target port kind ${(port as any)?.kind}`);
    return {
        kind: "node_slot",
        slot: toNodeSlotSelector(port),
        mode: "generic",
    };
}

function resolveRequiredCallbackTrigger(
    index: ModuleSpecIndex,
    spec: ModuleSpec,
    callbackPortId: string,
): ModuleCallbackDispatchTrigger {
    const triggers = index.callbackTriggersByPort.get(callbackPortId) || [];
    invariant(triggers.length === 1, `module spec ${spec.id} callback port '${callbackPortId}' requires exactly one callback_dispatch trigger`);
    return triggers[0];
}

function toDeferredBindingSpec(
    index: ModuleSpecIndex,
    spec: ModuleSpec,
    callbackPort: ModulePort,
): ModuleImperativeDeferredBindingSpec {
    invariant(callbackPort.kind === "callback_param", `module spec ${spec.id} callback binding requires callback_param port`);
    const trigger = resolveRequiredCallbackTrigger(index, spec, callbackPort.id);
    return {
        kind: "imperative",
        callbackArgIndex: callbackPort.callbackArgIndex,
        reason: trigger.reason,
        carrierKind: trigger.carrierKind,
        semantics: trigger.semantics,
    };
}

function lowerDeclarativeTrigger(
    spec: ModuleSpec,
    index: ModuleSpecIndex,
    trigger: ModuleDeclarativeDispatchTrigger,
): DeclarativeBindingModuleSpec {
    const sourceSurface = requireSurface(index, spec, trigger.sourceSurface);
    const handlerSurface = requireSurface(index, spec, trigger.handlerSurface);
    invariant(isMethodSurface(sourceSurface), `module spec ${spec.id} declarative trigger '${trigger.id}' source must be a method surface`);
    invariant(isMethodSurface(handlerSurface), `module spec ${spec.id} declarative trigger '${trigger.id}' handler must be a method surface`);
    return {
        id: buildLoweredModuleId(spec.id, `trigger.${trigger.id}`),
        description: `${spec.description} [${trigger.id}]`,
        enabled: spec.enabled,
        type: "declarative_binding",
        sourceMethod: { ...sourceSurface.selector },
        handlerMethod: { ...handlerSurface.selector },
        anchor: trigger.anchor,
        triggerLabel: trigger.triggerLabel,
        carrierKind: trigger.carrierKind,
        reason: trigger.reason,
        semantics: trigger.semantics,
    };
}

function resolveAssociationCarrierPortForSurface(
    association: Extract<ModuleAssociation, { kind: "same_carrier" }>,
    leftPort: ModulePort,
    rightPort: ModulePort,
    surfaceId: string,
    spec: ModuleSpec,
    role: "source" | "target",
): ModuleInvokeArgPort | ModuleInvokeBasePort | ModuleInvokeResultPort {
    const candidates = [leftPort, rightPort].filter(port => portSurfaceId(port) === surfaceId);
    invariant(candidates.length === 1, `module spec ${spec.id} association '${association.id}' must map exactly one ${role} carrier port to surface '${surfaceId}'`);
    const carrierPort = candidates[0];
    invariant(isInvokeValuePort(carrierPort), `module spec ${spec.id} association '${association.id}' ${role} carrier port '${carrierPort.id}' must be invoke_arg/base/result`);
    return carrierPort;
}

function resolveSameCarrierAssociation(
    index: ModuleSpecIndex,
    spec: ModuleSpec,
    associationId: string | undefined,
): Extract<ModuleAssociation, { kind: "same_carrier" }> | undefined {
    if (!associationId) {
        return undefined;
    }
    const association = requireAssociation(index, spec, associationId);
    invariant(association.kind === "same_carrier", `module spec ${spec.id} association '${associationId}' must be same_carrier`);
    return association;
}

function lowerPortToPortTransfer(
    spec: ModuleSpec,
    index: ModuleSpecIndex,
    transfer: ModulePortToPortTransfer,
): LoweredModuleSpec {
    const fromPort = requirePort(index, spec, transfer.fromPort);
    const toPort = requirePort(index, spec, transfer.toPort);
    const fromSurface = requireInvokeSurfaceForPort(index, spec, fromPort);
    const toInvokeSurface = toPort.kind === "method_param"
        ? undefined
        : requireInvokeSurfaceForPort(index, spec, toPort);

    if (transfer.association) {
        invariant(!!toInvokeSurface, `module spec ${spec.id} transfer '${transfer.id}' association-based bridge requires invoke-surface target`);
        const association = requireAssociation(index, spec, transfer.association);
        invariant(association.kind === "same_carrier", `module spec ${spec.id} transfer '${transfer.id}' only supports same_carrier association`);
        const leftCarrierPort = requirePort(index, spec, association.leftPort);
        const rightCarrierPort = requirePort(index, spec, association.rightPort);
        const sourceCarrierPort = resolveAssociationCarrierPortForSurface(association, leftCarrierPort, rightCarrierPort, fromSurface.id, spec, "source");
        const targetCarrierPort = resolveAssociationCarrierPortForSurface(association, leftCarrierPort, rightCarrierPort, toInvokeSurface.id, spec, "target");
        return {
            id: buildLoweredModuleId(spec.id, `transfer.${transfer.id}`),
            description: `${spec.description} [${transfer.id}]`,
            enabled: spec.enabled,
            type: "carrier_bridge",
            source: {
                surface: { ...fromSurface.selector },
                carrier: toCarrierNodeSelector(sourceCarrierPort),
                value: toNodeSlotSelector(fromPort),
            },
            target: {
                surface: { ...toInvokeSurface.selector },
                carrier: toCarrierNodeSelector(targetCarrierPort),
                value: toNodeSlotSelector(toPort),
            },
            targetDeferredBinding: toPort.kind === "callback_param"
                ? toDeferredBindingSpec(index, spec, toPort)
                : undefined,
            emit: buildBridgeEmitSpec(spec, transfer, "carrier_bridge"),
        };
    }

    if (toPort.kind === "callback_param") {
        invariant(!!toInvokeSurface && fromSurface.id === toInvokeSurface.id, `module spec ${spec.id} transfer '${transfer.id}' callback target without association must share one invoke surface`);
        invariant(isInvokeValuePort(fromPort), `module spec ${spec.id} transfer '${transfer.id}' callback source must be invoke_arg/base/result`);
        return {
            id: buildLoweredModuleId(spec.id, `transfer.${transfer.id}`),
            description: `${spec.description} [${transfer.id}]`,
            enabled: spec.enabled,
            type: "direct_callback_bridge",
            surface: { ...fromSurface.selector },
            source: toNodeSlotSelector(fromPort) as Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>,
            target: toNodeSlotSelector(toPort) as Extract<ModuleNodeSlotSelector, { kind: "callback_param" }>,
            deferredBinding: toDeferredBindingSpec(index, spec, toPort),
            emit: buildBridgeEmitSpec(spec, transfer, "direct_callback_bridge"),
        };
    }

    if (toPort.kind === "method_param") {
        invariant(isInvokeValuePort(fromPort), `module spec ${spec.id} transfer '${transfer.id}' method_param source must be invoke_arg/base/result`);
        const targetSurface = requireMethodSurfaceForPort(index, spec, toPort);
        return {
            id: buildLoweredModuleId(spec.id, `transfer.${transfer.id}`),
            description: `${spec.description} [${transfer.id}]`,
            enabled: spec.enabled,
            type: "cross_method_param_bridge",
            sourceSurface: { ...fromSurface.selector },
            sourceValue: toNodeSlotSelector(fromPort) as Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>,
            targetMethod: { ...targetSurface.selector },
            targetParamIndex: toPort.paramIndex,
            emit: buildBridgeEmitSpec(spec, transfer, "cross_method_param_bridge"),
        };
    }

    invariant(!!toInvokeSurface && fromSurface.id === toInvokeSurface.id, `module spec ${spec.id} transfer '${transfer.id}' direct invoke transfer must stay within one invoke surface`);
    invariant(isInvokeValuePort(fromPort), `module spec ${spec.id} transfer '${transfer.id}' source must be invoke_arg/base/result`);
    invariant(isInvokeValuePort(toPort), `module spec ${spec.id} transfer '${transfer.id}' target must be invoke_arg/base/result`);
    return {
        id: buildLoweredModuleId(spec.id, `transfer.${transfer.id}`),
        description: `${spec.description} [${transfer.id}]`,
        enabled: spec.enabled,
        type: "direct_node_bridge",
        surface: { ...fromSurface.selector },
        source: toNodeSlotSelector(fromPort) as Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>,
        target: toNodeSlotSelector(toPort) as Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>,
        emit: buildBridgeEmitSpec(spec, transfer, "direct_node_bridge"),
    };
}

function lowerFieldWriteTransfer(
    spec: ModuleSpec,
    index: ModuleSpecIndex,
    transfer: ModulePortToCellTransfer,
    fromPort: ModuleInvokeArgPort | ModuleInvokeBasePort | ModuleInvokeResultPort,
    targetCell: ModuleCarrierFieldCell,
): PairedNodeFieldWriteModuleSpec {
    const sourceSurface = requireInvokeSurfaceForPort(index, spec, fromPort);
    const carrierPort = requirePort(index, spec, targetCell.carrierPort);
    invariant(isInvokeValuePort(carrierPort), `module spec ${spec.id} field cell '${targetCell.id}' carrierPort must be invoke_arg/base/result for direct field write lowering`);
    const carrierSurface = requireInvokeSurfaceForPort(index, spec, carrierPort);
    invariant(sourceSurface.id === carrierSurface.id, `module spec ${spec.id} field write transfer '${transfer.id}' must use one invoke surface for value and carrier`);
    invariant(Array.isArray(targetCell.fieldPath) && targetCell.fieldPath.length > 0, `module spec ${spec.id} field cell '${targetCell.id}' requires non-empty fieldPath`);
    return {
        id: buildLoweredModuleId(spec.id, `transfer.${transfer.id}`),
        description: `${spec.description} [${transfer.id}]`,
        enabled: spec.enabled,
        type: "paired_node_field_write",
        surface: { ...sourceSurface.selector },
        source: toNodeSlotSelector(fromPort) as Extract<ModuleNodeSlotSelector, { kind: "arg" | "base" | "result" }>,
        targetCarrier: toCarrierNodeSelector(carrierPort),
        fieldPath: [...targetCell.fieldPath],
        ...buildFieldWriteEmitSpec(spec, transfer, "field_write"),
    };
}

function lowerMethodFieldWriteTransfer(
    spec: ModuleSpec,
    index: ModuleSpecIndex,
    transfer: ModulePortToCellTransfer,
    fromPort: ModuleMethodThisPort | ModuleMethodParamPort,
    targetCell: ModuleCarrierFieldCell,
    carrierPort: ModuleMethodThisPort | ModuleMethodParamPort,
): MethodFieldWriteModuleSpec {
    const sourceSurface = requireMethodSurfaceForPort(index, spec, fromPort);
    const carrierSurface = requireMethodSurfaceForPort(index, spec, carrierPort);
    invariant(sourceSurface.id === carrierSurface.id, `module spec ${spec.id} field write transfer '${transfer.id}' must use one method surface for source and carrier`);
    invariant(Array.isArray(targetCell.fieldPath) && targetCell.fieldPath.length > 0, `module spec ${spec.id} field cell '${targetCell.id}' requires non-empty fieldPath`);
    return {
        id: buildLoweredModuleId(spec.id, `transfer.${transfer.id}`),
        description: `${spec.description} [${transfer.id}]`,
        enabled: spec.enabled,
        type: "method_field_write",
        method: { ...sourceSurface.selector },
        source: toMethodPortSelector(fromPort),
        target: toMethodPortSelector(carrierPort),
        fieldPath: [...targetCell.fieldPath],
        emit: buildFieldWriteEmitSpec(spec, transfer, "method_field_write"),
    };
}

function lowerAddressedBridge(
    spec: ModuleSpec,
    index: ModuleSpecIndex,
    cell: ModuleKeyedStateCell | ModuleChannelCell,
    writes: AddressedWriteCandidate[],
    reads: AddressedReadCandidate[],
): LoweredModuleSpec[] {
    invariant(writes.length > 0, `module spec ${spec.id} addressed cell '${cell.id}' requires at least one write-side transfer`);
    invariant(reads.length > 0, `module spec ${spec.id} addressed cell '${cell.id}' requires at least one read-side transfer`);
    const lowered: LoweredModuleSpec[] = [];
    let pairIndex = 0;
    for (const write of writes) {
        for (const read of reads) {
            const canUseClassicAddressedBridge = isInvokeValuePort(write.fromPort)
                && (read.toPort.kind === "callback_param" || isInvokeValuePort(read.toPort))
                && write.address.kind === "invoke_slot"
                && read.address.kind === "invoke_slot";
            const requiresSemanticProjection = !!write.transfer.fromFieldPath && write.transfer.fromFieldPath.length > 0;
            const requiresTargetProjection = hasFieldPathSpec(read.transfer.toFieldPath);
            if (requiresSemanticProjection) {
                invariant(
                    isInvokeValuePort(write.fromPort),
                    `module spec ${spec.id} transfer '${write.transfer.id}' fromFieldPath currently requires invoke_arg/base/result source`,
                );
            }
            if (requiresTargetProjection) {
                invariant(
                    read.toPort.kind === "callback_param" || isInvokeValuePort(read.toPort),
                    `module spec ${spec.id} transfer '${read.transfer.id}' toFieldPath currently requires invoke_arg/base/result/callback_param target`,
                );
            }

            if (canUseClassicAddressedBridge && !requiresSemanticProjection && !requiresTargetProjection) {
                const writeSurface = requireInvokeSurfaceForPort(index, spec, write.fromPort);
                const readSurface = requireInvokeSurfaceForPort(index, spec, read.toPort);
                const writeAddress = write.address as InvokeSlotAddressKeySpec;
                const readAddress = read.address as InvokeSlotAddressKeySpec;
                if (write.association || read.association) {
                    invariant(!!write.association && !!read.association, `module spec ${spec.id} addressed cell '${cell.id}' scoped bridge requires associations on both write and read transfers`);
                    invariant(write.association.id === read.association.id, `module spec ${spec.id} addressed cell '${cell.id}' scoped bridge requires matching write/read association`);
                    const writeCarrierPort = resolveAssociationCarrierPortForSurface(
                        write.association,
                        requirePort(index, spec, write.association.leftPort),
                        requirePort(index, spec, write.association.rightPort),
                        writeSurface.id,
                        spec,
                        "source",
                    );
                    const readCarrierPort = resolveAssociationCarrierPortForSurface(
                        read.association,
                        requirePort(index, spec, read.association.leftPort),
                        requirePort(index, spec, read.association.rightPort),
                        readSurface.id,
                        spec,
                        "target",
                    );
                    lowered.push({
                        id: buildLoweredModuleId(spec.id, `cell.${cell.id}.${pairIndex++}`),
                        description: `${spec.description} [${cell.id}]`,
                        enabled: spec.enabled,
                        type: "scoped_addressed_bridge",
                        sourceSurface: { ...writeSurface.selector },
                        targetSurface: { ...readSurface.selector },
                        sourceValue: toNodeSlotSelector(write.fromPort),
                        sourceAddress: writeAddress.slot,
                        targetValue: toNodeSlotSelector(read.toPort),
                        targetAddress: readAddress.slot,
                        sourceScope: toCarrierNodeSelector(writeCarrierPort),
                        targetScope: toCarrierNodeSelector(readCarrierPort),
                        targetDeferredBinding: read.toPort.kind === "callback_param"
                            ? toDeferredBindingSpec(index, spec, read.toPort)
                            : undefined,
                        emit: {
                            mode: read.transfer.mode || write.transfer.mode || "preserve",
                            boundary: read.transfer.boundary || write.transfer.boundary || "identity",
                            reason: read.transfer.reason || write.transfer.reason || `${spec.id}:scoped_addressed_bridge:${cell.id}`,
                            allowUnreachableTarget:
                                read.transfer.allowUnreachableTarget === true
                                || write.transfer.allowUnreachableTarget === true,
                        },
                    });
                    continue;
                }
                lowered.push({
                    id: buildLoweredModuleId(spec.id, `cell.${cell.id}.${pairIndex++}`),
                    description: `${spec.description} [${cell.id}]`,
                    enabled: spec.enabled,
                    type: "keyed_bridge",
                    source: {
                        surface: { ...writeSurface.selector },
                        key: writeAddress.slot,
                        value: toNodeSlotSelector(write.fromPort),
                    },
                    target: {
                        surface: { ...readSurface.selector },
                        key: readAddress.slot,
                        value: toNodeSlotSelector(read.toPort),
                    },
                    targetDeferredBinding: read.toPort.kind === "callback_param"
                        ? toDeferredBindingSpec(index, spec, read.toPort)
                        : undefined,
                    emit: {
                        mode: read.transfer.mode || write.transfer.mode || "preserve",
                        boundary: read.transfer.boundary || write.transfer.boundary || "identity",
                        reason: read.transfer.reason || write.transfer.reason || `${spec.id}:addressed_bridge:${cell.id}`,
                        allowUnreachableTarget:
                            read.transfer.allowUnreachableTarget === true
                            || write.transfer.allowUnreachableTarget === true,
                    },
                });
                continue;
            }

            invariant(!write.association && !read.association, `module spec ${spec.id} addressed cell '${cell.id}' semantic bridge does not support scoped associations unless both sides are invoke-addressed`);
            lowered.push({
                id: buildLoweredModuleId(spec.id, `cell.${cell.id}.${pairIndex++}`),
                description: `${spec.description} [${cell.id}]`,
                enabled: spec.enabled,
                type: "semantic_addressed_bridge",
                source: toSemanticEndpointSpec(index, spec, write.fromPort, "source", write.transfer.fromFieldPath),
                target: toSemanticEndpointSpec(index, spec, read.toPort, "target", read.transfer.toFieldPath),
                sourceAddress: write.address,
                targetAddress: read.address,
                emit: {
                    mode: read.transfer.mode || write.transfer.mode || "preserve",
                    boundary: read.transfer.boundary || write.transfer.boundary || "identity",
                    reason: read.transfer.reason || write.transfer.reason || `${spec.id}:semantic_addressed_bridge:${cell.id}`,
                    allowUnreachableTarget:
                        read.transfer.allowUnreachableTarget === true
                        || write.transfer.allowUnreachableTarget === true,
                },
            });
        }
    }
    return lowered;
}

function lowerFieldBridge(
    spec: ModuleSpec,
    index: ModuleSpecIndex,
    sourceCell: ModuleCarrierFieldCell,
    group: FieldTargetGroup,
): FieldBridgeModuleSpec | undefined {
    if (group.writes.length === 0 && group.loads.length === 0) {
        return undefined;
    }
    invariant(sourceCell.fieldPath.length > 0, `module spec ${spec.id} source field cell '${sourceCell.id}' requires a non-empty fieldPath`);
    const targetWrites = group.writes.map(entry => ({
        carrier: toCarrierSetSelector(index, spec, requirePort(index, spec, entry.targetCell.carrierPort)),
        fieldPath: [...entry.targetCell.fieldPath],
    }));
    const targetLoads = group.loads.map(entry => {
        if (entry.targetPort.kind === "field_load") {
            const methodSurface = requireMethodSurfaceForPort(index, spec, entry.targetPort);
            return {
                kind: "field_load" as const,
                method: { ...methodSurface.selector },
                fieldName: entry.targetPort.fieldName,
            };
        }
        if (entry.targetPort.kind === "method_param") {
            const methodSurface = requireMethodSurfaceForPort(index, spec, entry.targetPort);
            return {
                kind: "method_param" as const,
                method: { ...methodSurface.selector },
                paramIndex: entry.targetPort.paramIndex,
            };
        }
        invariant(
            entry.targetPort.kind === "callback_param" || isInvokeValuePort(entry.targetPort),
            `module spec ${spec.id} field bridge target '${entry.targetPort.id}' cannot lower to a node target`,
        );
        const invokeSurface = requireInvokeSurfaceForPort(index, spec, entry.targetPort);
        return {
            kind: "invoke_port" as const,
            surface: { ...invokeSurface.selector },
            port: toNodeSlotSelector(entry.targetPort),
            deferredBinding: entry.targetPort.kind === "callback_param"
                ? toDeferredBindingSpec(index, spec, entry.targetPort)
                : undefined,
        };
    });
    return {
        id: buildLoweredModuleId(
            spec.id,
            `field.${group.sourceCellId}.${[
                ...group.writes.map(entry => entry.transfer.id),
                ...group.loads.map(entry => entry.transfer.id),
            ].join("+")}`,
        ),
        description: `${spec.description} [${sourceCell.id}]`,
        enabled: spec.enabled,
        type: "field_bridge",
        source: {
            carrier: toCarrierSetSelector(index, spec, requirePort(index, spec, sourceCell.carrierPort)),
            fieldName: sourceCell.fieldPath[0],
            fieldPath: [...sourceCell.fieldPath],
        },
        targetWrites,
        targetLoads,
        emit: group.emit,
    };
}

function pushUniqueById<T extends { id: string }>(
    collection: T[],
    seen: Set<string>,
    item: T,
    kind: string,
    specId: string,
): void {
    invariant(!seen.has(item.id), `duplicate ${kind} id '${item.id}' in module spec ${specId}`);
    collection.push(item);
    seen.add(item.id);
}

function ensureRecipeInvokeSurface(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    recipeId: string,
    label: string,
    selector: ModuleRecipeInvokeSurfaceRef,
): string {
    const surfaceId = `${recipeId}.${label}.surface`;
    if (!surfaceIds.has(surfaceId)) {
        spec.surfaces.push({
            id: surfaceId,
            kind: "invoke_surface",
            selector: { ...selector },
        });
        surfaceIds.add(surfaceId);
    }
    return surfaceId;
}

function toRecipeValueEndpoint(
    surface: string,
    source: ModuleRecipeValueSource,
): ModuleRecipeEndpoint {
    switch (source.kind) {
        case "arg":
            return {
                surface,
                kind: "invoke_arg",
                index: source.index,
                fieldPath: cloneFieldPathSpec(source.fieldPath),
            };
        case "base":
            return {
                surface,
                kind: "invoke_base",
                fieldPath: cloneFieldPathSpec(source.fieldPath),
            };
        case "result":
            return {
                surface,
                kind: "invoke_result",
                fieldPath: cloneFieldPathSpec(source.fieldPath),
            };
    }
}

function toRecipeCallbackEndpoint(
    surface: string,
    callback: ModuleRecipeCallbackTarget | undefined,
): ModuleRecipeEndpoint {
    return {
        surface,
        kind: "callback_param",
        callbackArgIndex: callback?.callbackArgIndex ?? 0,
        paramIndex: callback?.paramIndex ?? 0,
        maxCandidates: callback?.maxCandidates ?? 8,
    };
}

function buildPresetSemantics(
    preset: ModuleRecipeTriggerPreset | undefined,
): ModuleDeferredBindingSemanticsSpec | undefined {
    switch (preset) {
        case "callback_sync":
            return {
                activation: "event(c)",
                completion: "none",
                continuationRole: "value",
            };
        case "callback_event":
            return {
                activation: "event(c)",
                completion: "none",
                continuationRole: "value",
            };
        case "promise_fulfilled":
            return {
                activation: "settle(fulfilled)",
                completion: "promise_chain",
                preserve: ["settle(fulfilled)"],
                continuationRole: "value",
            };
        case "promise_rejected":
            return {
                activation: "settle(rejected)",
                completion: "promise_chain",
                preserve: ["settle(rejected)"],
                continuationRole: "error",
            };
        case "promise_any":
            return {
                activation: "settle(any)",
                completion: "promise_chain",
                preserve: ["settle(any)"],
                continuationRole: "observe",
            };
        case "declarative_field":
            return {
                activation: "event(c)",
                completion: "none",
                continuationRole: "value",
            };
        default:
            return undefined;
    }
}

function mergeDeferredSemantics(
    preset: ModuleRecipeTriggerPreset | undefined,
    explicit: ModuleDeferredBindingSemanticsSpec | undefined,
): ModuleDeferredBindingSemanticsSpec | undefined {
    const defaults = buildPresetSemantics(preset);
    if (!defaults) {
        return explicit;
    }
    return {
        activation: explicit?.activation || defaults.activation,
        completion: explicit?.completion || defaults.completion,
        preserve: explicit?.preserve || defaults.preserve,
        continuationRole: explicit?.continuationRole || defaults.continuationRole,
    };
}

function ensureSemanticSurface(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    semanticId: string,
    label: string,
    surfaceRef: ModuleSemanticSurfaceRef | string,
): string {
    const normalizedSurfaceRef = normalizeSurfaceRef(surfaceRef);
    const existing = (spec.surfaces || []).find(surface => {
        if (normalizedSurfaceRef.kind === "invoke" && surface.kind === "invoke_surface") {
            return JSON.stringify(surface.selector) === JSON.stringify(normalizedSurfaceRef.selector);
        }
        if (normalizedSurfaceRef.kind === "method" && surface.kind === "method_surface") {
            return JSON.stringify(surface.selector) === JSON.stringify(normalizedSurfaceRef.selector);
        }
        if (normalizedSurfaceRef.kind === "decorated_field" && surface.kind === "decorated_field_surface") {
            return JSON.stringify(surface.selector) === JSON.stringify(normalizedSurfaceRef.selector);
        }
        return false;
    });
    if (existing) {
        surfaceIds.add(existing.id);
        return existing.id;
    }
    const surfaceId = `${semanticId}.${label}.surface`;
    if (surfaceIds.has(surfaceId)) {
        return surfaceId;
    }
    switch (normalizedSurfaceRef.kind) {
        case "invoke":
            spec.surfaces!.push({
                id: surfaceId,
                kind: "invoke_surface",
                selector: { ...normalizedSurfaceRef.selector },
            });
            break;
        case "method":
            spec.surfaces!.push({
                id: surfaceId,
                kind: "method_surface",
                selector: { ...normalizedSurfaceRef.selector },
            });
            break;
        case "decorated_field":
            spec.surfaces!.push({
                id: surfaceId,
                kind: "decorated_field_surface",
                selector: { ...normalizedSurfaceRef.selector },
            });
            break;
    }
    surfaceIds.add(surfaceId);
    return surfaceId;
}

function inferValueNodeKind(
    endpoint: ModuleEndpoint,
    emit: ModuleBridgeEmitSpec | undefined,
): "node" | "object" | undefined {
    if (endpoint.fieldPath) {
        return "object";
    }
    if (emit?.boundary === "serialized_copy" || emit?.boundary === "clone_copy" || emit?.boundary === "stringify_result") {
        return "object";
    }
    return undefined;
}

function toRecipeEndpointFromSemantic(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    semanticId: string,
    label: string,
    endpoint: ModuleEndpoint,
    options?: {
        relationCarrier?: boolean;
        stateCarrier?: boolean;
        emit?: ModuleBridgeEmitSpec;
    },
): ModuleRecipeEndpoint {
    const surface = ensureSemanticSurface(spec, surfaceIds, semanticId, label, endpoint.surface);
    const valueNodeKind = options?.stateCarrier
        ? "object"
        : options?.relationCarrier
            ? "carrier"
            : inferValueNodeKind(endpoint, options?.emit);
    switch (endpoint.slot) {
        case "arg":
            return {
                surface,
                kind: "invoke_arg",
                index: endpoint.index,
                nodeKind: valueNodeKind,
                fieldPath: cloneFieldPathSpec(endpoint.fieldPath),
            };
        case "base":
            return {
                surface,
                kind: "invoke_base",
                nodeKind: options?.relationCarrier ? "carrier" : valueNodeKind,
                fieldPath: cloneFieldPathSpec(endpoint.fieldPath),
            };
        case "result":
            return {
                surface,
                kind: "invoke_result",
                nodeKind: valueNodeKind === "object" ? "carrier" : undefined,
                fieldPath: cloneFieldPathSpec(endpoint.fieldPath),
            };
        case "callback_param":
            return {
                surface,
                kind: "callback_param",
                callbackArgIndex: endpoint.callbackArgIndex ?? 0,
                paramIndex: endpoint.paramIndex ?? 0,
                maxCandidates: 8,
                fieldPath: cloneFieldPathSpec(endpoint.fieldPath),
            };
        case "method_this":
            return {
                surface,
                kind: "method_this",
                fieldPath: cloneFieldPathSpec(endpoint.fieldPath),
            };
        case "method_param":
            return {
                surface,
                kind: "method_param",
                paramIndex: endpoint.paramIndex,
                fieldPath: cloneFieldPathSpec(endpoint.fieldPath),
            };
        case "field_load":
            return {
                surface,
                kind: "field_load",
                fieldName: endpoint.fieldName,
                baseThisOnly: endpoint.baseThisOnly,
                fieldPath: cloneFieldPathSpec(endpoint.fieldPath),
            };
        case "decorated_field_value":
            return {
                surface,
                kind: "decorated_field_value",
                fieldPath: cloneFieldPathSpec(endpoint.fieldPath),
            };
    }
}

function toRecipeAddressFromSemantic(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    semanticId: string,
    label: string,
    address: ModuleAddress | undefined,
): ModuleRecipeAddress | undefined {
    if (!address) {
        return undefined;
    }
    switch (address.kind) {
        case "literal":
            return {
                kind: "literal",
                value: address.value,
            };
        case "endpoint":
            return {
                kind: "endpoint",
                endpoint: toRecipeEndpointFromSemantic(spec, surfaceIds, semanticId, `${label}.endpoint`, address.endpoint),
            };
        case "decorated_field_meta":
            return {
                kind: "decorated_field_meta",
                surface: ensureSemanticSurface(spec, surfaceIds, semanticId, `${label}.surface`, {
                    kind: "decorated_field",
                    selector: address.surface,
                }),
                source: address.source,
                decoratorKind: address.decoratorKind,
            };
    }
}

function toRecipeTriggerFromDispatch(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    semanticId: string,
    dispatch: ModuleDispatch | undefined,
): ModuleRecipeCallbackTrigger | undefined {
    if (!dispatch) {
        return undefined;
    }
    return {
        kind: "callback_dispatch",
        via: dispatch.via
            ? toRecipeEndpointFromSemantic(spec, surfaceIds, semanticId, "dispatch.via", dispatch.via)
            : undefined,
        reason: dispatch.reason || semanticId,
        preset: dispatch.preset,
    };
}

function assertRecipeSurfaceExists(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    endpoint: ModuleRecipeEndpoint,
    owner: string,
): void {
    invariant(surfaceIds.has(endpoint.surface), `module spec ${spec.id} ${owner} references unknown surface '${endpoint.surface}'`);
}

function buildRecipePort(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    endpoint: ModuleRecipeEndpoint,
    portId: string,
    owner: string,
): ModulePort {
    assertRecipeSurfaceExists(spec, surfaceIds, endpoint, owner);
    switch (endpoint.kind) {
        case "invoke_arg":
            return {
                id: portId,
                kind: "invoke_arg",
                surface: endpoint.surface,
                index: endpoint.index,
                nodeKind: endpoint.nodeKind,
            };
        case "invoke_base":
            return {
                id: portId,
                kind: "invoke_base",
                surface: endpoint.surface,
                nodeKind: endpoint.nodeKind,
            };
        case "invoke_result":
            return {
                id: portId,
                kind: "invoke_result",
                surface: endpoint.surface,
                nodeKind: endpoint.nodeKind,
            };
        case "callback_param":
            return {
                id: portId,
                kind: "callback_param",
                surface: endpoint.surface,
                callbackArgIndex: endpoint.callbackArgIndex,
                paramIndex: endpoint.paramIndex,
                maxCandidates: endpoint.maxCandidates,
            };
        case "method_this":
            return {
                id: portId,
                kind: "method_this",
                surface: endpoint.surface,
            };
        case "method_param":
            return {
                id: portId,
                kind: "method_param",
                surface: endpoint.surface,
                paramIndex: endpoint.paramIndex,
            };
        case "field_load":
            return {
                id: portId,
                kind: "field_load",
                surface: endpoint.surface,
                fieldName: endpoint.fieldName,
                baseThisOnly: endpoint.baseThisOnly,
            };
        case "decorated_field_value":
            return {
                id: portId,
                kind: "decorated_field_value",
                surface: endpoint.surface,
            };
    }
}

function addRecipeEndpointPort(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    seenPortIds: Set<string>,
    recipeId: string,
    label: string,
    endpoint: ModuleRecipeEndpoint,
): string {
    const portId = `${recipeId}.${label}`;
    pushUniqueById(
        ports,
        seenPortIds,
        buildRecipePort(spec, surfaceIds, endpoint, portId, `${recipeId}.${label}`),
        "port",
        spec.id,
    );
    return portId;
}

function applyRecipeAddress(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    seenPortIds: Set<string>,
    recipeId: string,
    label: string,
    transfer: ModulePortToCellTransfer | ModuleCellToPortTransfer,
    address: ModuleRecipeAddress | undefined,
): void {
    if (!address) {
        return;
    }
    if (address.kind === "literal") {
        transfer.addressLiteral = address.value;
        return;
    }
    if (address.kind === "decorated_field_meta") {
        invariant(
            surfaceIds.has(address.surface),
            `module spec ${spec.id} recipe '${recipeId}' address surface '${address.surface}' not found`,
        );
        transfer.addressMeta = {
            kind: "decorated_field_meta",
            surface: address.surface,
            source: address.source,
            decoratorKind: address.decoratorKind,
        };
        return;
    }
    invariant(
        address.endpoint.kind === "invoke_arg"
        || address.endpoint.kind === "invoke_base"
        || address.endpoint.kind === "invoke_result",
        `module spec ${spec.id} recipe '${recipeId}' address endpoint must be invoke_arg/base/result`,
    );
    transfer.addressFrom = addRecipeEndpointPort(
        spec,
        surfaceIds,
        ports,
        seenPortIds,
        recipeId,
        label,
        address.endpoint,
    );
}

function buildRecipeTransferBase(recipeId: string, emit?: ModuleBridgeEmitSpec): Pick<ModulePortToPortTransfer, "reason" | "mode" | "boundary" | "allowUnreachableTarget"> {
    return {
        reason: emit?.reason || recipeId,
        mode: emit?.mode,
        boundary: emit?.boundary,
        allowUnreachableTarget: emit?.allowUnreachableTarget,
    };
}

function addRecipeCallbackTrigger(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    triggers: ModuleTrigger[],
    seenPortIds: Set<string>,
    seenTriggerIds: Set<string>,
    recipeId: string,
    trigger: ModuleRecipeCallbackTrigger | undefined,
    defaultViaPortId: string,
): void {
    if (!trigger) {
        return;
    }
    const viaPort = trigger.via
        ? addRecipeEndpointPort(spec, surfaceIds, ports, seenPortIds, recipeId, "trigger.via", trigger.via)
        : defaultViaPortId;
    pushUniqueById(triggers, seenTriggerIds, {
        id: `${recipeId}.trigger`,
        kind: "callback_dispatch",
        viaPort,
        reason: trigger.reason,
        carrierKind: trigger.carrierKind,
        semantics: mergeDeferredSemantics(trigger.preset, trigger.semantics),
    }, "trigger", spec.id);
}

function addRecipeCell(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    cells: ModuleCell[],
    seenPortIds: Set<string>,
    seenCellIds: Set<string>,
    recipeId: string,
    cell: ModuleRecipeCell,
): string {
    switch (cell.kind) {
        case "keyed_state_cell":
            pushUniqueById(cells, seenCellIds, {
                id: cell.id,
                kind: "keyed_state_cell",
                label: cell.label,
            }, "cell", spec.id);
            return cell.id;
        case "channel_cell":
            pushUniqueById(cells, seenCellIds, {
                id: cell.id,
                kind: "channel_cell",
                label: cell.label,
            }, "cell", spec.id);
            return cell.id;
        case "carrier_field_cell": {
            const carrierPort = addRecipeEndpointPort(
                spec,
                surfaceIds,
                ports,
                seenPortIds,
                recipeId,
                "cell.carrier",
                cell.carrier,
            );
            pushUniqueById(cells, seenCellIds, {
                id: cell.id,
                kind: "carrier_field_cell",
                carrierPort,
                fieldPath: [...cell.fieldPath],
            }, "cell", spec.id);
            return cell.id;
        }
    }
}

function expandDirectBridgeRecipe(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    transfers: ModuleTransfer[],
    triggers: ModuleTrigger[],
    seenPortIds: Set<string>,
    seenTransferIds: Set<string>,
    seenTriggerIds: Set<string>,
    recipe: ModuleRecipeDirectBridge,
): void {
    const fromPort = addRecipeEndpointPort(spec, surfaceIds, ports, seenPortIds, recipe.id, "from", recipe.from);
    const toPort = addRecipeEndpointPort(spec, surfaceIds, ports, seenPortIds, recipe.id, "to", recipe.to);
    pushUniqueById(transfers, seenTransferIds, {
        id: `${recipe.id}.transfer`,
        kind: "port_to_port",
        fromPort,
        toPort,
        ...buildRecipeTransferBase(recipe.id, recipe.emit),
    }, "transfer", spec.id);
    addRecipeCallbackTrigger(spec, surfaceIds, ports, triggers, seenPortIds, seenTriggerIds, recipe.id, recipe.trigger, toPort);
}

function expandCallbackChannelRecipe(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    associations: ModuleAssociation[],
    transfers: ModuleTransfer[],
    triggers: ModuleTrigger[],
    seenPortIds: Set<string>,
    seenAssociationIds: Set<string>,
    seenTransferIds: Set<string>,
    seenTriggerIds: Set<string>,
    recipe: ModuleRecipeCallbackChannel,
): void {
    const sendSurface = ensureRecipeInvokeSurface(spec, surfaceIds, recipe.id, "send", recipe.send);
    const receiveSurface = ensureRecipeInvokeSurface(spec, surfaceIds, recipe.id, "receive", recipe.receive);
    expandAssociatedBridgeRecipe(
        spec,
        surfaceIds,
        ports,
        associations,
        transfers,
        triggers,
        seenPortIds,
        seenAssociationIds,
        seenTransferIds,
        seenTriggerIds,
        {
            id: recipe.id,
            kind: "associated_bridge",
            from: toRecipeValueEndpoint(sendSurface, recipe.payload || { kind: "arg", index: 0 }),
            to: toRecipeCallbackEndpoint(receiveSurface, recipe.callback),
            association: {
                kind: "same_carrier",
                left: {
                    surface: sendSurface,
                    kind: "invoke_base",
                    nodeKind: "carrier",
                },
                right: {
                    surface: receiveSurface,
                    kind: "invoke_base",
                    nodeKind: "carrier",
                },
            },
            emit: recipe.emit,
            trigger: recipe.trigger || {
                kind: "callback_dispatch",
                reason: recipe.emit?.reason || recipe.id,
                preset: "callback_event",
            },
        },
    );
}

function expandCallbackHandoffRecipe(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    transfers: ModuleTransfer[],
    triggers: ModuleTrigger[],
    seenPortIds: Set<string>,
    seenTransferIds: Set<string>,
    seenTriggerIds: Set<string>,
    recipe: ModuleRecipeCallbackHandoff,
): void {
    const surface = ensureRecipeInvokeSurface(spec, surfaceIds, recipe.id, "surface", recipe.surface);
    expandDirectBridgeRecipe(
        spec,
        surfaceIds,
        ports,
        transfers,
        triggers,
        seenPortIds,
        seenTransferIds,
        seenTriggerIds,
        {
            id: recipe.id,
            kind: "direct_bridge",
            from: toRecipeValueEndpoint(surface, recipe.source),
            to: toRecipeCallbackEndpoint(surface, recipe.callback),
            emit: recipe.emit,
            trigger: recipe.trigger || {
                kind: "callback_dispatch",
                reason: recipe.emit?.reason || recipe.id,
                preset: "callback_sync",
            },
        },
    );
}

function expandAccessorPairRecipe(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    associations: ModuleAssociation[],
    transfers: ModuleTransfer[],
    triggers: ModuleTrigger[],
    seenPortIds: Set<string>,
    seenAssociationIds: Set<string>,
    seenTransferIds: Set<string>,
    seenTriggerIds: Set<string>,
    recipe: ModuleRecipeAccessorPair,
): void {
    const writeSurface = ensureRecipeInvokeSurface(spec, surfaceIds, recipe.id, "write", recipe.write);
    const readSurface = ensureRecipeInvokeSurface(spec, surfaceIds, recipe.id, "read", recipe.read);
    expandAssociatedBridgeRecipe(
        spec,
        surfaceIds,
        ports,
        associations,
        transfers,
        triggers,
        seenPortIds,
        seenAssociationIds,
        seenTransferIds,
        seenTriggerIds,
        {
            id: recipe.id,
            kind: "associated_bridge",
            from: toRecipeValueEndpoint(writeSurface, recipe.value || { kind: "arg", index: 0 }),
            to: {
                surface: readSurface,
                kind: "invoke_result",
            },
            association: {
                kind: "same_carrier",
                left: {
                    surface: writeSurface,
                    kind: "invoke_base",
                    nodeKind: "carrier",
                },
                right: {
                    surface: readSurface,
                    kind: "invoke_base",
                    nodeKind: "carrier",
                },
            },
            emit: recipe.emit,
        },
    );
}

function expandFactoryReturnRecipe(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    transfers: ModuleTransfer[],
    triggers: ModuleTrigger[],
    seenPortIds: Set<string>,
    seenTransferIds: Set<string>,
    seenTriggerIds: Set<string>,
    recipe: ModuleRecipeFactoryReturn,
): void {
    const surface = ensureRecipeInvokeSurface(spec, surfaceIds, recipe.id, "surface", recipe.surface);
    expandDirectBridgeRecipe(
        spec,
        surfaceIds,
        ports,
        transfers,
        triggers,
        seenPortIds,
        seenTransferIds,
        seenTriggerIds,
        {
            id: recipe.id,
            kind: "direct_bridge",
            from: toRecipeValueEndpoint(surface, recipe.source),
            to: {
                surface,
                kind: "invoke_result",
            },
            emit: recipe.emit,
        },
    );
}

function expandAssociatedBridgeRecipe(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    associations: ModuleAssociation[],
    transfers: ModuleTransfer[],
    triggers: ModuleTrigger[],
    seenPortIds: Set<string>,
    seenAssociationIds: Set<string>,
    seenTransferIds: Set<string>,
    seenTriggerIds: Set<string>,
    recipe: ModuleRecipeAssociatedBridge,
): void {
    const fromPort = addRecipeEndpointPort(spec, surfaceIds, ports, seenPortIds, recipe.id, "from", recipe.from);
    const toPort = addRecipeEndpointPort(spec, surfaceIds, ports, seenPortIds, recipe.id, "to", recipe.to);
    const leftPort = addRecipeEndpointPort(spec, surfaceIds, ports, seenPortIds, recipe.id, "assoc.left", recipe.association.left);
    const rightPort = addRecipeEndpointPort(spec, surfaceIds, ports, seenPortIds, recipe.id, "assoc.right", recipe.association.right);
    const associationId = `${recipe.id}.association`;
    pushUniqueById(associations, seenAssociationIds, {
        id: associationId,
        kind: "same_carrier",
        leftPort,
        rightPort,
    }, "association", spec.id);
    pushUniqueById(transfers, seenTransferIds, {
        id: `${recipe.id}.transfer`,
        kind: "port_to_port",
        fromPort,
        toPort,
        association: associationId,
        ...buildRecipeTransferBase(recipe.id, recipe.emit),
    }, "transfer", spec.id);
    addRecipeCallbackTrigger(spec, surfaceIds, ports, triggers, seenPortIds, seenTriggerIds, recipe.id, recipe.trigger, toPort);
}

function assertRecipeWriteFieldPath(
    spec: ModuleSpec,
    recipeId: string,
    endpoint: ModuleRecipeEndpoint,
): string[] | undefined {
    if (!endpoint.fieldPath) {
        return undefined;
    }
    invariant(Array.isArray(endpoint.fieldPath), `module spec ${spec.id} recipe '${recipeId}' write fieldPath must be a concrete array`);
    return [...endpoint.fieldPath];
}

function expandCellBridgeRecipe(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    cells: ModuleCell[],
    transfers: ModuleTransfer[],
    triggers: ModuleTrigger[],
    seenPortIds: Set<string>,
    seenCellIds: Set<string>,
    seenTransferIds: Set<string>,
    seenTriggerIds: Set<string>,
    recipe: ModuleRecipeCellBridge,
): void {
    const cellId = addRecipeCell(spec, surfaceIds, ports, cells, seenPortIds, seenCellIds, recipe.id, recipe.cell);
    const writeFromPort = addRecipeEndpointPort(spec, surfaceIds, ports, seenPortIds, recipe.id, "write.from", recipe.write.from);
    const readToPort = addRecipeEndpointPort(spec, surfaceIds, ports, seenPortIds, recipe.id, "read.to", recipe.read.to);
    const emitBase = buildRecipeTransferBase(recipe.id, recipe.emit);

    const writeTransfer: ModulePortToCellTransfer = {
        id: `${recipe.id}.write`,
        kind: "port_to_cell",
        fromPort: writeFromPort,
        toCell: cellId,
        fromFieldPath: assertRecipeWriteFieldPath(spec, recipe.id, recipe.write.from),
        ...emitBase,
    };
    applyRecipeAddress(spec, surfaceIds, ports, seenPortIds, recipe.id, "write.address", writeTransfer, recipe.write.address);
    pushUniqueById(transfers, seenTransferIds, writeTransfer, "transfer", spec.id);

    const readTransfer: ModuleCellToPortTransfer = {
        id: `${recipe.id}.read`,
        kind: "cell_to_port",
        fromCell: cellId,
        toPort: readToPort,
        toFieldPath: cloneFieldPathSpec(recipe.read.to.fieldPath),
        ...emitBase,
    };
    applyRecipeAddress(spec, surfaceIds, ports, seenPortIds, recipe.id, "read.address", readTransfer, recipe.read.address);
    pushUniqueById(transfers, seenTransferIds, readTransfer, "transfer", spec.id);

    addRecipeCallbackTrigger(spec, surfaceIds, ports, triggers, seenPortIds, seenTriggerIds, recipe.id, recipe.trigger, readToPort);
}

function expandDeclarativeRecipe(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    triggers: ModuleTrigger[],
    seenTriggerIds: Set<string>,
    recipe: ModuleRecipeDeclarativeDispatch,
): void {
    invariant(surfaceIds.has(recipe.sourceSurface), `module spec ${spec.id} recipe '${recipe.id}' references unknown source surface '${recipe.sourceSurface}'`);
    invariant(surfaceIds.has(recipe.handlerSurface), `module spec ${spec.id} recipe '${recipe.id}' references unknown handler surface '${recipe.handlerSurface}'`);
    pushUniqueById(triggers, seenTriggerIds, {
        id: `${recipe.id}.trigger`,
        kind: "declarative_dispatch",
        sourceSurface: recipe.sourceSurface,
        handlerSurface: recipe.handlerSurface,
        anchor: recipe.anchor,
        triggerLabel: recipe.triggerLabel,
        carrierKind: recipe.carrierKind,
        reason: recipe.reason,
        semantics: mergeDeferredSemantics(recipe.preset, recipe.semantics),
    }, "trigger", spec.id);
}

function expandBridgeSemantic(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    cells: ModuleCell[],
    associations: ModuleAssociation[],
    transfers: ModuleTransfer[],
    triggers: ModuleTrigger[],
    seenPortIds: Set<string>,
    seenCellIds: Set<string>,
    seenAssociationIds: Set<string>,
    seenTransferIds: Set<string>,
    seenTriggerIds: Set<string>,
    semantic: ModuleBridgeSemantic,
): void {
    const receiverConstraint = (semantic.constraints || []).find((item): item is ModuleSameReceiverConstraint => item.kind === "same_receiver");
    const addressConstraint = (semantic.constraints || []).find((item): item is ModuleSameAddressConstraint => item.kind === "same_address");
    invariant(
        !(receiverConstraint && addressConstraint),
        `module spec ${spec.id} semantic '${semantic.id}' cannot combine same_receiver and same_address in one bridge`,
    );

    const from = toRecipeEndpointFromSemantic(spec, surfaceIds, semantic.id, "from", semantic.from, { emit: semantic.emit });
    const to = toRecipeEndpointFromSemantic(spec, surfaceIds, semantic.id, "to", semantic.to, { emit: semantic.emit });
    if (addressConstraint) {
        expandCellBridgeRecipe(
            spec,
            surfaceIds,
            ports,
            cells,
            transfers,
            triggers,
            seenPortIds,
            seenCellIds,
            seenTransferIds,
            seenTriggerIds,
            {
                id: semantic.id,
                kind: "cell_bridge",
                cell: {
                    id: `${semantic.id}.cell`,
                    kind: "keyed_state_cell",
                    label: semantic.id,
                },
                write: {
                    from,
                    address: toRecipeAddressFromSemantic(spec, surfaceIds, semantic.id, "constraint.left", addressConstraint.left),
                },
                read: {
                    to,
                    address: toRecipeAddressFromSemantic(spec, surfaceIds, semantic.id, "constraint.right", addressConstraint.right),
                },
                emit: semantic.emit,
                trigger: toRecipeTriggerFromDispatch(spec, surfaceIds, semantic.id, semantic.dispatch),
            },
        );
        return;
    }
    if (receiverConstraint) {
        const fromSurfaceRef = normalizeSurfaceRef(semantic.from.surface);
        const toSurfaceRef = normalizeSurfaceRef(semantic.to.surface);
        expandAssociatedBridgeRecipe(
            spec,
            surfaceIds,
            ports,
            associations,
            transfers,
            triggers,
            seenPortIds,
            seenAssociationIds,
            seenTransferIds,
            seenTriggerIds,
            {
                id: semantic.id,
                kind: "associated_bridge",
                from,
                to,
                association: {
                    kind: "same_carrier",
                    left: toRecipeEndpointFromSemantic(spec, surfaceIds, semantic.id, "assoc.left", fromSurfaceRef.kind === "invoke"
                        ? { slot: "base", surface: fromSurfaceRef }
                        : semantic.from, { relationCarrier: true }),
                    right: toRecipeEndpointFromSemantic(spec, surfaceIds, semantic.id, "assoc.right", toSurfaceRef.kind === "invoke"
                        ? { slot: "base", surface: toSurfaceRef }
                        : semantic.to, { relationCarrier: true }),
                },
                emit: semantic.emit,
                trigger: toRecipeTriggerFromDispatch(spec, surfaceIds, semantic.id, semantic.dispatch),
            },
        );
        return;
    }
    expandDirectBridgeRecipe(
        spec,
        surfaceIds,
        ports,
        transfers,
        triggers,
        seenPortIds,
        seenTransferIds,
        seenTriggerIds,
        {
            id: semantic.id,
            kind: "direct_bridge",
            from,
            to,
            emit: semantic.emit,
            trigger: toRecipeTriggerFromDispatch(spec, surfaceIds, semantic.id, semantic.dispatch),
        },
    );
}

function expandStateSemantic(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    ports: ModulePort[],
    cells: ModuleCell[],
    transfers: ModuleTransfer[],
    triggers: ModuleTrigger[],
    seenPortIds: Set<string>,
    seenCellIds: Set<string>,
    seenTransferIds: Set<string>,
    seenTriggerIds: Set<string>,
    semantic: ModuleStateSemantic,
): void {
    let cellId: string;
    switch (semantic.cell.kind) {
        case "keyed_state":
            cellId = addRecipeCell(spec, surfaceIds, ports, cells, seenPortIds, seenCellIds, semantic.id, {
                id: `${semantic.id}.cell`,
                kind: "keyed_state_cell",
                label: semantic.cell.label,
            });
            break;
        case "channel":
            cellId = addRecipeCell(spec, surfaceIds, ports, cells, seenPortIds, seenCellIds, semantic.id, {
                id: `${semantic.id}.cell`,
                kind: "channel_cell",
                label: semantic.cell.label,
            });
            break;
        case "field":
            cellId = addRecipeCell(spec, surfaceIds, ports, cells, seenPortIds, seenCellIds, semantic.id, {
                id: `${semantic.id}.cell`,
                kind: "carrier_field_cell",
                carrier: toRecipeEndpointFromSemantic(spec, surfaceIds, semantic.id, "cell.carrier", semantic.cell.carrier, { stateCarrier: true }),
                fieldPath: [...semantic.cell.fieldPath],
            });
            break;
    }

    for (let i = 0; i < semantic.writes.length; i++) {
        const write = semantic.writes[i];
        const from = toRecipeEndpointFromSemantic(spec, surfaceIds, semantic.id, `write${i}.from`, write.from, { emit: write.emit });
        const fromPort = addRecipeEndpointPort(spec, surfaceIds, ports, seenPortIds, semantic.id, `write${i}.from`, from);
        const transfer: ModulePortToCellTransfer = {
            id: `${semantic.id}.write.${i}`,
            kind: "port_to_cell",
            fromPort,
            toCell: cellId,
            fromFieldPath: Array.isArray(write.from.fieldPath) ? [...write.from.fieldPath] : undefined,
            ...buildRecipeTransferBase(semantic.id, write.emit),
        };
        applyRecipeAddress(
            spec,
            surfaceIds,
            ports,
            seenPortIds,
            semantic.id,
            `write${i}.address`,
            transfer,
            toRecipeAddressFromSemantic(spec, surfaceIds, semantic.id, `write${i}.address`, write.address),
        );
        pushUniqueById(transfers, seenTransferIds, transfer, "transfer", spec.id);
    }

    for (let i = 0; i < semantic.reads.length; i++) {
        const read = semantic.reads[i];
        const to = toRecipeEndpointFromSemantic(spec, surfaceIds, semantic.id, `read${i}.to`, read.to, { emit: read.emit });
        const toPort = addRecipeEndpointPort(spec, surfaceIds, ports, seenPortIds, semantic.id, `read${i}.to`, to);
        const transfer: ModuleCellToPortTransfer = {
            id: `${semantic.id}.read.${i}`,
            kind: "cell_to_port",
            fromCell: cellId,
            toPort,
            toFieldPath: cloneFieldPathSpec(read.to.fieldPath),
            ...buildRecipeTransferBase(semantic.id, read.emit),
        };
        applyRecipeAddress(
            spec,
            surfaceIds,
            ports,
            seenPortIds,
            semantic.id,
            `read${i}.address`,
            transfer,
            toRecipeAddressFromSemantic(spec, surfaceIds, semantic.id, `read${i}.address`, read.address),
        );
        pushUniqueById(transfers, seenTransferIds, transfer, "transfer", spec.id);
        addRecipeCallbackTrigger(
            spec,
            surfaceIds,
            ports,
            triggers,
            seenPortIds,
            seenTriggerIds,
            semantic.id,
            toRecipeTriggerFromDispatch(spec, surfaceIds, semantic.id, read.dispatch),
            toPort,
        );
    }
}

function expandDeclarativeBindingSemantic(
    spec: ModuleSpec,
    surfaceIds: Set<string>,
    triggers: ModuleTrigger[],
    seenTriggerIds: Set<string>,
    semantic: ModuleDeclarativeBindingSemantic,
): void {
    expandDeclarativeRecipe(
        spec,
        surfaceIds,
        triggers,
        seenTriggerIds,
        {
            id: semantic.id,
            kind: "declarative_dispatch",
            sourceSurface: ensureSemanticSurface(spec, surfaceIds, semantic.id, "source", semantic.source),
            handlerSurface: ensureSemanticSurface(spec, surfaceIds, semantic.id, "handler", semantic.handler),
            anchor: semantic.anchor,
            triggerLabel: semantic.triggerLabel,
            preset: semantic.dispatch?.preset || "declarative_field",
            reason: semantic.dispatch?.reason || semantic.id,
        },
    );
}

function materializeModuleSpec(spec: PublicModuleSpec): ModuleSpec {
    const materialized: ModuleSpec = {
        id: spec.id,
        description: spec.description || spec.id,
        enabled: spec.enabled,
        semantics: [...((spec.semantics || []) as Array<ModuleSemantic & { id: string }>)],
        surfaces: [],
        ports: [],
        cells: [],
        associations: [],
        transfers: [],
        triggers: [],
    };

    const surfaceIds = new Set<string>();
    const seenPortIds = new Set<string>();
    const seenCellIds = new Set<string>();
    const seenAssociationIds = new Set<string>();
    const seenTransferIds = new Set<string>();
    const seenTriggerIds = new Set<string>();

    for (const semantic of materialized.semantics || []) {
        invariant(!!semantic && typeof semantic.id === "string" && semantic.id.trim().length > 0, `semantic id must be non-empty in module spec ${spec.id}`);
        switch (semantic.kind) {
            case "bridge":
                expandBridgeSemantic(
                    materialized,
                    surfaceIds,
                    materialized.ports!,
                    materialized.cells!,
                    materialized.associations!,
                    materialized.transfers!,
                    materialized.triggers!,
                    seenPortIds,
                    seenCellIds,
                    seenAssociationIds,
                    seenTransferIds,
                    seenTriggerIds,
                    semantic,
                );
                break;
            case "state":
                expandStateSemantic(
                    materialized,
                    surfaceIds,
                    materialized.ports!,
                    materialized.cells!,
                    materialized.transfers!,
                    materialized.triggers!,
                    seenPortIds,
                    seenCellIds,
                    seenTransferIds,
                    seenTriggerIds,
                    semantic,
                );
                break;
            case "declarative_binding":
                expandDeclarativeBindingSemantic(
                    materialized,
                    surfaceIds,
                    materialized.triggers!,
                    seenTriggerIds,
                    semantic,
                );
                break;
            case "container":
            case "ability_handoff":
            case "keyed_storage":
            case "event_emitter":
            case "route_bridge":
            case "state_binding":
                break;
            default:
                invariant(false, `unsupported semantic kind ${(semantic as ModuleSemantic).kind} in module spec ${spec.id}`);
        }
    }
    return materialized;
}

function normalizeModuleSpec(spec: PublicModuleSpec): ModuleSpec {
    validateModuleSpecOrThrow(spec);
    return materializeModuleSpec(canonicalizeModuleSpec(spec));
}

function lowerNormalizedModuleSpec(spec: ModuleSpec): LoweredModuleSpec[] {
    invariant(typeof spec.id === "string" && spec.id.trim().length > 0, "module spec id must be a non-empty string");
    invariant(typeof spec.description === "string", `module spec ${spec.id} description must be a string`);

    const index = buildModuleSpecIndex(spec);
    const lowered: LoweredModuleSpec[] = [];
    const addressedWrites = new Map<string, AddressedWriteCandidate[]>();
    const addressedReads = new Map<string, AddressedReadCandidate[]>();
    const fieldGroups = new Map<string, FieldTargetGroup>();

    for (const trigger of index.declarativeTriggers) {
        lowered.push(lowerDeclarativeTrigger(spec, index, trigger));
    }

    for (const transfer of spec.transfers || []) {
        invariant(!!transfer && typeof transfer.id === "string" && transfer.id.trim().length > 0, `transfer id must be a non-empty string in module spec ${spec.id}`);
        switch (transfer.kind) {
            case "port_to_port":
                lowered.push(lowerPortToPortTransfer(spec, index, transfer));
                break;
            case "port_to_cell": {
                const fromPort = requirePort(index, spec, transfer.fromPort);
                invariant(
                    isInvokeValuePort(fromPort)
                    || isDecoratedFieldValuePort(fromPort)
                    || fromPort.kind === "method_this"
                    || fromPort.kind === "method_param",
                    `module spec ${spec.id} transfer '${transfer.id}' source port must be invoke_arg/base/result/method_this/method_param/decorated_field_value`,
                );
                const cell = requireCell(index, spec, transfer.toCell);
                if (isAddressedCell(cell)) {
                    invariant(
                        isInvokeValuePort(fromPort) || isDecoratedFieldValuePort(fromPort),
                        `module spec ${spec.id} transfer '${transfer.id}' addressed write requires invoke_arg/base/result/decorated_field_value source`,
                    );
                    const address = resolveAddressSpec(spec, index, transfer);
                    const association = resolveSameCarrierAssociation(index, spec, transfer.association);
                    const list = addressedWrites.get(cell.id) || [];
                    list.push({ cell, fromPort, address, association, transfer });
                    addressedWrites.set(cell.id, list);
                    break;
                }
                invariant(isCarrierFieldCell(cell), `module spec ${spec.id} transfer '${transfer.id}' targets unsupported cell kind ${(cell as any)?.kind}`);
                const carrierPort = requirePort(index, spec, cell.carrierPort);
                if (isInvokeValuePort(fromPort)) {
                    invariant(
                        isInvokeValuePort(carrierPort),
                        `module spec ${spec.id} transfer '${transfer.id}' invoke-based field write requires invoke_arg/base/result carrierPort`,
                    );
                    lowered.push(lowerFieldWriteTransfer(spec, index, transfer, fromPort, cell));
                    break;
                }
                invariant(
                    (fromPort.kind === "method_this" || fromPort.kind === "method_param")
                    && (carrierPort.kind === "method_this" || carrierPort.kind === "method_param"),
                    `module spec ${spec.id} transfer '${transfer.id}' non-addressed write only supports invoke->field or same-method method_port->field`,
                );
                lowered.push(lowerMethodFieldWriteTransfer(spec, index, transfer, fromPort, cell, carrierPort));
                break;
            }
            case "cell_to_port": {
                const cell = requireCell(index, spec, transfer.fromCell);
                const toPort = requirePort(index, spec, transfer.toPort);
                if (isAddressedCell(cell)) {
                    const address = resolveAddressSpec(spec, index, transfer);
                    const association = resolveSameCarrierAssociation(index, spec, transfer.association);
                    const list = addressedReads.get(cell.id) || [];
                    list.push({ cell, toPort, address, association, transfer });
                    addressedReads.set(cell.id, list);
                    break;
                }
                invariant(isCarrierFieldCell(cell), `module spec ${spec.id} transfer '${transfer.id}' source cell kind ${(cell as any)?.kind} cannot lower to modules`);
                invariant(
                    toPort.kind === "field_load"
                    || toPort.kind === "method_param"
                    || toPort.kind === "callback_param"
                    || isInvokeValuePort(toPort),
                    `module spec ${spec.id} transfer '${transfer.id}' from field cell '${cell.id}' cannot lower to target port kind ${(toPort as any)?.kind}`,
                );
                const emit = buildFieldBridgeEmitSpec(spec, transfer, "field_bridge");
                const groupKey = `${cell.id}|${emit.boundary}|${emit.fieldReason}|${emit.loadReason}|${emit.allowUnreachableTarget ? "1" : "0"}`;
                const group = fieldGroups.get(groupKey) || {
                    sourceCellId: cell.id,
                    emit,
                    writes: [],
                    loads: [],
                };
                group.loads.push({ targetPort: toPort, transfer });
                fieldGroups.set(groupKey, group);
                break;
            }
            case "cell_to_cell": {
                const fromCell = requireCell(index, spec, transfer.fromCell);
                const toCell = requireCell(index, spec, transfer.toCell);
                invariant(isCarrierFieldCell(fromCell) && isCarrierFieldCell(toCell), `module spec ${spec.id} transfer '${transfer.id}' currently only supports carrier_field_cell -> carrier_field_cell`);
                const emit = buildFieldBridgeEmitSpec(spec, transfer, "field_bridge");
                const groupKey = `${fromCell.id}|${emit.boundary}|${emit.fieldReason}|${emit.loadReason}|${emit.allowUnreachableTarget ? "1" : "0"}`;
                const group = fieldGroups.get(groupKey) || {
                    sourceCellId: fromCell.id,
                    emit,
                    writes: [],
                    loads: [],
                };
                group.writes.push({ targetCell: toCell, transfer });
                fieldGroups.set(groupKey, group);
                break;
            }
            default:
                invariant(false, `unsupported transfer kind ${(transfer as any)?.kind} in module spec ${spec.id}`);
        }
    }

    const addressedCellIds = new Set<string>([
        ...addressedWrites.keys(),
        ...addressedReads.keys(),
    ]);
    for (const cellId of addressedCellIds) {
        const cell = requireCell(index, spec, cellId);
        invariant(isAddressedCell(cell), `module spec ${spec.id} addressed lowering encountered non-addressed cell '${cellId}'`);
        lowered.push(...lowerAddressedBridge(
            spec,
            index,
            cell,
            addressedWrites.get(cellId) || [],
            addressedReads.get(cellId) || [],
        ));
    }

    for (const group of fieldGroups.values()) {
        const sourceCell = requireCell(index, spec, group.sourceCellId);
        invariant(isCarrierFieldCell(sourceCell), `module spec ${spec.id} field lowering encountered non-field cell '${group.sourceCellId}'`);
        const loweredField = lowerFieldBridge(spec, index, sourceCell, group);
        if (loweredField) {
            lowered.push(loweredField);
        }
    }

    invariant(lowered.length > 0, `module spec ${spec.id} lowered to zero runtime modules`);
    return lowered;
}

function hasStructuralModuleContent(spec: ModuleSpec): boolean {
    return (spec.transfers?.length || 0) > 0 || (spec.triggers?.length || 0) > 0;
}

function compileLoweredModule(spec: LoweredModuleSpec): TaintModule {
    switch (spec.type) {
        case "keyed_bridge":
            return compileKeyedBridgeModule(spec);
        case "carrier_bridge":
            return compileCarrierBridgeModule(spec);
        case "direct_node_bridge":
            return compileDirectNodeBridgeModule(spec);
        case "scoped_addressed_bridge":
            return compileScopedAddressedBridgeModule(spec);
        case "semantic_addressed_bridge":
            return compileSemanticAddressedBridgeModule(spec);
        case "cross_method_param_bridge":
            return compileCrossMethodParamBridgeModule(spec);
        case "direct_callback_bridge":
            return compileDirectCallbackBridgeModule(spec);
        case "field_bridge":
            return compileFieldBridgeModule(spec);
        case "invoke_emit":
            return compileInvokeEmitModule(spec);
        case "paired_node_field_write":
            return compilePairedNodeFieldWriteModule(spec);
        case "method_field_write":
            return compileMethodFieldWriteModule(spec);
        case "declarative_binding":
            return compileDeclarativeBindingModule(spec);
    }
}

export function compileModuleSpec(spec: PublicModuleSpec): TaintModule[] {
    const normalized = normalizeModuleSpec(spec);
    const out: TaintModule[] = [];
    for (const semantic of normalized.semantics || []) {
        const runtimeSemantic = compileRuntimeSemanticModule(normalized, semantic);
        if (runtimeSemantic) {
            out.push(runtimeSemantic);
        }
    }
    if (hasStructuralModuleContent(normalized)) {
        out.push(...lowerNormalizedModuleSpec(normalized).map(item => compileLoweredModule(item)));
    }
    invariant(out.length > 0, `module spec ${spec.id} compiled to zero runtime modules`);
    return out;
}

export function compileModuleSpecs(specs: PublicModuleSpec[] | undefined): TaintModule[] {
    if (!specs || specs.length === 0) {
        return [];
    }
    return specs
        .filter((spec): spec is PublicModuleSpec => !!spec && spec.enabled !== false)
        .flatMap(spec => compileModuleSpec(spec));
}
