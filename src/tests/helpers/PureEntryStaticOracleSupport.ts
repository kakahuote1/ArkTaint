import { Scene } from "../../../arkanalyzer/lib/Scene";
import { ArkAssignStmt, ArkReturnStmt } from "../../../arkanalyzer/lib/core/base/Stmt";
import { ArkArrayRef, ArkParameterRef } from "../../../arkanalyzer/lib/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/lib/core/base/Expr";
import { Local } from "../../../arkanalyzer/lib/core/base/Local";
import { ArkMethod } from "../../../arkanalyzer/lib/core/model/ArkMethod";

export interface PureEntryCallbackRegistrationMatchArgs {
    invokeExpr: any;
    explicitArgs: any[];
    scene: Scene;
    sourceMethod: ArkMethod;
}

export interface PureEntryCallbackRegistrationMatch {
    callbackArgIndexes: number[];
    reason?: string;
}

export type PureEntryCallbackRegistrationMatcher =
    (args: PureEntryCallbackRegistrationMatchArgs) => PureEntryCallbackRegistrationMatch | null;

export interface PureEntryResolvedCallbackRegistration {
    callbackMethod: ArkMethod;
    sourceMethod: ArkMethod;
    registrationMethod: ArkMethod;
    registrationInvokeExpr: any;
    registrationMethodName: string;
    registrationOwnerName: string;
    registrationSignature: string;
    callbackArgIndex: number;
    reason: string;
}

export interface PureEntryKeyedCallbackDispatchRegistration extends PureEntryResolvedCallbackRegistration {
    familyId: string;
    dispatchKeys: string[];
}

interface PureEntryResolvedCallee {
    method: ArkMethod;
}

interface PureEntryKeyedCallbackDispatchFamilySpec {
    familyId: string;
    ownerClassNames: Set<string>;
    registrationMethodNames: Set<string>;
    dispatchMethodNames: Set<string>;
    callbackArgIndex: number;
    keyArgIndex: number;
}

interface DirectCallExpansionOptions {
    includeKeyedDispatchCallbacks?: boolean;
    allowedDeclaringClassNames?: Set<string>;
}

interface PureEntryExactFrameworkCallbackSpec {
    ownerClassNames: Set<string>;
    methodNames: Set<string>;
    callbackArgIndexes: number[];
    reasonLabel: string;
    minArgs?: number;
    requiredStringArgIndexes?: number[];
}

interface PureEntryControllerOptionCallbackSpec {
    ownerClassNames: Set<string>;
    constructorMethodNames: Set<string>;
    optionsArgIndex: number;
    callbackFieldNames: Set<string>;
    reasonLabel: string;
}

const DEFAULT_MAX_CALLBACK_HELPER_DEPTH = 4;
const DEFAULT_MAX_NAME_MATCH_CANDIDATES = 8;
const DEFAULT_MAX_BACKTRACE_STEPS = 5;
const DEFAULT_MAX_VISITED_DEFS = 16;

