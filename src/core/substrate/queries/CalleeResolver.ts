import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef, ArkInstanceFieldRef, ArkParameterRef, ArkStaticFieldRef, ClosureFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkAwaitExpr, ArkCastExpr, ArkInstanceInvokeExpr, ArkPtrInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";

export interface ResolvedCallee {
    method: any;
    reason: "exact" | "name_fallback" | "reflect_fallback" | "type_fallback";
}

export interface CalleeResolveOptions {
    maxNameMatchCandidates?: number;
}

export interface CallableResolveOptions {
    maxCandidates?: number;
    enableLocalBacktrace?: boolean;
    maxBacktraceSteps?: number;
    maxVisitedDefs?: number;
}

type CallableCarrierValue = ArkInstanceFieldRef | ClosureFieldRef | ArkArrayRef | ArkStaticFieldRef;

export interface InvokeArgParamPair {
    arg: any;
    paramStmt: ArkAssignStmt;
    argIndex: number;
    paramIndex: number;
}

const DEFAULT_MAX_NAME_MATCH_CANDIDATES = 4;
const DEFAULT_MAX_BACKTRACE_STEPS = 5;
const DEFAULT_MAX_VISITED_DEFS = 16;

interface SceneMethodIndex {
    bySignature: Map<string, any>;
    byNormalizedName: Map<string, any[]>;
}

const _sceneMethodIndexCache = new WeakMap<Scene, SceneMethodIndex>();

function getSceneMethodIndex(scene: Scene): SceneMethodIndex {
    let index = _sceneMethodIndexCache.get(scene);
    if (index) return index;
    const bySignature = new Map<string, any>();
    const byNormalizedName = new Map<string, any[]>();
    for (const m of scene.getMethods()) {
        const sig = m.getSignature?.()?.toString?.();
        if (sig) bySignature.set(sig, m);
        const name = normalizeMethodName(m.getName?.() || "");
        if (name) {
            let list = byNormalizedName.get(name);
            if (!list) { list = []; byNormalizedName.set(name, list); }
            list.push(m);
        }
    }
    index = { bySignature, byNormalizedName };
    _sceneMethodIndexCache.set(scene, index);
    return index;
}

export function resolveInvokeMethodName(invokeExpr: any): string {
    if (!invokeExpr) return "";
    const fromSubSig = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (fromSubSig) return normalizeMethodName(fromSubSig);
    const sig = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    return extractMethodNameFromSignature(sig);
}

export function resolveCalleeCandidates(
    scene: Scene,
    invokeExpr: any,
    options: CalleeResolveOptions = {}
): ResolvedCallee[] {
    const maxNameMatchCandidates = options.maxNameMatchCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    const invokeSig = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    const reflectDispatch = isReflectDispatchInvoke(invokeExpr);
    const idx = getSceneMethodIndex(scene);
    const exact = invokeSig ? idx.bySignature.get(invokeSig) : undefined;
    if (exact && !reflectDispatch) {
        return [{ method: exact, reason: "exact" }];
    }

    if (reflectDispatch) {
        const reflectTargets = resolveReflectDispatchTargets(scene, invokeExpr, maxNameMatchCandidates);
        if (reflectTargets.length > 0) {
            return reflectTargets.map(method => ({ method, reason: "reflect_fallback" as const }));
        }
        if (exact) {
            return [{ method: exact, reason: "exact" }];
        }
    }

    const typeTargets = resolveDirectCallableTargets(scene, invokeExpr, maxNameMatchCandidates);
    if (typeTargets.length > 0) {
        return typeTargets.map(method => ({ method, reason: "type_fallback" as const }));
    }

    const methodName = resolveInvokeMethodName(invokeExpr);
    if (!methodName) return [];

    const expectedOwner = resolveExpectedOwnerForInvoke(invokeExpr, invokeSig);
    const argCount = invokeExpr?.getArgs ? invokeExpr.getArgs().length : 0;
    const isInstanceInvoke = isInstanceInvokeLike(invokeExpr);
    const isStaticInvoke = isStaticInvokeLike(invokeExpr);

    let candidates = (idx.byNormalizedName.get(methodName) || [])
        .filter(m => !!m.getCfg())
        .filter(m => isArgCountCompatible(getFormalParamCount(m), argCount));

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

    if (candidates.length === 0 || candidates.length > maxNameMatchCandidates) {
        return [];
    }

    return candidates.map(method => ({ method, reason: "name_fallback" as const }));
}

export function isReflectDispatchInvoke(invokeExpr: any): boolean {
    return !!getReflectDispatchKind(invokeExpr);
}

