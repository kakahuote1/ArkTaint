import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkArrayRef, ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../arkanalyzer/out/src/core/base/Local";

export interface ResolvedCallee {
    method: any;
    reason: "exact" | "name_fallback" | "reflect_fallback" | "type_fallback";
}

export interface CalleeResolveOptions {
    maxNameMatchCandidates?: number;
}

export interface InvokeArgParamPair {
    arg: any;
    paramStmt: ArkAssignStmt;
    argIndex: number;
    paramIndex: number;
}

const DEFAULT_MAX_NAME_MATCH_CANDIDATES = 4;

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
    const exact = invokeSig ? scene.getMethods().find(m => m.getSignature().toString() === invokeSig) : undefined;
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

    let candidates = scene.getMethods()
        .filter(m => normalizeMethodName(m.getName()) === methodName)
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
        : invokeExpr?.getBase?.();
    const methods = resolveMethodsFromCallableValue(scene, callableValue);
    if (methods.length === 0 || methods.length > maxCandidates) return [];
    return methods;
}

function resolveMethodsFromCallableValue(scene: Scene, callableValue: any): any[] {
    if (!callableValue) return [];
    const candidates: any[] = [];
    const seen = new Set<string>();
    const addMethod = (m: any): void => {
        if (!m || !m.getCfg || !m.getCfg()) return;
        const sig = m.getSignature?.()?.toString?.();
        if (!sig || seen.has(sig)) return;
        seen.add(sig);
        candidates.push(m);
    };

    const type = callableValue?.getType?.();
    const methodSig = type?.getMethodSignature?.();
    const methodSigText = methodSig?.toString?.();
    if (methodSigText) {
        const bySig = scene.getMethods().find(m => m.getSignature().toString() === methodSigText);
        addMethod(bySig);
        if (candidates.length > 0) {
            return candidates;
        }
    }

    if (!isCallableValue(callableValue)) {
        return candidates;
    }

    const localName = callableValue?.getName?.();
    if (localName) {
        for (const m of scene.getMethods().filter(mm => normalizeMethodName(mm.getName()) === normalizeMethodName(localName))) {
            addMethod(m);
        }
    }

    const rawText = callableValue?.toString?.();
    if (rawText && rawText !== localName) {
        for (const m of scene.getMethods().filter(mm => normalizeMethodName(mm.getName()) === normalizeMethodName(rawText))) {
            addMethod(m);
        }
    }

    return candidates;
}

type ReflectDispatchKind = "reflect_call" | "reflect_apply" | "function_call" | "function_apply";

function getReflectDispatchKind(invokeExpr: any): ReflectDispatchKind | undefined {
    if (!invokeExpr) return undefined;
    const methodName = resolveInvokeMethodName(invokeExpr);
    if (methodName !== "call" && methodName !== "apply") return undefined;

    const base = invokeExpr?.getBase?.();
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

function isCallableValue(value: any): boolean {
    if (!value) return false;
    const type = value?.getType?.();
    if (!type) return false;
    if (typeof type.getMethodSignature === "function" && type.getMethodSignature()) {
        return true;
    }
    const text = type?.toString?.() || "";
    if (!text) return false;
    return text.includes("=>") || text.includes("Function");
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

    const base = invokeExpr?.getBase?.();
    if (!base || isReflectBase(base)) return [];

    const args = invokeExpr?.getArgs ? invokeExpr.getArgs() : [];
    const argCount = args.length;
    const targets = resolveMethodsFromCallableValue(scene, base)
        .filter(m => isArgCountCompatible(getFormalParamCount(m), argCount));
    if (targets.length === 0 || targets.length > maxCandidates) return [];
    return targets;
}
