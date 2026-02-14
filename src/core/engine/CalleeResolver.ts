import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { ArkAssignStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkParameterRef } from "../../../arkanalyzer/out/src/core/base/Ref";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../arkanalyzer/out/src/core/base/Expr";

export interface ResolvedCallee {
    method: any;
    reason: "exact" | "name_fallback";
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
    const exact = invokeSig ? scene.getMethods().find(m => m.getSignature().toString() === invokeSig) : undefined;
    if (exact) {
        return [{ method: exact, reason: "exact" }];
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
