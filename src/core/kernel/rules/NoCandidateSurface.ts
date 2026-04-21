import { InvokeSite, TransferNoCandidateCallsite } from "./TransferTypes";
import { RuleInvokeKind } from "../../rules/RuleSchema";

interface WrapperOwnerMethodLike {
    getCode?: () => string | undefined;
    getCfg?: () => { getStmts?: () => any[] } | undefined;
    getParameters?: () => any[];
    getName?: () => string;
    getSignature?: () => { toString?: () => string } | undefined;
    isStatic?: () => boolean;
}

function isUnknownSignature(signature: string): boolean {
    const text = String(signature || "").trim();
    return !text || text.includes("%unk");
}

function normalizeStmtText(text: string): string {
    return String(text || "")
        .replace(/\s+/g, " ")
        .trim();
}

function extractInvokeMethodName(invokeExpr: any): string {
    const fromSig = invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (fromSig) {
        return String(fromSig).trim();
    }
    const raw = invokeExpr?.getMethodSignature?.()?.toString?.() || "";
    const match = String(raw).match(/\.([A-Za-z0-9_$]+)\(/);
    return match?.[1] || "";
}

function hasComplexControlFlow(text: string): boolean {
    return /\b(if|for|while|switch|throw|try|await)\b/.test(text);
}

function extractMethodBody(code: string): string {
    const raw = String(code || "");
    const open = raw.indexOf("{");
    const close = raw.lastIndexOf("}");
    if (open < 0 || close <= open) {
        return raw.trim();
    }
    return raw.slice(open + 1, close).trim();
}

function normalizeBodyText(body: string): string {
    return String(body || "")
        .replace(/\/\/.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim();
}

function matchesThinWrapperBody(body: string, methodName: string): boolean {
    const normalizedBody = normalizeBodyText(body);
    if (!normalizedBody || !methodName) {
        return false;
    }
    const methodPattern = `[A-Za-z_$][\\w$]*\\.${methodName}\\s*\\([^)]*\\)`;
    const directReturn = new RegExp(`^return\\s+${methodPattern}\\s*;?$`);
    if (directReturn.test(normalizedBody)) {
        return true;
    }
    const directAssignReturn = new RegExp(
        `^(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${methodPattern}\\s*;?\\s*return\\s+\\1\\s*;?$`
    );
    if (directAssignReturn.test(normalizedBody)) {
        return true;
    }
    const directInvoke = new RegExp(`^${methodPattern}\\s*;?$`);
    return directInvoke.test(normalizedBody);
}

function shouldPromoteUnknownInvokeToCallerSurface(site: InvokeSite, owner?: WrapperOwnerMethodLike): boolean {
    if (!owner) {
        return false;
    }
    if (!isUnknownSignature(site.signature)) {
        return false;
    }
    if (!site.callerSignature || isUnknownSignature(site.callerSignature)) {
        return false;
    }
    if (!site.callerMethodName || !site.callerFilePath || site.callerFilePath.includes("%unk")) {
        return false;
    }

    const stmts = owner.getCfg?.()?.getStmts?.() || [];
    const uniqueInvokeMethods = new Set<string>();
    const uniqueInvokeStmtTexts = new Set<string>();
    for (const stmt of stmts) {
        if (!stmt?.containsInvokeExpr?.()) {
            continue;
        }
        const invokeExpr = stmt.getInvokeExpr?.();
        const method = extractInvokeMethodName(invokeExpr);
        if (!method) {
            continue;
        }
        uniqueInvokeMethods.add(method);
        const stmtText = normalizeStmtText(
            String(stmt.getOriginalText?.() || stmt.toString?.() || "")
        );
        if (stmtText) {
            uniqueInvokeStmtTexts.add(stmtText);
        }
    }
    if (uniqueInvokeMethods.size !== 1 || !uniqueInvokeMethods.has(site.methodName)) {
        return false;
    }
    if (uniqueInvokeStmtTexts.size > 2) {
        return false;
    }

    const code = String(owner.getCode?.() || "").trim();
    if (!code) {
        return false;
    }
    if (code.length > 320) {
        return false;
    }
    if (hasComplexControlFlow(code)) {
        return false;
    }

    return matchesThinWrapperBody(extractMethodBody(code), site.methodName);
}

function resolveCallerInvokeKind(owner?: WrapperOwnerMethodLike): RuleInvokeKind {
    return owner?.isStatic?.() ? "static" : "instance";
}

function resolveCallerArgCount(owner?: WrapperOwnerMethodLike): number {
    const parameters = owner?.getParameters?.();
    return Array.isArray(parameters) ? parameters.length : 0;
}

export function buildNoCandidateCallsiteRecord(
    site: InvokeSite,
    owner?: WrapperOwnerMethodLike,
): TransferNoCandidateCallsite {
    if (shouldPromoteUnknownInvokeToCallerSurface(site, owner)) {
        return {
            calleeSignature: site.callerSignature,
            method: site.callerMethodName,
            invokeKind: resolveCallerInvokeKind(owner),
            argCount: resolveCallerArgCount(owner),
            sourceFile: site.callerFilePath,
            count: 1,
        };
    }

    return {
        calleeSignature: site.signature,
        method: site.methodName,
        invokeKind: site.invokeKind,
        argCount: site.args.length,
        sourceFile: site.calleeFilePath,
        count: 1,
    };
}
