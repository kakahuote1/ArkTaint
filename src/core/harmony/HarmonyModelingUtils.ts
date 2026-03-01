import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { Pag } from "../../../arkanalyzer/out/src/callgraph/pointerAnalysis/Pag";

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
