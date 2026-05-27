import type { AssetBinding, AssetDocumentBase, AssetSurface, ProgramPoint, ResolvedEndpoint, SemanticEffectInstance, SemanticEffectTemplate, SourceLocation, TypedEffectPayload } from "../schema";

export interface SemanticModelMatchSite {
    programPoint: ProgramPoint;
    methodSignature: string;
    location: SourceLocation;
    resolvedEndpoints?: ResolvedEndpoint[];
    payload?: TypedEffectPayload;
}

export function instantiateEffectTemplate(
    asset: AssetDocumentBase,
    surface: AssetSurface,
    binding: AssetBinding,
    template: SemanticEffectTemplate,
    site: SemanticModelMatchSite,
): SemanticEffectInstance {
    return {
        id: `${asset.id}:${binding.bindingId}:${template.id}:${site.programPoint.methodSignature}:${site.programPoint.stmtId}`,
        kind: template.kind,
        modelId: asset.id,
        bindingId: binding.bindingId,
        templateId: template.id,
        surfaceId: surface.surfaceId,
        programPoint: site.programPoint,
        methodSignature: site.methodSignature,
        location: site.location,
        resolvedEndpoints: site.resolvedEndpoints || [],
        payload: site.payload || {},
        originStatus: asset.status,
        confidence: template.confidence || binding.confidence,
    };
}
