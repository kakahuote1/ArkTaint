import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import type { AssetDocumentBase, AssetPlane } from "../assets/schema";
import { assertProjectAssetsArePromotedForModelRoot } from "../assets/schema";

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
    assertProjectAssetsArePromotedForModelRoot(modelRoot, options.assets);
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
    const normalizedAssets = namespaceLocalIdsForAggregation(assets);
    const prefix = `project.${projectId}.semanticflow.${plane}`;
    return normalizePublishedAsset({
        id: prefix,
        plane,
        status: "schema-valid",
        surfaces: dedupeById(
            normalizedAssets.flatMap(asset => asset.surfaces || []),
            item => item.surfaceId,
            "surfaceId",
        ),
        bindings: dedupeEquivalentBindings(dedupeBindingsById(
            normalizedAssets.flatMap(asset => asset.bindings || []),
        )),
        effectTemplates: dedupeById(
            normalizedAssets.flatMap(asset => asset.effectTemplates || []),
            item => item.id,
            "effectTemplate id",
        ),
        relations: dedupeById(
            normalizedAssets.flatMap(asset => asset.relations || []),
            item => item.relationId,
            "relationId",
        ),
        provenance: {
            source: "llm",
            projectId,
            evidenceLocations: normalizedAssets.flatMap(asset => asset.provenance.evidenceLocations || []),
        },
    });
}

function namespaceLocalIdsForAggregation(assets: AssetDocumentBase[]): AssetDocumentBase[] {
    const seenShapeBySurfaceId = new Map<string, string>();
    const seenShapeByBindingId = new Map<string, string>();
    const seenShapeByEffectTemplateId = new Map<string, string>();
    const seenShapeByRelationId = new Map<string, string>();
    return assets.map(asset => {
        const surfaceIdMap = new Map<string, string>();
        const bindingIdMap = new Map<string, string>();
        const effectTemplateIdMap = new Map<string, string>();
        const relationIdMap = new Map<string, string>();
        const surfaces = (asset.surfaces || []).map(surface => {
            const shape = stableSerialize(surfaceAggregationShape(surface));
            const previousShape = seenShapeBySurfaceId.get(surface.surfaceId);
            if (previousShape === undefined || previousShape === shape) {
                seenShapeBySurfaceId.set(surface.surfaceId, shape);
                return surface;
            }
            const nextSurfaceId = disambiguatedAggregationId(surface.surfaceId, shape, seenShapeBySurfaceId);
            surfaceIdMap.set(surface.surfaceId, nextSurfaceId);
            return {
                ...surface,
                surfaceId: nextSurfaceId,
            };
        });

        const effectTemplates = (asset.effectTemplates || []).map(template => {
            const shape = stableSerialize(effectTemplateAggregationShape(template));
            const previousShape = seenShapeByEffectTemplateId.get(template.id);
            if (previousShape === undefined || previousShape === shape) {
                seenShapeByEffectTemplateId.set(template.id, shape);
                return template;
            }
            const nextTemplateId = disambiguatedAggregationId(template.id, shape, seenShapeByEffectTemplateId);
            effectTemplateIdMap.set(template.id, nextTemplateId);
            return {
                ...template,
                id: nextTemplateId,
            };
        });

        const relations = (asset.relations || []).map(relation => {
            const surfaceRewritten = rewriteRelationSurfaceIds(relation, surfaceIdMap);
            const shape = stableSerialize(relationAggregationShape(surfaceRewritten));
            const previousShape = seenShapeByRelationId.get(surfaceRewritten.relationId);
            if (previousShape === undefined || previousShape === shape) {
                seenShapeByRelationId.set(surfaceRewritten.relationId, shape);
                return surfaceRewritten;
            }
            const nextRelationId = disambiguatedAggregationId(surfaceRewritten.relationId, shape, seenShapeByRelationId);
            relationIdMap.set(surfaceRewritten.relationId, nextRelationId);
            return {
                ...surfaceRewritten,
                relationId: nextRelationId,
            };
        });

        const bindings = (asset.bindings || []).map(binding => {
            const rewritten = rewriteBindingAggregationRefs(
                binding,
                surfaceIdMap,
                effectTemplateIdMap,
                relationIdMap,
            );
            const shape = stableSerialize(bindingAggregationShape(rewritten));
            const previousShape = seenShapeByBindingId.get(rewritten.bindingId);
            if (previousShape === undefined || previousShape === shape) {
                seenShapeByBindingId.set(rewritten.bindingId, shape);
                return rewritten;
            }
            const nextBindingId = disambiguatedAggregationId(rewritten.bindingId, shape, seenShapeByBindingId);
            bindingIdMap.set(rewritten.bindingId, nextBindingId);
            return {
                ...rewritten,
                bindingId: nextBindingId,
            };
        });

        if (
            surfaceIdMap.size === 0 &&
            bindingIdMap.size === 0 &&
            effectTemplateIdMap.size === 0 &&
            relationIdMap.size === 0
        ) {
            return asset;
        }
        return {
            ...asset,
            surfaces,
            bindings,
            effectTemplates,
            relations,
        };
    });
}

