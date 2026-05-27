import type {
    AssetBinding,
    AssetDocumentBase,
    AssetEndpoint,
    AssetSurface,
    CoreCapabilityTemplate,
    InvokeSurface,
} from "../../core/assets/schema";

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
    const templateId = `${input.id}.capability`;
    return {
        id: input.id,
        plane: "module",
        status: "official",
        surfaces: input.surfaces,
        bindings: input.surfaces.map(surface => ({
            bindingId: `${surface.surfaceId}.binding`,
            surfaceId: surface.surfaceId,
            assetId: input.id,
            plane: "module",
            role: input.role,
            endpoint: endpointForSurface(surface),
            effectTemplateRefs: [templateId],
            semanticsFamily: input.semanticsFamily,
            metadata: {
                description: input.description,
            },
            completeness: "complete",
            confidence: "certain",
        })),
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

export function moduleInvokeSurface(
    surfaceId: string,
    ownerName: string,
    methodName: string,
    argCount: number,
    invokeKind: InvokeSurface["invokeKind"] = "static",
    modulePath = "arkts.framework",
): InvokeSurface {
    return {
        surfaceId,
        kind: "invoke",
        modulePath,
        ownerName,
        methodName,
        invokeKind,
        argCount,
        confidence: "certain",
        provenance: {
            source: "manual",
        },
    };
}

export function decoratorSurface(
    surfaceId: string,
    decoratorName: string,
    ownerName = "ArkUIComponent",
): AssetSurface {
    return {
        surfaceId,
        kind: "decorator",
        decoratorName,
        ownerKind: "field",
        ownerName,
        confidence: "certain",
        provenance: {
            source: "manual",
        },
    };
}

function endpointForSurface(surface: AssetSurface): AssetEndpoint | undefined {
    if (surface.kind === "invoke") {
        return {
            base: { kind: "receiver" },
        };
    }
    if (surface.kind === "decorator") {
        return {
            base: { kind: "receiver" },
            accessPath: [surface.decoratorName],
        };
    }
    return undefined;
}
