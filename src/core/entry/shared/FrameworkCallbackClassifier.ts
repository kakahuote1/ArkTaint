import { Scene } from "../../../../arkanalyzer/lib/Scene";
import { ArkMethod } from "../../../../arkanalyzer/lib/core/model/ArkMethod";
import { CALLBACK_METHOD_NAME } from "../../../../arkanalyzer/lib/utils/entryMethodUtils";
import { collectFiniteStringCandidatesFromValue } from "../../substrate/queries/FiniteStringCandidateResolver";
import {
    isExternalImportRooted,
    isSdkBackedMethodSignature,
} from "../../substrate/queries/SdkProvenance";
import {
    collectParameterAssignStmts,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates,
} from "../../substrate/queries/CalleeResolver";
import {
    CallbackRegistrationMatchArgs,
    CallbackRegistrationMatchBase,
    ResolvedCallbackRegistration,
    resolveCallbackMethodsFromValueWithReturns,
    resolveCallbackRegistrationsFromStmt,
} from "../../substrate/queries/CallbackBindingQuery";

export interface FrameworkCallbackResolutionPolicy {
    enableSdkProvenance?: boolean;
    enableOpaqueExternalCallFallback?: boolean;
    enableOwnerQualifiedFallback?: boolean;
    enableEmptyOwnerFallback?: boolean;
    enableStructuralCallableFallback?: boolean;
    suppressCatalogSlotFamilyInference?: boolean;
}

export type CallbackRegistrationFlavor = "ui_event" | "channel";

export type CallbackRegistrationShape =
    | "direct_callback_slot"
    | "string_plus_callback_slot"
    | "trailing_callback_slot"
    | "options_object_slot"
    | "keyed_dispatch_slot";

export type CallbackRegistrationSlotFamily =
    | "ui_direct_slot"
    | "gesture_direct_slot"
    | "system_direct_slot"
    | "subscription_event_slot"
    | "completion_callback_slot"
    | "controller_option_slot"
    | "keyed_dispatch_slot"
    | "scheduler_slot";

export type CallbackRegistrationRecognitionLayer =
    | "sdk_provenance"
    | "opaque_external_call_fallback"
    | "owner_qualified_fallback"
    | "empty_owner_fallback"
    | "structural_callable_fallback"
    | "controller_options"
    | "keyed_dispatch";

export type StructuralCallbackEvidenceFamily =
    | "on_like_callback"
    | "builder_create_callback"
    | "scheduler_like_callback"
    | "action_completion_callback"
    | "helper_forwarded_callback";

export interface CallbackRegistrationMatch extends CallbackRegistrationMatchBase {
    callbackFlavor?: CallbackRegistrationFlavor;
    registrationShape?: CallbackRegistrationShape;
    slotFamily?: CallbackRegistrationSlotFamily;
    recognitionLayer?: CallbackRegistrationRecognitionLayer;
    structuralEvidenceFamily?: StructuralCallbackEvidenceFamily;
}

export type FrameworkResolvedCallbackRegistration = ResolvedCallbackRegistration<CallbackRegistrationMatch>;

export type KeyedCallbackDispatchRegistration = FrameworkResolvedCallbackRegistration & {
    familyId: string;
    dispatchKeys: string[];
};

interface ControllerOptionCallbackSpec {
    ownerClassNames: Set<string>;
    constructorMethodNames: Set<string>;
    optionsArgIndex: number;
    callbackFieldNames: Set<string>;
    reasonLabel: string;
}

type FrameworkCallbackOwnerFamily =
    | "ui_component"
    | "gesture"
    | "system_direct"
    | "subscription_event"
    | "completion_callback";

interface FallbackSlotSpec {
    slotFamily: CallbackRegistrationSlotFamily;
    callbackFlavor: CallbackRegistrationFlavor;
    registrationShape: CallbackRegistrationShape;
    callbackArgIndexes: number[];
    methodNames: Set<string>;
    minArgs: number;
    requiredStringArgIndexes?: number[];
}

interface KeyedCallbackDispatchFamilySpec {
    familyId: string;
    ownerClassNames: Set<string>;
    registrationMethodNames: Set<string>;
    dispatchMethodNames: Set<string>;
    callbackArgIndex: number;
    keyArgIndex: number;
}