export function collectParameterAssignStmts(calleeMethod: any): ArkAssignStmt[] {
    const cfg = calleeMethod?.getCfg?.();
    if (!cfg) return [];
    return cfg.getStmts()
        .filter((s: any) => s instanceof ArkAssignStmt && s.getRightOp() instanceof ArkParameterRef)
        .sort((a: ArkAssignStmt, b: ArkAssignStmt) => {
            const aIdx = (a.getRightOp() as ArkParameterRef).getIndex();
            const bIdx = (b.getRightOp() as ArkParameterRef).getIndex();
            return aIdx - bIdx;
        });
}

export function mapInvokeArgsToParamAssigns(
    invokeExpr: any,
    explicitArgs: any[],
    paramStmts: ArkAssignStmt[]
): InvokeArgParamPair[] {
    if (!paramStmts || paramStmts.length === 0) return [];
    const normalizedArgs = normalizeActualArgsForInvoke(invokeExpr, explicitArgs || [], paramStmts);
    const spreadToFirstParam = paramStmts.length === 1 && normalizedArgs.length > 1;
    const limit = spreadToFirstParam ? normalizedArgs.length : Math.min(normalizedArgs.length, paramStmts.length);
    const pairs: InvokeArgParamPair[] = [];
    for (let i = 0; i < limit; i++) {
        const arg = normalizedArgs[i];
        const paramIndex = spreadToFirstParam ? 0 : i;
        if (arg === undefined) continue;
        pairs.push({ arg, paramStmt: paramStmts[paramIndex], argIndex: i, paramIndex });
    }
    return pairs;
}

export function resolveMethodsFromCallable(
    scene: Scene,
    callableValue: any,
    options: CallableResolveOptions = {}
): any[] {
    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    const methods = resolveMethodsFromCallableValue(scene, callableValue, options, new Set<string>());
    if (methods.length === 0 || methods.length > maxCandidates) {
        return [];
    }
    return methods;
}

export function analyzeInvokedParams(method: any): Set<number> {
    const cfg = method?.getCfg?.();
    if (!cfg) return new Set<number>();

    const localToParamIndex = new Map<string, number>();
    for (const paramStmt of collectParameterAssignStmts(method)) {
        const left = paramStmt.getLeftOp();
        const right = paramStmt.getRightOp();
        if (!(left instanceof Local) || !(right instanceof ArkParameterRef)) continue;
        localToParamIndex.set(left.getName(), right.getIndex());
    }

    // Follow simple local aliases so `const f = cb; f()` still marks `cb` as invoked.
    let changed = true;
    let rounds = 0;
    while (changed && rounds < 4) {
        changed = false;
        rounds += 1;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local) || !(right instanceof Local)) continue;
            const paramIndex = localToParamIndex.get(right.getName());
            if (paramIndex === undefined || localToParamIndex.get(left.getName()) === paramIndex) continue;
            localToParamIndex.set(left.getName(), paramIndex);
            changed = true;
        }
    }

    const invoked = new Set<number>();
    const maybeMarkInvoked = (value: any): void => {
        if (!(value instanceof Local) || !isCallableValue(value)) return;
        const paramIndex = localToParamIndex.get(value.getName());
        if (paramIndex !== undefined) {
            invoked.add(paramIndex);
        }
    };

    for (const stmt of cfg.getStmts()) {
        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!invokeExpr) continue;

        maybeMarkInvoked(getInvokeCallableBase(invokeExpr));

        if (invokeExpr instanceof ArkInstanceInvokeExpr) {
            const invokeName = resolveInvokeMethodName(invokeExpr);
            if (invokeName === "call" || invokeName === "apply") {
                maybeMarkInvoked(invokeExpr.getBase?.());
            }
        }
    }

    const storedFieldsByParamIndex = collectStoredThisFieldsByParamIndex(cfg.getStmts(), localToParamIndex);
    if (storedFieldsByParamIndex.size === 0) {
        return invoked;
    }

    const declaringClass = method?.getDeclaringArkClass?.();
    const siblingMethods = declaringClass?.getMethods?.() || [];
    const invokedStoredFields = new Set<string>();
    for (const siblingMethod of siblingMethods) {
        const siblingCfg = siblingMethod?.getCfg?.();
        if (!siblingCfg) continue;
        for (const fieldName of collectInvokedThisFields(siblingCfg.getStmts(), storedFieldsByParamIndex)) {
            invokedStoredFields.add(fieldName);
        }
    }

    for (const [paramIndex, fieldNames] of storedFieldsByParamIndex.entries()) {
        for (const fieldName of fieldNames) {
            if (invokedStoredFields.has(fieldName)) {
                invoked.add(paramIndex);
            }
        }
    }

    return invoked;
}

