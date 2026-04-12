import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { PagNode } from "../../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";
import { ArkAssignStmt } from "../../../../arkanalyzer/out/src/core/base/Stmt";
import { Local } from "../../../../arkanalyzer/out/src/core/base/Local";

export function resolveHarmonyMethods(scene: Scene, allowedMethodSignatures?: Set<string>): any[] {
    const allMethods = scene.getMethods().filter(m => m.getName() !== "%dflt");
    if (!allowedMethodSignatures || allowedMethodSignatures.size === 0) {
        return allMethods;
    }
    return allMethods.filter(m => allowedMethodSignatures.has(m.getSignature().toString()));
}

export function resolveClassKeyFromMethodSig(methodSig: any): string {
    const classSigText = methodSig?.getDeclaringClassSignature?.()?.toString?.() || "";
    const className = methodSig?.getDeclaringClassSignature?.()?.getClassName?.() || "";
    const signatureText = methodSig?.toString?.() || "";
    return classSigText || className || signatureText;
}

export function addMapSetValue<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
    if (!map.has(key)) {
        map.set(key, new Set<V>());
    }
    map.get(key)!.add(value);
}

export function collectNodeIdsFromValue(pag: Pag, value: any): Set<number> {
    const out = new Set<number>();
    const nodes = pag.getNodesByValue(value);
    if (!nodes || nodes.size === 0) return out;
    for (const nodeId of nodes.values()) {
        out.add(nodeId);
    }
    return out;
}

export function collectObjectNodeIdsFromValue(pag: Pag, value: any): Set<number> {
    const out = new Set<number>();
    const nodes = pag.getNodesByValue(value);
    if (!nodes || nodes.size === 0) return out;
    for (const nodeId of nodes.values()) {
        const node: any = pag.getNode(nodeId);
        const pointTo: Iterable<number> = node?.getPointTo?.() || [];
        for (const objectNodeId of pointTo) {
            out.add(objectNodeId);
        }
    }
    return out;
}

export function collectMethodThisObjectNodeIds(pag: Pag, method: any): Set<number> {
    const out = new Set<number>();
    const body = method?.getBody?.();
    const thisLocal = body?.getLocals?.()?.get?.("this");
    if (thisLocal instanceof Local) {
        const nodes = collectObjectNodeIdsFromValue(pag, thisLocal);
        for (const nodeId of nodes) {
            out.add(nodeId);
        }
        if (out.size > 0) {
            return out;
        }
        const carrierNodes = pag.getNodesByValue(thisLocal);
        if (carrierNodes) {
            for (const nodeId of carrierNodes.values()) {
                const carrier = pag.getNode(nodeId) as PagNode | undefined;
                const pointTo = carrier?.getPointTo?.() || [];
                for (const objectNodeId of pointTo) {
                    out.add(objectNodeId);
                }
            }
            if (out.size > 0) {
                return out;
            }
        }
    }

    const cfg = method?.getCfg?.();
    if (!cfg) return out;
    for (const stmt of cfg.getStmts()) {
        if (!(stmt instanceof ArkAssignStmt)) continue;
        const left = stmt.getLeftOp();
        if (!(left instanceof Local) || left.getName() !== "this") continue;
        const nodes = collectObjectNodeIdsFromValue(pag, left);
        for (const nodeId of nodes) {
            out.add(nodeId);
        }
        if (out.size > 0) continue;
        const carrierNodes = pag.getNodesByValue(left);
        if (!carrierNodes) continue;
        for (const nodeId of carrierNodes.values()) {
            const carrier = pag.getNode(nodeId) as PagNode | undefined;
            const pointTo = carrier?.getPointTo?.() || [];
            for (const objectNodeId of pointTo) {
                out.add(objectNodeId);
            }
        }
    }
    return out;
}

export function collectObjectNodeIdsFromValueInMethod(pag: Pag, method: any, value: any): Set<number> {
    const nodeIds = collectObjectNodeIdsFromValue(pag, value);
    if (nodeIds.size > 0) {
        return nodeIds;
    }
    if (!(value instanceof Local) || value.getName() !== "this") {
        return nodeIds;
    }
    return collectMethodThisObjectNodeIds(pag, method);
}