const DEFAULT_MAX_CALLBACK_HELPER_DEPTH = 4;
const UI_COMPONENT_CALLBACK_OWNER_NAMES = new Set([
    "Button",
    "UIInput",
    "TextInput",
    "Slider",
    "Toggle",
    "Search",
    "Tabs",
    "List",
    "Swiper",
]);
const UI_COMPONENT_CALLBACK_METHOD_NAMES = new Set([
    ...CALLBACK_METHOD_NAME,
    "onChange",
    "onInput",
    "onSubmit",
    "onChange2",
    "onTouch",
    "onAppear",
    "onHover",
    "onFocus",
    "onBlur",
    "onScroll",
    "onScrollIndex",
    "onReachStart",
    "onReachEnd",
    "onTabBarClick",
    "onAnimationStart",
    "onAnimationEnd",
]);
const GESTURE_CALLBACK_OWNER_NAMES = new Set([
    "TapGesture",
    "LongPressGesture",
    "PanGesture",
    "PinchGesture",
    "SwipeGesture",
]);
const GESTURE_CALLBACK_METHOD_NAMES = new Set([
    "onAction",
    "onActionStart",
    "onActionUpdate",
    "onActionEnd",
]);
const DIRECT_SYSTEM_CALLBACK_OWNER_NAMES = new Set([
    "WebView",
    "Worker",
]);
const DIRECT_SYSTEM_CALLBACK_METHOD_NAMES = new Set([
    "onMessage",
    "onError",
]);
const WEB_LIFECYCLE_CALLBACK_METHOD_NAMES = new Set([
    "onPageBegin",
    "onPageEnd",
    "onErrorReceive",
]);
const STRING_PLUS_SUBSCRIPTION_OWNER_NAMES = new Set([
    "WindowStage",
    "MediaQueryListener",
    "KVStore",
]);
const STRING_PLUS_SUBSCRIPTION_METHOD_NAMES = new Set([
    "loadContent",
    "on",
]);
const TRAILING_CALLBACK_OWNER_NAMES = new Set([
    "CommonEventSubscriber",
    "HttpRequest",
]);
const TRAILING_CALLBACK_METHOD_NAMES = new Set([
    "subscribe",
    "request",
]);
const PREFERENCES_CALLBACK_METHOD_NAMES = new Set([
    "get",
    "put",
]);
const DIRECT_UI_FALLBACK_SLOT_SPEC: FallbackSlotSpec = {
    slotFamily: "ui_direct_slot",
    callbackFlavor: "ui_event",
    registrationShape: "direct_callback_slot",
    callbackArgIndexes: [0],
    methodNames: UI_COMPONENT_CALLBACK_METHOD_NAMES,
    minArgs: 1,
};
const GESTURE_FALLBACK_SLOT_SPEC: FallbackSlotSpec = {
    slotFamily: "gesture_direct_slot",
    callbackFlavor: "ui_event",
    registrationShape: "direct_callback_slot",
    callbackArgIndexes: [0],
    methodNames: GESTURE_CALLBACK_METHOD_NAMES,
    minArgs: 1,
};
const SYSTEM_DIRECT_FALLBACK_SLOT_SPEC: FallbackSlotSpec = {
    slotFamily: "system_direct_slot",
    callbackFlavor: "channel",
    registrationShape: "direct_callback_slot",
    callbackArgIndexes: [0],
    methodNames: new Set([
        ...DIRECT_SYSTEM_CALLBACK_METHOD_NAMES,
        ...WEB_LIFECYCLE_CALLBACK_METHOD_NAMES,
    ]),
    minArgs: 1,
};
const SUBSCRIPTION_EVENT_FALLBACK_SLOT_SPEC: FallbackSlotSpec = {
    slotFamily: "subscription_event_slot",
    callbackFlavor: "channel",
    registrationShape: "string_plus_callback_slot",
    callbackArgIndexes: [1],
    methodNames: STRING_PLUS_SUBSCRIPTION_METHOD_NAMES,
    minArgs: 2,
    requiredStringArgIndexes: [0],
};
const COMPLETION_FALLBACK_SLOT_SPEC: FallbackSlotSpec = {
    slotFamily: "completion_callback_slot",
    callbackFlavor: "channel",
    registrationShape: "trailing_callback_slot",
    callbackArgIndexes: [1],
    methodNames: TRAILING_CALLBACK_METHOD_NAMES,
    minArgs: 2,
};
const PREFERENCES_COMPLETION_FALLBACK_SLOT_SPEC: FallbackSlotSpec = {
    slotFamily: "completion_callback_slot",
    callbackFlavor: "channel",
    registrationShape: "trailing_callback_slot",
    callbackArgIndexes: [2],
    methodNames: PREFERENCES_CALLBACK_METHOD_NAMES,
    minArgs: 3,
};
const OWNER_FAMILY_FALLBACK_SPECS = new Map<FrameworkCallbackOwnerFamily, FallbackSlotSpec[]>([
    ["ui_component", [DIRECT_UI_FALLBACK_SLOT_SPEC]],
    ["gesture", [GESTURE_FALLBACK_SLOT_SPEC]],
    ["system_direct", [SYSTEM_DIRECT_FALLBACK_SLOT_SPEC]],
    ["subscription_event", [SUBSCRIPTION_EVENT_FALLBACK_SLOT_SPEC]],
    ["completion_callback", [COMPLETION_FALLBACK_SLOT_SPEC, PREFERENCES_COMPLETION_FALLBACK_SLOT_SPEC]],
]);
const EMPTY_OWNER_FALLBACK_SPECS: FallbackSlotSpec[] = [
    DIRECT_UI_FALLBACK_SLOT_SPEC,
    GESTURE_FALLBACK_SLOT_SPEC,
    SUBSCRIPTION_EVENT_FALLBACK_SLOT_SPEC,
];
const CONTROLLER_OPTION_CALLBACK_SPECS: ControllerOptionCallbackSpec[] = [
    {
        ownerClassNames: new Set(["CustomDialogController"]),
        constructorMethodNames: new Set(["constructor"]),
        optionsArgIndex: 0,
        callbackFieldNames: new Set(["builder", "cancel", "confirm"]),
        reasonLabel: "Framework controller callback registration",
    },
];
const KNOWN_SCHEDULER_METHOD_NAMES = new Set([
    "setTimeout",
    "setInterval",
    "requestAnimationFrame",
    "queueMicrotask",
    "execute",
]);
const KNOWN_SCHEDULER_EXECUTOR_OWNER_NAMES = new Set([
    "TaskPool",
    "taskpool",
]);
const KNOWN_SYNC_HOF_METHOD_NAMES = new Set([
    "map",
    "filter",
    "sort",
    "reduce",
    "forEach",
    "find",
    "findIndex",
    "some",
    "every",
    "flatMap",
]);
const KNOWN_FRAMEWORK_CALLBACK_METHOD_NAMES = new Set([
    ...UI_COMPONENT_CALLBACK_METHOD_NAMES,
    ...GESTURE_CALLBACK_METHOD_NAMES,
    "onMessage",
    "onPageBegin",
    "onPageEnd",
    "onErrorReceive",
    "onError",
    "on",
    "request",
    "subscribe",
    "get",
    "put",
    "loadContent",
    "constructor",
]);
const KNOWN_KEYED_CALLBACK_DISPATCH_FAMILIES: KeyedCallbackDispatchFamilySpec[] = [
    {
        familyId: "nav_destination",
        ownerClassNames: new Set(["NavDestination"]),
        registrationMethodNames: new Set(["register", "setBuilder", "setDestinationBuilder"]),
        dispatchMethodNames: new Set(["trigger"]),
        callbackArgIndex: 1,
        keyArgIndex: 0,
    },
];
const DEFAULT_FRAMEWORK_CALLBACK_RESOLUTION_POLICY: Required<FrameworkCallbackResolutionPolicy> = {
    enableSdkProvenance: true,
    enableOpaqueExternalCallFallback: false,
    enableOwnerQualifiedFallback: true,
    enableEmptyOwnerFallback: true,
    enableStructuralCallableFallback: true,
    suppressCatalogSlotFamilyInference: false,
};
const KNOWN_COLLECTION_CLASS_NAMES = new Set([
    "Array", "Map", "Set", "WeakMap", "WeakSet",
    "Int8Array", "Uint8Array", "Int16Array", "Uint16Array",
    "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
    "BigInt64Array", "BigUint64Array",
]);

export function resolveKnownFrameworkCallbackRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    return resolveKnownFrameworkCallbackRegistrationWithPolicy(args);
}

export function resolveKnownFrameworkCallbackRegistrationWithPolicy(
    args: CallbackRegistrationMatchArgs,
    policy: FrameworkCallbackResolutionPolicy = DEFAULT_FRAMEWORK_CALLBACK_RESOLUTION_POLICY,
): CallbackRegistrationMatch | null {
    if (isPromiseContinuationRegistration(args.invokeExpr)) {
        return null;
    }
    if (isKnownSynchronousHigherOrderFunction(args.invokeExpr)) {
        return null;
    }
    const callbackArgIndexes = inferCallableArgIndexes(args.scene, args.explicitArgs || []);
    const effectivePolicy = normalizeFrameworkCallbackResolutionPolicy(policy);
    if (callbackArgIndexes.length === 0) {
        return null;
    }

    return (effectivePolicy.enableSdkProvenance
        ? resolveSdkProvenanceFrameworkCallbackRegistration(args, callbackArgIndexes, effectivePolicy)
        : null)
        || (effectivePolicy.enableOpaqueExternalCallFallback
            ? resolveOpaqueExternalCallFallback(args, callbackArgIndexes)
            : null)
        || (effectivePolicy.enableOwnerQualifiedFallback
            ? resolveOwnerQualifiedFrameworkCallbackFallback(args)
            : null)
        || (effectivePolicy.enableEmptyOwnerFallback
            ? resolveEmptyOwnerFrameworkCallbackFallback(args)
            : null)
        || (effectivePolicy.enableStructuralCallableFallback
            ? resolveStructuralCallableFallback(args, callbackArgIndexes)
            : null);
}

export function resolveKnownSchedulerCallbackRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.().getMethodName?.() || "";
    if (isPromiseContinuationRegistration(args.invokeExpr)) {
        return null;
    }
    if (!KNOWN_SCHEDULER_METHOD_NAMES.has(methodName)) {
        return null;
    }
    if (methodName === "execute") {
        const ownerName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
        if (!KNOWN_SCHEDULER_EXECUTOR_OWNER_NAMES.has(ownerName)) {
            return null;
        }
        return {
            callbackArgIndexes: [0],
            reason: `Scheduler callback registration ${ownerName}.${methodName} from ${args.sourceMethod.getName()}`,
            callbackFlavor: "channel",
            registrationShape: "direct_callback_slot",
            slotFamily: "scheduler_slot",
            recognitionLayer: "owner_qualified_fallback",
        };
    }
    return {
        callbackArgIndexes: [0],
        reason: `Scheduler callback registration ${methodName} from ${args.sourceMethod.getName()}`,
        callbackFlavor: "channel",
        registrationShape: "direct_callback_slot",
        slotFamily: "scheduler_slot",
        recognitionLayer: "owner_qualified_fallback",
    };
}

export function resolveKnownChannelCallbackRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    if (methodName === "on") {
        const explicitArgs = args.explicitArgs || [];
        if (explicitArgs.length < 2 || !looksLikeStringArg(explicitArgs[0])) {
            return null;
        }
        if (!(className === "Emitter" || className === "EventHub")) {
            return null;
        }
        return {
            callbackArgIndexes: [1],
            reason: `Channel callback registration ${describeRegistrationOwner(methodSig)}.${methodName} from ${args.sourceMethod.getName()}`,
            callbackFlavor: "channel",
            registrationShape: "string_plus_callback_slot",
            slotFamily: "subscription_event_slot",
            recognitionLayer: "owner_qualified_fallback",
        };
    }
    if (methodName === "onMessage" && className === "Worker") {
        return {
            callbackArgIndexes: [0],
            reason: `Channel callback registration ${describeRegistrationOwner(methodSig)}.${methodName} from ${args.sourceMethod.getName()}`,
            callbackFlavor: "channel",
            registrationShape: "direct_callback_slot",
            slotFamily: "system_direct_slot",
            recognitionLayer: "owner_qualified_fallback",
        };
    }
    return null;
}

export function resolveKnownControllerOptionCallbackRegistrationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: ArkMethod,
): FrameworkResolvedCallbackRegistration[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];

    const methodSig = invokeExpr.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const out = new Map<string, FrameworkResolvedCallbackRegistration>();

    for (const spec of CONTROLLER_OPTION_CALLBACK_SPECS) {
        if (!spec.ownerClassNames.has(className)) continue;
        if (!spec.constructorMethodNames.has(methodName)) continue;
        const optionsValue = explicitArgs[spec.optionsArgIndex];
        const optionClass = resolveClassFromValue(scene, optionsValue);
        if (!optionClass) continue;
        for (const field of optionClass.getFields()) {
            const fieldName = field.getName?.() || "";
            if (!spec.callbackFieldNames.has(fieldName)) continue;
            const callbackSig = field.getType?.()?.getMethodSignature?.();
            if (!callbackSig) continue;
            const callbackMethod = scene.getMethod(callbackSig);
            if (!callbackMethod?.getCfg?.()) continue;
            const callbackSignature = callbackMethod.getSignature?.()?.toString?.() || "";
            if (!callbackSignature) continue;
            const registrationSignature = methodSig?.toString?.() || "";
            const key = `${callbackSignature}|field:${fieldName}|call:${registrationSignature}`;
            if (out.has(key)) continue;
            out.set(key, {
                callbackMethod,
                sourceMethod,
                registrationMethod: sourceMethod,
                registrationInvokeExpr: invokeExpr,
                registrationMethodName: methodName,
                registrationOwnerName: className,
                registrationSignature,
                callbackArgIndex: spec.optionsArgIndex,
                reason: `${spec.reasonLabel} ${className}.${fieldName} from ${sourceMethod.getName()}`,
                callbackFlavor: "channel",
                registrationShape: "options_object_slot",
                slotFamily: "controller_option_slot",
                recognitionLayer: "controller_options",
            });
        }
    }

    return [...out.values()];
}

export function resolveKnownKeyedCallbackRegistrationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: ArkMethod,
): KeyedCallbackDispatchRegistration[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];
    const family = matchKnownKeyedCallbackDispatchFamily(invokeExpr, "registration");
    if (!family) return [];

    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const keyValue = explicitArgs[family.keyArgIndex];
    const dispatchKeys = keyValue
        ? collectFiniteStringCandidatesFromValue(scene, keyValue)
        : [];
    if (dispatchKeys.length === 0) return [];

    const registrations = resolveCallbackRegistrationsFromStmt(
        stmt,
        scene,
        sourceMethod,
        args => resolveKnownKeyedCallbackDispatchRegistration(args),
    );
    return registrations
        .filter(reg => reg.callbackArgIndex === family.callbackArgIndex)
        .map(reg => ({
            ...reg,
            familyId: family.familyId,
            dispatchKeys,
        }));
}

export function collectKnownKeyedDispatchKeysFromMethod(
    scene: Scene,
    method: ArkMethod,
): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    const cfg = method.getCfg?.();
    if (!cfg) return out;

    for (const stmt of cfg.getStmts()) {
        const invokeExpr = stmt?.getInvokeExpr?.();
        if (!invokeExpr) continue;
        const family = matchKnownKeyedCallbackDispatchFamily(invokeExpr, "dispatch");
        if (!family) continue;

        const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
        const keyValue = explicitArgs[family.keyArgIndex];
        if (!keyValue) continue;
        const keys = collectFiniteStringCandidatesFromValue(scene, keyValue);
        if (keys.length === 0) continue;

        if (!out.has(family.familyId)) {
            out.set(family.familyId, new Set<string>());
        }
        const familyKeys = out.get(family.familyId)!;
        for (const key of keys) {
            familyKeys.add(key);
        }
    }

    return out;
}

export function isKnownFrameworkCallbackMethodName(methodName: string): boolean {
    return KNOWN_FRAMEWORK_CALLBACK_METHOD_NAMES.has(methodName || "");
}

