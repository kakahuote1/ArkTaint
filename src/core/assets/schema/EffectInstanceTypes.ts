import type { AssetStatus, Confidence, ProgramPoint, SourceLocation } from "./CommonTypes";
import type { SemanticEffectKind } from "./EffectTemplateTypes";
import type { ResolvedEndpoint } from "./SurfaceTypes";

export type TypedEffectPayload = Record<string, unknown>;

export interface SemanticEffectInstance {
    id: string;
    kind: SemanticEffectKind;
    modelId: string;
    bindingId: string;
    templateId: string;
    surfaceId: string;
    programPoint: ProgramPoint;
    methodSignature: string;
    location: SourceLocation;
    resolvedEndpoints: ResolvedEndpoint[];
    payload: TypedEffectPayload;
    originStatus: AssetStatus;
    confidence: Confidence;
}
