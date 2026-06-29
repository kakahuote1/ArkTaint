import type { CanonicalApiDescriptor } from "./CanonicalApiDescriptor";
import { createCanonicalApiRegistry, type CanonicalApiRegistry } from "./CanonicalApiRegistry";
import { createOfficialCanonicalApiRegistry } from "./OfficialCanonicalApiRegistry";

interface RegistryMergeCacheNode {
    next: WeakMap<CanonicalApiRegistry, RegistryMergeCacheNode>;
    result?: {
        registry: CanonicalApiRegistry;
        inputChangeCounts: number[];
    };
}

const registryMergeCacheRoot: RegistryMergeCacheNode = {
    next: new WeakMap(),
};

export function createDefaultCanonicalApiRegistry(): CanonicalApiRegistry {
    return createOfficialCanonicalApiRegistry();
}

export function mergeCanonicalApiRegistries(registries: readonly CanonicalApiRegistry[]): CanonicalApiRegistry {
    const cached = getCachedMergedRegistry(registries);
    if (cached) return cached;
    const descriptors = new Map<string, CanonicalApiDescriptor>();
    for (const registry of registries) {
        for (const descriptor of registry.listDescriptors()) {
            const existing = descriptors.get(descriptor.canonicalApiId);
            if (existing && JSON.stringify(existing) !== JSON.stringify(descriptor)) {
                throw new Error(`canonical API registry descriptor conflict: ${descriptor.canonicalApiId}`);
            }
            descriptors.set(descriptor.canonicalApiId, descriptor);
        }
    }
    const merged = createCanonicalApiRegistry([...descriptors.values()]);
    setCachedMergedRegistry(registries, merged);
    return merged;
}

function getCachedMergedRegistry(registries: readonly CanonicalApiRegistry[]): CanonicalApiRegistry | undefined {
    const node = getMergeCacheNode(registries, false);
    if (!node?.result) return undefined;
    const inputChangeCounts = registries.map(registry => registry.getDescriptorSetChangeCount());
    return sameNumberArray(inputChangeCounts, node.result.inputChangeCounts)
        ? node.result.registry
        : undefined;
}

function setCachedMergedRegistry(registries: readonly CanonicalApiRegistry[], merged: CanonicalApiRegistry): void {
    const node = getMergeCacheNode(registries, true);
    if (!node) return;
    node.result = {
        registry: merged,
        inputChangeCounts: registries.map(registry => registry.getDescriptorSetChangeCount()),
    };
}

function getMergeCacheNode(
    registries: readonly CanonicalApiRegistry[],
    create: boolean,
): RegistryMergeCacheNode | undefined {
    let node = registryMergeCacheRoot;
    for (const registry of registries) {
        let next = node.next.get(registry);
        if (!next) {
            if (!create) return undefined;
            next = { next: new WeakMap() };
            node.next.set(registry, next);
        }
        node = next;
    }
    return node;
}

function sameNumberArray(left: readonly number[], right: readonly number[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
