import { TaintFlow } from "../../kernel/model/TaintFlow";
import { ProvenancePath } from "../../provenance/ProvenancePathTypes";
import { PostsolveContext, PostsolveEvidence } from "./PostsolveTypes";
import { resolveSafeOverwriteFromReadExpr } from "./PostsolveSharedEvidence";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";

export function evaluateSafeOverwritePath(
    flow: TaintFlow,
    path: ProvenancePath,
    context: PostsolveContext,
): PostsolveEvidence[] {
    const readSites = collectCandidateReadSites(path, context);
    for (const site of readSites) {
        const resolution = resolveSafeOverwriteFromReadExpr(site.readExpr, {
            declStmt: site.stmt,
            sinkNodeId: flow.sinkNodeId,
            sinkFieldPath: flow.sinkFieldPath ? [...flow.sinkFieldPath] : undefined,
        });
        if (!resolution) continue;
        return [{
            kind: "safe_overwrite",
            polarity: "negative",
            strength: "strong",
            stability: "stable",
            position: {
                factId: site.factId,
                stmtText: resolution.hit.overwriteStmtText,
                methodSignature: site.stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "",
            },
            target: {
                sinkFactId: flow.sinkFactId || "",
                sinkNodeId: flow.sinkNodeId,
            },
            meta: {
                reason: "safe_overwrite",
                keyLiteral: resolution.hit.keyLiteral,
                sinkNodeId: resolution.hit.sinkNodeId,
                sinkFieldPath: resolution.hit.sinkFieldPath ? [...resolution.hit.sinkFieldPath] : undefined,
                overwriteStmtText: resolution.hit.overwriteStmtText,
                readStmtText: site.stmt?.toString?.() || undefined,
            },
        }];
    }
    return [];
}

export function collectCandidateReadSites(
    path: ProvenancePath,
    context: PostsolveContext,
): Array<{
    factId?: string;
    stmt: any;
    readExpr: any;
}> {
    const facts = path.factIds
        .map(factId => ({
            factId,
            fact: context.observedFactsById.get(factId),
        }))
        .filter((item): item is { factId: string; fact: NonNullable<typeof item.fact> } => !!item.fact);

    const directSites: Array<{ factId?: string; stmt: any; readExpr: any }> = [];
    const receiverLocalsByMethod = new Map<string, { method: any; locals: Local[] }>();
    const seenStmtKeys = new Set<string>();

    for (const item of facts) {
        const stmt = resolveAnchorStmtFromFact(item.fact);
        if (!stmt) continue;

        const directRead = extractReadExprFromStmt(stmt);
        if (isStorageReadExpr(directRead)) {
            const key = buildStmtKey(stmt);
            if (!seenStmtKeys.has(key)) {
                seenStmtKeys.add(key);
                directSites.push({ factId: item.factId, stmt, readExpr: directRead });
            }
        }

        const receiverLocal = extractAssignedLocal(stmt);
        if (!(receiverLocal instanceof Local)) continue;
        const method = stmt.getCfg?.()?.getDeclaringMethod?.();
        const methodSig = method?.getSignature?.()?.toString?.() || "";
        if (!method || !methodSig) continue;
        const bucket = receiverLocalsByMethod.get(methodSig) || { method, locals: [] as Local[] };
        if (!receiverLocalsByMethod.has(methodSig)) {
            receiverLocalsByMethod.set(methodSig, bucket);
        }
        if (!bucket.locals.some(local => sameLocal(local, receiverLocal))) {
            bucket.locals.push(receiverLocal);
        }
    }

    const scannedSites: Array<{ factId?: string; stmt: any; readExpr: any }> = [];
    for (const { method, locals } of receiverLocalsByMethod.values()) {
        const cfg = method.getCfg?.();
        const stmts = cfg?.getStmts?.() || [];
        for (const stmt of stmts) {
            const readExpr = extractReadExprFromStmt(stmt);
            if (!isStorageReadExpr(readExpr)) continue;
            const base = readExpr.getBase?.();
            if (!(base instanceof Local)) continue;
            if (!locals.some(local => sameLocal(local, base))) continue;
            const key = buildStmtKey(stmt);
            if (seenStmtKeys.has(key)) continue;
            seenStmtKeys.add(key);
            scannedSites.push({ stmt, readExpr });
        }
    }

    return [...directSites, ...scannedSites];
}

function extractReadExprFromStmt(stmt: any): any | undefined {
    const right = stmt?.getRightOp?.();
    if (right?.getMethodSignature) return right;
    const invokeExpr = stmt?.getInvokeExpr?.();
    if (invokeExpr?.getMethodSignature) return invokeExpr;
    return undefined;
}

function isStorageReadExpr(expr: any): boolean {
    const methodName = expr?.getMethodSignature?.()?.getMethodSubSignature?.()?.getMethodName?.() || "";
    return methodName === "get" || methodName === "getSync";
}

function extractAssignedLocal(stmt: any): Local | undefined {
    const left = stmt?.getLeftOp?.();
    return left instanceof Local ? left : undefined;
}

function sameLocal(left: Local, right: Local): boolean {
    if (left === right) return true;
    return String(left?.toString?.() || "") === String(right?.toString?.() || "");
}

function buildStmtKey(stmt: any): string {
    const methodSig = stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.() || "";
    const text = stmt?.toString?.() || "";
    return `${methodSig}::${text}`;
}

function resolveAnchorStmtFromFact(fact: any): any | undefined {
    const nodeStmt = fact?.node?.getStmt?.();
    if (nodeStmt) return nodeStmt;
    const value = fact?.node?.getValue?.();
    if (value?.getDeclaringStmt) return value.getDeclaringStmt?.();
    return undefined;
}

