import type { AssetDocumentBase } from "../schema/AssetTypes";
import {
    TRUSTED_ANALYSIS_ASSET_STATUSES,
    isTrustedAnalysisAssetStatus,
    type AssetStatus,
    type TrustedAnalysisAssetStatus,
} from "../schema/CommonTypes";
import { createAssetIdentityIndex, type AssetIdentityIndex } from "../schema/AssetIdentityIndex";

export type TrustedCoverageAssetStatus = TrustedAnalysisAssetStatus;

export const TRUSTED_COVERAGE_ASSET_STATUSES: readonly TrustedCoverageAssetStatus[] = TRUSTED_ANALYSIS_ASSET_STATUSES;

export interface AssetRegistryBootstrapOptions {
    failOnInvalid?: boolean;
    canonicalApiRegistry: {
        has(canonicalApiId: string): boolean;
    };
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
    registry: AssetIdentityIndex;
    trustedAssetIds: string[];
    skippedAssets: SkippedBootstrapAsset[];
    validationErrors: BootstrapValidationError[];
}

export function isTrustedCoverageAssetStatus(status: AssetStatus): status is TrustedCoverageAssetStatus {
    return isTrustedAnalysisAssetStatus(status);
}

export function bootstrapAssetIdentityIndex(
    assets: readonly AssetDocumentBase[],
    options: AssetRegistryBootstrapOptions,
): AssetRegistryBootstrapResult {
    const registry = createAssetIdentityIndex({
        canonicalApiRegistry: options.canonicalApiRegistry,
    });
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

        try {
            registry.addAsset(asset);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const validationError = { assetId: asset.id, errors: [message] };
            validationErrors.push(validationError);
            if (failOnInvalid) {
                throw new Error(`invalid trusted asset ${asset.id}: ${message}`);
            }
            continue;
        }
        const conflicts = registry.listConflicts().filter(item => item.assetIds.includes(asset.id));
        if (conflicts.length > 0) {
            const validationError = { assetId: asset.id, errors: conflicts.map(item => item.message) };
            validationErrors.push(validationError);
            if (failOnInvalid) {
                throw new Error(`invalid trusted asset ${asset.id}: ${validationError.errors.join("; ")}`);
            }
            continue;
        }
        trustedAssetIds.push(asset.id);
    }

    return {
        registry,
        trustedAssetIds,
        skippedAssets,
        validationErrors,
    };
}