export function isKnownSchedulerMethodName(methodName: string): boolean {
    return KNOWN_SCHEDULER_METHOD_NAMES.has(methodName || "");
}

function resolveKnownKeyedCallbackDispatchRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    const family = matchKnownKeyedCallbackDispatchFamily(args.invokeExpr, "registration");
    if (!family) return null;
    return {
        callbackArgIndexes: [family.callbackArgIndex],
        reason: `Keyed callback registration ${describeRegistrationOwner(args.invokeExpr?.getMethodSignature?.())}.${args.invokeExpr?.getMethodSignature?.().getMethodSubSignature?.().getMethodName?.() || ""} from ${args.sourceMethod.getName()}`,
        callbackFlavor: "channel",
        registrationShape: "keyed_dispatch_slot",
        slotFamily: "keyed_dispatch_slot",
        recognitionLayer: "keyed_dispatch",
    };
}

function matchKnownKeyedCallbackDispatchFamily(
    invokeExpr: any,
    mode: "registration" | "dispatch",
): KeyedCallbackDispatchFamilySpec | undefined {
    const methodSig = invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    return KNOWN_KEYED_CALLBACK_DISPATCH_FAMILIES.find(family => {
        if (!family.ownerClassNames.has(className)) return false;
        return mode === "registration"
            ? family.registrationMethodNames.has(methodName)
            : family.dispatchMethodNames.has(methodName);
    });
}

function describeRegistrationOwner(methodSig: any): string {
    return methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "@channel";
}

function inferCallableArgIndexes(scene: Scene, explicitArgs: any[]): number[] {
    const callbackArgIndexes: number[] = [];
    explicitArgs.forEach((arg, index) => {
        const methods = resolveCallbackMethodsFromValueWithReturns(scene, arg, {
            maxDepth: DEFAULT_MAX_CALLBACK_HELPER_DEPTH,
        });
        if (methods.length > 0) {
            callbackArgIndexes.push(index);
        }
    });
    return callbackArgIndexes;
}

function inferRegistrationShape(
    explicitArgs: any[],
    callbackArgIndexes: number[],
): CallbackRegistrationShape | undefined {
    if (callbackArgIndexes.length === 0) {
        return undefined;
    }
    if (callbackArgIndexes.length > 1) {
        return "trailing_callback_slot";
    }

    const callbackIndex = callbackArgIndexes[0];
    if (callbackIndex === 0) {
        return "direct_callback_slot";
    }
    if (callbackIndex === 1 && explicitArgs.length >= 2 && looksLikeStringArg(explicitArgs[0])) {
        return "string_plus_callback_slot";
    }
    return "trailing_callback_slot";
}

function inferFrameworkCallbackSlotFamily(
    methodName: string,
    explicitArgs: any[],
): CallbackRegistrationSlotFamily | undefined {
    if (GESTURE_CALLBACK_METHOD_NAMES.has(methodName)) {
        return "gesture_direct_slot";
    }
    if (UI_COMPONENT_CALLBACK_METHOD_NAMES.has(methodName)) {
        return "ui_direct_slot";
    }
    if (DIRECT_SYSTEM_CALLBACK_METHOD_NAMES.has(methodName) || WEB_LIFECYCLE_CALLBACK_METHOD_NAMES.has(methodName)) {
        return "system_direct_slot";
    }
    if (
        STRING_PLUS_SUBSCRIPTION_METHOD_NAMES.has(methodName)
        && explicitArgs.length >= 2
        && looksLikeStringArg(explicitArgs[0])
    ) {
        return "subscription_event_slot";
    }
    if (TRAILING_CALLBACK_METHOD_NAMES.has(methodName) || PREFERENCES_CALLBACK_METHOD_NAMES.has(methodName)) {
        return "completion_callback_slot";
    }
    return undefined;
}

function resolveSdkProvenanceFrameworkCallbackRegistration(
    args: CallbackRegistrationMatchArgs,
    callbackArgIndexes: number[],
    policy: Required<FrameworkCallbackResolutionPolicy>,
): CallbackRegistrationMatch | null {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    if (!isSdkBackedMethodSignature(args.scene, methodSig, { sourceMethod: args.sourceMethod, invokeExpr: args.invokeExpr })) {
        return null;
    }
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const slotFamily = policy.suppressCatalogSlotFamilyInference
        ? undefined
        : inferFrameworkCallbackSlotFamily(methodName, args.explicitArgs || []);
    const callbackFlavor: CallbackRegistrationFlavor =
        slotFamily === "ui_direct_slot" || slotFamily === "gesture_direct_slot"
            ? "ui_event"
            : "channel";
    return {
        callbackArgIndexes,
        reason: `Framework SDK callback registration ${describeRegistrationOwner(methodSig)}.${methodName} from ${args.sourceMethod.getName()}`,
        callbackFlavor,
        registrationShape: inferRegistrationShape(args.explicitArgs || [], callbackArgIndexes),
        slotFamily,
        recognitionLayer: "sdk_provenance",
    };
}