function surfaceAggregationShape(surface: AssetDocumentBase["surfaces"][number]): unknown {
    const {
        surfaceId: _surfaceId,
        confidence: _confidence,
        provenance: _provenance,
        ...shape
    } = surface;
    return shape;
}

function bindingAggregationShape(
    binding: AssetDocumentBase["bindings"][number],
): Omit<AssetDocumentBase["bindings"][number], "bindingId" | "assetId"> {
    const { bindingId: _bindingId, assetId: _assetId, ...shape } = binding;
    return shape;
}

function effectTemplateAggregationShape(
    template: NonNullable<AssetDocumentBase["effectTemplates"]>[number],
): Omit<NonNullable<AssetDocumentBase["effectTemplates"]>[number], "id"> {
    const { id: _id, ...shape } = template;
    return shape;
}

function relationAggregationShape(
    relation: NonNullable<AssetDocumentBase["relations"]>[number],
): Omit<NonNullable<AssetDocumentBase["relations"]>[number], "relationId"> {
    const { relationId: _relationId, ...shape } = relation;
    return shape;
}

function rewriteBindingAggregationRefs(
    binding: AssetDocumentBase["bindings"][number],
    surfaceIdMap: Map<string, string>,
    effectTemplateIdMap: Map<string, string>,
    relationIdMap: Map<string, string>,
): AssetDocumentBase["bindings"][number] {
    const nextSurfaceId = surfaceIdMap.get(binding.surfaceId);
    const effectTemplateRefs = binding.effectTemplateRefs?.map(ref => effectTemplateIdMap.get(ref) || ref);
    const relationRefs = binding.relationRefs?.map(ref => relationIdMap.get(ref) || ref);
    if (!nextSurfaceId && !effectTemplateRefs && !relationRefs) {
        return binding;
    }
    return {
        ...binding,
        surfaceId: nextSurfaceId || binding.surfaceId,
        effectTemplateRefs,
        relationRefs,
    };
}

function rewriteRelationSurfaceIds(
    relation: NonNullable<AssetDocumentBase["relations"]>[number],
    surfaceIdMap: Map<string, string>,
): NonNullable<AssetDocumentBase["relations"]>[number] {
    const out: Record<string, unknown> = { ...(relation as unknown as Record<string, unknown>) };
    for (const key of ["surfaceId", "fromSurfaceId", "toSurfaceId"]) {
        const value = out[key];
        if (typeof value === "string" && surfaceIdMap.has(value)) {
            out[key] = surfaceIdMap.get(value);
        }
    }
    const target = out.target;
    if (target && typeof target === "object") {
        const targetRecord = { ...(target as Record<string, unknown>) };
        const targetSurfaceId = targetRecord.surfaceId;
        if (typeof targetSurfaceId === "string" && surfaceIdMap.has(targetSurfaceId)) {
            targetRecord.surfaceId = surfaceIdMap.get(targetSurfaceId);
            out.target = targetRecord;
        }
    }
    return out as unknown as NonNullable<AssetDocumentBase["relations"]>[number];
}