const UI_COMPONENT_CALLBACK_OWNER_NAMES = new Set([
    "",
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
    "onChange",
    "onInput",
    "onSubmit",
    "onChange2",
    "onClick",
    "onTouch",
    "onAppear",
    "onHover",
    "onFocus",
    "onBlur",
    "onChange",
    "onInput",
    "onSubmit",
    "onChange2",
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
const FRAMEWORK_CALLBACK_SPECS: PureEntryExactFrameworkCallbackSpec[] = [
    {
        ownerClassNames: UI_COMPONENT_CALLBACK_OWNER_NAMES,
        methodNames: UI_COMPONENT_CALLBACK_METHOD_NAMES,
        callbackArgIndexes: [0],
        reasonLabel: "Pure-entry framework UI callback",
    },
    {
        ownerClassNames: GESTURE_CALLBACK_OWNER_NAMES,
        methodNames: GESTURE_CALLBACK_METHOD_NAMES,
        callbackArgIndexes: [0],
        reasonLabel: "Pure-entry framework gesture callback",
    },
    {
        ownerClassNames: new Set(["WindowStage"]),
        methodNames: new Set(["loadContent"]),
        callbackArgIndexes: [1],
        minArgs: 2,
        reasonLabel: "Pure-entry framework system callback",
    },
    {
        ownerClassNames: new Set(["WebView"]),
        methodNames: new Set(["onMessage"]),
        callbackArgIndexes: [0],
        reasonLabel: "Pure-entry framework system callback",
    },
    {
        ownerClassNames: new Set(["Web"]),
        methodNames: new Set(["onPageBegin", "onPageEnd", "onErrorReceive"]),
        callbackArgIndexes: [0],
        reasonLabel: "Pure-entry framework system callback",
    },
    {
        ownerClassNames: new Set(["MediaQueryListener"]),
        methodNames: new Set(["on"]),
        callbackArgIndexes: [1],
        minArgs: 2,
        requiredStringArgIndexes: [0],
        reasonLabel: "Pure-entry framework subscription callback",
    },
    {
        ownerClassNames: new Set(["CommonEventSubscriber"]),
        methodNames: new Set(["subscribe"]),
        callbackArgIndexes: [1],
        minArgs: 2,
        reasonLabel: "Pure-entry framework subscription callback",
    },
    {
        ownerClassNames: new Set(["HttpRequest"]),
        methodNames: new Set(["request"]),
        callbackArgIndexes: [1],
        minArgs: 2,
        reasonLabel: "Pure-entry framework subscription callback",
    },
    {
        ownerClassNames: new Set(["KVStore"]),
        methodNames: new Set(["on"]),
        callbackArgIndexes: [1],
        minArgs: 2,
        requiredStringArgIndexes: [0],
        reasonLabel: "Pure-entry framework subscription callback",
    },
    {
        ownerClassNames: new Set(["Preferences"]),
        methodNames: new Set(["get", "put"]),
        callbackArgIndexes: [2],
        minArgs: 3,
        reasonLabel: "Pure-entry framework subscription callback",
    },
    {
        ownerClassNames: new Set(["Worker"]),
        methodNames: new Set(["onError"]),
        callbackArgIndexes: [0],
        reasonLabel: "Pure-entry framework subscription callback",
    },
];
const CONTROLLER_OPTION_CALLBACK_SPECS: PureEntryControllerOptionCallbackSpec[] = [
    {
        ownerClassNames: new Set(["CustomDialogController"]),
        constructorMethodNames: new Set(["constructor"]),
        optionsArgIndex: 0,
        callbackFieldNames: new Set(["builder", "cancel", "confirm"]),
        reasonLabel: "Pure-entry framework controller callback",
    },
];
const CHANNEL_EVENT_OWNER_NAMES = new Set([
    "Emitter",
    "EventHub",
]);
const CHANNEL_MESSAGE_OWNER_NAMES = new Set([
    "Worker",
]);
const SCHEDULER_METHOD_NAMES = new Set([
    "setTimeout",
    "setInterval",
    "requestAnimationFrame",
    "queueMicrotask",
    "execute",
]);
const SCHEDULER_EXECUTOR_OWNER_NAMES = new Set([
    "TaskPool",
    "taskpool",
]);

const KNOWN_KEYED_CALLBACK_DISPATCH_FAMILIES: PureEntryKeyedCallbackDispatchFamilySpec[] = [
    {
        familyId: "nav_destination",
        ownerClassNames: new Set(["NavDestination"]),
        registrationMethodNames: new Set(["register", "setBuilder", "setDestinationBuilder"]),
        dispatchMethodNames: new Set(["trigger"]),
        callbackArgIndex: 1,
        keyArgIndex: 0,
    },
];

export function resolvePureEntryFrameworkCallbackRegistration(
    args: PureEntryCallbackRegistrationMatchArgs,
): PureEntryCallbackRegistrationMatch | null {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.().getMethodName?.() || "";
    const ownerName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const explicitArgs = args.explicitArgs || [];

    for (const spec of FRAMEWORK_CALLBACK_SPECS) {
        if (!spec.ownerClassNames.has(ownerName)) continue;
        if (!spec.methodNames.has(methodName)) continue;
        if (explicitArgs.length < (spec.minArgs || 0)) continue;
        if (spec.requiredStringArgIndexes?.some(index => !looksLikeStringArg(explicitArgs[index]))) continue;
        return {
            callbackArgIndexes: spec.callbackArgIndexes,
            reason: `${spec.reasonLabel} ${ownerName || "@dsl"}.${methodName}`,
        };
    }
    return null;
}

export function resolvePureEntrySchedulerCallbackRegistration(
    args: PureEntryCallbackRegistrationMatchArgs,
): PureEntryCallbackRegistrationMatch | null {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.().getMethodName?.() || "";
    const ownerName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    if (isPromiseContinuationRegistration(args.invokeExpr)) {
        return null;
    }
    if (!SCHEDULER_METHOD_NAMES.has(methodName)) {
        return null;
    }
    if (methodName === "execute") {
        return SCHEDULER_EXECUTOR_OWNER_NAMES.has(ownerName)
            ? {
                callbackArgIndexes: [0],
                reason: `Pure-entry scheduler callback ${ownerName}.${methodName}`,
            }
            : null;
    }
    return {
        callbackArgIndexes: [0],
        reason: `Pure-entry scheduler callback ${methodName}`,
    };
}

export function resolvePureEntryChannelCallbackRegistration(
    args: PureEntryCallbackRegistrationMatchArgs,
): PureEntryCallbackRegistrationMatch | null {
    const methodSig = args.invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const ownerName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    if (methodName === "on") {
        return CHANNEL_EVENT_OWNER_NAMES.has(ownerName) && looksLikeStringArg(args.explicitArgs?.[0])
            ? {
                callbackArgIndexes: [1],
                reason: `Pure-entry channel callback ${ownerName}.${methodName}`,
            }
            : null;
    }
    if (methodName === "onMessage") {
        return CHANNEL_MESSAGE_OWNER_NAMES.has(ownerName)
            ? {
                callbackArgIndexes: [0],
                reason: `Pure-entry channel callback ${ownerName}.${methodName}`,
            }
            : null;
    }
    return null;
}

export function resolvePureEntryControllerOptionCallbackRegistrationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: ArkMethod,
): PureEntryResolvedCallbackRegistration[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];

    const methodSig = invokeExpr.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const ownerName = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const out = new Map<string, PureEntryResolvedCallbackRegistration>();

    for (const spec of CONTROLLER_OPTION_CALLBACK_SPECS) {
        if (!spec.ownerClassNames.has(ownerName)) continue;
        if (!spec.constructorMethodNames.has(methodName)) continue;
        const optionsValue = explicitArgs[spec.optionsArgIndex];
        const optionClass = resolvePureEntryClassFromValue(scene, optionsValue);
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
                registrationOwnerName: ownerName,
                registrationSignature,
                callbackArgIndex: spec.optionsArgIndex,
                reason: `${spec.reasonLabel} ${ownerName}.${fieldName}`,
            });
        }
    }

    return [...out.values()];
}