function resolveOpaqueExternalCallFallback(
    args: CallbackRegistrationMatchArgs,
    callbackArgIndexes: number[],
): CallbackRegistrationMatch | null {
    if (callbackArgIndexes.length === 0) {
        return null;
    }
    if (!isExternalImportRooted(args.sourceMethod, args.invokeExpr)) {
        return null;
    }
    if (isCalleeResolvableWithBody(args)) {
        return null;
    }

    const methodSig = args.invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "<unknown>";
    const ownerName = describeRegistrationOwner(methodSig);
    return {
        callbackArgIndexes,
        reason: `Opaque external callback registration ${ownerName}.${methodName} from ${args.sourceMethod.getName()}`,
        callbackFlavor: "channel",
        registrationShape: inferRegistrationShape(args.explicitArgs || [], callbackArgIndexes),
        slotFamily: undefined,
        recognitionLayer: "opaque_external_call_fallback",
    };
}

function isCalleeResolvableWithBody(args: CallbackRegistrationMatchArgs): boolean {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    if (!methodSig) return false;
    const direct = args.scene.getMethod(methodSig);
    if (direct?.getCfg?.()) return true;
    const candidates = resolveCalleeCandidates(args.scene, args.invokeExpr, { maxNameMatchCandidates: 3 });
    return candidates.some(c => !!c.method?.getCfg?.());
}

function normalizeFrameworkCallbackResolutionPolicy(
    policy: FrameworkCallbackResolutionPolicy,
): Required<FrameworkCallbackResolutionPolicy> {
    return {
        enableSdkProvenance: policy.enableSdkProvenance ?? true,
        enableOpaqueExternalCallFallback: policy.enableOpaqueExternalCallFallback ?? false,
        enableOwnerQualifiedFallback: policy.enableOwnerQualifiedFallback ?? true,
        enableEmptyOwnerFallback: policy.enableEmptyOwnerFallback ?? true,
        enableStructuralCallableFallback: policy.enableStructuralCallableFallback ?? true,
        suppressCatalogSlotFamilyInference: policy.suppressCatalogSlotFamilyInference ?? false,
    };
}

function resolveStructuralCallableFallback(
    args: CallbackRegistrationMatchArgs,
    callbackArgIndexes: number[],
): CallbackRegistrationMatch | null {
    if (callbackArgIndexes.length === 0) {
        return null;
    }
    const structuralEvidenceFamily = resolveStructuralCallableEvidenceFamily(args, callbackArgIndexes);
    if (!structuralEvidenceFamily) {
        return null;
    }
    if (shouldDeferToProjectHelperFollowing(args.scene, args.sourceMethod, args.invokeExpr, args.explicitArgs || [], callbackArgIndexes)) {
        return null;
    }

    const methodSig = args.invokeExpr?.getMethodSignature?.();
    if (shouldExcludeProjectConstructorStructuralFallback(args.scene, methodSig)) {
        return null;
    }
    if (shouldExcludeProjectConstructorSourceFallback(args.scene, args.sourceMethod)) {
        return null;
    }
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "<unknown>";
    const ownerName = describeRegistrationOwner(methodSig);

    return {
        callbackArgIndexes,
        reason: `Structural callable fallback: ${ownerName}.${methodName} has callable arg(s) at index [${callbackArgIndexes.join(", ")}]`,
        callbackFlavor: "channel",
        registrationShape: inferRegistrationShape(args.explicitArgs || [], callbackArgIndexes),
        slotFamily: undefined,
        recognitionLayer: "structural_callable_fallback",
        structuralEvidenceFamily,
    };
}

function resolveStructuralCallableEvidenceFamily(
    args: CallbackRegistrationMatchArgs,
    callbackArgIndexes: number[],
): StructuralCallbackEvidenceFamily | undefined {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const sourceMethodName = args.sourceMethod?.getName?.() || "";
    const carrierMethod = args.carrierMethod || args.sourceMethod;
    if (/^on[A-Z]/.test(methodName)) {
        return "on_like_callback";
    }
    if (methodName === "create" && sourceMethodName === "build") {
        return "builder_create_callback";
    }
    if (KNOWN_SCHEDULER_METHOD_NAMES.has(methodName)) {
        return "scheduler_like_callback";
    }
    if (helperCarrierShowsFrameworkRegistrationEvidence(args.scene, carrierMethod, args.invokeExpr)) {
        return "helper_forwarded_callback";
    }
    if (hasVoidReturningTrailingCallbackEvidence(args.invokeExpr, callbackArgIndexes, args.explicitArgs || [])) {
        return "action_completion_callback";
    }
    return undefined;
}

function hasVoidReturningTrailingCallbackEvidence(
    invokeExpr: any,
    callbackArgIndexes: number[],
    explicitArgs: any[],
): boolean {
    if (callbackArgIndexes.length !== 1 || callbackArgIndexes[0] === 0) {
        return false;
    }
    if (explicitArgs.length === 0 || callbackArgIndexes[0] !== explicitArgs.length - 1) {
        return false;
    }
    const methodSig = invokeExpr?.getMethodSignature?.();
    const returnTypeText = String(methodSig?.getMethodSubSignature?.()?.getReturnType?.()?.toString?.() || "").toLowerCase();
    return returnTypeText === "void";
}

