import type { SourceLocation } from "../schema/CommonTypes";
import type { AssetDocumentBase } from "../schema/AssetTypes";
import type { AssetSurface } from "../schema/SurfaceTypes";
import {
    canonicalApiDescriptorFromIdSeed,
    createCanonicalApiRegistry,
    mergeCanonicalApiRegistries,
    parseCanonicalApiId,
    type ArkanalyzerMethodKey,
    type CanonicalApiDescriptor,
    type CanonicalApiIdParts,
    type CanonicalApiRegistry,
} from "../../api/identity";

export interface AssetDeclaredCanonicalApiRegistryOptions {
    assets: readonly AssetDocumentBase[];
    baseRegistry: CanonicalApiRegistry;
}

export function extendCanonicalApiRegistryWithAssetDeclarations(
    options: AssetDeclaredCanonicalApiRegistryOptions,
): CanonicalApiRegistry {
    const descriptors = collectAssetDeclaredCanonicalApiDescriptors(options);
    if (descriptors.length === 0) {
        return options.baseRegistry;
    }
    return mergeCanonicalApiRegistries([
        options.baseRegistry,
        createCanonicalApiRegistry(descriptors),
    ]);
}

export function collectAssetDeclaredCanonicalApiDescriptors(
    options: AssetDeclaredCanonicalApiRegistryOptions,
): CanonicalApiDescriptor[] {
    const descriptors: CanonicalApiDescriptor[] = [];
    const seen = new Set<string>();
    for (const asset of options.assets || []) {
        for (const surface of asset.surfaces || []) {
            const canonicalApiId = String(surface.canonicalApiId || "").trim();
            if (!canonicalApiId || seen.has(canonicalApiId) || options.baseRegistry.has(canonicalApiId)) {
                continue;
            }
            const parts = parseCanonicalApiId(canonicalApiId);
            if (!parts) {
                continue;
            }
            if (parts.authority === "official") {
                continue;
            }
            if (parts.authority !== "project" && parts.authority !== "third_party") {
                continue;
            }
            descriptors.push(canonicalApiDescriptorFromIdSeed({
                canonicalApiId,
                arkanalyzer: exactCallableArkanalyzerEvidence(surface, parts),
                declarationLocations: declarationLocationsForAssetSurface(asset, surface),
            }));
            seen.add(canonicalApiId);
        }
    }
    return descriptors;
}

function exactCallableArkanalyzerEvidence(
    surface: AssetSurface,
    parts: CanonicalApiIdParts,
): ArkanalyzerMethodKey | undefined {
    if (parts.invoke !== "call" && parts.invoke !== "new") {
        return undefined;
    }
    const memberKind = parts.member.split(":").filter(Boolean)[0] || "";
    if (!["function", "method", "constructor", "lifecycle"].includes(memberKind)) {
        return undefined;
    }
    const methodKey = surface.evidence?.arkanalyzer?.methodKey;
    return methodKey
        ? {
            ...methodKey,
            declaringNamespacePath: methodKey.declaringNamespacePath || [],
        }
        : undefined;
}

function declarationLocationsForAssetSurface(
    asset: AssetDocumentBase,
    surface: AssetSurface,
): SourceLocation[] | undefined {
    const locations: SourceLocation[] = [];
    if (surface.provenance?.location) {
        locations.push(surface.provenance.location);
    }
    for (const location of asset.provenance?.evidenceLocations || []) {
        if (!locations.some(item => sameLocation(item, location))) {
            locations.push(location);
        }
    }
    return locations.length > 0 ? locations : undefined;
}

function sameLocation(left: SourceLocation, right: SourceLocation): boolean {
    return left.file === right.file
        && left.line === right.line
        && left.column === right.column;
}