export function resolvePureEntryKnownKeyedCallbackRegistrationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: ArkMethod,
): PureEntryKeyedCallbackDispatchRegistration[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];
    const family = matchKnownKeyedCallbackDispatchFamily(invokeExpr, "registration");
    if (!family) return [];

    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];
    const keyValue = explicitArgs[family.keyArgIndex];
    const dispatchKeys = collectFiniteStringCandidatesFromValueLocal(keyValue);
    if (dispatchKeys.length === 0) return [];

    const registrations = resolvePureEntryCallbackRegistrationsFromStmt(
        stmt,
        scene,
        sourceMethod,
        resolvePureEntryKnownKeyedCallbackDispatchRegistration,
    );
    return registrations
        .filter(reg => reg.callbackArgIndex === family.callbackArgIndex)
        .map(reg => ({
            ...reg,
            familyId: family.familyId,
            dispatchKeys,
        }));
}

export function collectPureEntryKnownKeyedDispatchKeysFromMethod(
    scene: Scene,
    method: ArkMethod,
): Map<string, Set<string>> {
    void scene;
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
        const keys = collectFiniteStringCandidatesFromValueLocal(keyValue);
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

export function resolvePureEntryCallbackRegistrationsFromStmt(
    stmt: any,
    scene: Scene,
    sourceMethod: ArkMethod,
    matcher: PureEntryCallbackRegistrationMatcher,
    options: { maxDepth?: number } = {},
): PureEntryResolvedCallbackRegistration[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];
    return resolveCallbackRegistrationsFromInvokeExpr(
        invokeExpr,
        scene,
        sourceMethod,
        matcher,
        invokeExpr.getArgs ? invokeExpr.getArgs() : [],
        0,
        new Set<string>(),
        options.maxDepth ?? DEFAULT_MAX_CALLBACK_HELPER_DEPTH,
    );
}

export function expandPureEntryMethodsByDirectCalls(scene: Scene, seedMethods: ArkMethod[]): ArkMethod[] {
    return expandMethodsByDirectCalls(scene, seedMethods, {
        includeKeyedDispatchCallbacks: true,
    });
}

function resolvePureEntryKnownKeyedCallbackDispatchRegistration(
    args: PureEntryCallbackRegistrationMatchArgs,
): PureEntryCallbackRegistrationMatch | null {
    const family = matchKnownKeyedCallbackDispatchFamily(args.invokeExpr, "registration");
    if (!family) return null;
    return {
        callbackArgIndexes: [family.callbackArgIndex],
        reason: `Pure-entry keyed callback registration ${family.familyId}`,
    };
}

function matchKnownKeyedCallbackDispatchFamily(
    invokeExpr: any,
    mode: "registration" | "dispatch",
): PureEntryKeyedCallbackDispatchFamilySpec | undefined {
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

function resolvePureEntryClassFromValue(scene: Scene, value: any): any | null {
    const classSignature = value?.getType?.()?.getClassSignature?.();
    if (!classSignature) return null;
    return scene.getClass(classSignature) || null;
}

function expandMethodsByDirectCalls(
    scene: Scene,
    seedMethods: ArkMethod[],
    options: DirectCallExpansionOptions = {},
): ArkMethod[] {
    const queue = [...dedupeMethods(seedMethods)];
    const out = new Map<string, ArkMethod>();
    const includeKeyedDispatchCallbacks = options.includeKeyedDispatchCallbacks ?? false;
    const allowedDeclaringClassNames = options.allowedDeclaringClassNames;

    while (true) {
        while (queue.length > 0) {
            const method = queue.shift()!;
            const signature = method.getSignature?.()?.toString?.();
            if (!signature || out.has(signature)) continue;
            out.set(signature, method);

            const cfg = method.getCfg?.();
            if (!cfg) continue;
            for (const stmt of cfg.getStmts()) {
                if (!stmt.containsInvokeExpr?.()) continue;
                const invokeExpr = stmt.getInvokeExpr?.();
                if (!invokeExpr) continue;
                const callees = resolvePureEntryCalleeCandidates(scene, invokeExpr);
                for (const callee of callees) {
                    const calleeSignature = callee.method?.getSignature?.()?.toString?.();
                    if (!calleeSignature || out.has(calleeSignature)) continue;
                    if (!isAllowedDeclaringClass(callee.method, allowedDeclaringClassNames)) continue;
                    queue.push(callee.method);
                }
            }
        }

        if (!includeKeyedDispatchCallbacks) break;
        const explicitDispatchCallbacks = collectKeyedDispatchCallbackMethods(scene, [...out.values()]);
        const newCallbacks = explicitDispatchCallbacks.filter(method => {
            const signature = method.getSignature?.()?.toString?.();
            return !!signature
                && !out.has(signature)
                && isAllowedDeclaringClass(method, allowedDeclaringClassNames);
        });
        if (newCallbacks.length === 0) break;
        queue.push(...newCallbacks);
    }

    return [...out.values()];
}

function collectKeyedDispatchCallbackMethods(scene: Scene, scopeMethods: ArkMethod[]): ArkMethod[] {
    const dispatchKeysByFamily = new Map<string, Set<string>>();
    const registrations: PureEntryKeyedCallbackDispatchRegistration[] = [];

    for (const method of scopeMethods) {
        const dispatchKeys = collectPureEntryKnownKeyedDispatchKeysFromMethod(scene, method);
        for (const [familyId, keys] of dispatchKeys.entries()) {
            if (!dispatchKeysByFamily.has(familyId)) {
                dispatchKeysByFamily.set(familyId, new Set<string>());
            }
            const familyKeys = dispatchKeysByFamily.get(familyId)!;
            for (const key of keys) {
                familyKeys.add(key);
            }
        }

        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            registrations.push(
                ...resolvePureEntryKnownKeyedCallbackRegistrationsFromStmt(stmt, scene, method),
            );
        }
    }

    const callbacks: ArkMethod[] = [];
    const seen = new Set<string>();
    for (const registration of registrations) {
        const familyKeys = dispatchKeysByFamily.get(registration.familyId);
        if (!familyKeys || familyKeys.size === 0) continue;
        const matched = registration.dispatchKeys.some(key => familyKeys.has(key));
        if (!matched) continue;
        const signature = registration.callbackMethod.getSignature?.()?.toString?.();
        if (!signature || seen.has(signature)) continue;
        seen.add(signature);
        callbacks.push(registration.callbackMethod);
    }

    return callbacks;
}