function helperCarrierShowsFrameworkRegistrationEvidence(
    scene: Scene,
    carrierMethod: ArkMethod | undefined,
    currentInvokeExpr: any,
): boolean {
    if (!carrierMethod?.getCfg?.()) {
        return false;
    }
    const carrierFileSig = carrierMethod
        .getSignature?.()
        ?.getDeclaringClassSignature?.()
        ?.getDeclaringFileSignature?.();
    if (carrierFileSig && scene.hasSdkFile(carrierFileSig)) {
        return false;
    }

    const cfg = carrierMethod.getCfg?.();
    if (!cfg) {
        return false;
    }
    for (const stmt of cfg.getStmts()) {
        const innerInvokeExpr = stmt?.getInvokeExpr?.();
        if (!innerInvokeExpr || innerInvokeExpr === currentInvokeExpr) {
            continue;
        }
        const explicitArgs = innerInvokeExpr.getArgs ? innerInvokeExpr.getArgs() : [];
        const structuralArgs = inferCallableArgIndexes(scene, explicitArgs);
        const matcherArgs: CallbackRegistrationMatchArgs = {
            invokeExpr: innerInvokeExpr,
            explicitArgs,
            scene,
            sourceMethod: carrierMethod,
            carrierMethod,
        };
        if (resolveKnownSchedulerCallbackRegistration(matcherArgs)) {
            return true;
        }
        if (resolveKnownChannelCallbackRegistration(matcherArgs)) {
            return true;
        }
        if (resolveOwnerQualifiedFrameworkCallbackFallback(matcherArgs)) {
            return true;
        }
        if (resolveEmptyOwnerFrameworkCallbackFallback(matcherArgs)) {
            return true;
        }
        if (resolveKnownKeyedCallbackDispatchRegistration(matcherArgs)) {
            return true;
        }
        if (
            structuralArgs.length > 0
            && resolveSdkProvenanceFrameworkCallbackRegistration(
                matcherArgs,
                structuralArgs,
                DEFAULT_FRAMEWORK_CALLBACK_RESOLUTION_POLICY,
            )
        ) {
            return true;
        }
    }
    return false;
}

function shouldExcludeProjectConstructorStructuralFallback(scene: Scene, methodSig: any): boolean {
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (methodName !== "constructor") {
        return false;
    }
    return !isSdkBackedMethodSignature(scene, methodSig);
}

function shouldExcludeProjectConstructorSourceFallback(scene: Scene, sourceMethod: ArkMethod): boolean {
    if (sourceMethod?.getName?.() !== "constructor") {
        return false;
    }
    const sourceFileSig = sourceMethod
        ?.getSignature?.()
        ?.getDeclaringClassSignature?.()
        ?.getDeclaringFileSignature?.();
    return !(sourceFileSig && scene.hasSdkFile(sourceFileSig));
}

function resolveOwnerQualifiedFrameworkCallbackFallback(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const explicitArgs = args.explicitArgs || [];
    const ownerFamily = resolveFallbackOwnerFamily(className);
    if (!ownerFamily) {
        return null;
    }
    const slotSpec = matchFallbackSlotSpec(
        methodName,
        explicitArgs,
        OWNER_FAMILY_FALLBACK_SPECS.get(ownerFamily) || [],
    );
    if (slotSpec) {
        return {
            callbackArgIndexes: slotSpec.callbackArgIndexes,
            reason: `Framework ${ownerFamily} callback registration ${className}.${methodName} from ${args.sourceMethod.getName()}`,
            callbackFlavor: slotSpec.callbackFlavor,
            registrationShape: slotSpec.registrationShape,
            slotFamily: slotSpec.slotFamily,
            recognitionLayer: "owner_qualified_fallback",
        };
    }

    return null;
}

function resolveEmptyOwnerFrameworkCallbackFallback(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const explicitArgs = args.explicitArgs || [];
    if (className !== "") {
        return null;
    }
    const slotSpec = matchFallbackSlotSpec(methodName, explicitArgs, EMPTY_OWNER_FALLBACK_SPECS);
    if (slotSpec) {
        return {
            callbackArgIndexes: slotSpec.callbackArgIndexes,
            reason: `Framework empty-owner callback fallback ${methodName} from ${args.sourceMethod.getName()}`,
            callbackFlavor: slotSpec.callbackFlavor,
            registrationShape: slotSpec.registrationShape,
            slotFamily: slotSpec.slotFamily,
            recognitionLayer: "empty_owner_fallback",
        };
    }

    return null;
}

function resolveFallbackOwnerFamily(className: string): FrameworkCallbackOwnerFamily | undefined {
    if (UI_COMPONENT_CALLBACK_OWNER_NAMES.has(className)) {
        return "ui_component";
    }
    if (GESTURE_CALLBACK_OWNER_NAMES.has(className)) {
        return "gesture";
    }
    if (DIRECT_SYSTEM_CALLBACK_OWNER_NAMES.has(className) || className === "Web") {
        return "system_direct";
    }
    if (STRING_PLUS_SUBSCRIPTION_OWNER_NAMES.has(className)) {
        return "subscription_event";
    }
    if (TRAILING_CALLBACK_OWNER_NAMES.has(className) || className === "Preferences") {
        return "completion_callback";
    }
    return undefined;
}

