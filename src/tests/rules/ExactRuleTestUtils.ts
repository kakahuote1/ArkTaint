import type { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import { createAssetIdentityIndex, type AssetDocumentBase, type AssetEndpoint, type AssetIdentityIndex, type RuleValueRef } from "../../core/assets/schema";
import type { ApiEffectIdentity } from "../../core/api/ApiOccurrenceIdentity";
import type {
    RuleEndpointOrRef,
    SanitizerRule,
    SinkRule,
    SourceRule,
    SourceRuleKind,
    TransferRule,
} from "../../core/rules/RuleSchema";
import { normalizeEndpoint } from "../../core/rules/RuleSchema";
import { canonicalApiDescriptorFromIdSeed, createCanonicalApiRegistry, type ArkanalyzerMethodKey, type CanonicalApiDescriptor, type CanonicalApiRegistry } from "../../core/api/identity";
import {
    projectApiEffectAssetFromMethod,
    type TestApiEffectAsset,
} from "../helpers/ApiEffectTestAssets";

export interface ExactRuleFixture<T> {
    rule: T;
    asset: AssetDocumentBase;
    exact: TestApiEffectAsset;
}

export interface ExactRuleRuntime {
    apiAssets: AssetDocumentBase[];
    canonicalApiRegistry: CanonicalApiRegistry;
    assetIdentityIndex: AssetIdentityIndex;
}

const exactRuntimeCache = new Map<string, ExactRuleRuntime>();

export function exactRuleRuntimeFromFixtures(fixtures: Array<ExactRuleFixture<unknown>>): ExactRuleRuntime {
    return exactRuleRuntimeFromAssets(
        fixtures.map(fixture => fixture.asset),
        fixtures.map(fixture => fixture.exact.canonicalApiDescriptor),
    );
}

export function exactRuleRuntimeFromAssets(
    apiAssets: AssetDocumentBase[],
    descriptors: CanonicalApiDescriptor[] = [],
): ExactRuleRuntime {
    const cacheKey = exactRuntimeCacheKey(apiAssets, descriptors);
    const cached = exactRuntimeCache.get(cacheKey);
    if (cached) return cached;
    const descriptorsById = new Map<string, CanonicalApiDescriptor>();
    for (const descriptor of descriptors) {
        descriptorsById.set(descriptor.canonicalApiId, descriptor);
    }
    for (const asset of apiAssets) {
        for (const surface of asset.surfaces || []) {
            const canonicalApiId = String(surface.canonicalApiId || "").trim();
            if (!canonicalApiId || descriptorsById.has(canonicalApiId)) continue;
            descriptorsById.set(canonicalApiId, canonicalApiDescriptorFromIdSeed({
                canonicalApiId,
                arkanalyzer: normalizeArkanalyzerMethodKey(surface.evidence?.arkanalyzer?.methodKey),
            }));
        }
    }
    const canonicalApiRegistry = createCanonicalApiRegistry([...descriptorsById.values()]);
    const assetIdentityIndex = createAssetIdentityIndex({ canonicalApiRegistry });
    for (const asset of apiAssets) {
        assetIdentityIndex.addAsset(asset);
    }
    const runtime = {
        apiAssets,
        canonicalApiRegistry,
        assetIdentityIndex,
    };
    exactRuntimeCache.set(cacheKey, runtime);
    return runtime;
}

function exactRuntimeCacheKey(
    apiAssets: AssetDocumentBase[],
    descriptors: CanonicalApiDescriptor[],
): string {
    return JSON.stringify({
        descriptors: descriptors.map(descriptor => descriptor.canonicalApiId).sort(),
        assets: apiAssets.map(asset => ({
            id: asset.id,
            plane: asset.plane,
            surfaces: (asset.surfaces || []).map(surface => ({
                surfaceId: surface.surfaceId,
                canonicalApiId: surface.canonicalApiId,
            })).sort((left, right) => left.surfaceId.localeCompare(right.surfaceId)),
            bindings: (asset.bindings || []).map(binding => ({
                bindingId: binding.bindingId,
                surfaceId: binding.surfaceId,
                canonicalApiId: binding.canonicalApiId,
                role: binding.role,
                endpoint: binding.endpoint,
                effectTemplateRefs: binding.effectTemplateRefs,
            })).sort((left, right) => left.bindingId.localeCompare(right.bindingId)),
            effectTemplates: (asset.effectTemplates || []).map(template => ({
                id: template.id,
                kind: template.kind,
                value: (template as any).value,
                target: (template as any).target,
                from: (template as any).from,
                to: (template as any).to,
                handle: (template as any).handle,
            })).sort((left, right) => left.id.localeCompare(right.id)),
        })).sort((left, right) => left.id.localeCompare(right.id)),
    });
}

function normalizeArkanalyzerMethodKey(raw: AssetDocumentBase["surfaces"][number]["evidence"] extends infer Evidence
    ? Evidence extends { arkanalyzer?: { methodKey?: infer MethodKey } } ? MethodKey : never
    : never): ArkanalyzerMethodKey | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const key = raw as Partial<ArkanalyzerMethodKey>;
    if (!key.declaringFileName || !key.declaringClassName || !key.methodName || !Array.isArray(key.parameterTypes) || !key.returnType || typeof key.staticFlag !== "boolean") {
        return undefined;
    }
    return {
        declaringFileName: key.declaringFileName,
        declaringNamespacePath: Array.isArray(key.declaringNamespacePath) ? key.declaringNamespacePath : [],
        declaringClassName: key.declaringClassName,
        methodName: key.methodName,
        parameterTypes: key.parameterTypes,
        returnType: key.returnType,
        staticFlag: key.staticFlag,
    };
}

