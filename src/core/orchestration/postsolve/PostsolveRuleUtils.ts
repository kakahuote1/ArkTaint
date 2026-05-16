import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { RuleEndpoint, RuleMatchKind, RuleStringConstraint, SanitizerRule } from "../../rules/RuleSchema";

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
    if (!matchesRuleMatch(rule.match.kind, rule.match.value, invokeExpr)) return false;
    const invokeKind = rule.match.invokeKind;
    if (invokeKind && invokeKind !== "any") {
        const actual = invokeExpr instanceof ArkInstanceInvokeExpr ? "instance" : "static";
        if (actual !== invokeKind) return false;
    }
    if (rule.match.argCount !== undefined) {
        const args = invokeExpr.getArgs?.() || [];
        if (args.length !== rule.match.argCount) return false;
    }
    if (!matchesScope(rule.scope?.className, declaringClassText(invokeExpr))) return false;
    if (!matchesScope(rule.scope?.methodName, methodSignatureTextFromStmt(stmt))) return false;
    if (!matchesScope(rule.scope?.file, methodSignatureTextFromStmt(stmt))) return false;
    return true;
}

function matchesRuleMatch(kind: RuleMatchKind, value: string, invokeExpr: SupportedInvokeExpr): boolean {
    const signature = invokeSignatureText(invokeExpr);
    const methodName = invokeMethodName(invokeExpr);
    const declaringClass = declaringClassText(invokeExpr);
    switch (kind) {
        case "signature_contains":
            return signature.includes(value);
        case "signature_equals":
            return signature === value;
        case "signature_regex":
            return new RegExp(value).test(signature);
        case "declaring_class_equals":
            return declaringClass === value || declaringClass.endsWith(value);
        case "method_name_equals":
            return methodName === value;
        case "method_name_regex":
            return new RegExp(value).test(methodName);
        default:
            return false;
    }
}

function matchesScope(scope: RuleStringConstraint | undefined, haystack: string): boolean {
    if (!scope) return true;
    if (scope.mode === "equals") return haystack === scope.value || haystack.endsWith(scope.value);
    if (scope.mode === "contains") return haystack.includes(scope.value);
    return new RegExp(scope.value).test(haystack);
}
