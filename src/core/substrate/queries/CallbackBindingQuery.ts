import { Scene } from "../../../../arkanalyzer/lib/Scene";
import { ArkMethod } from "../../../../arkanalyzer/lib/core/model/ArkMethod";
import {
    collectParameterAssignStmts,
    mapInvokeArgsToParamAssigns,
    resolveCalleeCandidates,
    resolveMethodsFromCallable,
} from "./CalleeResolver";

export interface CallbackRegistrationMatchArgs {
    invokeExpr: any;
    explicitArgs: any[];
    scene: Scene;
    sourceMethod: ArkMethod;
    carrierMethod?: ArkMethod;
}

export interface CallbackRegistrationMatchBase {
    callbackArgIndexes: number[];
    reason?: string;
}

export type CallbackRegistrationMatcher<TMatch extends CallbackRegistrationMatchBase = CallbackRegistrationMatchBase> =
    (args: CallbackRegistrationMatchArgs) => TMatch | null;

export type ResolvedCallbackRegistration<TMatch extends CallbackRegistrationMatchBase = CallbackRegistrationMatchBase> =
    Omit<TMatch, "callbackArgIndexes"> & {
        callbackMethod: ArkMethod;
        sourceMethod: ArkMethod;
        registrationMethod: ArkMethod;
        registrationInvokeExpr: any;
        registrationMethodName: string;
        registrationOwnerName: string;
        registrationSignature: string;
        callbackArgIndex: number;
        reason: string;
    };

const DEFAULT_MAX_CALLBACK_HELPER_DEPTH = 4;
const METHOD_BY_NAME_CACHE = new WeakMap<Scene, Map<string, ArkMethod | null>>();

export function resolveCallbackRegistrationsFromStmt<TMatch extends CallbackRegistrationMatchBase>(
    stmt: any,
    scene: Scene,
    sourceMethod: ArkMethod,
    matcher: CallbackRegistrationMatcher<TMatch>,
    options: { maxDepth?: number } = {},
): Array<ResolvedCallbackRegistration<TMatch>> {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr) return [];
    return resolveCallbackRegistrationsFromInvokeExpr(
        invokeExpr,
        scene,
        sourceMethod,
        sourceMethod,
        matcher,
        invokeExpr.getArgs ? invokeExpr.getArgs() : [],
        0,
        new Set<string>(),
        options.maxDepth ?? DEFAULT_MAX_CALLBACK_HELPER_DEPTH,
    );
}

export function resolveCallbackMethodsFromValueWithReturns(
    scene: Scene,
    value: any,
    options: { maxDepth?: number } = {},
): ArkMethod[] {
    return resolveCallbackMethodBindingsPreferReturnedOrigins(
        scene,
        value,
        0,
        new Set<string>(),
        options.maxDepth ?? DEFAULT_MAX_CALLBACK_HELPER_DEPTH,
    );
}

function resolveCallbackMethodBindingsPreferReturnedOrigins(
    scene: Scene,
    value: any,
    depth: number,
    visited: Set<string>,
    maxDepth: number,
): ArkMethod[] {
    const returnedOriginBindings = collectReturnedOriginBindingsFromValue(scene, value, depth, visited, maxDepth);
    if (returnedOriginBindings.length > 0) {
        return returnedOriginBindings.map(binding => binding.callbackMethod);
    }
    return resolveCallbackMethodsFromValue(scene, value, depth, visited, maxDepth);
}

function resolveCallbackRegistrationsFromInvokeExpr<TMatch extends CallbackRegistrationMatchBase>(
    invokeExpr: any,
    scene: Scene,
    sourceMethod: ArkMethod,
    carrierMethod: ArkMethod,
    matcher: CallbackRegistrationMatcher<TMatch>,
    explicitArgs: any[],
    depth: number,
    visited: Set<string>,
    maxDepth: number,
): Array<ResolvedCallbackRegistration<TMatch>> {
    const direct = collectDirectCallbackRegistrations(
        invokeExpr,
        scene,
        sourceMethod,
        carrierMethod,
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
        carrierMethod,
        matcher,
        explicitArgs,
        depth + 1,
        visited,
        maxDepth,
    );
}