export function exactSourceRule(input: {
    id: string;
    method: ArkMethod;
    sourceKind: SourceRuleKind;
    target: RuleEndpointOrRef;
}): ExactRuleFixture<SourceRule> {
    const exact = projectApiEffectAssetFromMethod({
        id: input.id,
        role: "source",
        method: input.method,
        endpoint: endpointFromRuleRef(input.target),
        sourceKind: input.sourceKind,
    });
    return {
        exact,
        asset: exact.asset,
        rule: {
            id: input.id,
            sourceKind: input.sourceKind,
            target: input.target,
            match: { kind: "canonical_api_id_equals", value: exact.canonicalApiDescriptor.canonicalApiId },
            apiEffect: exact.apiEffect,
        },
    };
}

export function exactSinkRule(input: {
    id: string;
    method: ArkMethod;
    target: RuleEndpointOrRef;
    family?: string;
}): ExactRuleFixture<SinkRule> {
    const exact = projectApiEffectAssetFromMethod({
        id: input.id,
        role: "sink",
        method: input.method,
        endpoint: endpointFromRuleRef(input.target),
        sinkKind: "test",
    });
    return {
        exact,
        asset: exact.asset,
        rule: {
            id: input.id,
            family: input.family,
            target: input.target,
            match: { kind: "canonical_api_id_equals", value: exact.canonicalApiDescriptor.canonicalApiId },
            apiEffect: exact.apiEffect,
        },
    };
}

export function exactTransferRule(input: {
    id: string;
    method: ArkMethod;
    from: RuleEndpointOrRef;
    to: RuleEndpointOrRef;
}): ExactRuleFixture<TransferRule> {
    const exact = projectApiEffectAssetFromMethod({
        id: input.id,
        role: "transfer",
        method: input.method,
        endpoint: endpointFromRuleRef(input.to),
    });
    const from = ruleValueRefFromRuleRef(input.from);
    const to = ruleValueRefFromRuleRef(input.to);
    for (const template of exact.asset.effectTemplates || []) {
        if (template.id === exact.apiEffect.effectTemplateId && template.kind === "rule.transfer") {
            template.from = from;
            template.to = to;
        }
    }
    return {
        exact,
        asset: exact.asset,
        rule: {
            id: input.id,
            from: input.from,
            to: input.to,
            match: { kind: "canonical_api_id_equals", value: exact.canonicalApiDescriptor.canonicalApiId },
            apiEffect: exact.apiEffect,
        },
    };
}

export function exactSanitizerRule(input: {
    id: string;
    method: ArkMethod;
    target: RuleEndpointOrRef;
}): ExactRuleFixture<SanitizerRule> {
    const exact = projectApiEffectAssetFromMethod({
        id: input.id,
        role: "sink",
        method: input.method,
        endpoint: endpointFromRuleRef(input.target),
        sinkKind: "test-sanitizer",
    });
    const apiEffect: ApiEffectIdentity = {
        ...exact.apiEffect,
        role: "sanitizer",
    };
    for (const binding of exact.asset.bindings || []) {
        if (binding.bindingId === apiEffect.bindingId) {
            binding.role = "sanitizer";
        }
    }
    for (const template of exact.asset.effectTemplates || []) {
        if (template.id !== apiEffect.effectTemplateId) continue;
        const raw = template as any;
        raw.kind = "rule.sanitizer";
        raw.sanitizerKind = "test";
        raw.strength = "strong";
        raw.value = ruleValueRefFromRuleRef(input.target);
        delete raw.sinkKind;
    }
    return {
        exact: {
            ...exact,
            apiEffect,
        },
        asset: exact.asset,
        rule: {
            id: input.id,
            target: input.target,
            match: { kind: "canonical_api_id_equals", value: exact.canonicalApiDescriptor.canonicalApiId },
            apiEffect,
        },
    };
}

export function endpointFromRuleRef(input: RuleEndpointOrRef): AssetEndpoint {
    const normalized = normalizeEndpoint(input);
    const endpoint = normalized.endpoint;
    if (endpoint === "base") return { base: { kind: "receiver" } };
    if (endpoint === "result") return { base: { kind: "return" } };
    if (endpoint === "matched_param") return { base: { kind: "matchedParam" as any } };
    if (endpoint.startsWith("arg")) {
        return { base: { kind: "arg", index: Number(endpoint.slice("arg".length)) } };
    }
    return { base: { kind: "return" } };
}

function ruleValueRefFromRuleRef(input: RuleEndpointOrRef): RuleValueRef {
    return endpointFromRuleRef(input) as RuleValueRef;
}
