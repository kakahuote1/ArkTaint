import * as path from "path";
import type { AssetDocumentBase, AssetStatus } from "../schema";
import { validateAssetDocument } from "../schema";
import type { CellKindRegistry } from "../../cellkind";

export interface AssetPromotionInput {
    asset: AssetDocumentBase;
    targetStatus: Extract<AssetStatus, "reviewed" | "replayed">;
    analyzerBackedSurfaceIds: Set<string>;
    reviewedBy: string;
    replayedBy?: string;
    projectId?: string;
    cellKindRegistry?: Pick<CellKindRegistry, "has">;
}

export interface AssetPromotionResult {
    accepted: boolean;
    asset?: AssetDocumentBase;
    assetId: string;
    fromStatus: AssetStatus;
    toStatus?: Extract<AssetStatus, "reviewed" | "replayed">;
    errors: string[];
}

const promotableSourceStatuses = new Set<AssetStatus>([
    "candidate",
    "llm-generated",
    "schema-valid",
    "reviewed",
]);

export function promoteAssetThroughGate(input: AssetPromotionInput): AssetPromotionResult {
    const errors = validatePromotionInput(input);
    if (errors.length > 0) {
        return {
            accepted: false,
            assetId: input.asset.id,
            fromStatus: input.asset.status,
            toStatus: input.targetStatus,
            errors,
        };
    }
    const promoted: AssetDocumentBase = {
        ...input.asset,
        status: input.targetStatus,
        provenance: {
            ...input.asset.provenance,
            source: input.asset.provenance.source === "llm" ? "manual" : input.asset.provenance.source,
            projectId: input.projectId || input.asset.provenance.projectId,
            reviewedBy: input.reviewedBy,
        },
        surfaces: input.asset.surfaces.map(surface => ({
            ...surface,
            provenance: {
                ...surface.provenance,
                source: surface.provenance.source === "llm-proposal" ? "analyzer" : surface.provenance.source,
            },
        })),
    };
    const validation = validateAssetDocument(promoted, { cellKindRegistry: input.cellKindRegistry });
    if (!validation.valid) {
        return {
            accepted: false,
            assetId: input.asset.id,
            fromStatus: input.asset.status,
            toStatus: input.targetStatus,
            errors: validation.errors,
        };
    }
    return {
        accepted: true,
        asset: promoted,
        assetId: promoted.id,
        fromStatus: input.asset.status,
        toStatus: input.targetStatus,
        errors: [],
    };
}

export function assertProjectAssetsArePromotedForModelRoot(
    modelRoot: string,
    assets: readonly AssetDocumentBase[],
): void {
    if (!isFormalSrcModelRoot(modelRoot)) {
        return;
    }
    const unpromoted = assets.filter(asset => asset.status !== "reviewed" && asset.status !== "replayed");
    if (unpromoted.length > 0) {
        throw new Error(`formal project assets under src/models require reviewed/replayed status: ${unpromoted.map(asset => `${asset.id}:${asset.status}`).join(", ")}`);
    }
}

function validatePromotionInput(input: AssetPromotionInput): string[] {
    const errors: string[] = [];
    const validation = validateAssetDocument(input.asset, { cellKindRegistry: input.cellKindRegistry });
    if (!validation.valid) {
        errors.push(...validation.errors);
    }
    if (!promotableSourceStatuses.has(input.asset.status)) {
        errors.push(`asset ${input.asset.id} status ${input.asset.status} is not promotable`);
    }
    if (input.targetStatus !== "reviewed" && input.targetStatus !== "replayed") {
        errors.push(`target status ${input.targetStatus} is not a project promotion status`);
    }
    if (!input.reviewedBy.trim()) {
        errors.push("promotion requires reviewedBy");
    }
    if (input.targetStatus === "replayed" && !String(input.replayedBy || "").trim()) {
        errors.push("replayed promotion requires replayedBy");
    }
    for (const surface of input.asset.surfaces) {
        if (!input.analyzerBackedSurfaceIds.has(surface.surfaceId)) {
            errors.push(`surface ${surface.surfaceId} is not analyzer-backed`);
        }
    }
    return errors;
}

function isFormalSrcModelRoot(modelRoot: string): boolean {
    const resolved = path.resolve(modelRoot).toLowerCase();
    const formal = path.resolve(process.cwd(), "src", "models").toLowerCase();
    return resolved === formal || resolved.startsWith(`${formal}${path.sep}`);
}