function resolveCallbackRegistrationsFromInvokeExpr(
    invokeExpr: any,
    scene: Scene,
    sourceMethod: ArkMethod,
    matcher: PureEntryCallbackRegistrationMatcher,
    explicitArgs: any[],
    depth: number,
    visited: Set<string>,
    maxDepth: number,
): PureEntryResolvedCallbackRegistration[] {
    const direct = collectDirectCallbackRegistrations(
        invokeExpr,
        scene,
        sourceMethod,
        matcher,
        explicitArgs,
        depth,
        visited,
        maxDepth,
    );
    if (direct.length > 0) {
        return direct;
    }
    if (depth >= maxDepth) {
        return [];
    }
    return collectHelperCallbackRegistrations(
        invokeExpr,
        scene,
        sourceMethod,
        matcher,
        explicitArgs,
        depth + 1,
        visited,
        maxDepth,
    );
}

function collectDirectCallbackRegistrations(
    invokeExpr: any,
    scene: Scene,
    sourceMethod: ArkMethod,
    matcher: PureEntryCallbackRegistrationMatcher,
    explicitArgs: any[],
    depth: number,
    visited: Set<string>,
    maxDepth: number,
): PureEntryResolvedCallbackRegistration[] {
    const match = matcher({
        invokeExpr,
        explicitArgs,
        scene,
        sourceMethod,
    });
    if (!match || match.callbackArgIndexes.length === 0) return [];

    const methodName = invokeExpr.getMethodSignature?.().getMethodSubSignature?.().getMethodName?.() || "";
    const ownerName = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.().getClassName?.() || "@dsl";
    const signature = invokeExpr.getMethodSignature?.().toString?.() || "";
    const out = new Map<string, PureEntryResolvedCallbackRegistration>();

    for (const callbackArgIndex of match.callbackArgIndexes) {
        const callbackValue = explicitArgs[callbackArgIndex];
        if (!callbackValue) continue;
        const callbackMethods = resolveCallbackMethodsFromValue(scene, callbackValue, depth + 1, visited, maxDepth);
        for (const callbackMethod of callbackMethods) {
            const callbackSignature = callbackMethod.getSignature?.().toString?.();
            if (!callbackSignature) continue;
            const key = `${callbackSignature}|cbArg:${callbackArgIndex}|call:${signature}`;
            if (out.has(key)) continue;
            out.set(key, {
                callbackMethod,
                sourceMethod,
                registrationMethod: sourceMethod,
                registrationInvokeExpr: invokeExpr,
                registrationMethodName: methodName,
                registrationOwnerName: ownerName,
                registrationSignature: signature,
                callbackArgIndex,
                reason: match.reason || `Pure-entry callback registration ${ownerName}.${methodName}`,
            });
        }
    }

    return [...out.values()];
}