function collectStoredThisFieldsByParamIndex(
    stmts: any[],
    localToParamIndex: Map<string, number>
): Map<number, Set<string>> {
    const result = new Map<number, Set<string>>();
    for (const stmt of stmts) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        const right = stmt.getRightOp();
        if (!(left instanceof ArkInstanceFieldRef) || !(right instanceof Local)) continue;
        const base = left.getBase?.();
        if (!(base instanceof Local) || base.getName() !== "this") continue;

        const paramIndex = localToParamIndex.get(right.getName());
        if (paramIndex === undefined) continue;

        const fieldName = left.getFieldSignature?.().getFieldName?.();
        if (!fieldName) continue;
        if (!result.has(paramIndex)) result.set(paramIndex, new Set<string>());
        result.get(paramIndex)!.add(fieldName);
    }
    return result;
}

function collectInvokedThisFields(
    stmts: any[],
    storedFieldsByParamIndex: Map<number, Set<string>>
): Set<string> {
    const trackedFields = new Set<string>();
    for (const fieldNames of storedFieldsByParamIndex.values()) {
        for (const fieldName of fieldNames) {
            trackedFields.add(fieldName);
        }
    }
    if (trackedFields.size === 0) return new Set<string>();

    const localToFieldName = new Map<string, string>();
    let changed = true;
    let rounds = 0;
    while (changed && rounds < 4) {
        changed = false;
        rounds += 1;
        for (const stmt of stmts) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local)) continue;

            if (right instanceof ArkInstanceFieldRef) {
                const base = right.getBase?.();
                const fieldName = right.getFieldSignature?.().getFieldName?.();
                if (!(base instanceof Local) || base.getName() !== "this" || !fieldName || !trackedFields.has(fieldName)) {
                    continue;
                }
                if (localToFieldName.get(left.getName()) === fieldName) continue;
                localToFieldName.set(left.getName(), fieldName);
                changed = true;
                continue;
            }

            if (right instanceof Local) {
                const fieldName = localToFieldName.get(right.getName());
                if (!fieldName || localToFieldName.get(left.getName()) === fieldName) continue;
                localToFieldName.set(left.getName(), fieldName);
                changed = true;
            }
        }
    }

    const invokedFields = new Set<string>();
    const maybeMarkInvokedField = (value: any): void => {
        if (value instanceof Local) {
            const fieldName = localToFieldName.get(value.getName());
            if (fieldName && isCallableValue(value)) {
                invokedFields.add(fieldName);
            }
            return;
        }
        if (value instanceof ArkInstanceFieldRef) {
            const base = value.getBase?.();
            const fieldName = value.getFieldSignature?.().getFieldName?.();
            if ((base instanceof Local) && base.getName() === "this" && fieldName && trackedFields.has(fieldName)) {
                invokedFields.add(fieldName);
            }
        }
    };

    for (const stmt of stmts) {
        if (!stmt.containsInvokeExpr?.()) continue;
        const invokeExpr = stmt.getInvokeExpr?.();
        if (!invokeExpr) continue;

        maybeMarkInvokedField(getInvokeCallableBase(invokeExpr));

        if (invokeExpr instanceof ArkInstanceInvokeExpr) {
            const invokeName = resolveInvokeMethodName(invokeExpr);
            if (invokeName === "call" || invokeName === "apply") {
                maybeMarkInvokedField(invokeExpr.getBase?.());
            }
        }
    }

    return invokedFields;
}

function getFormalParamCount(method: any): number {
    return collectParameterAssignStmts(method).length;
}

function isArgCountCompatible(paramCount: number, argCount: number): boolean {
    if (paramCount === argCount) return true;
    return paramCount === 1 && argCount > 1;
}

function isStaticMethod(method: any): boolean {
    const sig = method?.getSignature?.()?.toString?.() || "";
    return sig.includes(".[static]");
}

