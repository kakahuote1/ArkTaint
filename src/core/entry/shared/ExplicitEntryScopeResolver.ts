import { Scene } from "../../../../arkanalyzer/lib/Scene";
import { ArkMethod } from "../../../../arkanalyzer/lib/core/model/ArkMethod";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr } from "../../../../arkanalyzer/lib/core/base/Expr";
import { resolveCalleeCandidates, resolveMethodsFromCallable } from "../../substrate/queries/CalleeResolver";
import {
    collectKnownKeyedDispatchKeysFromMethod,
    KeyedCallbackDispatchRegistration,
    resolveKnownKeyedCallbackRegistrationsFromStmt,
} from "./FrameworkCallbackClassifier";

interface DirectCallExpansionOptions {
    includeKeyedDispatchCallbacks?: boolean;
    allowedDeclaringClassNames?: Set<string>;
    includeDeferredCallbacks?: boolean;
}

const KNOWN_ORDINARY_CALLBACK_ARG_INDEXES = new Map<string, number[]>([
    ["forEach", [0]],
    ["map", [0]],
    ["filter", [0]],
    ["find", [0]],
    ["findIndex", [0]],
    ["some", [0]],
    ["every", [0]],
    ["reduce", [0]],
    ["reduceRight", [0]],
    ["flatMap", [0]],
]);

const KNOWN_DEFERRED_CALLBACK_ARG_INDEXES = new Map<string, number[]>([
    ["then", [0, 1]],
    ["catch", [0]],
    ["finally", [0]],
]);

function dedupeMethods(methods: ArkMethod[]): ArkMethod[] {
    const dedup = new Map<string, ArkMethod>();
    for (const method of methods) {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature || dedup.has(signature)) continue;
        dedup.set(signature, method);
    }
    return [...dedup.values()];
}

export function expandEntryMethodsByDirectCalls(scene: Scene, seedMethods: ArkMethod[]): ArkMethod[] {
    return expandMethodsByDirectCalls(scene, seedMethods, {
        includeKeyedDispatchCallbacks: true,
    });
}

export function expandClassLocalMethodsByDirectCalls(scene: Scene, seedMethods: ArkMethod[]): ArkMethod[] {
    const allowedDeclaringClassNames = new Set(
        seedMethods
            .map(method => method.getDeclaringArkClass?.()?.getName?.())
            .filter((name): name is string => Boolean(name)),
    );
    return expandMethodsByDirectCalls(scene, seedMethods, {
        includeKeyedDispatchCallbacks: false,
        allowedDeclaringClassNames,
    });
}

export function expandMethodsByDirectCalls(
    scene: Scene,
    seedMethods: ArkMethod[],
    options: DirectCallExpansionOptions = {},
): ArkMethod[] {
    const queue = [...dedupeMethods(seedMethods)];
    const out = new Map<string, ArkMethod>();
    const includeKeyedDispatchCallbacks = options.includeKeyedDispatchCallbacks ?? false;
    const allowedDeclaringClassNames = options.allowedDeclaringClassNames;
    const includeDeferredCallbacks = options.includeDeferredCallbacks ?? true;

    while (true) {
        for (let head = 0; head < queue.length; head++) {
            const method = queue[head];
            const signature = method.getSignature?.()?.toString?.();
            if (!signature || out.has(signature)) continue;
            out.set(signature, method);

            const cfg = method.getCfg?.();
            if (!cfg) continue;
            for (const stmt of cfg.getStmts()) {
                if (!stmt.containsInvokeExpr?.()) continue;
                const invokeExpr = stmt.getInvokeExpr?.();
                if (!invokeExpr) continue;
                const callees = resolveCalleeCandidates(scene, invokeExpr, {
                    maxNameMatchCandidates: 8,
                });
                for (const callee of callees) {
                    const calleeMethod = callee.method as ArkMethod;
                    const calleeSignature = calleeMethod?.getSignature?.()?.toString?.();
                    if (!calleeSignature || out.has(calleeSignature)) continue;
                    if (!isAllowedDeclaringClass(calleeMethod, allowedDeclaringClassNames)) continue;
                    queue.push(calleeMethod);
                }

                for (const calleeMethod of collectCallableExpansionTargets(scene, invokeExpr, includeDeferredCallbacks)) {
                    const calleeSignature = calleeMethod?.getSignature?.()?.toString?.();
                    if (!calleeSignature || out.has(calleeSignature)) continue;
                    if (!isAllowedDeclaringClass(calleeMethod, allowedDeclaringClassNames)) continue;
                    queue.push(calleeMethod);
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
        queue.length = 0;
        queue.push(...newCallbacks);
    }

    return [...out.values()];
}

function collectCallableExpansionTargets(scene: Scene, invokeExpr: any, includeDeferredCallbacks: boolean): ArkMethod[] {
    const out: ArkMethod[] = [];
    const seen = new Set<string>();

    const addMethod = (method: any): void => {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature || seen.has(signature)) return;
        seen.add(signature);
        out.push(method as ArkMethod);
    };

    const addCallableTargetsFromValue = (value: any): void => {
        for (const method of resolveMethodsFromCallable(scene, value, { maxCandidates: 8 })) {
            addMethod(method);
        }
    };

    if (invokeExpr instanceof ArkInstanceInvokeExpr) {
        addCallableTargetsFromValue(invokeExpr.getBase?.());
    }

    if (invokeExpr instanceof ArkPtrInvokeExpr && typeof invokeExpr.getFuncPtrLocal === "function") {
        addCallableTargetsFromValue(invokeExpr.getFuncPtrLocal());
    }

    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const methodName = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    for (const argIndex of resolveKnownCallableArgIndexes(methodName, includeDeferredCallbacks)) {
        if (argIndex < 0 || argIndex >= args.length) continue;
        addCallableTargetsFromValue(args[argIndex]);
    }

    return out;
}

function resolveKnownCallableArgIndexes(methodName: string, includeDeferredCallbacks: boolean): number[] {
    if (!methodName) return [];
    const ordinary = KNOWN_ORDINARY_CALLBACK_ARG_INDEXES.get(methodName) || [];
    const deferred = includeDeferredCallbacks
        ? (KNOWN_DEFERRED_CALLBACK_ARG_INDEXES.get(methodName) || [])
        : [];
    return ordinary.length === 0
        ? deferred
        : deferred.length === 0
            ? ordinary
            : [...new Set([...ordinary, ...deferred])];
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

function collectKeyedDispatchCallbackMethods(scene: Scene, scopeMethods: ArkMethod[]): ArkMethod[] {
    const dispatchKeysByFamily = new Map<string, Set<string>>();
    const registrations: KeyedCallbackDispatchRegistration[] = [];

    for (const method of scopeMethods) {
        const dispatchKeys = collectKnownKeyedDispatchKeysFromMethod(scene, method);
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
                ...resolveKnownKeyedCallbackRegistrationsFromStmt(stmt, scene, method),
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
