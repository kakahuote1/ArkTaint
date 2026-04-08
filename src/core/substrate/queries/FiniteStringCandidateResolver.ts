import { Scene } from "../../../../arkanalyzer/lib/Scene";
import { ArkAssignStmt, ArkReturnStmt } from "../../../../arkanalyzer/lib/core/base/Stmt";
import { ArkInstanceInvokeExpr, ArkStaticInvokeExpr } from "../../../../arkanalyzer/lib/core/base/Expr";
import { Constant } from "../../../../arkanalyzer/lib/core/base/Constant";
import { Local } from "../../../../arkanalyzer/lib/core/base/Local";
import { collectParameterAssignStmts } from "./CalleeResolver";

const MAX_STRING_CANDIDATES = 6;

export function collectFiniteStringCandidatesFromValue(
    scene: Scene,
    value: any,
    maxDepth: number = 4
): string[] {
    const out = new Set<string>();
    const visited = new Set<string>();
    collectCandidates(scene, value, 0, maxDepth, visited, out);
    return [...out].slice(0, MAX_STRING_CANDIDATES);
}

function collectCandidates(
    scene: Scene,
    value: any,
    depth: number,
    maxDepth: number,
    visited: Set<string>,
    out: Set<string>
): void {
    if (!value || depth > maxDepth || out.size >= MAX_STRING_CANDIDATES) {
        return;
    }

    const directLiteral = resolveClosedStringLiteral(value);
    if (directLiteral) {
        out.add(directLiteral);
        return;
    }

    const quotedLiterals = extractQuotedStringLiterals(value?.toString?.() || "");
    if (quotedLiterals.length > 0) {
        for (const literal of quotedLiterals) {
            if (out.size >= MAX_STRING_CANDIDATES) break;
            out.add(literal);
        }
        if (!(value instanceof Local) && !isInvokeExpr(value)) {
            return;
        }
    }

    if (value instanceof Local) {
        const localKey = `local:${value.getName?.() || value.toString?.() || "<local>"}`;
        if (visited.has(localKey)) return;
        visited.add(localKey);

        const declaringStmt: any = value.getDeclaringStmt?.();
        if (declaringStmt instanceof ArkAssignStmt) {
            collectCandidates(scene, declaringStmt.getRightOp?.(), depth + 1, maxDepth, visited, out);
        }
        return;
    }

    if (!isInvokeExpr(value)) {
        return;
    }

    for (const target of resolveInvokeTargets(scene, value)) {
        const targetSig = target.getSignature?.().toString?.() || target.getName?.() || "<method>";
        const methodKey = `method:${targetSig}`;
        if (visited.has(methodKey)) continue;
        visited.add(methodKey);

        const returnStmts: any[] = target.getReturnStmt?.() || collectReturnStmtsFromCfg(target);
        const booleanBindings = resolveBooleanParamBindings(target, value);
        for (const retStmt of returnStmts) {
            const retValue = retStmt?.getOp?.();
            if (!retValue) continue;
            const narrowed = tryResolveBooleanTernaryLiteral(retValue, booleanBindings);
            if (narrowed !== undefined) {
                out.add(narrowed);
                continue;
            }
            collectCandidates(scene, retValue, depth + 1, maxDepth, visited, out);
        }
    }
}

function resolveClosedStringLiteral(value: any): string | undefined {
    if (!value) return undefined;
    if (value instanceof Constant) {
        return normalizeClosedString(String(value.getValue?.() ?? ""));
    }
    return normalizeClosedString(String(value?.toString?.() || ""));
}

function normalizeClosedString(text: string): string | undefined {
    const raw = String(text || "").trim();
    if (raw.length < 2) return undefined;
    const quote = raw[0];
    if ((quote !== "'" && quote !== "\"" && quote !== "`") || raw[raw.length - 1] !== quote) {
        return undefined;
    }
    let out = "";
    let escaping = false;
    for (let i = 1; i < raw.length - 1; i++) {
        const ch = raw[i];
        if (escaping) {
            out += ch;
            escaping = false;
            continue;
        }
        if (ch === "\\") {
            escaping = true;
            continue;
        }
        if (ch === quote) {
            return undefined;
        }
        out += ch;
    }
    return escaping ? undefined : out;
}

