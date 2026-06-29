import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { ArkInstanceInvokeExpr, ArkPtrInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import {
    diagnoseUnresolvedVirtualDispatch,
    isCallableValue,
    resolveCalleeCandidates,
    resolveInvokeMethodName,
    resolveMethodsFromCallable,
} from "../../substrate/queries/CalleeResolver";
import { assertBuildStageBudget, BuildStageBudget } from "../../shared/BuildStageBudget";
import {
    collectKnownKeyedDispatchKeysFromMethod,
    KeyedCallbackDispatchRegistration,
    resolveKnownChannelCallbackRegistration,
    resolveKnownFrameworkCallbackRegistrationWithPolicy,
    resolveKnownKeyedCallbackRegistrationsFromStmt,
} from "./FrameworkCallbackClassifier";
import { resolveCallbackRegistrationsFromStmt } from "../../substrate/queries/CallbackBindingQuery";
import { resolveKnownOptionCallbackRegistrationsFromStmt } from "../../substrate/semantics/KnownOptionCallbackRegistration";

interface DirectCallExpansionOptions {
    includeKeyedDispatchCallbacks?: boolean;
    allowedDeclaringClassNames?: Set<string>;
    budget?: BuildStageBudget;
    budgetLabel?: string;
}

const _directExpansionTargetCache = new WeakMap<Scene, Map<string, ArkMethod[]>>();
const _sceneMethodNameCache = new WeakMap<Scene, Set<string>>();

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

    while (true) {
        for (let head = 0; head < queue.length; head++) {
            const method = queue[head];
            const signature = method.getSignature?.()?.toString?.();
            if (!signature || out.has(signature)) continue;
            out.set(signature, method);

            for (const calleeMethod of collectDirectCallExpansionTargetMethods(scene, method, options)) {
                const calleeSignature = calleeMethod?.getSignature?.()?.toString?.();
                if (!calleeSignature || out.has(calleeSignature)) continue;
                if (!isAllowedDeclaringClass(calleeMethod, allowedDeclaringClassNames)) continue;
                queue.push(calleeMethod);
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

export function collectDirectCallExpansionTargetMethods(
    scene: Scene,
    method: ArkMethod,
    options: DirectCallExpansionOptions = {},
): ArkMethod[] {
    const cacheKey = directExpansionCacheKey(method, options);
    const sceneCache = cacheKey ? getDirectExpansionTargetCache(scene) : undefined;
    const cached = cacheKey ? sceneCache?.get(cacheKey) : undefined;
    if (cached) return cached;

    const out: ArkMethod[] = [];
    const seen = new Set<string>();
    const allowedDeclaringClassNames = options.allowedDeclaringClassNames;

    const addMethod = (calleeMethod: ArkMethod): void => {
        const calleeSignature = calleeMethod?.getSignature?.()?.toString?.();
        if (!calleeSignature || seen.has(calleeSignature)) return;
        if (!isAllowedDeclaringClass(calleeMethod, allowedDeclaringClassNames)) return;
        seen.add(calleeSignature);
        out.push(calleeMethod);
    };

    const cfg = method.getCfg?.();
    if (!cfg) return out;
    const methodLabel = options.budgetLabel || shortMethodLabel(method);

    for (const stmt of cfg.getStmts()) {
        assertBuildStageBudget(options.budget, `direct_expansion.stmt(${methodLabel})`);
        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!invokeExpr) continue;
        if (shouldAttemptExactReachabilityCalleeResolution(scene, invokeExpr, options)) {
            assertBuildStageBudget(options.budget, `direct_expansion.resolve_callee.start(${methodLabel})`);
            const callees = resolveCalleeCandidates(scene, invokeExpr, {
                maxNameMatchCandidates: 8,
                enableDirectCallableTargets: false,
                maxCallableResolveDepth: 16,
            });
            assertBuildStageBudget(options.budget, `direct_expansion.resolve_callee.done(count=${callees.length},method=${methodLabel})`);
            for (const callee of callees) {
                addMethod(callee.method as ArkMethod);
            }
        }

        assertBuildStageBudget(options.budget, `direct_expansion.callable_targets.start(${methodLabel})`);
        for (const calleeMethod of collectCallableExpansionTargets(scene, invokeExpr, options)) {
            addMethod(calleeMethod);
        }
        for (const calleeMethod of collectExactCallbackExpansionTargets(scene, method, stmt)) {
            addMethod(calleeMethod);
        }
        assertBuildStageBudget(options.budget, `direct_expansion.callable_targets.done(count=${out.length},method=${methodLabel})`);
    }

    if (cacheKey) sceneCache?.set(cacheKey, out);
    return out;
}

function getDirectExpansionTargetCache(scene: Scene): Map<string, ArkMethod[]> {
    let cache = _directExpansionTargetCache.get(scene);
    if (!cache) {
        cache = new Map<string, ArkMethod[]>();
        _directExpansionTargetCache.set(scene, cache);
    }
    return cache;
}

function directExpansionCacheKey(method: ArkMethod, options: DirectCallExpansionOptions): string | undefined {
    if (options.allowedDeclaringClassNames || options.budget?.maxElapsedMs) return undefined;
    return method.getSignature?.()?.toString?.() || undefined;
}

function shouldAttemptExactReachabilityCalleeResolution(
    scene: Scene,
    invokeExpr: any,
    options: DirectCallExpansionOptions = {},
): boolean {
    const invokeSignature = safeInvokeSignatureText(invokeExpr);
    if (invokeSignature && !invokeSignature.includes("%unk")) return true;
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (!methodName || !getSceneMethodNameSet(scene).has(methodName)) return false;
    if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) return true;

    const diagnostic = diagnoseUnresolvedVirtualDispatch(scene, invokeExpr, {
        maxNameMatchCandidates: 8,
        enableDirectCallableTargets: false,
        maxCallableResolveDepth: 16,
    });
    if (!diagnostic) return true;
    const blockers = new Set([
        "missing_concrete_receiver_owner",
        "receiver_owner_candidates_not_unique",
        "name_candidates_exceed_limit",
    ]);
    return !diagnostic.evidence.some(evidence => blockers.has(evidence));
}

function getSceneMethodNameSet(scene: Scene): Set<string> {
    let cached = _sceneMethodNameCache.get(scene);
    if (cached) return cached;
    cached = new Set<string>();
    for (const method of scene.getMethods()) {
        const name = method.getName?.();
        if (name) cached.add(String(name));
    }
    _sceneMethodNameCache.set(scene, cached);
    return cached;
}

function collectCallableExpansionTargets(
    scene: Scene,
    invokeExpr: any,
    options: DirectCallExpansionOptions = {},
): ArkMethod[] {
    const out: ArkMethod[] = [];
    const seen = new Set<string>();

    const addMethod = (method: any): void => {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature || seen.has(signature)) return;
        seen.add(signature);
        out.push(method as ArkMethod);
    };

    const addCallableTargetsFromValue = (value: any): void => {
        if (!isPotentialCallableExpansionValue(value)) return;
        for (const method of resolveMethodsFromCallable(scene, value, { maxCandidates: 8 })) {
            addMethod(method);
        }
    };

    if (shouldResolveReceiverAsCallable(invokeExpr)) {
        assertBuildStageBudget(options.budget, `direct_expansion.callable_receiver(${shortInvokeLabel(invokeExpr)})`);
        addCallableTargetsFromValue(invokeExpr.getBase?.());
    }

    if (invokeExpr instanceof ArkPtrInvokeExpr && typeof invokeExpr.getFuncPtrLocal === "function") {
        assertBuildStageBudget(options.budget, `direct_expansion.callable_ptr(${shortInvokeLabel(invokeExpr)})`);
        addCallableTargetsFromValue(invokeExpr.getFuncPtrLocal());
    }

    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const methodName = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    for (const argIndex of resolveKnownCallableArgIndexes(methodName)) {
        if (argIndex < 0 || argIndex >= args.length) continue;
        assertBuildStageBudget(options.budget, `direct_expansion.callable_arg(${methodName}#${argIndex})`);
        addCallableTargetsFromValue(args[argIndex]);
    }

    return out;
}

function collectExactCallbackExpansionTargets(
    scene: Scene,
    sourceMethod: ArkMethod,
    stmt: any,
): ArkMethod[] {
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (!invokeExpr || !hasCallbackExpansionEvidence(stmt, invokeExpr)) return [];

    const out = new Map<string, ArkMethod>();
    const addMethod = (method: any): void => {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature || out.has(signature)) return;
        out.set(signature, method as ArkMethod);
    };

    for (const binding of resolveCallbackRegistrationsFromStmt(
        stmt,
        scene,
        sourceMethod,
        args =>
            resolveKnownFrameworkCallbackRegistrationWithPolicy(args, { enableSdkProvenance: true })
            || resolveKnownChannelCallbackRegistration(args),
        { maxDepth: 2 },
    )) {
        addMethod(binding.callbackMethod);
    }

    for (const binding of resolveKnownOptionCallbackRegistrationsFromStmt(stmt, scene, sourceMethod)) {
        addMethod(binding.callbackMethod);
    }

    return [...out.values()];
}