function disambiguatedAggregationId(id: string, shape: string, seenShapeById: Map<string, string>): string {
    const base = `${id}.${shortStableHash(shape)}`;
    let candidate = base;
    let suffix = 2;
    while (true) {
        const existingShape = seenShapeById.get(candidate);
        if (existingShape === undefined || existingShape === shape) {
            seenShapeById.set(candidate, shape);
            return candidate;
        }
        candidate = `${base}.${suffix++}`;
    }
}

function shortStableHash(value: string): string {
    return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function normalizePublishedAsset(asset: AssetDocumentBase): AssetDocumentBase {
    const promoted = asset.status !== "llm-generated" && asset.status !== "candidate"
        ? asset
        : {
            ...asset,
            status: "schema-valid" as const,
        };
    return normalizePairedHandoffFamilies(promoted);
}

function normalizePairedHandoffFamilies(asset: AssetDocumentBase): AssetDocumentBase {
    if (asset.plane !== "module" || !asset.effectTemplates || asset.effectTemplates.length === 0) {
        return asset;
    }
    const surfacesById = new Map<string, AssetDocumentBase["surfaces"][number]>();
    for (const surface of asset.surfaces || []) {
        if (surface?.surfaceId) surfacesById.set(surface.surfaceId, surface);
    }

    const templateOwners = new Map<string, Set<string>>();
    for (const binding of asset.bindings || []) {
        const ownerKey = surfaceOwnerKeyForHandoffNormalization(surfacesById.get(binding.surfaceId));
        if (!ownerKey) continue;
        for (const ref of binding.effectTemplateRefs || []) {
            let owners = templateOwners.get(ref);
            if (!owners) {
                owners = new Set<string>();
                templateOwners.set(ref, owners);
            }
            owners.add(ownerKey);
        }
    }

    const canonicalFamilyByGroup = new Map<string, string>();
    const replacementFamilyByTemplateId = new Map<string, string>();
    for (const template of asset.effectTemplates || []) {
        const handle = primaryHandoffHandleForNormalization(template);
        if (!handle || typeof handle !== "object") continue;
        const family = typeof (handle as any).family === "string" ? (handle as any).family : "";
        if (!family) continue;
        const owners = templateOwners.get((template as any).id);
        if (!owners || owners.size === 0) continue;
        for (const ownerKey of owners) {
            const groupKey = [
                ownerKey,
                String((handle as any).cellKind || ""),
                stableSerialize((handle as any).scope),
                stableSerialize((handle as any).key),
                stableSerialize((handle as any).owner),
                (handle as any).index === undefined ? "" : String((handle as any).index),
            ].join("|");
            const canonical = canonicalFamilyByGroup.get(groupKey);
            if (!canonical) {
                canonicalFamilyByGroup.set(groupKey, family);
                continue;
            }
            if (canonical !== family) {
                replacementFamilyByTemplateId.set((template as any).id, canonical);
            }
        }
    }

    if (replacementFamilyByTemplateId.size === 0) {
        return asset;
    }
    return {
        ...asset,
        effectTemplates: asset.effectTemplates.map(template => {
            const replacement = replacementFamilyByTemplateId.get((template as any).id);
            if (!replacement) return template;
            const handle = primaryHandoffHandleForNormalization(template);
            if (!handle || typeof handle !== "object") return template;
            return {
                ...(template as any),
                handle: {
                    ...(handle as any),
                    family: replacement,
                },
            };
        }) as AssetDocumentBase["effectTemplates"],
    };
}

function primaryHandoffHandleForNormalization(template: NonNullable<AssetDocumentBase["effectTemplates"]>[number]): unknown {
    const kind = (template as any).kind;
    if (kind === "handoff.put" || kind === "handoff.get" || kind === "handoff.kill") {
        return (template as any).handle;
    }
    return undefined;
}

function surfaceOwnerKeyForHandoffNormalization(surface: AssetDocumentBase["surfaces"][number] | undefined): string | undefined {
    if (!surface || (surface as any).kind !== "invoke") return undefined;
    const modulePath = String((surface as any).modulePath || "");
    const owner = String((surface as any).ownerName || (surface as any).functionName || "");
    if (!modulePath || !owner) return undefined;
    return `${modulePath}::${owner}`;
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

function dedupeEquivalentBindings(bindings: AssetDocumentBase["bindings"]): AssetDocumentBase["bindings"] {
    const byKey = new Map<string, AssetDocumentBase["bindings"][number]>();
    for (const binding of bindings) {
        const key = [
            binding.surfaceId,
            binding.role,
            stableSerialize(binding.endpoint),
            stableSerialize(binding.guard),
            stableSerialize(binding.effectTemplateRefs || []),
            stableSerialize(binding.relationRefs || []),
        ].join("|");
        const previous = byKey.get(key);
        if (!previous) {
            byKey.set(key, binding);
            continue;
        }
        const merged = mergeCompatibleValue(
            equivalentBindingShape(previous),
            equivalentBindingShape(binding),
        );
        if (merged === undefined) {
            throw new Error(`semanticflow project asset aggregation conflict for equivalent binding ${previous.bindingId} / ${binding.bindingId}`);
        }
        byKey.set(key, {
            ...(merged as AssetDocumentBase["bindings"][number]),
            bindingId: previous.bindingId,
            assetId: previous.assetId,
        });
    }
    return [...byKey.values()];
}

function equivalentBindingShape(
    binding: AssetDocumentBase["bindings"][number],
): Omit<AssetDocumentBase["bindings"][number], "bindingId" | "assetId"> {
    const { bindingId: _bindingId, assetId: _assetId, ...shape } = binding;
    return shape;
}

function dedupeById<T>(items: T[], getId: (item: T) => string | undefined, label: string): T[] {
    const seen = new Map<string, T>();
    for (const item of items) {
        const id = getId(item);
        if (!id) {
            throw new Error(`semanticflow project asset aggregation encountered missing ${label}`);
        }
        const previous = seen.get(id);
        if (!previous) {
            seen.set(id, item);
            continue;
        }
        seen.set(id, mergeCompatibleById(previous, item, label, id));
    }
    return Array.from(seen.values());
}

function dedupeBindingsById(bindings: AssetDocumentBase["bindings"]): AssetDocumentBase["bindings"] {
    const seen = new Map<string, AssetDocumentBase["bindings"][number]>();
    for (const binding of bindings) {
        const id = binding.bindingId;
        if (!id) {
            throw new Error("semanticflow project asset aggregation encountered missing bindingId");
        }
        const previous = seen.get(id);
        if (!previous) {
            seen.set(id, binding);
            continue;
        }
        const mergedShape = mergeCompatibleValue(
            bindingAggregationShape(previous),
            bindingAggregationShape(binding),
        );
        if (mergedShape === undefined) {
            throw new Error(`semanticflow project asset aggregation conflict for duplicate bindingId ${id}`);
        }
        seen.set(id, {
            ...(mergedShape as AssetDocumentBase["bindings"][number]),
            bindingId: previous.bindingId,
            assetId: previous.assetId,
        });
    }
    return [...seen.values()];
}

function mergeCompatibleById<T>(left: T, right: T, label: string, id: string): T {
    const merged = mergeCompatibleValue(left, right);
    if (merged === undefined) {
        throw new Error(`semanticflow project asset aggregation conflict for duplicate ${label} ${id}`);
    }
    return merged as T;
}

function mergeCompatibleValue(left: unknown, right: unknown): unknown | undefined {
    if (stableSerialize(left) === stableSerialize(right)) {
        return left;
    }
    if (left === undefined) return right;
    if (right === undefined) return left;
    if (Array.isArray(left) || Array.isArray(right)) {
        return undefined;
    }
    if (
        left &&
        right &&
        typeof left === "object" &&
        typeof right === "object"
    ) {
        const leftRecord = left as Record<string, unknown>;
        const rightRecord = right as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])]) {
            const merged = mergeCompatibleValue(leftRecord[key], rightRecord[key]);
            if (merged === undefined && leftRecord[key] !== undefined && rightRecord[key] !== undefined) {
                return undefined;
            }
            if (merged !== undefined) {
                out[key] = merged;
            }
        }
        return out;
    }
    return undefined;
}

function stableSerialize(value: unknown): string {
    return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortJson);
    }
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
            sorted[key] = sortJson(record[key]);
        }
        return sorted;
    }
    return value;
}
