import * as fs from "fs";
import * as path from "path";
import type { AssetDocumentBase, AssetPlane } from "../assets/schema";

export interface PublishSemanticFlowProjectAssetsOptions {
    projectId: string;
    modelRoot?: string;
    assets: AssetDocumentBase[];
}

export interface PublishSemanticFlowProjectAssetsResult {
    rulePath?: string;
    modulePath?: string;
    arkMainPath?: string;
}

export function publishSemanticFlowProjectAssets(
    options: PublishSemanticFlowProjectAssetsOptions,
): PublishSemanticFlowProjectAssetsResult {
    const projectId = sanitizeProjectId(options.projectId);
    if (!projectId) {
        throw new Error("publish model project id must not be empty");
    }
    const modelRoot = resolveModelRoot(options.modelRoot);
    const result: PublishSemanticFlowProjectAssetsResult = {};
    result.rulePath = writePlaneAsset(modelRoot, projectId, "rule", options.assets);
    result.modulePath = writePlaneAsset(modelRoot, projectId, "module", options.assets);
    result.arkMainPath = writePlaneAsset(modelRoot, projectId, "arkmain", options.assets);
    return result;
}

function writePlaneAsset(
    modelRoot: string,
    projectId: string,
    plane: AssetPlane,
    assets: AssetDocumentBase[],
): string | undefined {
    const planeAssets = assets.filter(asset => asset.plane === plane);
    const dir = plane === "rule" ? "rules" : plane === "module" ? "modules" : "arkmain";
    const fileName = plane === "rule"
        ? "semanticflow.rules.json"
        : plane === "module"
            ? "semanticflow.modules.json"
            : "semanticflow.arkmain.json";
    const target = path.join(modelRoot, "project", projectId, dir, fileName);
    if (planeAssets.length === 0) {
        deleteIfExists(target);
        return undefined;
    }
    const aggregate = aggregatePlaneAssets(projectId, plane, planeAssets);
    return writeJsonDocument(target, aggregate);
}

function aggregatePlaneAssets(projectId: string, plane: AssetPlane, assets: AssetDocumentBase[]): AssetDocumentBase {
    if (assets.length === 1) {
        return normalizePublishedAsset(assets[0]);
    }
    const prefix = `project.${projectId}.semanticflow.${plane}`;
    return {
        id: prefix,
        plane,
        status: "schema-valid",
        surfaces: assets.flatMap(asset => asset.surfaces || []),
        bindings: assets.flatMap(asset => asset.bindings || []),
        effectTemplates: assets.flatMap(asset => asset.effectTemplates || []),
        relations: assets.flatMap(asset => asset.relations || []),
        provenance: {
            source: "llm",
            projectId,
            evidenceLocations: assets.flatMap(asset => asset.provenance.evidenceLocations || []),
        },
    };
}

function normalizePublishedAsset(asset: AssetDocumentBase): AssetDocumentBase {
    if (asset.status !== "llm-generated" && asset.status !== "candidate") {
        return asset;
    }
    return {
        ...asset,
        status: "schema-valid",
    };
}

function writeJsonDocument(targetPath: string, document: unknown): string {
    const resolved = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(document, null, 2), "utf-8");
    return resolved;
}

function deleteIfExists(targetPath: string): void {
    const resolved = path.resolve(targetPath);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        fs.unlinkSync(resolved);
    }
}

function resolveModelRoot(explicitPath?: string): string {
    if (explicitPath) {
        return path.resolve(explicitPath);
    }
    return path.resolve(__dirname, "../../../../src/models");
}

function sanitizeProjectId(value: string): string {
    return value.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}
