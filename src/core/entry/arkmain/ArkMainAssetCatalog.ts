import * as fs from "fs";
import type { AssetDocumentBase, CoreCapabilityTemplate } from "../../assets/schema";
import { validateAssetDocument } from "../../assets/schema";

export function loadArkMainCoreCapabilityPayload(
    catalogPath: string,
    capability: string,
): Record<string, unknown> {
    const asset = loadArkMainAssetDocument(catalogPath);
    const template = (asset.effectTemplates || []).find(
        (item): item is CoreCapabilityTemplate => item.kind === "core.capability" && item.capability === capability,
    );
    if (!template) {
        throw new Error(`${catalogPath} missing arkmain core capability ${capability}`);
    }
    return template.payload;
}

function loadArkMainAssetDocument(catalogPath: string): AssetDocumentBase {
    const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
    const validation = validateAssetDocument(parsed);
    if (!validation.valid) {
        throw new Error(`${catalogPath} invalid arkmain asset: ${validation.errors.join("; ")}`);
    }
    const asset = parsed as AssetDocumentBase;
    if (asset.plane !== "arkmain") {
        throw new Error(`${catalogPath} must be an arkmain asset`);
    }
    if (asset.status !== "official" && asset.status !== "reviewed" && asset.status !== "replayed") {
        throw new Error(`${catalogPath} arkmain asset status is not loadable: ${asset.status}`);
    }
    if (asset.provenance.source !== "builtin" && asset.provenance.source !== "manual" && asset.provenance.source !== "sdk") {
        throw new Error(`${catalogPath} arkmain asset provenance is not loadable: ${asset.provenance.source}`);
    }
    return asset;
}