function extractQuotedStringLiterals(text: string): string[] {
    const out = new Set<string>();
    const raw = String(text || "");
    const pattern = /(['"`])((?:\\.|(?!\1).)+)\1/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw)) !== null) {
        if (out.size >= MAX_STRING_CANDIDATES) break;
        const literal = normalizeClosedString(match[0]);
        if (literal !== undefined) {
            out.add(literal);
        }
    }
    return [...out];
}

function isInvokeExpr(value: any): value is ArkInstanceInvokeExpr | ArkStaticInvokeExpr {
    return value instanceof ArkInstanceInvokeExpr || value instanceof ArkStaticInvokeExpr;
}

function resolveInvokeTargets(scene: Scene, invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr): any[] {
    const out = new Map<string, any>();
    const methodSigText = invokeExpr.getMethodSignature?.()?.toString?.() || "";
    if (methodSigText) {
        for (const method of scene.getMethods()) {
            const sig = method.getSignature?.().toString?.() || "";
            if (sig === methodSigText) {
                out.set(sig, method);
            }
        }
    }

    if (out.size > 0) return [...out.values()];

    const methodName = invokeExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    const declaringClass = invokeExpr.getMethodSignature?.()?.getDeclaringClassSignature?.()?.toString?.() || "";
    for (const method of scene.getMethods()) {
        const sig = method.getSignature?.().toString?.() || "";
        const sameName = method.getName?.() === methodName;
        const sameClass = declaringClass.length > 0 && sig.includes(declaringClass);
        if (sameName && sameClass) {
            out.set(sig, method);
        }
    }
    return [...out.values()];
}

function collectReturnStmtsFromCfg(method: any): any[] {
    const cfg = method.getCfg?.();
    if (!cfg) return [];
    return cfg.getStmts().filter((stmt: any) => stmt instanceof ArkReturnStmt);
}

function resolveBooleanParamBindings(
    method: any,
    invokeExpr: ArkInstanceInvokeExpr | ArkStaticInvokeExpr
): Map<string, boolean> {
    const out = new Map<string, boolean>();
    const invokeArgs = invokeExpr.getArgs?.() || [];
    const paramAssigns = collectParameterAssignStmts(method);
    for (const paramStmt of paramAssigns) {
        const right: any = paramStmt.getRightOp?.();
        const index = right?.getIndex?.();
        if (typeof index !== "number" || index < 0 || index >= invokeArgs.length) continue;
        const actualArg = invokeArgs[index];
        const boolValue = parseBooleanLiteral(actualArg);
        if (boolValue === undefined) continue;
        const leftText = String(paramStmt.getLeftOp?.()?.toString?.() || "").trim();
        if (!leftText) continue;
        out.set(leftText, boolValue);
    }
    return out;
}

function tryResolveBooleanTernaryLiteral(value: any, bindings: Map<string, boolean>): string | undefined {
    if (bindings.size === 0) return undefined;
    let exprText = String(value?.toString?.() || "").trim();
    exprText = stripOuterParens(exprText);
    const ternary = exprText.match(/^(.+?)\?\s*(['"`](?:\\.|[^'"`])+['"`])\s*:\s*(['"`](?:\\.|[^'"`])+['"`])$/);
    if (!ternary) return undefined;

    const conditionText = stripOuterParens(String(ternary[1] || "").trim());
    for (const [paramName, boolValue] of bindings.entries()) {
        const evaluated = evaluateBooleanCondition(conditionText, paramName, boolValue);
        if (evaluated === undefined) continue;
        const branchText = evaluated ? ternary[2] : ternary[3];
        return normalizeClosedString(branchText);
    }
    return undefined;
}

function evaluateBooleanCondition(text: string, paramName: string, value: boolean): boolean | undefined {
    const normalized = stripOuterParens(text.replace(/\s+/g, ""));
    const param = escapeForRegex(paramName);
    if (new RegExp(`^${param}$`).test(normalized)) return value;
    if (new RegExp(`^!${param}$`).test(normalized)) return !value;
    if (new RegExp(`^${param}(===|==)true$`).test(normalized)) return value;
    if (new RegExp(`^${param}(===|==)false$`).test(normalized)) return !value;
    if (new RegExp(`^true(===|==)${param}$`).test(normalized)) return value;
    if (new RegExp(`^false(===|==)${param}$`).test(normalized)) return !value;
    return undefined;
}

function parseBooleanLiteral(value: any): boolean | undefined {
    const text = String(value?.toString?.() || "").trim();
    if (text === "true") return true;
    if (text === "false") return false;
    return undefined;
}

function stripOuterParens(text: string): string {
    let out = String(text || "").trim();
    while (out.startsWith("(") && out.endsWith(")")) {
        out = out.slice(1, -1).trim();
    }
    return out;
}

function escapeForRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
