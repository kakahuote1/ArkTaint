import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { CALLBACK_METHOD_NAME } from "../../../../arkanalyzer/out/src/utils/entryMethodUtils";
import { isSdkBackedMethodSignature } from "../queries/SdkProvenance";
import {
    CallbackRegistrationMatchArgs,
    CallbackRegistrationMatchBase,
    ResolvedCallbackRegistration,
    resolveCallbackMethodsFromValueWithReturns,
} from "../queries/CallbackBindingQuery";

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
    | "official_catalog"
    | "controller_options"
    | "keyed_dispatch";

export interface CallbackRegistrationMatch extends CallbackRegistrationMatchBase {
    callbackFlavor?: CallbackRegistrationFlavor;
    registrationShape?: CallbackRegistrationShape;
    slotFamily?: CallbackRegistrationSlotFamily;
    recognitionLayer?: CallbackRegistrationRecognitionLayer;
}

export type FrameworkResolvedCallbackRegistration = ResolvedCallbackRegistration<CallbackRegistrationMatch>;

const DEFAULT_MAX_CALLBACK_HELPER_DEPTH = 4;
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
const GESTURE_CALLBACK_METHOD_NAMES = new Set([
    "onAction",
    "onActionStart",
    "onActionUpdate",
    "onActionEnd",
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
const STRING_PLUS_SUBSCRIPTION_METHOD_NAMES = new Set([
    "loadContent",
    "on",
]);
const TRAILING_CALLBACK_METHOD_NAMES = new Set([
    "subscribe",
    "request",
]);
const PREFERENCES_CALLBACK_METHOD_NAMES = new Set([
    "get",
    "put",
]);
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
const KNOWN_COLLECTION_CLASS_NAMES = new Set([
    "Array", "Map", "Set", "WeakMap", "WeakSet",
    "Int8Array", "Uint8Array", "Int16Array", "Uint16Array",
    "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
    "BigInt64Array", "BigUint64Array",
]);

export function resolveKnownFrameworkCallbackRegistration(
    args: CallbackRegistrationMatchArgs,
): CallbackRegistrationMatch | null {
    if (isPromiseContinuationRegistration(args.invokeExpr)) {
        return null;
    }
    if (isKnownSynchronousHigherOrderFunction(args.invokeExpr)) {
        return null;
    }
    const callbackArgIndexes = inferCallableArgIndexes(args.scene, args.explicitArgs || []);
    if (callbackArgIndexes.length === 0) {
        return null;
    }
    return resolveSdkProvenanceFrameworkCallbackRegistration(args, callbackArgIndexes);
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
            recognitionLayer: "official_catalog",
        };
    }
    return {
        callbackArgIndexes: [0],
        reason: `Scheduler callback registration ${methodName} from ${args.sourceMethod.getName()}`,
        callbackFlavor: "channel",
        registrationShape: "direct_callback_slot",
        slotFamily: "scheduler_slot",
        recognitionLayer: "official_catalog",
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
            recognitionLayer: "official_catalog",
        };
    }
    if (methodName === "onMessage" && className === "Worker") {
        return {
            callbackArgIndexes: [0],
            reason: `Channel callback registration ${describeRegistrationOwner(methodSig)}.${methodName} from ${args.sourceMethod.getName()}`,
            callbackFlavor: "channel",
            registrationShape: "direct_callback_slot",
            slotFamily: "system_direct_slot",
            recognitionLayer: "official_catalog",
        };
    }
    return null;
}

export function isKnownFrameworkCallbackMethodName(methodName: string): boolean {
    return KNOWN_FRAMEWORK_CALLBACK_METHOD_NAMES.has(methodName || "");
}

export function isKnownSchedulerMethodName(methodName: string): boolean {
    return KNOWN_SCHEDULER_METHOD_NAMES.has(methodName || "");
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
): CallbackRegistrationMatch | null {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    if (!isSdkBackedMethodSignature(args.scene, methodSig, { sourceMethod: args.sourceMethod, invokeExpr: args.invokeExpr })) {
        return null;
    }
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const slotFamily = inferFrameworkCallbackSlotFamily(methodName, args.explicitArgs || []);
    if (!slotFamily) {
        return null;
    }
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