function isInstanceInvokeLike(invokeExpr: any): boolean {
    if (!invokeExpr) return false;
    if (invokeExpr instanceof ArkInstanceInvokeExpr) return true;
    return typeof invokeExpr.getBase === "function";
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

function isStaticInvokeLike(invokeExpr: any): boolean {
    if (!invokeExpr) return false;
    if (invokeExpr instanceof ArkStaticInvokeExpr) return true;
    return !isInstanceInvokeLike(invokeExpr);
}

function normalizeActualArgsForInvoke(
    invokeExpr: any,
    explicitArgs: any[],
    paramStmts: ArkAssignStmt[]
): any[] {
    const reflectKind = getReflectDispatchKind(invokeExpr);
    if (reflectKind === "reflect_call") {
        // Reflect.call(fn, thisArg, ...args) -> map ...args to callee params
        if (explicitArgs.length >= 2) return explicitArgs.slice(2);
    } else if (reflectKind === "reflect_apply") {
        // Reflect.apply(fn, thisArg, argsArray) -> try unpack array elements
        if (explicitArgs.length >= 3) return resolveApplyArgs(explicitArgs[2]);
    } else if (reflectKind === "function_call") {
        // fn.call(thisArg, ...args) -> map ...args to callee params
        if (explicitArgs.length >= 1) return explicitArgs.slice(1);
    } else if (reflectKind === "function_apply") {
        // fn.apply(thisArg, argsArray) -> try unpack array elements
        if (explicitArgs.length >= 2) return resolveApplyArgs(explicitArgs[1]);
    }

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

function resolveReflectDispatchTargets(
    scene: Scene,
    invokeExpr: any,
    maxCandidates: number
): any[] {
    const kind = getReflectDispatchKind(invokeExpr);
    if (!kind) return [];
    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const callableValue = kind.startsWith("reflect_")
        ? (args.length > 0 ? args[0] : undefined)
        : getInvokeCallableBase(invokeExpr);
    const methods = resolveMethodsFromCallableValue(scene, callableValue, { maxCandidates });
    if (methods.length === 0 || methods.length > maxCandidates) return [];
    return methods;
}

function resolveMethodsFromCallableValue(
    scene: Scene,
    callableValue: any,
    options: CallableResolveOptions = {},
    visitingFactoryMethods: Set<string> = new Set<string>(),
): any[] {
    if (!callableValue) return [];
    const resolvedCallable = resolveCallableValueByLocalBacktrace(callableValue, options);
    const carrierVisitKey = isCallableCarrierValue(resolvedCallable)
        ? `carrier:${describeCallableCarrierValue(resolvedCallable)}`
        : undefined;
    if (carrierVisitKey) {
        if (visitingFactoryMethods.has(carrierVisitKey)) {
            return [];
        }
        visitingFactoryMethods.add(carrierVisitKey);
    }

    const candidates: any[] = [];
    const seen = new Set<string>();
    const idx = getSceneMethodIndex(scene);
    const addMethod = (m: any): void => {
        if (!m || !m.getCfg || !m.getCfg()) return;
        const sig = m.getSignature?.()?.toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        candidates.push(m);
    };

    try {
        const type = resolvedCallable?.getType?.();
        const methodSig = type?.getMethodSignature?.();
        const methodSigText = methodSig?.toString?.();
        if (methodSigText) {
            addMethod(idx.bySignature.get(methodSigText));
            if (candidates.length > 0) {
                return candidates;
            }
        }

        for (const returnedMethod of resolveMethodsFromReturnedCallableFactory(
            scene,
            resolvedCallable,
            options,
            visitingFactoryMethods,
        )) {
            addMethod(returnedMethod);
        }
        if (candidates.length > 0) {
            return candidates;
        }

        for (const memberMethod of resolveMethodsFromCallableCarrierValue(
            scene,
            resolvedCallable,
            options,
            visitingFactoryMethods,
        )) {
            addMethod(memberMethod);
        }
        if (candidates.length > 0) {
            return candidates;
        }

        if (!isCallableValue(resolvedCallable)) {
            return candidates;
        }

        const localName = resolvedCallable?.getName?.();
        if (localName) {
            for (const m of idx.byNormalizedName.get(normalizeMethodName(localName)) || []) {
                addMethod(m);
            }
        }

        const rawText = resolvedCallable?.toString?.();
        if (rawText && rawText !== localName) {
            for (const m of idx.byNormalizedName.get(normalizeMethodName(rawText)) || []) {
                addMethod(m);
            }
        }

        return candidates;
    } finally {
        if (carrierVisitKey) {
            visitingFactoryMethods.delete(carrierVisitKey);
        }
    }
}

function resolveMethodsFromCallableCarrierValue(
    scene: Scene,
    callableValue: any,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    if (callableValue instanceof ArkInstanceFieldRef || callableValue instanceof ClosureFieldRef) {
        return resolveMethodsFromCallableFieldCarrier(scene, callableValue, options, visitingFactoryMethods);
    }
    if (callableValue instanceof ArkArrayRef) {
        return resolveMethodsFromCallableArrayCarrier(scene, callableValue, options, visitingFactoryMethods);
    }
    if (callableValue instanceof ArkStaticFieldRef) {
        return resolveMethodsFromCallableStaticFieldCarrier(scene, callableValue, options, visitingFactoryMethods);
    }
    return [];
}

export function resolveMethodsFromAnonymousObjectCarrier(
    scene: Scene,
    objectValue: any,
    options: CallableResolveOptions = {},
    visitingFactoryMethods: Set<string> = new Set<string>(),
): any[] {
    const classSig = objectValue?.getType?.()?.getClassSignature?.()?.toString?.() || "";
    if (!classSig || !isAnonymousObjectCarrierClassSignature(classSig)) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    for (const method of scene.getMethods()) {
        const declaringClassSig = method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
        if (declaringClassSig !== classSig) continue;
        const name = method.getName?.() || "";
        if (!isAnonymousObjectCallableMethodName(name)) continue;
        const sig = method.getSignature?.()?.toString?.();
        if (!sig || seen.has(sig) || !method.getCfg?.()) continue;
        seen.add(sig);
        out.push(method);
    }
    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    if (out.length > maxCandidates) return [];
    return out;
}

export function resolveMethodsFromAnonymousObjectCarrierByField(
    scene: Scene,
    objectValue: any,
    fieldName: string,
    options: CallableResolveOptions = {},
    visitingFactoryMethods: Set<string> = new Set<string>(),
): any[] {
    const classSig = objectValue?.getType?.()?.getClassSignature?.()?.toString?.() || "";
    if (!classSig || !isAnonymousObjectCarrierClassSignature(classSig)) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    const addResolvedMethods = (callable: any): void => {
        for (const method of resolveMethodsFromCallableValue(scene, callable, options, visitingFactoryMethods)) {
            const sig = method.getSignature?.()?.toString?.();
            if (!sig || seen.has(sig)) continue;
            seen.add(sig);
            out.push(method);
        }
    };

    for (const method of scene.getMethods()) {
        const declaringClassSig = method.getDeclaringArkClass?.()?.getSignature?.()?.toString?.() || "";
        if (declaringClassSig !== classSig) continue;
        const name = method.getName?.() || "";
        if (matchesAnonymousCarrierFieldMethod(name, fieldName)) {
            const sig = method.getSignature?.()?.toString?.();
            if (sig && !seen.has(sig) && method.getCfg?.()) {
                seen.add(sig);
                out.push(method);
            }
        }
        if (!(name.includes("constructor(") || name.includes("%instInit"))) continue;
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkInstanceFieldRef)) continue;
            const leftBase = left.getBase?.();
            if (!(leftBase instanceof Local) || leftBase.getName() !== "this") continue;
            const leftFieldName = left.getFieldSignature?.().getFieldName?.() || "";
            if (leftFieldName !== fieldName) continue;
            addResolvedMethods(stmt.getRightOp());
        }
    }

    const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    if (out.length > maxCandidates) return [];
    return out;
}

