import { Pag } from "../../../../arkanalyzer/lib/callgraph/pointerAnalysis/Pag";
import {
    ArkArrayRef,
    ArkInstanceFieldRef,
    ArkParameterRef,
    ArkStaticFieldRef,
    ArkThisRef,
} from "../../../../arkanalyzer/lib/core/base/Ref";
import { Local } from "../../../../arkanalyzer/lib/core/base/Local";
import { Constant } from "../../../../arkanalyzer/lib/core/base/Constant";
import {
    AbstractExpr,
    ArkAwaitExpr,
    ArkNewArrayExpr,
    ArkNewExpr,
} from "../../../../arkanalyzer/lib/core/base/Expr";

export interface PagNodeResolutionAuditSnapshot {
    requestCount: number;
    directHitCount: number;
    fallbackResolveCount: number;
    awaitFallbackCount: number;
    exprUseFallbackCount: number;
    anchorLeftFallbackCount: number;
    addAttemptCount: number;
    addFailureCount: number;
    unresolvedCount: number;
    unsupportedValueKinds: Record<string, number>;
}

interface MutablePagNodeResolutionAudit {
    requestCount: number;
    directHitCount: number;
    fallbackResolveCount: number;
    awaitFallbackCount: number;
    exprUseFallbackCount: number;
    anchorLeftFallbackCount: number;
    addAttemptCount: number;
    addFailureCount: number;
    unresolvedCount: number;
    unsupportedValueKinds: Map<string, number>;
}

const pagNodeResolutionAuditByPag = new WeakMap<Pag, MutablePagNodeResolutionAudit>();

export function safeGetOrCreatePagNodes(
    pag: Pag,
    value: any,
    anchorStmt?: any,
): Map<number, number> | undefined {
    const audit = getMutableAudit(pag);
    audit.requestCount++;
    let nodes = pag.getNodesByValue(value);
    if (nodes && nodes.size > 0) {
        audit.directHitCount++;
        return nodes;
    }

    const pagValue = resolvePagNodeValue(value, anchorStmt, new Set(), audit);
    if (!pagValue) {
        audit.unresolvedCount++;
        recordValueKind(audit.unsupportedValueKinds, value);
        return undefined;
    }
    if (pagValue !== value) {
        audit.fallbackResolveCount++;
    }

    if (pagValue !== value) {
        nodes = pag.getNodesByValue(pagValue);
        if (nodes && nodes.size > 0) {
            return nodes;
        }
    }

    if (!anchorStmt) {
        return nodes;
    }

    try {
        audit.addAttemptCount++;
        pag.addPagNode(0, pagValue, anchorStmt);
    } catch {
        audit.addFailureCount++;
        return undefined;
    }
    return pag.getNodesByValue(pagValue);
}

export function resolvePagNodeValue(
    value: any,
    anchorStmt?: any,
    visiting: Set<any> = new Set(),
    audit?: MutablePagNodeResolutionAudit,
): any | undefined {
    if (!value || visiting.has(value)) {
        return undefined;
    }
    visiting.add(value);

    if (isBuildablePagValue(value)) {
        return value;
    }

    if (value instanceof ArkAwaitExpr) {
        audit && audit.awaitFallbackCount++;
        return resolvePagNodeValue(value.getPromise?.(), anchorStmt, visiting, audit);
    }

    if (value instanceof AbstractExpr) {
        const uses = value.getUses?.() || [];
        for (const use of uses) {
            audit && audit.exprUseFallbackCount++;
            const resolved = resolvePagNodeValue(use, anchorStmt, visiting, audit);
            if (resolved) {
                return resolved;
            }
        }
    }

    const left = anchorStmt?.getLeftOp?.();
    if (left && left !== value) {
        audit && audit.anchorLeftFallbackCount++;
        return resolvePagNodeValue(left, undefined, visiting, audit);
    }

    return undefined;
}

export function isBuildablePagValue(value: any): boolean {
    return value instanceof Local
        || value instanceof ArkInstanceFieldRef
        || value instanceof ArkStaticFieldRef
        || value instanceof ArkArrayRef
        || value instanceof ArkNewExpr
        || value instanceof ArkNewArrayExpr
        || value instanceof ArkParameterRef
        || value instanceof ArkThisRef
        || value instanceof Constant;
}

export function resetPagNodeResolutionAudit(pag: Pag): void {
    pagNodeResolutionAuditByPag.set(pag, createMutableAudit());
}

export function getPagNodeResolutionAuditSnapshot(pag: Pag): PagNodeResolutionAuditSnapshot {
    const audit = getMutableAudit(pag);
    return {
        requestCount: audit.requestCount,
        directHitCount: audit.directHitCount,
        fallbackResolveCount: audit.fallbackResolveCount,
        awaitFallbackCount: audit.awaitFallbackCount,
        exprUseFallbackCount: audit.exprUseFallbackCount,
        anchorLeftFallbackCount: audit.anchorLeftFallbackCount,
        addAttemptCount: audit.addAttemptCount,
        addFailureCount: audit.addFailureCount,
        unresolvedCount: audit.unresolvedCount,
        unsupportedValueKinds: toSortedRecord(audit.unsupportedValueKinds),
    };
}

export function emptyPagNodeResolutionAuditSnapshot(): PagNodeResolutionAuditSnapshot {
    return {
        requestCount: 0,
        directHitCount: 0,
        fallbackResolveCount: 0,
        awaitFallbackCount: 0,
        exprUseFallbackCount: 0,
        anchorLeftFallbackCount: 0,
        addAttemptCount: 0,
        addFailureCount: 0,
        unresolvedCount: 0,
        unsupportedValueKinds: {},
    };
}

function getMutableAudit(pag: Pag): MutablePagNodeResolutionAudit {
    let audit = pagNodeResolutionAuditByPag.get(pag);
    if (!audit) {
        audit = createMutableAudit();
        pagNodeResolutionAuditByPag.set(pag, audit);
    }
    return audit;
}

function createMutableAudit(): MutablePagNodeResolutionAudit {
    return {
        requestCount: 0,
        directHitCount: 0,
        fallbackResolveCount: 0,
        awaitFallbackCount: 0,
        exprUseFallbackCount: 0,
        anchorLeftFallbackCount: 0,
        addAttemptCount: 0,
        addFailureCount: 0,
        unresolvedCount: 0,
        unsupportedValueKinds: new Map<string, number>(),
    };
}

function recordValueKind(target: Map<string, number>, value: any): void {
    const kind = resolveValueKind(value);
    target.set(kind, (target.get(kind) || 0) + 1);
}

function resolveValueKind(value: any): string {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    const ctor = value?.constructor?.name;
    if (typeof ctor === "string" && ctor.trim().length > 0) {
        return ctor;
    }
    return typeof value;
}

function toSortedRecord(map: Map<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        out[key] = value;
    }
    return out;
}