function collectHelperCallbackRegistrations(
    invokeExpr: any,
    scene: Scene,
    sourceMethod: ArkMethod,
    matcher: PureEntryCallbackRegistrationMatcher,
    explicitArgs: any[],
    depth: number,
    visited: Set<string>,
    maxDepth: number,
): PureEntryResolvedCallbackRegistration[] {
    const out = new Map<string, PureEntryResolvedCallbackRegistration>();
    const callees = resolvePureEntryCalleeCandidates(scene, invokeExpr);
    for (const resolved of callees) {
        const helperMethod = resolved.method as ArkMethod | undefined;
        if (!helperMethod?.getCfg?.()) continue;
        const helperSignature = helperMethod.getSignature?.().toString?.();
        if (!helperSignature) continue;
        const visitKey = `helper|${helperSignature}|${depth}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);

        const bindings = bindHelperParameters(helperMethod, invokeExpr, explicitArgs);
        const cfg = helperMethod.getCfg?.();
        if (!cfg) continue;

        for (const stmt of cfg.getStmts()) {
            const innerInvokeExpr = stmt?.getInvokeExpr?.();
            if (!innerInvokeExpr) continue;
            const innerExplicitArgs = (innerInvokeExpr.getArgs ? innerInvokeExpr.getArgs() : [])
                .map(arg => resolveHelperBoundValue(arg, bindings, 0, maxDepth));
            const registrations = resolveCallbackRegistrationsFromInvokeExpr(
                innerInvokeExpr,
                scene,
                sourceMethod,
                matcher,
                innerExplicitArgs,
                depth,
                visited,
                maxDepth,
            );
            for (const registration of registrations) {
                const key = `${registration.callbackMethod.getSignature?.().toString?.() || ""}|cbArg:${registration.callbackArgIndex}|call:${registration.registrationSignature}`;
                if (out.has(key)) continue;
                out.set(key, registration);
            }
        }
    }
    return [...out.values()];
}

function bindHelperParameters(
    helperMethod: ArkMethod,
    invokeExpr: any,
    explicitArgs: any[],
): Map<string, any> {
    const bindings = new Map<string, any>();
    const paramStmts = collectParameterAssignStmts(helperMethod);
    const pairs = mapInvokeArgsToParamAssigns(invokeExpr, explicitArgs || [], paramStmts);
    for (const pair of pairs) {
        const leftOp: any = pair.paramStmt?.getLeftOp?.();
        const localName = typeof leftOp?.getName === "function" ? leftOp.getName() : undefined;
        if (!localName) continue;
        bindings.set(localName, pair.arg);
    }
    return bindings;
}

function resolveHelperBoundValue(
    value: any,
    paramBindings: Map<string, any>,
    depth: number,
    maxDepth: number,
): any {
    if (!value || depth >= maxDepth) return value;
    const localName = value?.getName?.();
    if (localName && paramBindings.has(localName)) {
        return paramBindings.get(localName);
    }

    const declaringStmt = value?.getDeclaringStmt?.();
    const rightOp = declaringStmt?.getRightOp?.();
    if (rightOp) {
        const rightLocalName = typeof rightOp?.getName === "function" ? rightOp.getName() : undefined;
        if (rightLocalName && paramBindings.has(rightLocalName)) {
            return paramBindings.get(rightLocalName);
        }
        return resolveHelperBoundValue(rightOp, paramBindings, depth + 1, maxDepth);
    }

    return value;
}

function resolveCallbackMethodsFromValue(
    scene: Scene,
    value: any,
    depth: number,
    visited: Set<string>,
    maxDepth: number,
): ArkMethod[] {
    const direct = resolveMethodsFromCallable(scene, value).filter(method => !!method?.getCfg?.());
    if (direct.length > 0) {
        return dedupeMethods(direct as ArkMethod[]);
    }

    if (depth >= maxDepth) {
        return [];
    }

    const returnedOriginBindings = collectReturnedOriginBindingsFromValue(scene, value, depth, visited, maxDepth);
    if (returnedOriginBindings.length > 0) {
        return returnedOriginBindings.map(binding => binding.callbackMethod);
    }

    const bySimpleName = resolveMethodBySimpleName(scene, value?.toString?.());
    return bySimpleName ? [bySimpleName] : [];
}

function collectReturnedOriginBindingsFromValue(
    scene: Scene,
    value: any,
    depth: number,
    visited: Set<string>,
    maxDepth: number,
): Array<{ callbackMethod: ArkMethod; sourceMethod: ArkMethod; reason: "returned" }> {
    if (depth >= maxDepth) {
        return [];
    }
    const declaringStmt = value?.getDeclaringStmt?.();
    const invokeExpr = declaringStmt?.getInvokeExpr?.();
    if (!invokeExpr) {
        return [];
    }

    const out = new Map<string, { callbackMethod: ArkMethod; sourceMethod: ArkMethod; reason: "returned" }>();
    const callees = resolvePureEntryCalleeCandidates(scene, invokeExpr);
    for (const resolved of callees) {
        const method = resolved.method as ArkMethod | undefined;
        if (!method?.getCfg?.()) continue;
        for (const returned of collectReturnedCallbackMethods(scene, method, depth + 1, visited, maxDepth)) {
            const signature = returned.callbackMethod.getSignature?.().toString?.();
            if (!signature || out.has(signature)) continue;
            out.set(signature, returned);
        }
    }
    return [...out.values()];
}

function collectReturnedCallbackMethods(
    scene: Scene,
    method: ArkMethod,
    depth: number,
    visited: Set<string>,
    maxDepth: number,
): Array<{ callbackMethod: ArkMethod; sourceMethod: ArkMethod; reason: "returned" }> {
    const signature = method.getSignature?.().toString?.();
    if (!signature) return [];
    const visitKey = `return|${signature}|${depth}`;
    if (visited.has(visitKey)) return [];
    visited.add(visitKey);

    const out = new Map<string, { callbackMethod: ArkMethod; sourceMethod: ArkMethod; reason: "returned" }>();
    const cfg = method.getCfg?.();
    if (!cfg) return [];
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkReturnStmt)) continue;
        const retValue = stmt.getOp?.();
        if (!retValue) continue;
        for (const callbackMethod of resolveCallbackMethodsFromValue(scene, retValue, depth + 1, visited, maxDepth)) {
            const callbackSignature = callbackMethod.getSignature?.().toString?.();
            if (!callbackSignature || out.has(callbackSignature)) continue;
            out.set(callbackSignature, {
                callbackMethod,
                sourceMethod: method,
                reason: "returned",
            });
        }
    }
    return [...out.values()];
}

function resolvePureEntryCalleeCandidates(
    scene: Scene,
    invokeExpr: any,
): PureEntryResolvedCallee[] {
    const invokeSig = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    const exact = invokeSig ? scene.getMethods().find(m => m.getSignature().toString() === invokeSig) : undefined;
    if (exact) {
        return [{ method: exact }];
    }

    const typeTargets = resolveDirectCallableTargets(scene, invokeExpr, DEFAULT_MAX_NAME_MATCH_CANDIDATES);
    if (typeTargets.length > 0) {
        return typeTargets.map(method => ({ method }));
    }

    const methodName = resolveInvokeMethodName(invokeExpr);
    if (!methodName) return [];
    const expectedOwner = resolveExpectedOwnerForInvoke(invokeExpr, invokeSig);
    const argCount = invokeExpr?.getArgs ? invokeExpr.getArgs().length : 0;
    const isInstanceInvoke = isInstanceInvokeLike(invokeExpr);
    const isStaticInvoke = isStaticInvokeLike(invokeExpr);

    let candidates = scene.getMethods()
        .filter(m => normalizeMethodName(m.getName()) === methodName)
        .filter(m => !!m.getCfg())
        .filter(m => isArgCountCompatible(collectParameterAssignStmts(m).length, argCount));

    if (isInstanceInvoke) {
        candidates = candidates.filter(m => !isStaticMethod(m));
    } else if (isStaticInvoke) {
        candidates = candidates.filter(m => isStaticMethod(m));
    }

    if (expectedOwner) {
        const ownerMatched = candidates.filter(m => extractOwnerNameFromSignature(m.getSignature().toString()) === expectedOwner);
        if (ownerMatched.length > 0) {
            candidates = ownerMatched;
        }
    }

    if (candidates.length === 0 || candidates.length > DEFAULT_MAX_NAME_MATCH_CANDIDATES) {
        return [];
    }
    return candidates.map(method => ({ method }));
}

function resolveInvokeMethodName(invokeExpr: any): string {
    if (!invokeExpr) return "";
    const fromSubSig = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (fromSubSig) return normalizeMethodName(fromSubSig);
    const sig = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    return extractMethodNameFromSignature(sig);
}

function collectParameterAssignStmts(calleeMethod: ArkMethod): ArkAssignStmt[] {
    const cfg = calleeMethod?.getCfg?.();
    if (!cfg) return [];
    return cfg.getStmts()
        .filter((stmt: any) => stmt instanceof ArkAssignStmt && stmt.getRightOp() instanceof ArkParameterRef)
        .map(stmt => stmt as ArkAssignStmt)
        .sort((left: ArkAssignStmt, right: ArkAssignStmt) => {
            const leftIndex = (left.getRightOp() as ArkParameterRef).getIndex();
            const rightIndex = (right.getRightOp() as ArkParameterRef).getIndex();
            return leftIndex - rightIndex;
        });
}

function mapInvokeArgsToParamAssigns(
    invokeExpr: any,
    explicitArgs: any[],
    paramStmts: ArkAssignStmt[],
): Array<{ arg: any; paramStmt: ArkAssignStmt; argIndex: number; paramIndex: number }> {
    if (!paramStmts || paramStmts.length === 0) return [];
    const normalizedArgs = normalizeActualArgsForInvoke(invokeExpr, explicitArgs || [], paramStmts);
    const spreadToFirstParam = paramStmts.length === 1 && normalizedArgs.length > 1;
    const limit = spreadToFirstParam ? normalizedArgs.length : Math.min(normalizedArgs.length, paramStmts.length);
    const pairs: Array<{ arg: any; paramStmt: ArkAssignStmt; argIndex: number; paramIndex: number }> = [];
    for (let i = 0; i < limit; i++) {
        const arg = normalizedArgs[i];
        const paramIndex = spreadToFirstParam ? 0 : i;
        if (arg === undefined) continue;
        pairs.push({ arg, paramStmt: paramStmts[paramIndex], argIndex: i, paramIndex });
    }
    return pairs;
}

function resolveMethodsFromCallable(scene: Scene, callableValue: any): ArkMethod[] {
    const methods = resolveMethodsFromCallableValue(scene, callableValue, {
        maxCandidates: DEFAULT_MAX_NAME_MATCH_CANDIDATES,
    });
    if (methods.length === 0 || methods.length > DEFAULT_MAX_NAME_MATCH_CANDIDATES) {
        return [];
    }
    return methods;
}

function resolveMethodsFromCallableValue(
    scene: Scene,
    callableValue: any,
    options: { maxCandidates?: number; enableLocalBacktrace?: boolean; maxBacktraceSteps?: number; maxVisitedDefs?: number } = {},
): ArkMethod[] {
    if (!callableValue) return [];
    const resolvedCallable = resolveCallableValueByLocalBacktrace(callableValue, options);
    const candidates: ArkMethod[] = [];
    const seen = new Set<string>();
    const addMethod = (method: ArkMethod | undefined): void => {
        if (!method?.getCfg?.()) return;
        const sig = method.getSignature?.()?.toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        candidates.push(method);
    };

    const type = resolvedCallable?.getType?.();
    const methodSig = type?.getMethodSignature?.();
    const methodSigText = methodSig?.toString?.();
    if (methodSigText) {
        addMethod(scene.getMethods().find(method => method.getSignature().toString() === methodSigText));
        if (candidates.length > 0) {
            return candidates;
        }
    }

    if (!isCallableValue(resolvedCallable)) {
        return candidates;
    }

    const localName = resolvedCallable?.getName?.();
    if (localName) {
        for (const method of scene.getMethods().filter(candidate => normalizeMethodName(candidate.getName()) === normalizeMethodName(localName))) {
            addMethod(method);
        }
    }

    const rawText = resolvedCallable?.toString?.();
    if (rawText && rawText !== localName) {
        for (const method of scene.getMethods().filter(candidate => normalizeMethodName(candidate.getName()) === normalizeMethodName(rawText))) {
            addMethod(method);
        }
    }

    return candidates;
}

function isAllowedDeclaringClass(
    method: ArkMethod,
    allowedDeclaringClassNames?: Set<string>,
): boolean {
    if (!allowedDeclaringClassNames || allowedDeclaringClassNames.size === 0) {
        return true;
    }
    const declaringClassName = method.getDeclaringArkClass?.()?.getName?.();
    return !!declaringClassName && allowedDeclaringClassNames.has(declaringClassName);
}

function dedupeMethods(methods: ArkMethod[]): ArkMethod[] {
    const out = new Map<string, ArkMethod>();
    for (const method of methods) {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature || out.has(signature)) continue;
        out.set(signature, method);
    }
    return [...out.values()];
}

function resolveMethodBySimpleName(scene: Scene, rawName: string | undefined): ArkMethod | null {
    if (!rawName) return null;
    const normalized = rawName.trim();
    if (!normalized) return null;
    const matches = scene.getMethods().filter(method => method.getName?.() === normalized);
    return matches.length === 1 ? matches[0] : null;
}

function normalizeActualArgsForInvoke(
    invokeExpr: any,
    explicitArgs: any[],
    paramStmts: ArkAssignStmt[],
): any[] {
    if (!isInstanceInvokeLike(invokeExpr)) return explicitArgs;
    if (!paramStmts || paramStmts.length === 0) return explicitArgs;

    const firstParam = paramStmts[0].getRightOp();
    const firstLooksLikeThis = firstParam instanceof ArkParameterRef && firstParam.getIndex() === 0;
    if (!firstLooksLikeThis) return explicitArgs;
    if (explicitArgs.length + 1 !== paramStmts.length) return explicitArgs;

    const base = invokeExpr.getBase?.();
    if (!base) return explicitArgs;
    if (explicitArgs.length > 0 && explicitArgs[0] === base) return explicitArgs;
    return [base, ...explicitArgs];
}

function normalizeMethodName(name: string): string {
    return String(name || "").replace(/^\[static\]/, "").trim();
}

function extractMethodNameFromSignature(signature: string): string {
    if (!signature) return "";
    const openIdx = signature.indexOf("(");
    if (openIdx < 0) return "";
    const left = signature.slice(0, openIdx);
    const dotIdx = left.lastIndexOf(".");
    if (dotIdx < 0 || dotIdx + 1 >= left.length) return "";
    return normalizeMethodName(left.slice(dotIdx + 1));
}

function extractOwnerNameFromSignature(signature: string): string | undefined {
    if (!signature || signature.includes("%unk")) return undefined;
    const colonIdx = signature.indexOf(":");
    if (colonIdx < 0) return undefined;
    const openIdx = signature.indexOf("(");
    if (openIdx < 0) return undefined;
    const left = signature.slice(colonIdx + 1, openIdx).trim();
    const dotIdx = left.lastIndexOf(".");
    if (dotIdx <= 0) return undefined;
    const owner = left.slice(0, dotIdx).replace(/\[static\]/g, "").trim();
    return owner || undefined;
}

function resolveExpectedOwnerForInvoke(invokeExpr: any, invokeSig: string): string | undefined {
    const ownerFromSig = extractOwnerNameFromSignature(invokeSig);
    if (ownerFromSig) return ownerFromSig;

    if (!isInstanceInvokeLike(invokeExpr)) return undefined;
    const base = invokeExpr.getBase?.();
    const baseType = base?.getType?.();
    const classSig = baseType?.getClassSignature?.();
    if (!classSig) return undefined;
    const text = classSig.toString?.() || "";
    if (!text) return undefined;

    const normalized = text.replace(/^@/, "").trim();
    if (!normalized || normalized.includes("%unk")) return undefined;
    return normalized;
}

function isArgCountCompatible(paramCount: number, argCount: number): boolean {
    if (paramCount === argCount) return true;
    return paramCount === 1 && argCount > 1;
}

function isStaticMethod(method: ArkMethod): boolean {
    const sig = method?.getSignature?.()?.toString?.() || "";
    return sig.includes(".[static]");
}

function isInstanceInvokeLike(invokeExpr: any): boolean {
    if (!invokeExpr) return false;
    if (invokeExpr instanceof ArkInstanceInvokeExpr) return true;
    return typeof invokeExpr.getBase === "function";
}

function isStaticInvokeLike(invokeExpr: any): boolean {
    if (!invokeExpr) return false;
    if (invokeExpr instanceof ArkStaticInvokeExpr) return true;
    return !isInstanceInvokeLike(invokeExpr);
}

function getInvokeCallableBase(invokeExpr: any): any {
    if (!invokeExpr) return undefined;
    if (typeof invokeExpr.getBase === "function") {
        return invokeExpr.getBase();
    }
    if (invokeExpr instanceof ArkPtrInvokeExpr && typeof invokeExpr.getFuncPtrLocal === "function") {
        return invokeExpr.getFuncPtrLocal();
    }
    return undefined;
}

function isCallableValue(value: any): boolean {
    if (!value) return false;
    const localName = String(value?.getName?.() || "");
    if (localName.startsWith("%AM")) {
        return true;
    }
    const rawText = String(value?.toString?.() || "");
    if (rawText.startsWith("%AM")) {
        return true;
    }
    const type = value?.getType?.();
    if (!type) return false;
    if (typeof type.getMethodSignature === "function" && type.getMethodSignature()) {
        return true;
    }
    const text = type?.toString?.() || "";
    if (!text) return false;
    return text.includes("=>") || text.includes("Function") || text.includes("%AM");
}

function resolveCallableValueByLocalBacktrace(
    callableValue: any,
    options: { enableLocalBacktrace?: boolean; maxBacktraceSteps?: number; maxVisitedDefs?: number },
): any {
    if (!(callableValue instanceof Local)) return callableValue;
    if (options.enableLocalBacktrace === false) return callableValue;

    const maxBacktraceSteps = options.maxBacktraceSteps ?? DEFAULT_MAX_BACKTRACE_STEPS;
    const maxVisitedDefs = options.maxVisitedDefs ?? DEFAULT_MAX_VISITED_DEFS;
    if (maxBacktraceSteps <= 0 || maxVisitedDefs <= 0) return callableValue;

    const rootMethodSig = getDeclaringMethodSignatureFromLocal(callableValue);
    if (!rootMethodSig) return callableValue;

    let current: any = callableValue;
    let steps = 0;
    const visitedDefs = new Set<string>();
    while (steps < maxBacktraceSteps && current instanceof Local && !isCallableValue(current)) {
        const key = `${current.getName?.() || ""}#${getDeclaringStmtIdentity(current.getDeclaringStmt?.())}`;
        if (visitedDefs.has(key)) break;
        visitedDefs.add(key);
        if (visitedDefs.size > maxVisitedDefs) break;

        const declStmt = current.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt)) break;
        if (declStmt.getLeftOp() !== current) break;
        const declMethodSig = declStmt.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        if (!declMethodSig || declMethodSig !== rootMethodSig) break;

        const rightOp = declStmt.getRightOp();
        steps++;

        if (rightOp instanceof Local) {
            const rightMethodSig = getDeclaringMethodSignatureFromLocal(rightOp);
            if (!rightMethodSig || rightMethodSig !== rootMethodSig) break;
            current = rightOp;
            continue;
        }

        if (isCallableValue(rightOp)) {
            return rightOp;
        }
        break;
    }

    return current;
}

