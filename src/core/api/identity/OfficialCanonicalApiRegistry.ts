import * as fs from "fs";
import * as path from "path";
import type { CanonicalApiDescriptor } from "./CanonicalApiDescriptor";
import { createCanonicalApiRegistry, type CanonicalApiRegistry } from "./CanonicalApiRegistry";
import { canonicalApiDescriptorFromIdSeed, type CanonicalApiDescriptorSeed } from "./CanonicalApiDescriptorFromId";
import { assertValidCanonicalApiId } from "./CanonicalApiId";
import { loadOfficialDeclarationInventoryDescriptors } from "./OfficialDeclarationInventory";
import { loadOfficialKernelModuleCanonicalApiDescriptorSeeds } from "./OfficialKernelModuleCanonicalApiRegistry";

const KERNEL_RULE_ASSET_DIRS = [
    "src/models/kernel/rules/sources",
    "src/models/kernel/rules/sinks",
    "src/models/kernel/rules/transfers",
    "src/models/kernel/rules/sanitizers",
];

const KERNEL_ARKMAIN_OFFICIAL_ASSET_FILES = [
    path.join("src", "models", "kernel", "arkmain", "harmony", "official_declarations.catalog.json"),
];

let descriptorCache: CanonicalApiDescriptor[] | undefined;
let registryCache: CanonicalApiRegistry | undefined;

export function loadOfficialCanonicalApiDescriptors(): CanonicalApiDescriptor[] {
    if (!descriptorCache) {
        descriptorCache = loadOfficialCanonicalApiDescriptorSet();
    }
    return descriptorCache.map(descriptor => ({ ...descriptor }));
}

export function createOfficialCanonicalApiRegistry(): CanonicalApiRegistry {
    if (!registryCache) {
        registryCache = createCanonicalApiRegistry(loadOfficialCanonicalApiDescriptors());
    }
    return registryCache;
}

function loadOfficialCanonicalApiDescriptorSeeds(): CanonicalApiDescriptorSeed[] {
    const canonicalApiIds = new Set<string>();
    for (const ruleDir of KERNEL_RULE_ASSET_DIRS) {
        for (const assetPath of listJsonFiles(resolveRepoPath(ruleDir))) {
            collectCanonicalApiIdsFromAssetFile(assetPath, canonicalApiIds);
        }
    }
    for (const assetPath of KERNEL_ARKMAIN_OFFICIAL_ASSET_FILES.map(resolveRepoPath)) {
        collectCanonicalApiIdsFromAssetFile(assetPath, canonicalApiIds);
    }
    for (const seed of loadOfficialKernelModuleCanonicalApiDescriptorSeeds()) {
        addCanonicalApiId(canonicalApiIds, seed.canonicalApiId, "kernel module registry");
    }
    return [...canonicalApiIds]
        .sort((left, right) => left.localeCompare(right))
        .map(canonicalApiId => ({ canonicalApiId }));
}

function loadOfficialCanonicalApiDescriptorSet(): CanonicalApiDescriptor[] {
    const descriptors = new Map<string, CanonicalApiDescriptor>();
    for (const descriptor of loadOfficialDeclarationInventoryDescriptors()) {
        addDescriptor(descriptors, descriptor, "official declaration inventory");
    }
    for (const seed of loadOfficialCanonicalApiDescriptorSeeds()) {
        addDescriptor(descriptors, canonicalApiDescriptorFromIdSeed(seed), "kernel semantic asset");
    }
    return [...descriptors.values()]
        .sort((left, right) => left.canonicalApiId.localeCompare(right.canonicalApiId));
}

function addDescriptor(
    descriptors: Map<string, CanonicalApiDescriptor>,
    descriptor: CanonicalApiDescriptor,
    source: string,
): void {
    const existing = descriptors.get(descriptor.canonicalApiId);
    if (existing) {
        descriptors.set(descriptor.canonicalApiId, mergeSameIdentityDescriptor(existing, descriptor));
        void source;
        return;
    }
    descriptors.set(descriptor.canonicalApiId, descriptor);
}

function mergeSameIdentityDescriptor(
    existing: CanonicalApiDescriptor,
    incoming: CanonicalApiDescriptor,
): CanonicalApiDescriptor {
    return {
        ...existing,
        declarationOwner: {
            ...existing.declarationOwner,
            arkanalyzerName: existing.declarationOwner.arkanalyzerName || incoming.declarationOwner.arkanalyzerName,
        },
        signature: {
            parameters: existing.signature.parameters.map((parameter, index) => ({
                ...parameter,
                name: parameter.name || incoming.signature.parameters[index]?.name,
            })),
            returnType: existing.signature.returnType,
        },
        arkanalyzer: existing.arkanalyzer || incoming.arkanalyzer,
        provenance: {
            ...existing.provenance,
            declarationLocations: mergeDeclarationLocations(
                existing.provenance.declarationLocations,
                incoming.provenance.declarationLocations,
            ),
        },
    };
}

function mergeDeclarationLocations(
    left: CanonicalApiDescriptor["provenance"]["declarationLocations"],
    right: CanonicalApiDescriptor["provenance"]["declarationLocations"],
): CanonicalApiDescriptor["provenance"]["declarationLocations"] {
    const seen = new Set<string>();
    const out: CanonicalApiDescriptor["provenance"]["declarationLocations"] = [];
    for (const item of [...left, ...right]) {
        const key = `${item.file}:${item.line || ""}:${item.column || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...item });
    }
    return out;
}

function collectCanonicalApiIdsFromAssetFile(assetPath: string, output: Set<string>): void {
    const asset = JSON.parse(fs.readFileSync(assetPath, "utf-8"));
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
        throw new Error(`${assetPath} must contain an asset object`);
    }
    const surfaces = Array.isArray((asset as any).surfaces) ? (asset as any).surfaces : [];
    for (const [index, surface] of surfaces.entries()) {
        addCanonicalApiId(output, surface?.canonicalApiId, `${assetPath}.surfaces[${index}]`);
    }
}

function addCanonicalApiId(output: Set<string>, canonicalApiId: unknown, where: string): void {
    if (typeof canonicalApiId !== "string" || canonicalApiId.trim().length === 0) {
        throw new Error(`${where} is missing canonicalApiId`);
    }
    assertValidCanonicalApiId(canonicalApiId);
    output.add(canonicalApiId.trim());
}

function listJsonFiles(dir: string): string[] {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        throw new Error(`kernel asset directory not found: ${dir}`);
    }
    return fs.readdirSync(dir)
        .filter(name => name.endsWith(".json"))
        .map(name => path.join(dir, name))
        .sort((left, right) => left.localeCompare(right));
}

function resolveRepoPath(relativePath: string): string {
    return path.resolve(process.cwd(), relativePath);
}