function resolveMethodsFromCallableFieldCarrier(
    scene: Scene,
    fieldRef: ArkInstanceFieldRef | ClosureFieldRef,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (method: any): void => {
        const sig = method?.getSignature?.()?.toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(method);
    };

    const base = fieldRef.getBase?.();
    const fieldName = fieldRef instanceof ClosureFieldRef
        ? fieldRef.getFieldName?.()
        : fieldRef.getFieldSignature?.().getFieldName?.();
    if (!fieldName) return out;

    if (base) {
        for (const method of resolveMethodsFromAnonymousObjectCarrierByField(
            scene,
            base,
            fieldName,
            options,
            visitingFactoryMethods,
        )) {
            addMethod(method);
        }
    }

    const assignedValues = collectAssignedFieldCarrierValues(fieldRef, options);
    for (const assignedValue of assignedValues) {
        for (const method of resolveMethodsFromCallableValue(scene, assignedValue, options, visitingFactoryMethods)) {
            addMethod(method);
        }
    }

    return out;
}

function resolveMethodsFromCallableArrayCarrier(
    scene: Scene,
    arrayRef: ArkArrayRef,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (method: any): void => {
        const sig = method?.getSignature?.()?.toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(method);
    };

    for (const assignedValue of collectAssignedArrayCarrierValues(arrayRef, options)) {
        for (const method of resolveMethodsFromCallableValue(scene, assignedValue, options, visitingFactoryMethods)) {
            addMethod(method);
        }
    }

    return out;
}

function resolveMethodsFromCallableStaticFieldCarrier(
    scene: Scene,
    fieldRef: ArkStaticFieldRef,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const fieldSigText = fieldRef.getFieldSignature?.().toString?.() || "";
    if (!fieldSigText) return out;

    for (const method of scene.getMethods()) {
        const cfg = method.getCfg?.();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            if (!(left instanceof ArkStaticFieldRef)) continue;
            const leftFieldSigText = left.getFieldSignature?.().toString?.() || "";
            if (leftFieldSigText !== fieldSigText) continue;
            for (const candidate of resolveMethodsFromCallableValue(scene, stmt.getRightOp(), options, visitingFactoryMethods)) {
                const sig = candidate.getSignature?.()?.toString?.();
                if (!sig || seen.has(sig)) continue;
                seen.add(sig);
                out.push(candidate);
            }
        }
    }

    return out;
}

function collectAssignedFieldCarrierValues(
    fieldRef: ArkInstanceFieldRef | ClosureFieldRef,
    options: CallableResolveOptions,
): any[] {
    const base = fieldRef.getBase?.();
    const method = resolveDeclaringMethodForCarrierBase(base);
    const cfg = method?.getCfg?.();
    if (!cfg) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!matchesCallableFieldCarrier(left, fieldRef, options)) continue;
        pushUniqueCarrierValue(out, seen, stmt.getRightOp());
    }
    return out;
}