function collectDirectCallbackRegistrations<TMatch extends CallbackRegistrationMatchBase>(
    invokeExpr: any,
    scene: Scene,
    sourceMethod: ArkMethod,
    carrierMethod: ArkMethod,
    matcher: CallbackRegistrationMatcher<TMatch>,
    explicitArgs: any[],
    depth: number,
    visited: Set<string>,
    maxDepth: number,
): Array<ResolvedCallbackRegistration<TMatch>> {
    const match = matcher({
        invokeExpr,
        explicitArgs,
        scene,
        sourceMethod,
        carrierMethod,
    });
    if (!match || match.callbackArgIndexes.length === 0) return [];

    const methodName = invokeExpr.getMethodSignature?.().getMethodSubSignature?.().getMethodName?.() || "";
    const ownerName = invokeExpr.getMethodSignature?.().getDeclaringClassSignature?.().getClassName?.() || "@dsl";
    const signature = invokeExpr.getMethodSignature?.().toString?.() || "";
    const out = new Map<string, ResolvedCallbackRegistration<TMatch>>();

    for (const callbackArgIndex of match.callbackArgIndexes) {
        const callbackValue = explicitArgs[callbackArgIndex];
        if (!callbackValue) continue;
        const callbackMethods = resolveCallbackMethodBindingsPreferReturnedOrigins(
            scene,
            callbackValue,
            depth + 1,
            visited,
            maxDepth,
        );
        for (const callbackMethod of callbackMethods) {
            const callbackSignature = callbackMethod.getSignature?.().toString?.();
            if (!callbackSignature) continue;
            const key = `${callbackSignature}|cbArg:${callbackArgIndex}|call:${signature}`;
            if (out.has(key)) continue;
            const { callbackArgIndexes: _ignored, ...metadata } = match as TMatch & { callbackArgIndexes: number[] };
            out.set(key, {
                ...metadata,
                callbackMethod,
                sourceMethod,
                registrationMethod: sourceMethod,
                registrationInvokeExpr: invokeExpr,
                registrationMethodName: methodName,
                registrationOwnerName: ownerName,
                registrationSignature: signature,
                callbackArgIndex,
                reason: match.reason || `Callback registration ${ownerName}.${methodName} from ${sourceMethod.getName()}`,
            } as ResolvedCallbackRegistration<TMatch>);
        }
    }

    return [...out.values()];
}

function collectHelperCallbackRegistrations<TMatch extends CallbackRegistrationMatchBase>(
    invokeExpr: any,
    scene: Scene,
    sourceMethod: ArkMethod,
    carrierMethod: ArkMethod,
    matcher: CallbackRegistrationMatcher<TMatch>,
    explicitArgs: any[],
    depth: number,
    visited: Set<string>,
    maxDepth: number,
): Array<ResolvedCallbackRegistration<TMatch>> {
    const out = new Map<string, ResolvedCallbackRegistration<TMatch>>();
    const callees = resolveCalleeCandidates(scene, invokeExpr, { maxNameMatchCandidates: 8 });
    for (const resolved of callees) {
        const helperMethod = resolved?.method as ArkMethod | undefined;
        if (!helperMethod?.getCfg?.()) continue;
        if (shouldSkipProjectConstructorHelperFollowing(scene, helperMethod)) continue;
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
                helperMethod,
                matcher,
                innerExplicitArgs,
                depth,
                visited,
                maxDepth,
            );
            for (const registration of registrations) {
                const key = `${registration.callbackMethod.getSignature?.().toString?.() || ""}|cbArg:${registration.callbackArgIndex}|call:${registration.registrationSignature}`;
                if (out.has(key)) continue;
                out.set(key, {
                    ...registration,
                    registrationMethod: registration.registrationMethod || helperMethod,
                });
            }
        }
    }
    return [...out.values()];
}

function shouldSkipProjectConstructorHelperFollowing(scene: Scene, helperMethod: ArkMethod): boolean {
    if (helperMethod?.getName?.() !== "constructor") {
        return false;
    }
    const helperFileSig = helperMethod
        ?.getSignature?.()
        ?.getDeclaringClassSignature?.()
        ?.getDeclaringFileSignature?.();
    return !(helperFileSig && scene.hasSdkFile(helperFileSig));
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
    const direct = resolveMethodsFromCallable(scene, value, {
        maxCandidates: 8,
        enableLocalBacktrace: true,
    }).filter(method => !!method?.getCfg?.());
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
    const callees = resolveCalleeCandidates(scene, invokeExpr, { maxNameMatchCandidates: 8 });
    for (const resolved of callees) {
        const method = resolved?.method as ArkMethod | undefined;
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
    for (const retStmt of method.getReturnStmt?.() || []) {
        const retValue = (retStmt as any)?.getOp?.();
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
    let cache = METHOD_BY_NAME_CACHE.get(scene);
    if (!cache) {
        cache = new Map();
        const nameCount = new Map<string, number>();
        const nameMethod = new Map<string, ArkMethod>();
        for (const method of scene.getMethods()) {
            const name = method.getName?.();
            if (!name) continue;
            nameCount.set(name, (nameCount.get(name) || 0) + 1);
            nameMethod.set(name, method);
        }
        for (const [name, count] of nameCount) {
            cache.set(name, count === 1 ? nameMethod.get(name)! : null);
        }
        METHOD_BY_NAME_CACHE.set(scene, cache);
    }
    if (cache.has(normalized)) {
        return cache.get(normalized)!;
    }
    return null;
}