function hasCallbackExpansionEvidence(stmt: any, invokeExpr: any): boolean {
    const stmtText = stmt?.toString?.() || "";
    if (stmtText.includes("ptrinvoke this.")) return true;
    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    for (const arg of args) {
        if (isPotentialCallableExpansionValue(arg)) return true;
        const typeValue: any = arg?.getType?.();
        const text = [
            arg?.toString?.() || "",
            typeValue?.getClassSignature?.()?.toString?.() || "",
            typeValue?.toString?.() || "",
        ].join(" ");
        if (text.includes("%AM") || text.includes("%AC")) return true;
    }
    return false;
}

function shouldResolveReceiverAsCallable(invokeExpr: any): boolean {
    if (!(invokeExpr instanceof ArkInstanceInvokeExpr)) return false;
    const methodName = resolveInvokeMethodName(invokeExpr);
    return methodName === "call" || methodName === "apply";
}

function isPotentialCallableExpansionValue(value: any): boolean {
    return isCallableValue(value);
}

function shortMethodLabel(method: ArkMethod): string {
    const sig = method?.getSignature?.()?.toString?.() || method?.getName?.() || "<unknown>";
    return sig.length <= 90 ? sig : `${sig.slice(0, 44)}...${sig.slice(-40)}`;
}

function shortInvokeLabel(invokeExpr: any): string {
    const sig = invokeExpr?.getMethodSignature?.()?.toString?.() || resolveInvokeMethodName(invokeExpr) || "<unknown>";
    return sig.length <= 90 ? sig : `${sig.slice(0, 44)}...${sig.slice(-40)}`;
}

function safeInvokeSignatureText(invokeExpr: any): string {
    try {
        return invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    } catch {
        return "";
    }
}

function resolveKnownCallableArgIndexes(methodName: string): number[] {
    if (!methodName) return [];
    const ordinary = KNOWN_ORDINARY_CALLBACK_ARG_INDEXES.get(methodName) || [];
    const deferred = KNOWN_DEFERRED_CALLBACK_ARG_INDEXES.get(methodName) || [];
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

export function collectKeyedDispatchCallbackMethods(scene: Scene, scopeMethods: ArkMethod[]): ArkMethod[] {
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