function collectAssignedArrayCarrierValues(
    arrayRef: ArkArrayRef,
    options: CallableResolveOptions,
): any[] {
    const base = arrayRef.getBase?.();
    if (!(base instanceof Local)) return [];
    const method = resolveDeclaringMethodForCarrierBase(base);
    const cfg = method?.getCfg?.();
    if (!cfg) return [];

    const out: any[] = [];
    const seen = new Set<string>();
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (!matchesCallableArrayCarrier(left, arrayRef, options)) continue;
        pushUniqueCarrierValue(out, seen, stmt.getRightOp());
    }
    return out;
}

function resolveDeclaringMethodForCarrierBase(base: any): any | undefined {
    if (base instanceof Local) {
        return base.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.();
    }
    if (base instanceof ArkInstanceFieldRef || base instanceof ClosureFieldRef || base instanceof ArkArrayRef) {
        return resolveDeclaringMethodForCarrierBase(base.getBase?.());
    }
    return undefined;
}

function matchesCallableFieldCarrier(
    candidate: any,
    target: ArkInstanceFieldRef | ClosureFieldRef,
    options: CallableResolveOptions,
): boolean {
    if (!(candidate instanceof ArkInstanceFieldRef) && !(candidate instanceof ClosureFieldRef)) {
        return false;
    }
    const targetIdentity = getCallableFieldIdentity(target);
    const candidateIdentity = getCallableFieldIdentity(candidate);
    if (!targetIdentity || !candidateIdentity || targetIdentity !== candidateIdentity) {
        return false;
    }
    return areEquivalentCarrierBases(candidate.getBase?.(), target.getBase?.(), options);
}

function matchesCallableArrayCarrier(
    candidate: ArkArrayRef,
    target: ArkArrayRef,
    options: CallableResolveOptions,
): boolean {
    if (!areEquivalentCarrierBases(candidate.getBase?.(), target.getBase?.(), options)) {
        return false;
    }
    return normalizeCarrierArrayIndex(candidate.getIndex?.(), options)
        === normalizeCarrierArrayIndex(target.getIndex?.(), options);
}

function areEquivalentCarrierBases(
    candidateBase: any,
    targetBase: any,
    options: CallableResolveOptions,
): boolean {
    if (candidateBase === targetBase) return true;
    if (candidateBase instanceof Local && targetBase instanceof Local) {
        return getAliasRootLocalIdentity(candidateBase, options)
            === getAliasRootLocalIdentity(targetBase, options);
    }
    return String(candidateBase?.toString?.() || "")
        === String(targetBase?.toString?.() || "");
}

function getAliasRootLocalIdentity(local: Local, options: CallableResolveOptions): string {
    const root = resolveAliasRootLocal(local, options);
    const methodSig = getDeclaringMethodSignatureFromLocal(root) || "__unknown_method__";
    const declIdentity = getDeclaringStmtIdentity(root.getDeclaringStmt?.());
    return `${methodSig}::${root.getName?.() || ""}::${declIdentity}`;
}

function resolveAliasRootLocal(local: Local, options: CallableResolveOptions): Local {
    if (options.enableLocalBacktrace === false) return local;
    const maxBacktraceSteps = options.maxBacktraceSteps ?? DEFAULT_MAX_BACKTRACE_STEPS;
    const maxVisitedDefs = options.maxVisitedDefs ?? DEFAULT_MAX_VISITED_DEFS;
    const rootMethodSig = getDeclaringMethodSignatureFromLocal(local);
    if (!rootMethodSig) return local;

    let current: Local = local;
    let steps = 0;
    const visitedDefs = new Set<string>();
    while (steps < maxBacktraceSteps) {
        const key = `${current.getName?.() || ""}#${getDeclaringStmtIdentity(current.getDeclaringStmt?.())}`;
        if (visitedDefs.has(key)) break;
        visitedDefs.add(key);
        if (visitedDefs.size > maxVisitedDefs) break;

        const declStmt = current.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== current) break;
        const declMethodSig = declStmt.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        if (!declMethodSig || declMethodSig !== rootMethodSig) break;

        const rightOp = declStmt.getRightOp();
        const next = resolveBacktraceAliasLocal(rightOp, rootMethodSig);
        if (!(next instanceof Local)) break;
        current = next;
        steps += 1;
    }
    return current;
}

function resolveBacktraceAliasLocal(value: any, rootMethodSig: string): Local | undefined {
    if (value instanceof Local) {
        const rightMethodSig = getDeclaringMethodSignatureFromLocal(value);
        if (!rightMethodSig || rightMethodSig !== rootMethodSig) return undefined;
        return value;
    }
    if (value instanceof ArkCastExpr) {
        return resolveBacktraceAliasLocal(value.getOp?.(), rootMethodSig);
    }
    if (value instanceof ArkAwaitExpr) {
        return resolveBacktraceAliasLocal(value.getPromise?.(), rootMethodSig);
    }
    return undefined;
}

