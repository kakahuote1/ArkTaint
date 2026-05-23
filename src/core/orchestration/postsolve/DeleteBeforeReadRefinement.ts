import { ArkInstanceInvokeExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { TaintFlow } from "../../kernel/model/TaintFlow";
import { ProvenancePath } from "../../provenance/ProvenancePathTypes";
import { PostsolveContext, PostsolveEvidence } from "./PostsolveTypes";
import { collectCandidateReadSites } from "./SafeOverwriteRefinement";
import { methodSignatureTextFromStmt, normalizeQuotedLiteral, sameValueLike } from "./PostsolveRuleUtils";

export function evaluateDeleteBeforeReadPath(
    flow: TaintFlow,
    path: ProvenancePath,
    context: PostsolveContext,
): PostsolveEvidence[] {
    const readSites = collectCandidateReadSites(path, context);
    const fallbackSite = resolveSinkReadSite(flow, context);
    if (fallbackSite) {
        readSites.push(fallbackSite);
    }
    for (const site of readSites) {
        const hit = resolveDeleteBeforeRead(site.readExpr, site.stmt);
        if (!hit) continue;
        return [{
            kind: "delete_before_read",
            polarity: "negative",
            strength: "strong",
            stability: "stable",
            position: {
                factId: site.factId,
                stmtText: hit.deleteStmtText,
                methodSignature: methodSignatureTextFromStmt(site.stmt),
            },
            target: {
                sinkFactId: flow.sinkFactId || "",
                sinkNodeId: flow.sinkNodeId,
            },
            meta: {
                reason: "delete_before_read",
                keyLiteral: hit.keyLiteral,
                deleteStmtText: hit.deleteStmtText,
                readStmtText: site.stmt?.toString?.() || "",
            },
        }];
    }
    return [];
}

function resolveSinkReadSite(
    flow: TaintFlow,
    context: PostsolveContext,
): {
    factId?: string;
    stmt: any;
    readExpr: any;
} | undefined {
    if (!context.pag || flow.sinkNodeId === undefined) return undefined;
    const sinkNode: any = context.pag.getNode?.(flow.sinkNodeId);
    const value = sinkNode?.getValue?.();
    if (!(value instanceof Local)) return undefined;
    const declStmt = value.getDeclaringStmt?.();
    if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp?.() !== value) return undefined;
    const right = declStmt.getRightOp?.();
    if (!(right instanceof ArkInstanceInvokeExpr)) return undefined;
    return {
        factId: flow.sinkFactId,
        stmt: declStmt,
        readExpr: right,
    };
}

function resolveDeleteBeforeRead(
    readExpr: any,
    readStmt: any,
): {
    keyLiteral?: string;
    deleteStmtText?: string;
} | undefined {
    if (!(readExpr instanceof ArkInstanceInvokeExpr)) return undefined;
    const methodName = readExpr.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    if (methodName !== "get" && methodName !== "getSync" && methodName !== "getItem") return undefined;
    if (!isKnownKeyedStorageSignature(String(readExpr.getMethodSignature?.()?.toString?.() || ""))) return undefined;
    const args = readExpr.getArgs?.() || [];
    const readKey = args.length > 0 ? normalizeQuotedLiteral(String(args[0]?.toString?.() || "")) : undefined;
    if (!readKey) return undefined;
    const cfg = readStmt?.getCfg?.();
    const stmts: any[] = cfg?.getStmts?.() || [];
    const readIndex = stmts.indexOf(readStmt);
    if (readIndex <= 0) return undefined;

    for (let i = readIndex - 1; i >= 0; i--) {
        const stmt = stmts[i];
        if (!stmt?.containsInvokeExpr?.()) continue;
        const inv = stmt.getInvokeExpr?.();
        if (!(inv instanceof ArkInstanceInvokeExpr)) continue;
        if (!sameReceiver(inv, readExpr)) continue;
        const invName = inv.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
        if (isPutMethod(invName) && sameKey(inv, readKey)) {
            return undefined;
        }
        if (isDeleteMethod(invName) && (invName === "clear" || sameKey(inv, readKey))) {
            return {
                keyLiteral: invName === "clear" ? "*" : readKey,
                deleteStmtText: stmt?.toString?.() || "",
            };
        }
    }
    return undefined;
}

function sameReceiver(left: ArkInstanceInvokeExpr, right: ArkInstanceInvokeExpr): boolean {
    return sameValueLike(left.getBase?.(), right.getBase?.());
}

function sameKey(invokeExpr: ArkInstanceInvokeExpr, key: string): boolean {
    const args = invokeExpr.getArgs?.() || [];
    if (args.length === 0) return false;
    const current = normalizeQuotedLiteral(String(args[0]?.toString?.() || ""));
    return current === key;
}

function isPutMethod(name: string): boolean {
    return name === "put" || name === "putSync" || name === "set" || name === "setSync" || name === "setItem";
}

function isDeleteMethod(name: string): boolean {
    return name === "delete"
        || name === "deleteSync"
        || name === "remove"
        || name === "removeSync"
        || name === "deleteKey"
        || name === "deleteItem"
        || name === "clear";
}

function isKnownKeyedStorageSignature(signature: string): boolean {
    const text = signature.toLowerCase();
    return text.includes("preferences")
        || text.includes("distributedkv")
        || text.includes("kvstore")
        || text.includes("storage");
}
