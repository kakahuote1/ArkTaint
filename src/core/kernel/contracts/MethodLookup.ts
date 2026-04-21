import { Scene } from "../../../../arkanalyzer/out/src/Scene";
import { ArkMethod } from "../../../../arkanalyzer/out/src/core/model/ArkMethod";

const methodSignatureIndexCache: WeakMap<Scene, Map<string, ArkMethod>> = new WeakMap();
const methodSimpleNameIndexCache: WeakMap<Scene, Map<string, ArkMethod>> = new WeakMap();

function buildMethodSignatureIndex(scene: Scene): Map<string, ArkMethod> {
    const existing = methodSignatureIndexCache.get(scene);
    if (existing) {
        return existing;
    }
    const index = new Map<string, ArkMethod>();
    for (const method of scene.getMethods()) {
        const signature = method?.getSignature?.()?.toString?.();
        if (!signature || index.has(signature)) continue;
        index.set(signature, method);
    }
    methodSignatureIndexCache.set(scene, index);
    return index;
}

export function getMethodBySignature(scene: Scene, signature: string): ArkMethod | undefined {
    if (!signature) return undefined;
    return buildMethodSignatureIndex(scene).get(signature);
}

function buildMethodSimpleNameIndex(scene: Scene): Map<string, ArkMethod> {
    const existing = methodSimpleNameIndexCache.get(scene);
    if (existing) {
        return existing;
    }
    const index = new Map<string, ArkMethod>();
    for (const method of scene.getMethods()) {
        const name = method?.getName?.();
        if (!name || index.has(name)) continue;
        index.set(name, method);
    }
    methodSimpleNameIndexCache.set(scene, index);
    return index;
}

export function getMethodBySimpleName(scene: Scene, name: string): ArkMethod | undefined {
    if (!name) return undefined;
    return buildMethodSimpleNameIndex(scene).get(name);
}