function normalizeCarrierArrayIndex(indexValue: any, options: CallableResolveOptions): string {
    const resolved = resolveSimpleAliasValue(indexValue, options);
    if (resolved instanceof Local) {
        return `local:${getAliasRootLocalIdentity(resolved, options)}`;
    }
    const parsed = parseArrayIndex(resolved);
    if (parsed !== undefined) {
        return `const:${parsed}`;
    }
    return `text:${String(resolved?.toString?.() || "")}`;
}

function resolveSimpleAliasValue(value: any, options: CallableResolveOptions): any {
    if (options.enableLocalBacktrace === false || !(value instanceof Local)) {
        return value;
    }
    const maxBacktraceSteps = options.maxBacktraceSteps ?? DEFAULT_MAX_BACKTRACE_STEPS;
    const maxVisitedDefs = options.maxVisitedDefs ?? DEFAULT_MAX_VISITED_DEFS;
    const rootMethodSig = getDeclaringMethodSignatureFromLocal(value);
    if (!rootMethodSig) return value;

    let current: any = value;
    let steps = 0;
    const visitedDefs = new Set<string>();
    while (steps < maxBacktraceSteps && current instanceof Local) {
        const key = `${current.getName?.() || ""}#${getDeclaringStmtIdentity(current.getDeclaringStmt?.())}`;
        if (visitedDefs.has(key)) break;
        visitedDefs.add(key);
        if (visitedDefs.size > maxVisitedDefs) break;

        const declStmt = current.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== current) break;
        const declMethodSig = declStmt.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
        if (!declMethodSig || declMethodSig !== rootMethodSig) break;

        const rightOp = declStmt.getRightOp();
        const nextLocal = resolveBacktraceAliasLocal(rightOp, rootMethodSig);
        if (nextLocal instanceof Local) {
            current = nextLocal;
            steps += 1;
            continue;
        }
        return rightOp;
    }
    return current;
}

function getCallableFieldIdentity(fieldRef: ArkInstanceFieldRef | ClosureFieldRef): string | undefined {
    if (fieldRef instanceof ClosureFieldRef) {
        const fieldName = fieldRef.getFieldName?.();
        return fieldName ? `closure:${fieldName}` : undefined;
    }
    const fieldSigText = fieldRef.getFieldSignature?.().toString?.();
    if (fieldSigText) return `field_sig:${fieldSigText}`;
    const fieldName = fieldRef.getFieldSignature?.().getFieldName?.();
    return fieldName ? `field_name:${fieldName}` : undefined;
}

function pushUniqueCarrierValue(out: any[], seen: Set<string>, value: any): void {
    if (value === undefined || value === null) return;
    const key = describeCallableCarrierValue(value);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value);
}

function describeCallableCarrierValue(value: any): string {
    if (value instanceof Local) {
        return getAliasRootLocalIdentity(value, {});
    }
    if (value instanceof ArkInstanceFieldRef || value instanceof ClosureFieldRef || value instanceof ArkArrayRef || value instanceof ArkStaticFieldRef) {
        return String(value.toString?.() || value);
    }
    return String(value?.toString?.() || value);
}

function isCallableCarrierValue(value: any): value is CallableCarrierValue {
    return value instanceof ArkInstanceFieldRef
        || value instanceof ClosureFieldRef
        || value instanceof ArkArrayRef
        || value instanceof ArkStaticFieldRef;
}

export function isAnonymousObjectCarrierClassSignature(classSig: string): boolean {
    if (!classSig) return false;
    return /(^|[.: \t])%AC\d+\$/.test(classSig) || classSig.includes(": %AC");
}

function isAnonymousObjectCallableMethodName(name: string): boolean {
    if (!name) return false;
    if (name.startsWith("%AM")) return true;
    return !(name === "constructor" || name.includes("constructor(") || name === "%instInit");
}

function matchesAnonymousCarrierFieldMethod(methodName: string, fieldName: string): boolean {
    if (!isAnonymousObjectCallableMethodName(methodName)) return false;
    if (normalizeMethodName(methodName) === fieldName) return true;
    return methodName.startsWith("%AM") && methodName.includes(`$${fieldName}`);
}

type ReflectDispatchKind = "reflect_call" | "reflect_apply" | "function_call" | "function_apply";

function getReflectDispatchKind(invokeExpr: any): ReflectDispatchKind | undefined {
    if (!invokeExpr) return undefined;
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (methodName !== "call" && methodName !== "apply") return undefined;

    const base = getInvokeCallableBase(invokeExpr);
    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];

    const baseIsReflect = isReflectBase(base);
    const baseIsCallable = isCallableValue(base);
    const firstArgIsCallable = args.length > 0 ? isCallableValue(args[0]) : false;

    if (baseIsReflect || (!baseIsCallable && firstArgIsCallable)) {
        return methodName === "call" ? "reflect_call" : "reflect_apply";
    }
    if (baseIsCallable) {
        return methodName === "call" ? "function_call" : "function_apply";
    }
    return undefined;
}

