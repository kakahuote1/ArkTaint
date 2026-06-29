import type {
    AssetBinding,
    AssetDocumentBase,
    AssetEndpoint,
    AssetSurfaceEvidence,
    AssetSurface,
    CoreCapabilityTemplate,
    InvokeSurface,
} from "../../core/assets/schema";
import { canonicalApiDescriptorFromIdSeed } from "../../core/api/identity/CanonicalApiDescriptorFromId";
import { parseCanonicalApiId } from "../../core/api/identity/CanonicalApiId";

interface BuiltinModuleAssetInput {
    id: string;
    description: string;
    semanticsFamily: string;
    surfaces: AssetSurface[];
    role: AssetBinding["role"];
    capability: CoreCapabilityTemplate["capability"];
    payload: Record<string, unknown>;
}

export function createBuiltinModuleAsset(input: BuiltinModuleAssetInput): AssetDocumentBase {
    const templateId = `template:${input.id}:capability`;
    return {
        id: input.id,
        plane: "module",
        status: "official",
        surfaces: input.surfaces,
        bindings: input.surfaces.map((surface, index) => {
            const endpoint = builtinModuleBindingEndpoint(input, surface);
            return {
                bindingId: `binding:${input.id}:${String(index + 1).padStart(4, "0")}`,
                surfaceId: surface.surfaceId,
                canonicalApiId: surface.canonicalApiId,
                assetId: input.id,
                plane: "module",
                role: input.role,
                ...(endpoint ? { endpoint } : {}),
                effectTemplateRefs: [templateId],
                semanticsFamily: input.semanticsFamily,
                metadata: {
                    description: input.description,
                },
                completeness: "complete",
                confidence: "certain",
            };
        }),
        effectTemplates: [
            {
                id: templateId,
                kind: "core.capability",
                capability: input.capability,
                payload: input.payload,
                confidence: "certain",
            },
        ],
        provenance: {
            source: "builtin",
        },
    };
}

function builtinModuleBindingEndpoint(input: BuiltinModuleAssetInput, surface: AssetSurface): AssetEndpoint | undefined {
    if (input.capability !== "module.bridge") return undefined;
    const bridge = (input.payload as any)?.bridge;
    const from = bridge && typeof bridge === "object" && !Array.isArray(bridge)
        ? bridge.from
        : undefined;
    if (!from || typeof from !== "object" || Array.isArray(from)) return undefined;
    if (!bridgeEndpointReferencesSurface(from as Record<string, unknown>, surface)) return undefined;
    return bridgeSourceEndpointToAssetEndpoint(from as Record<string, unknown>);
}

function bridgeEndpointReferencesSurface(endpoint: Record<string, unknown>, surface: AssetSurface): boolean {
    const rawSurface = endpoint.surface;
    if (!rawSurface || typeof rawSurface !== "object" || Array.isArray(rawSurface)) return false;
    const ref = rawSurface as Record<string, unknown>;
    const surfaceId = typeof ref.surfaceId === "string" ? ref.surfaceId : undefined;
    const canonicalApiId = typeof ref.canonicalApiId === "string" ? ref.canonicalApiId : undefined;
    return (!surfaceId || surface.surfaceId === surfaceId)
        && (!canonicalApiId || surface.canonicalApiId === canonicalApiId)
        && (!!surfaceId || !!canonicalApiId);
}

function bridgeSourceEndpointToAssetEndpoint(endpoint: Record<string, unknown>): AssetEndpoint | undefined {
    const slot = String(endpoint.slot || "");
    if (slot === "arg") {
        const index = Number(endpoint.index);
        if (!Number.isInteger(index) || index < 0) return undefined;
        return endpoint.rest === true
            ? { base: { kind: "rest", startIndex: index } }
            : { base: { kind: "arg", index } };
    }
    if (slot === "base") {
        return { base: { kind: "receiver" } };
    }
    if (slot === "result") {
        return { base: { kind: "return" } };
    }
    return undefined;
}

export function canonicalInvokeSurfaceFromId(canonicalApiId: string): InvokeSurface {
    if (!canonicalApiId || !parseCanonicalApiId(canonicalApiId)) {
        throw new Error(`module invoke surface requires a valid canonicalApiId: ${canonicalApiId}`);
    }
    return {
        surfaceId: surfaceIdForCanonicalApiId(canonicalApiId),
        canonicalApiId,
        evidence: arkanalyzerEvidenceFromCanonicalApiId(canonicalApiId),
        kind: "invoke",
        confidence: "certain",
        provenance: {
            source: "sdk",
        },
    };
}

export function officialInvokeSurfaceFromId(canonicalApiId: string): InvokeSurface {
    const surface = canonicalInvokeSurfaceFromId(canonicalApiId);
    const methodKey = canonicalApiDescriptorFromIdSeed({ canonicalApiId }).arkanalyzer;
    if (!methodKey) {
        throw new Error(`official module invoke surface requires Arkanalyzer methodKey evidence: ${canonicalApiId}`);
    }
    return {
        ...surface,
        evidence: {
            arkanalyzer: {
                methodKey,
            },
        },
    };
}

export function canonicalDecoratorSurfaceFromId(canonicalApiId: string): AssetSurface {
    const parsed = parseCanonicalApiId(canonicalApiId);
    if (!canonicalApiId || !parsed || parsed.invoke !== "decorator" || !parsed.member.startsWith("decorator:")) {
        throw new Error(`module decorator surface requires a valid decorator canonicalApiId: ${canonicalApiId}`);
    }
    return {
        surfaceId: surfaceIdForCanonicalApiId(canonicalApiId),
        canonicalApiId,
        kind: "decorator",
        confidence: "certain",
        provenance: {
            source: "sdk",
        },
    };
}

export { canonicalDecoratorSurfaceFromId as officialDecoratorSurfaceFromId };

function surfaceIdForCanonicalApiId(canonicalApiId: string): string {
    return `surface:${canonicalApiId}`;
}

function arkanalyzerEvidenceFromCanonicalApiId(canonicalApiId: string): AssetSurfaceEvidence | undefined {
    const methodKey = canonicalApiDescriptorFromIdSeed({ canonicalApiId }).arkanalyzer;
    if (!methodKey) return undefined;
    return {
        arkanalyzer: {
            methodKey,
        },
    };
}
