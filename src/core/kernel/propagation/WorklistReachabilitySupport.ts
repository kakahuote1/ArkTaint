import { ArkArrayRef, ArkInstanceFieldRef } from "../../../../arkanalyzer/out/src/core/base/Ref";
import { Pag, PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";
import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";
import { TaintContextManager } from "../context/TaintContext";
import { safeGetOrCreatePagNodes } from "../contracts/PagNodeResolution";

const ANY_CLASS_SIG = "__ANY_CLASS__";

export type ThisFieldFallbackLoadNodeIds = Map<string, Map<string, Map<string, Set<number>>>>;

export function resolveDeclaringMethodSignature(node: PagNode): string | undefined {
    const stmt: any = (node as any)?.stmt;
    const cfg = stmt?.getCfg?.();
    const method = cfg?.getDeclaringMethod?.();
    return method?.getSignature?.()?.toString?.();
}

export function normalizeSharedStateContext(ctxManager: TaintContextManager, currentCtx: number): number {
    const topElem = ctxManager.getTopElement(currentCtx);
    return topElem === -1 ? currentCtx : ctxManager.restoreCallerContext(currentCtx);
}

export function isNodeAllowedByReachability(node: PagNode, allowedMethodSignatures?: Set<string>): boolean {
    if (!allowedMethodSignatures || allowedMethodSignatures.size === 0) return true;
    const methodSig = resolveMethodSignatureByNode(node);
    if (!methodSig) return true;
    return allowedMethodSignatures.has(methodSig);
}

export function resolveMethodSignatureByNode(node: PagNode): string | undefined {
    const stmt = node.getStmt?.();
    const stmtSig = stmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
    if (stmtSig) return stmtSig;

    const funcSig = (node as any).getMethod?.()?.toString?.();
    if (funcSig) return funcSig;

    const value = node.getValue?.();
    return resolveMethodSignatureByValue(value);
}

export function resolveMethodSignatureByValue(value: any): string | undefined {
    if (!value) return undefined;
    if (value instanceof Local) {
        const declStmt = value.getDeclaringStmt?.();
        const sig = declStmt?.getCfg?.()?.getDeclaringMethod?.()?.getSignature?.()?.toString?.();
        if (sig) return sig;
    }
    if (value instanceof ArkInstanceFieldRef || value instanceof ArkArrayRef) {
        const base = value.getBase?.();
        return resolveMethodSignatureByValue(base);
    }
    const valueSig = value.getMethodSignature?.()?.toString?.();
    if (valueSig) return valueSig;
    return undefined;
}

export function extractFilePathFromMethodSignature(methodSig?: string): string {
    if (!methodSig) return "";
    const m = methodSig.match(/@([^:>]+):/);
    return m ? m[1].replace(/\\/g, "/") : "";
}

export function buildClassSignatureIndex(scene: Scene): Map<string, any> {
    const out = new Map<string, any>();
    for (const cls of scene.getClasses()) {
        const sig = cls.getSignature?.().toString?.() || "";
        if (!sig) continue;
        out.set(sig, cls);
    }
    return out;
}

export function resolveObjectClassSignatureByNode(node: PagNode): string | undefined {
    const value: any = node?.getValue?.();
    const fromType = value?.getType?.()?.getClassSignature?.()?.toString?.();
    if (fromType) return fromType;
    const direct = value?.getClassSignature?.()?.toString?.();
    if (direct) return direct;
    return undefined;
}

export function isSameOrSubtypeClassSignature(
    sourceClassSig: string,
    targetClassSig: string,
    classBySignature: Map<string, any>,
    relationCache: Map<string, boolean>
): boolean {
    if (!sourceClassSig || !targetClassSig) return false;
    if (sourceClassSig === targetClassSig) return true;
    const cacheKey = `${sourceClassSig}=>${targetClassSig}`;
    const cached = relationCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let matched = false;
    let current = classBySignature.get(sourceClassSig);
    const visited = new Set<string>();
    while (current) {
        const currentSig = current.getSignature?.().toString?.() || "";
        if (!currentSig || visited.has(currentSig)) break;
        if (currentSig === targetClassSig) {
            matched = true;
            break;
        }
        visited.add(currentSig);
        current = current.getSuperClass?.();
    }
    relationCache.set(cacheKey, matched);
    return matched;
}

export function selectThisFieldFallbackLoads(
    classMap: Map<string, Set<number>> | undefined,
    sourceClassSig: string | undefined,
    classBySignature: Map<string, any>,
    relationCache: Map<string, boolean>
): Set<number> | undefined {
    if (!classMap || classMap.size === 0) return undefined;

    const out = new Set<number>();
    if (sourceClassSig) {
        for (const [targetClassSig, nodeIds] of classMap.entries()) {
            if (targetClassSig === ANY_CLASS_SIG) continue;
            if (!isSameOrSubtypeClassSignature(sourceClassSig, targetClassSig, classBySignature, relationCache)) {
                continue;
            }
            for (const nodeId of nodeIds) out.add(nodeId);
        }
    }

    const anyClassNodes = classMap.get(ANY_CLASS_SIG);
    if (anyClassNodes) {
        for (const nodeId of anyClassNodes) out.add(nodeId);
    }

    return out.size > 0 ? out : undefined;
}

export function buildUnresolvedThisFieldLoadNodeIdsByFieldAndFile(
    scene: Scene,
    pag: Pag,
    allowedMethodSignatures?: Set<string>
): ThisFieldFallbackLoadNodeIds {
    const out: ThisFieldFallbackLoadNodeIds = new Map();
    const methods = scene.getMethods().filter(m => m.getName() !== "%dflt");
    for (const method of methods) {
        const methodSig = method.getSignature().toString();
        if (allowedMethodSignatures && allowedMethodSignatures.size > 0 && !allowedMethodSignatures.has(methodSig)) {
            continue;
        }
        const cfg = method.getCfg();
        if (!cfg) continue;
        for (const stmt of cfg.getStmts()) {
            if (!(stmt instanceof ArkAssignStmt)) continue;
            const left = stmt.getLeftOp();
            const right = stmt.getRightOp();
            if (!(left instanceof Local) || !(right instanceof ArkInstanceFieldRef)) continue;

            const base = right.getBase();
            if (!(base instanceof Local) || base.getName() !== "this") continue;

            const leftNodes = safeGetOrCreatePagNodes(pag, left, stmt);
            if (!leftNodes || leftNodes.size === 0) continue;

            const fieldName = right.getFieldSignature().getFieldName();
            const sourceFilePath = extractFilePathFromMethodSignature(methodSig);
            if (sourceFilePath.length === 0) continue;
            const sourceClassSig = right.getFieldSignature?.().getDeclaringSignature?.()?.toString?.()
                || method.getDeclaringArkClass?.().getSignature?.().toString?.()
                || ANY_CLASS_SIG;

            if (!out.has(fieldName)) out.set(fieldName, new Map<string, Map<string, Set<number>>>());
            const fileMap = out.get(fieldName)!;
            if (!fileMap.has(sourceFilePath)) fileMap.set(sourceFilePath, new Map<string, Set<number>>());
            const classMap = fileMap.get(sourceFilePath)!;
            if (!classMap.has(sourceClassSig)) classMap.set(sourceClassSig, new Set<number>());
            const outSet = classMap.get(sourceClassSig)!;
            for (const nodeId of leftNodes.values()) {
                outSet.add(nodeId);
            }
        }
    }
    return out;
}
