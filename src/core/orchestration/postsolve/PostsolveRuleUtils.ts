import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { RuleEndpoint, SanitizerRule } from "../../rules/RuleSchema";

export type SupportedInvokeExpr = ArkInstanceInvokeExpr | ArkStaticInvokeExpr;

export function isSupportedInvokeExpr(value: any): value is SupportedInvokeExpr {
    return value instanceof ArkInstanceInvokeExpr || value instanceof ArkStaticInvokeExpr;
}

export function resolveInvokeExprFromStmt(stmt: any): SupportedInvokeExpr | undefined {
    const invokeExpr = stmt?.getInvokeExpr?.();
    return isSupportedInvokeExpr(invokeExpr) ? invokeExpr : undefined;
}

export function resolveAssignInvokeExprFromStmt(stmt: any): SupportedInvokeExpr | undefined {
    if (!(stmt instanceof ArkAssignStmt)) return resolveInvokeExprFromStmt(stmt);
    const right = stmt.getRightOp?.();
    return isSupportedInvokeExpr(right) ? right : resolveInvokeExprFromStmt(stmt);
}

export function resolveInvokeEndpointValue(
    stmt: any,
    invokeExpr: SupportedInvokeExpr,
    endpoint: RuleEndpoint,
): any | undefined {
    if (endpoint === "result") {
        if (stmt instanceof ArkAssignStmt) return stmt.getLeftOp?.();
        return undefined;
    }
    if (endpoint === "base") {
        return invokeExpr instanceof ArkInstanceInvokeExpr ? invokeExpr.getBase?.() : undefined;
    }
    if (endpoint === "matched_param") return undefined;
    const argMatch = String(endpoint).match(/^arg(\d+)$/);
    if (!argMatch) return undefined;
    const args = invokeExpr.getArgs?.() || [];
    return args[Number(argMatch[1])];
}

export function invokeMethodName(invokeExpr: any): string {
    return invokeExpr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
}

export function invokeSignatureText(invokeExpr: any): string {
    return invokeExpr?.getMethodSignature?.()?.toString?.() || "";
}

export function declaringClassText(invokeExpr: any): string {
    return invokeExpr?.getMethodSignature?.()?.getDeclaringClassSignature?.()?.toString?.() || "";
}

export function methodSignatureTextFromStmt(stmt: any): string {
    return stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
}

export function methodStmtsFromStmt(stmt: any): any[] {
    return stmt?.getCfg?.()?.getStmts?.() || [];
}

export function stmtIndexInMethod(stmt: any): number {
    return methodStmtsFromStmt(stmt).indexOf(stmt);
}

export function sameValueLike(left: any, right: any): boolean {
    if (!left || !right) return false;
    if (left === right) return true;
    return String(left?.toString?.() || "") === String(right?.toString?.() || "");
}

export function hasLocalReassignmentBetween(
    stmts: any[],
    local: Local,
    fromIndexInclusive: number,
    toIndexExclusive: number,
): boolean {
    const localName = local.getName?.() || "";
    if (!localName) return false;
    for (let i = fromIndexInclusive + 1; i < toIndexExclusive; i++) {
        const stmt = stmts[i];
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp?.();
        if (!(left instanceof Local)) continue;
        if (left.getName?.() === localName) return true;
    }
    return false;
}

export function normalizeQuotedLiteral(text: string): string | undefined {
    const m = String(text || "").trim().match(/^['"`]((?:\\.|[^'"`])*)['"`]$/);
    return m ? m[1] : undefined;
}

export function isStringLiteralValue(value: any): boolean {
    return normalizeQuotedLiteral(String(value?.toString?.() || "")) !== undefined;
}

export function stringLiteralValue(value: any): string | undefined {
    return normalizeQuotedLiteral(String(value?.toString?.() || ""));
}

export function matchesSanitizerRuleInvoke(
    rule: SanitizerRule,
    stmt: any,
    invokeExpr: SupportedInvokeExpr,
): boolean {
    void rule;
    void stmt;
    void invokeExpr;
    return false;
}
