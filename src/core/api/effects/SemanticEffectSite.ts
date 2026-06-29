import type { AssetEndpoint } from "../../assets/schema";
import type { ApiEffectInstance, ApiEffectRole, ResolvedEndpointBinding } from "../ApiOccurrenceIdentity";

export interface SemanticEffectSite {
    readonly effectSiteId: string;
    readonly occurrenceId: string;
    readonly rawOccurrenceId: string;
    readonly canonicalApiId: string;
    readonly capability: ApiEffectRole;
    readonly effectAssetId: string;
    readonly surfaceId?: string;
    readonly bindingId?: string;
    readonly effectTemplateId?: string;
    readonly endpointSpec: AssetEndpoint;
    readonly endpointBindingRef?: string;
}

export function semanticEffectSitesFromEffect(effect: ApiEffectInstance): SemanticEffectSite[] {
    const out: SemanticEffectSite[] = [];
    for (const binding of effect.endpointBindings) {
        if (binding.status !== "exact") continue;
        out.push(semanticEffectSiteFromEndpointBinding(effect, binding));
    }
    return out;
}

export function semanticEffectSiteFromEndpointBinding(
    effect: ApiEffectInstance,
    binding: ResolvedEndpointBinding,
): SemanticEffectSite {
    const endpointBindingRef = binding.valueRef || "endpoint";
    return {
        effectSiteId: [
            effect.effectInstanceId,
            endpointBindingRef,
            endpointPathKey(binding.endpoint),
        ].join(":"),
        occurrenceId: effect.occurrenceId,
        rawOccurrenceId: effect.rawOccurrenceId,
        canonicalApiId: effect.identity.canonicalApiId,
        capability: effect.identity.role,
        effectAssetId: effect.identity.assetId,
        surfaceId: effect.identity.surfaceId,
        bindingId: effect.identity.bindingId,
        effectTemplateId: effect.identity.effectTemplateId,
        endpointSpec: binding.endpoint,
        endpointBindingRef,
    };
}

function endpointPathKey(endpoint: AssetEndpoint): string {
    const base = endpoint.base;
    switch (base.kind) {
        case "receiver":
            return withAccessPath("base", endpoint.accessPath);
        case "arg":
            return withAccessPath(`arg${base.index}`, endpoint.accessPath);
        case "rest":
            return withAccessPath(`rest${base.startIndex}[]`, endpoint.accessPath);
        case "return":
            return withAccessPath("result", endpoint.accessPath);
        case "promiseResult":
            return withAccessPath("promiseResult", endpoint.accessPath);
        case "promiseRejected":
            return withAccessPath("promiseRejected", endpoint.accessPath);
        case "constructorResult":
            return withAccessPath("constructorResult", endpoint.accessPath);
        case "callbackArg":
            return withAccessPath(
                `${callbackLocatorKey(base.callback)}.arg${base.argIndex}`,
                endpoint.accessPath,
            );
        case "callbackReturn":
            return withAccessPath(`${callbackLocatorKey(base.callback)}.return`, endpoint.accessPath);
    }
}

function callbackLocatorKey(locator: { kind: "arg"; index: number } | { kind: "option"; base: AssetEndpoint; accessPath: string[] }): string {
    if (locator.kind === "arg") return `callbackArg${locator.index}`;
    return withAccessPath(`callbackOption:${endpointPathKey(locator.base)}`, locator.accessPath);
}

function withAccessPath(base: string, accessPath?: readonly string[]): string {
    if (!accessPath || accessPath.length === 0) return base;
    return `${base}.${accessPath.map(item => String(item || "").trim()).filter(Boolean).join(".")}`;
}
