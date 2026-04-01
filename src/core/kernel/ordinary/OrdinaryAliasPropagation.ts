import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { ArkInstanceFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { ArkAwaitExpr, ArkCastExpr, ArkPhiExpr } from "../../../../arkanalyzer/out/src/core/base/Expr";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";

const MAX_ALIAS_RESOLUTION_DEPTH = 8;

export function isCarrierAliasNode(aliasNode: PagNode, carrierNodeId: number): boolean {
    if (aliasNode.getID() === carrierNodeId) return true;
    const pts = aliasNode.getPointTo();
    return !!(pts && pts.contains(carrierNodeId));
}

export function collectAliasLocalsForCarrier(
    pag: Pag,
    carrierNodeId: number,
    classBySignature?: Map<string, any>,
): Local[] {
    const results: Local[] = [];
    const seen = new Set<string>();
    const directAliasLocals: Local[] = [];

    for (const rawNode of pag.getNodesIter()) {
        const aliasNode = rawNode as PagNode;
        if (!isCarrierAliasNode(aliasNode, carrierNodeId)) continue;

        const value = aliasNode.getValue?.();
        if (!(value instanceof Local)) continue;

        const key = `${value.getName?.() || ""}#${value.getDeclaringStmt?.()?.toString?.() || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(value);
        directAliasLocals.push(value);
    }

    if (!classBySignature || directAliasLocals.length === 0) {
        return results;
    }

    const directAliasLocalNames = new Set<string>();
    const methodLocalIndex = new Map<string, Map<string, Local[]>>();
    for (const local of directAliasLocals) {
        const name = local.getName?.() || "";
        if (!name) continue;
        directAliasLocalNames.add(name);
    }

    for (const rawNode of pag.getNodesIter()) {
        const candidateNode = rawNode as PagNode;
        const candidateValue = candidateNode.getValue?.();
        if (!(candidateValue instanceof Local)) continue;

        const declStmt = candidateValue.getDeclaringStmt?.();
        if (!(declStmt instanceof ArkAssignStmt) || declStmt.getLeftOp() !== candidateValue) continue;
        const rhs = declStmt.getRightOp();
        if (!(rhs instanceof ArkInstanceFieldRef)) continue;
        const base = rhs.getBase?.();
        if (!(base instanceof Local)) continue;

        const baseMethodSig = resolveDeclaringMethodSignature(base);
        if (!baseMethodSig) continue;
        const baseClassSig = resolveValueClassSignatureAtStmt(base, declStmt, 0, new Set<string>());
        if (!baseClassSig) continue;
        const arkClass = classBySignature.get(baseClassSig);
        if (!arkClass) continue;

        const fieldName = rhs.getFieldSignature?.().getFieldName?.() || rhs.getFieldName?.();
        if (!fieldName) continue;
        const capturedLocalNames = resolveCapturedLocalNamesForField(arkClass, fieldName);
        if (capturedLocalNames.length === 0) continue;

        const localIndex = ensureMethodLocalIndex(methodLocalIndex, pag, baseMethodSig);
        const hasDirectCarrierCapture = capturedLocalNames.some(name => directAliasLocalNames.has(name));
        if (!hasDirectCarrierCapture) continue;

        const key = `${candidateValue.getName?.() || ""}#${candidateValue.getDeclaringStmt?.()?.toString?.() || ""}`;
        if (seen.has(key)) continue;

        const carrierIds = collectCarrierNodeIdsForValueAtStmt(
            pag,
            candidateValue,
            declStmt,
            classBySignature,
            methodLocalIndex,
        );
        if (!carrierIds.includes(carrierNodeId)) continue;

        seen.add(key);
        results.push(candidateValue);
    }

    return results;
}

export function collectCarrierNodeIdsForValueAtStmt(
    pag: Pag,
    value: any,
    anchorStmt: any,
    classBySignature?: Map<string, any>,
    methodLocalIndexCache?: Map<string, Map<string, Local[]>>,
): number[] {
    const out = resolveCarrierNodeIdsForValueAtStmt(
        pag,
        value,
        anchorStmt,
        classBySignature,
        methodLocalIndexCache,
        0,
        new Set<string>(),
    );
    return [...new Set(out)];
}

function resolveCarrierNodeIdsForValueAtStmt(
    pag: Pag,
    value: any,
    anchorStmt: any,
    classBySignature: Map<string, any> | undefined,
    methodLocalIndexCache: Map<string, Map<string, Local[]>> | undefined,
    depth: number,
    visiting: Set<string>,
): number[] {
    if (depth > MAX_ALIAS_RESOLUTION_DEPTH) {
        return fallbackCarrierNodeIds(pag, value, anchorStmt);
    }

    if (!(value instanceof Local)) {
        return fallbackCarrierNodeIds(pag, value, anchorStmt);
    }

    const methodSig = resolveDeclaringMethodSignature(value) || resolveDeclaringMethodSignatureFromStmt(anchorStmt) || "";
    const visitKey = `${methodSig}::${value.getName?.() || ""}@${depth}`;
    if (visiting.has(visitKey)) {
        return fallbackCarrierNodeIds(pag, value, anchorStmt);
    }
    visiting.add(visitKey);

    const latestAssign = findLatestAssignStmtForLocalBefore(value, anchorStmt);
    if (!latestAssign) {
        return fallbackCarrierNodeIds(pag, value, anchorStmt);
    }

    const rhs = latestAssign.getRightOp();
    if (rhs instanceof Local) {
        return resolveCarrierNodeIdsForValueAtStmt(
            pag,
            rhs,
            anchorStmt,
            classBySignature,
            methodLocalIndexCache,
            depth + 1,
            visiting,
        );
    }

    if (rhs instanceof ArkCastExpr) {
        return resolveCarrierNodeIdsForValueAtStmt(
            pag,
            rhs.getOp?.(),
            anchorStmt,
            classBySignature,
            methodLocalIndexCache,
            depth + 1,
            visiting,
        );
    }

    if (rhs instanceof ArkAwaitExpr) {
        return resolveCarrierNodeIdsForValueAtStmt(
            pag,
            rhs.getPromise?.(),
            anchorStmt,
            classBySignature,
            methodLocalIndexCache,
            depth + 1,
            visiting,
        );
    }

    if (rhs instanceof ArkPhiExpr) {
        return fallbackCarrierNodeIds(pag, value, anchorStmt);
    }

    if (rhs instanceof ArkInstanceFieldRef && classBySignature) {
        const capturedCarrierIds = resolveCapturedCarrierNodeIdsFromObjectLiteralField(
            pag,
            rhs,
            anchorStmt,
            classBySignature,
            methodLocalIndexCache,
            depth + 1,
            visiting,
        );
        if (capturedCarrierIds.length > 0) {
            return capturedCarrierIds;
        }
    }

    return fallbackCarrierNodeIds(pag, value, anchorStmt);
}

function resolveCapturedCarrierNodeIdsFromObjectLiteralField(
    pag: Pag,
    fieldRef: ArkInstanceFieldRef,
    anchorStmt: any,
    classBySignature: Map<string, any>,
    methodLocalIndexCache: Map<string, Map<string, Local[]>> | undefined,
    depth: number,
    visiting: Set<string>,
): number[] {
    const base = fieldRef.getBase?.();
    if (!(base instanceof Local)) return [];

    const baseClassSig = resolveValueClassSignatureAtStmt(base, anchorStmt, depth + 1, new Set<string>());
    if (!baseClassSig) return [];
    const arkClass = classBySignature.get(baseClassSig);
    if (!arkClass) return [];

    const fieldName = fieldRef.getFieldSignature?.().getFieldName?.() || fieldRef.getFieldName?.();
    if (!fieldName) return [];

    const capturedLocalNames = resolveCapturedLocalNamesForField(arkClass, fieldName);
    if (capturedLocalNames.length === 0) return [];

    const methodSig = resolveDeclaringMethodSignature(base);
    if (!methodSig) return [];

    const localIndex = ensureMethodLocalIndex(methodLocalIndexCache, pag, methodSig);
    const out: number[] = [];
    for (const capturedLocalName of capturedLocalNames) {
        const candidateLocals = localIndex.get(capturedLocalName) || [];
        for (const candidateLocal of candidateLocals) {
            out.push(...resolveCarrierNodeIdsForValueAtStmt(
                pag,
                candidateLocal,
                anchorStmt,
                classBySignature,
                methodLocalIndexCache,
                depth + 1,
                visiting,
            ));
        }
    }

    return [...new Set(out)];
}

function fallbackCarrierNodeIds(
    pag: Pag,
    value: any,
    anchorStmt: any,
): number[] {
    const nodes = safeGetOrCreatePagNodes(pag, value, anchorStmt);
    if (!nodes || nodes.size === 0) return [];
    const out: number[] = [];
    const seen = new Set<number>();
    for (const nodeId of nodes.values()) {
        const node = pag.getNode(nodeId) as PagNode;
        if (!node) continue;
        let hasPointTo = false;
        for (const objId of node.getPointTo()) {
            hasPointTo = true;
            if (seen.has(objId)) continue;
            seen.add(objId);
            out.push(objId);
        }
        if (!hasPointTo && !seen.has(nodeId)) {
            seen.add(nodeId);
            out.push(nodeId);
        }
    }
    return out;
}

function findLatestAssignStmtForLocalBefore(local: Local, anchorStmt: any): ArkAssignStmt | undefined {
    const cfg = anchorStmt?.getCfg?.() || local.getDeclaringStmt?.()?.getCfg?.();
    const stmts = cfg?.getStmts?.();
    if (!stmts) return undefined;

    let latest: ArkAssignStmt | undefined;
    for (const stmt of stmts) {
        if (stmt === anchorStmt) {
            if (stmt instanceof ArkAssignStmt && isSameLocal(stmt.getLeftOp(), local)) {
                latest = stmt;
            }
            break;
        }
        if (!(stmt instanceof ArkAssignStmt)) continue;
        if (!isSameLocal(stmt.getLeftOp(), local)) continue;
        latest = stmt;
    }
    return latest;
}

function ensureMethodLocalIndex(
    cache: Map<string, Map<string, Local[]>> | undefined,
    pag: Pag,
    methodSig: string,
): Map<string, Local[]> {
    if (!cache) {
        return buildMethodLocalIndex(pag, methodSig);
    }
    const existing = cache.get(methodSig);
    if (existing) return existing;
    const built = buildMethodLocalIndex(pag, methodSig);
    cache.set(methodSig, built);
    return built;
}

function buildMethodLocalIndex(
    pag: Pag,
    methodSig: string,
): Map<string, Local[]> {
    const out = new Map<string, Local[]>();
    const seen = new Set<string>();
    for (const rawNode of pag.getNodesIter()) {
        const node = rawNode as PagNode;
        const value = node.getValue?.();
        if (!(value instanceof Local)) continue;
        if (resolveDeclaringMethodSignature(value) !== methodSig) continue;
        const name = value.getName?.() || "";
        if (!name) continue;
        const key = `${name}#${value.getDeclaringStmt?.()?.toString?.() || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!out.has(name)) out.set(name, []);
        out.get(name)!.push(value);
    }
    return out;
}

function resolveCapturedLocalNamesForField(arkClass: any, fieldName: string): string[] {
    const out: string[] = [];
    const fields = arkClass?.getFields?.() || [];
    for (const field of fields) {
        const candidateName = field?.getSignature?.()?.getFieldName?.() || field?.getName?.();
        if (candidateName !== fieldName) continue;
        const initializer = field?.getInitializer?.();
        const rhsLocalName = normalizeCapturedLocalFromInitializer(initializer);
        if (rhsLocalName) {
            out.push(rhsLocalName);
            continue;
        }
        const initializerText = String(initializer?.toString?.() || "").trim();
        if (!initializerText) {
            out.push(fieldName);
            continue;
        }
        const normalized = normalizeCapturedLocalToken(extractInitializerRhsText(initializerText));
        if (normalized) {
            out.push(normalized);
        }
    }
    return [...new Set(out)];
}

function normalizeCapturedLocalFromInitializer(initializer: any): string | undefined {
    if (!(initializer instanceof ArkAssignStmt)) return undefined;
    const right = initializer.getRightOp?.();
    if (right instanceof Local) {
        return right.getName?.() || undefined;
    }
    return normalizeCapturedLocalToken(extractInitializerRhsText(String(initializer.toString?.() || "")));
}

function normalizeCapturedLocalToken(text: string): string | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    if (/^['"`].*['"`]$/.test(trimmed)) return undefined;
    return /^[%A-Za-z_$][%A-Za-z0-9_$]*$/.test(trimmed) ? trimmed : undefined;
}

function extractInitializerRhsText(text: string): string {
    const parts = text.split("=");
    return parts.length >= 2 ? parts.slice(1).join("=").trim() : text.trim();
}

function resolveDeclaringMethodSignature(local: Local): string | undefined {
    return local.getDeclaringStmt?.()?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
}

function resolveDeclaringMethodSignatureFromStmt(stmt: any): string | undefined {
    return stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
}

function resolveLocalClassSignature(local: Local): string | undefined {
    const typeAny = local.getType?.() as any;
    const classSig = typeAny?.getClassSignature?.();
    const text = classSig?.toString?.() || "";
    return text || undefined;
}

function resolveValueClassSignatureAtStmt(
    value: any,
    anchorStmt: any,
    depth: number,
    visiting: Set<string>,
): string | undefined {
    if (depth > MAX_ALIAS_RESOLUTION_DEPTH) return undefined;
    const direct = resolveClassSignatureFromValue(value);
    if (direct) return direct;

    if (!(value instanceof Local)) return undefined;

    const methodSig = resolveDeclaringMethodSignature(value) || resolveDeclaringMethodSignatureFromStmt(anchorStmt) || "";
    const visitKey = `${methodSig}::${value.getName?.() || ""}@class`;
    if (visiting.has(visitKey)) return undefined;
    visiting.add(visitKey);

    const latestAssign = findLatestAssignStmtForLocalBefore(value, anchorStmt);
    if (!latestAssign) return undefined;
    return resolveValueClassSignatureAtStmt(latestAssign.getRightOp(), latestAssign, depth + 1, visiting);
}

function resolveClassSignatureFromValue(value: any): string | undefined {
    if (!value) return undefined;
    const typeAny = value.getType?.() as any;
    const classSig = typeAny?.getClassSignature?.();
    const text = classSig?.toString?.() || "";
    if (text) return text;
    return value.getClassSignature?.()?.toString?.() || undefined;
}

function isSameLocal(candidate: any, local: Local): boolean {
    return candidate instanceof Local
        && (candidate === local || (candidate.getName?.() || "") === (local.getName?.() || ""));
}
