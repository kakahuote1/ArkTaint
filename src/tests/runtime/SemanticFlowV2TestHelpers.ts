import type { AssetDocumentBase, AssetPlane, AssetSurface } from "../../core/assets/schema";
import type { AssetRole } from "../../core/assets/schema";
import type { SemanticEffectKind } from "../../core/assets/schema";
import { bindExactAssetIdentities, exactProjectInvokeSurface } from "../helpers/AssetIdentityTestUtils";

export function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

export function expectThrows(fn: () => unknown, contains: string): void {
    try {
        fn();
    } catch (error) {
        const text = String((error as any)?.message || error);
        assert(text.includes(contains), `expected "${contains}", got "${text}"`);
        return;
    }
    throw new Error(`expected error containing "${contains}"`);
}

export function makeRuleAsset(
    id = "asset.project.logger.sink",
    options: AssetPlane | {
        plane?: AssetPlane;
        role?: AssetRole;
        effectKind?: SemanticEffectKind;
        bindingId?: string;
        effectId?: string;
    } = "rule",
): AssetDocumentBase {
    const plane = typeof options === "string" ? options : options.plane || "rule";
    const role = typeof options === "string" ? "sink" : options.role || "sink";
    const effectKind = typeof options === "string" ? "rule.sink" : options.effectKind || "rule.sink";
    const bindingId = typeof options === "string" ? `${id}.binding` : options.bindingId || `${id}.binding`;
    const effectId = typeof options === "string" ? `${id}.effect` : options.effectId || `${id}.effect`;
    const endpoint = effectKind === "rule.source"
        ? { base: { kind: "promiseResult" as const } }
        : { base: { kind: "arg" as const, index: 0 } };
    const effectTemplate = effectKind === "rule.source"
        ? {
            id: effectId,
            kind: "rule.source" as const,
            value: endpoint,
            sourceKind: "call_return" as const,
            confidence: "likely" as const,
        }
        : {
            id: effectId,
            kind: "rule.sink" as const,
            value: endpoint,
            sinkKind: "logging",
            confidence: "likely" as const,
        };
    const asset = bindExactAssetIdentities({
        id,
        plane,
        status: "llm-generated",
        surfaces: [
            exactProjectInvokeSurface({
                surfaceId: `${id}.surface`,
                modulePath: "project/Logger",
                ownerName: "Logger",
                methodName: "info",
                invokeKind: "static",
                argCount: 1,
                parameterTypes: ["string"],
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "Logger.ets", line: 1 },
                },
            }),
        ],
        bindings: [
            {
                bindingId,
                surfaceId: `${id}.surface`,
                assetId: id,
                plane,
                role,
                endpoint,
                effectTemplateRefs: [effectId],
                semanticsFamily: "logging",
                completeness: "complete",
                confidence: "likely",
            },
        ],
        effectTemplates: [effectTemplate],
        provenance: {
            source: "llm",
            projectId: "project-a",
            evidenceLocations: [{ file: "Logger.ets", line: 1 }],
        },
    } as any);
    return normalizeExactTestAsset(asset);
}

export function makeHandoffAsset(id = "asset.project.token-cache"): AssetDocumentBase {
    const asset = bindExactAssetIdentities({
        id,
        plane: "module",
        status: "llm-generated",
        surfaces: [
            exactProjectInvokeSurface({
                surfaceId: `${id}.save.surface`,
                modulePath: "project/TokenCache",
                ownerName: "TokenCache",
                methodName: "save",
                invokeKind: "static",
                argCount: 2,
                parameterTypes: ["string", "Object"],
                confidence: "likely",
                provenance: {
                    source: "llm-proposal",
                    location: { file: "TokenCache.ets", line: 3 },
                },
            }),
        ],
        bindings: [
            {
                bindingId: `${id}.save.binding`,
                surfaceId: `${id}.save.surface`,
                assetId: id,
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 1 } },
                effectTemplateRefs: [`${id}.save.put`],
                completeness: "complete",
                confidence: "likely",
            },
        ],
        effectTemplates: [
            {
                id: `${id}.save.put`,
                kind: "handoff.put",
                handle: {
                    cellKind: "keyed-semantic-slot",
                    family: "project.token_cache",
                    key: [{ kind: "fromLiteralArg", index: 0 }],
                    precision: "exact",
                },
                value: { base: { kind: "arg", index: 1 } },
                updateStrength: "weak",
                confidence: "likely",
            },
        ],
        provenance: {
            source: "llm",
            projectId: "project-a",
            evidenceLocations: [{ file: "TokenCache.ets", line: 3 }],
        },
    } as any);
    return normalizeExactTestAsset(asset);
}

export function normalizeExactTestAsset<T extends AssetDocumentBase>(asset: T): T {
    const surfaceIdMap = new Map<string, string>();
    for (const surface of asset.surfaces || []) {
        const oldSurfaceId = surface.surfaceId;
        normalizeExactTestSurface(surface);
        if (oldSurfaceId && oldSurfaceId !== surface.surfaceId) {
            surfaceIdMap.set(oldSurfaceId, surface.surfaceId);
        }
    }
    const canonicalApiIdsBySurfaceId = new Map<string, string>();
    for (const surface of asset.surfaces || []) {
        const canonicalApiId = (surface as any).canonicalApiId;
        if (surface.surfaceId && canonicalApiId) {
            canonicalApiIdsBySurfaceId.set(surface.surfaceId, canonicalApiId);
        }
    }
    for (const binding of asset.bindings || []) {
        const bindingAny = binding as any;
        if (surfaceIdMap.has(binding.surfaceId)) {
            bindingAny.surfaceId = surfaceIdMap.get(binding.surfaceId);
        }
        const canonicalApiId = canonicalApiIdsBySurfaceId.get(bindingAny.surfaceId);
        if (canonicalApiId) {
            bindingAny.canonicalApiId = canonicalApiId;
        }
    }
    return asset;
}

export function normalizeExactTestSurface<T extends AssetSurface>(surface: T): T {
    const legacy = surface as any;
    if (!legacy.canonicalApiId) {
        throw new Error(`exact test surface ${legacy.surfaceId || "<missing>"} has no canonicalApiId`);
    }
    if (!legacy.evidence?.arkanalyzer?.methodKey) {
        throw new Error(`exact test surface ${legacy.surfaceId || "<missing>"} has no analyzer methodKey evidence`);
    }
    legacy.surfaceId = `surface:${legacy.canonicalApiId}`;
    return surface;
}
