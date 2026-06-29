import type { AssetEndpoint } from "../assets/schema";

export type ApiEffectRole =
    | "source"
    | "sink"
    | "sanitizer"
    | "transfer"
    | "arkmain"
    | "module";

export interface ApiEffectIdentity {
    canonicalApiId: string;
    assetId: string;
    surfaceId: string;
    bindingId: string;
    effectTemplateId: string;
    role: ApiEffectRole;
}

export interface ResolvedEndpointBinding {
    endpoint: AssetEndpoint;
    pathFrom?: AssetEndpoint;
    slotKind?: string;
    slotWriteMode?: "replace" | "append";
    taintScope?: "self" | "contained-values";
    valueRef?: string;
    status: "exact" | "unresolved" | "rejected";
}

export interface ApiEffectInstance {
    effectInstanceId: string;
    occurrenceId: string;
    rawOccurrenceId: string;
    identity: ApiEffectIdentity;
    endpointBindings: ResolvedEndpointBinding[];
    guardStatus: "accepted" | "rejected" | "unresolved";
    endpointStatus: "exact" | "unresolved" | "rejected";
    acceptedForPropagation: boolean;
    diagnostics: Array<{ kind: string; message: string }>;
}

export interface ApiIdentityBackedRule {
    apiEffect: ApiEffectIdentity;
}

export function hasApiEffectIdentity(rule: Partial<ApiIdentityBackedRule> | undefined): rule is ApiIdentityBackedRule {
    const apiEffect = rule?.apiEffect;
    return !!apiEffect
        && !!apiEffect.canonicalApiId
        && !!apiEffect.assetId
        && !!apiEffect.surfaceId
        && !!apiEffect.bindingId
        && !!apiEffect.effectTemplateId
        && !!apiEffect.role;
}