function isReflectBase(value: any): boolean {
    const name = value?.getName?.() || value?.toString?.() || "";
    return String(name).trim() === "Reflect";
}

export function isCallableValue(value: any): boolean {
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

function resolveApplyArgs(argsArrayValue: any): any[] {
    if (!(argsArrayValue instanceof Local)) {
        return [argsArrayValue];
    }

    const byIndex = new Map<number, any>();
    for (const stmt of argsArrayValue.getUsedStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof ArkArrayRef)) continue;
        if (left.getBase() !== argsArrayValue) continue;
        const idx = parseArrayIndex(left.getIndex());
        if (idx === undefined || idx < 0) continue;
        byIndex.set(idx, stmt.getRightOp());
    }

    if (byIndex.size === 0) {
        return [argsArrayValue];
    }

    return Array.from(byIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([_, value]) => value);
}

function parseArrayIndex(indexValue: any): number | undefined {
    const raw = indexValue?.toString?.() || "";
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) ? n : undefined;
}

function resolveDirectCallableTargets(
    scene: Scene,
    invokeExpr: any,
    maxCandidates: number
): any[] {
    if (!invokeExpr || isReflectDispatchInvoke(invokeExpr)) return [];
    const invokeSig = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (!invokeSig.includes("%unk") && methodName) return [];

    const base = getInvokeCallableBase(invokeExpr);
    if (!base || isReflectBase(base)) return [];

    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const argCount = args.length;
    const targets = resolveMethodsFromCallableValue(scene, base, { maxCandidates })
        .filter(m => isArgCountCompatible(getFormalParamCount(m), argCount));
    if (targets.length === 0 || targets.length > maxCandidates) return [];
    return targets;
}

function resolveCallableValueByLocalBacktrace(
    callableValue: any,
    options: CallableResolveOptions
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

        if (rightOp instanceof ArkCastExpr) {
            current = rightOp.getOp?.();
            continue;
        }

        if (rightOp instanceof ArkAwaitExpr) {
            current = rightOp.getPromise?.();
            continue;
        }

        if (isCallableCarrierValue(rightOp)) {
            return rightOp;
        }

        if (isCallableValue(rightOp)) {
            return rightOp;
        }

        // Only accept simple alias chains: Local <- Local / Local <- callable(%AM/FunctionType).
        break;
    }

    return current;
}

function resolveMethodsFromReturnedCallableFactory(
    scene: Scene,
    callableValue: any,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    if (!(callableValue instanceof Local)) return [];
    const declStmt = callableValue.getDeclaringStmt?.();
    if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== callableValue) {
        return [];
    }

    const rightOp = declStmt.getRightOp();
    if (!(rightOp instanceof ArkStaticInvokeExpr)
        && !(rightOp instanceof ArkInstanceInvokeExpr)
        && !(rightOp instanceof ArkPtrInvokeExpr)) {
        return [];
    }

    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (method: any): void => {
        if (!method?.getCfg?.()) return;
        const sig = method.getSignature?.()?.toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(method);
    };

    const maxNameMatchCandidates = options.maxCandidates ?? DEFAULT_MAX_NAME_MATCH_CANDIDATES;
    const resolvedCallees = resolveCalleeCandidates(scene, rightOp, { maxNameMatchCandidates });
    for (const resolved of resolvedCallees) {
        const calleeMethod = resolved.method;
        const calleeSig = calleeMethod?.getSignature?.()?.toString?.();
        if (!calleeSig || visitingFactoryMethods.has(calleeSig)) continue;
        visitingFactoryMethods.add(calleeSig);
        for (const returnedMethod of collectReturnedCallableMethods(
            scene,
            calleeMethod,
            options,
            visitingFactoryMethods,
        )) {
            addMethod(returnedMethod);
        }
        visitingFactoryMethods.delete(calleeSig);
    }

    return out;
}

function collectReturnedCallableMethods(
    scene: Scene,
    method: any,
    options: CallableResolveOptions,
    visitingFactoryMethods: Set<string>,
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    const addMethod = (candidate: any): void => {
        if (!candidate?.getCfg?.()) return;
        const sig = candidate.getSignature?.()?.toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        out.push(candidate);
    };

    const returnStmts = method?.getReturnStmt?.() || [];
    for (const retStmt of returnStmts) {
        if (!(retStmt instanceof ArkReturnStmt)) continue;
        const returnedValue = retStmt.getOp?.();
        if (!returnedValue) continue;
        for (const candidate of resolveMethodsFromCallableValue(
            scene,
            returnedValue,
            options,
            visitingFactoryMethods,
        )) {
            addMethod(candidate);
        }
    }

    return out;
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