function getDeclaringMethodSignatureFromLocal(local: Local): string | undefined {
    const declStmt = local.getDeclaringStmt?.();
    return declStmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
}

function getDeclaringStmtIdentity(stmt: any): string {
    if (!stmt) return "null";
    const line = stmt.getOriginPositionInfo?.()?.getLineNo?.() ?? -1;
    const text = stmt.toString?.() || "";
    return `${line}:${text}`;
}

function resolveDirectCallableTargets(
    scene: Scene,
    invokeExpr: any,
    maxCandidates: number,
): ArkMethod[] {
    const invokeSig = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (!invokeSig.includes("%unk") && methodName) return [];

    const base = getInvokeCallableBase(invokeExpr);
    if (!base) return [];
    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const argCount = args.length;
    const targets = resolveMethodsFromCallableValue(scene, base, { maxCandidates })
        .filter(method => isArgCountCompatible(collectParameterAssignStmts(method).length, argCount));
    if (targets.length === 0 || targets.length > maxCandidates) return [];
    return targets;
}

function looksLikeStringArg(value: any): boolean {
    if (!value) return false;
    const text = String(value.toString?.() || "").trim();
    return /^['"`].+['"`]$/.test(text);
}

function isPromiseContinuationRegistration(invokeExpr: any): boolean {
    const methodSig = invokeExpr?.getMethodSignature?.();
    const methodName = methodSig?.getMethodSubSignature?.()?.getMethodName?.() || "";
    return methodName === "then" || methodName === "catch" || methodName === "finally";
}

function collectFiniteStringCandidatesFromValueLocal(
    value: any,
    depth: number = 0,
    visited: Set<string> = new Set<string>(),
): string[] {
    if (!value || depth > 4) return [];
    const text = String(value.toString?.() || "").trim();
    const quoted = text.match(/^[\"'`](.+)[\"'`]$/);
    if (quoted) {
        return [quoted[1]];
    }

    const localName = value?.getName?.();
    const visitKey = `${localName || "anon"}|${text}`;
    if (visited.has(visitKey)) return [];
    visited.add(visitKey);

    const declaringStmt = value?.getDeclaringStmt?.();
    const rightOp = declaringStmt?.getRightOp?.();
    if (rightOp) {
        return collectFiniteStringCandidatesFromValueLocal(rightOp, depth + 1, visited);
    }
    return [];
}
