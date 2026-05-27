import type { AssetDocumentBase } from "../schema/AssetTypes";
import {
    TRUSTED_ANALYSIS_ASSET_STATUSES,
    isTrustedAnalysisAssetStatus,
    type AssetStatus,
    type TrustedAnalysisAssetStatus,
} from "../schema/CommonTypes";
import { createAssetSurfaceRegistry, type InMemoryAssetSurfaceRegistry } from "../schema/SurfaceIdentity";

export type TrustedCoverageAssetStatus = TrustedAnalysisAssetStatus;

export const TRUSTED_COVERAGE_ASSET_STATUSES: readonly TrustedCoverageAssetStatus[] = TRUSTED_ANALYSIS_ASSET_STATUSES;

export interface AssetRegistryBootstrapOptions {
    failOnInvalid?: boolean;
}

export interface SkippedBootstrapAsset {
    assetId: string;
    status: AssetStatus;
    reason: string;
}

export interface BootstrapValidationError {
    assetId: string;
    errors: string[];
}

export interface AssetRegistryBootstrapResult {
    registry: InMemoryAssetSurfaceRegistry;
    trustedAssetIds: string[];
    skippedAssets: SkippedBootstrapAsset[];
    validationErrors: BootstrapValidationError[];
}

export function isTrustedCoverageAssetStatus(status: AssetStatus): status is TrustedCoverageAssetStatus {
    return isTrustedAnalysisAssetStatus(status);
}

export function bootstrapAssetSurfaceRegistry(
    assets: readonly AssetDocumentBase[],
    options: AssetRegistryBootstrapOptions = {},
): AssetRegistryBootstrapResult {
    const registry = createAssetSurfaceRegistry();
    const trustedAssetIds: string[] = [];
    const skippedAssets: SkippedBootstrapAsset[] = [];
    const validationErrors: BootstrapValidationError[] = [];
    const failOnInvalid = options.failOnInvalid !== false;

    for (const asset of assets) {
        if (!isTrustedCoverageAssetStatus(asset.status)) {
            skippedAssets.push({
                assetId: asset.id,
                status: asset.status,
                reason: "asset status is not trusted for known-covered bootstrap",
            });
            continue;
        }

        const validation = registry.validateAsset(asset);
        if (!validation.valid) {
            const error = { assetId: asset.id, errors: validation.errors };
            validationErrors.push(error);
            if (failOnInvalid) {
                throw new Error(`invalid trusted asset ${asset.id}: ${validation.errors.join("; ")}`);
            }
            continue;
        }

        registry.addAsset(asset);
        trustedAssetIds.push(asset.id);
    }

    return {
        registry,
        trustedAssetIds,
        skippedAssets,
        validationErrors,
    };
}