function matchFallbackSlotSpec(
    methodName: string,
    explicitArgs: any[],
    slotSpecs: FallbackSlotSpec[],
): FallbackSlotSpec | undefined {
    return slotSpecs.find(spec => {
        if (!spec.methodNames.has(methodName)) {
            return false;
        }
        if (explicitArgs.length < spec.minArgs) {
            return false;
        }
        return (spec.requiredStringArgIndexes || []).every(index => looksLikeStringArg(explicitArgs[index]));
    });
}

function resolveClassFromValue(scene: Scene, value: any): any | null {
    const classSignature = value?.getType?.()?.getClassSignature?.();
    if (!classSignature) return null;
    return scene.getClass(classSignature) || null;
}

function looksLikeStringArg(value: any): boolean {
    if (!value) return false;
    const typeText = String(value.getType?.()?.toString?.() || "").toLowerCase().trim();
    if (/^string(\s*\||$)/.test(typeText)) {
        return true;
    }
    const text = String(value.toString?.() || "").trim();
    return /^['"`].+['"`]$/.test(text);
}

function isPromiseContinuationRegistration(invokeExpr: any): boolean {
    const methodSig = invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    return methodName === "then" || methodName === "catch" || methodName === "finally";
}

function isKnownSynchronousHigherOrderFunction(invokeExpr: any): boolean {
    const methodSig = invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (!KNOWN_SYNC_HOF_METHOD_NAMES.has(methodName)) {
        return false;
    }
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    if (!className || KNOWN_COLLECTION_CLASS_NAMES.has(className)) {
        return true;
    }
    return false;
}

function shouldDeferToProjectHelperFollowing(
    scene: Scene,
    sourceMethod: ArkMethod,
    invokeExpr: any,
    explicitArgs: any[],
    callbackArgIndexes: number[],
): boolean {
    const methodSig = invokeExpr?.getMethodSignature?.();
    if (isSdkBackedMethodSignature(scene, methodSig, { sourceMethod, invokeExpr })) {
        return false;
    }

    const callees = resolveCalleeCandidates(scene, invokeExpr, { maxNameMatchCandidates: 8 });
    return callees.some(candidate => {
        const helperMethod = candidate?.method as ArkMethod | undefined;
        if (!helperMethod?.getCfg?.()) {
            return false;
        }
        const helperFileSig = helperMethod
            .getSignature?.()
            ?.getDeclaringClassSignature?.()
            ?.getDeclaringFileSignature?.();
        if (helperFileSig && scene.hasSdkFile(helperFileSig)) {
            return false;
        }
        return helperTouchesBoundCallback(helperMethod, invokeExpr, explicitArgs, callbackArgIndexes);
    });
}

function helperTouchesBoundCallback(
    helperMethod: ArkMethod,
    invokeExpr: any,
    explicitArgs: any[],
    callbackArgIndexes: number[],
): boolean {
    const boundCallbackLocals = collectBoundCallbackLocalNames(
        helperMethod,
        invokeExpr,
        explicitArgs,
        callbackArgIndexes,
    );
    if (boundCallbackLocals.size === 0) {
        return false;
    }

    const cfg = helperMethod.getCfg?.();
    if (!cfg) {
        return false;
    }
    for (const stmt of cfg.getStmts()) {
        const innerInvokeExpr = stmt?.getInvokeExpr?.();
        if (!innerInvokeExpr) continue;
        if (invokeTouchesBoundCallback(innerInvokeExpr, boundCallbackLocals)) {
            return true;
        }
    }
    return false;
}

function collectBoundCallbackLocalNames(
    helperMethod: ArkMethod,
    invokeExpr: any,
    explicitArgs: any[],
    callbackArgIndexes: number[],
): Set<string> {
    const out = new Set<string>();
    const paramStmts = collectParameterAssignStmts(helperMethod);
    const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs || [], paramStmts);
    for (const pair of pairs) {
        if (!callbackArgIndexes.includes(pair.argIndex)) {
            continue;
        }
        const leftOp: any = pair.paramStmt?.getLeftOp?.();
        const localName = typeof leftOp?.getName === "function" ? leftOp.getName() : undefined;
        if (localName) {
            out.add(localName);
        }
    }
    return out;
}

function invokeTouchesBoundCallback(invokeExpr: any, boundCallbackLocals: Set<string>): boolean {
    if (valueTouchesBoundCallback(invokeExpr?.getBase?.(), boundCallbackLocals, 0)) {
        return true;
    }
    if (valueTouchesBoundCallback(invokeExpr?.getFuncPtrLocal?.(), boundCallbackLocals, 0)) {
        return true;
    }
    const explicitArgs = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    return explicitArgs.some((arg: any) => valueTouchesBoundCallback(arg, boundCallbackLocals, 0));
}

function valueTouchesBoundCallback(
    value: any,
    boundCallbackLocals: Set<string>,
    depth: number,
): boolean {
    if (!value || depth >= 4) {
        return false;
    }
    const localName = typeof value?.getName === "function" ? value.getName() : undefined;
    if (localName && boundCallbackLocals.has(localName)) {
        return true;
    }

    const declaringStmt = value?.getDeclaringStmt?.();
    const rightOp = declaringStmt?.getRightOp?.();
    if (rightOp && valueTouchesBoundCallback(rightOp, boundCallbackLocals, depth + 1)) {
        return true;
    }

    return false;
}
