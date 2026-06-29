import type { ArkMethod } from "../../../arkanalyzer/out/src/core/model/ArkMethod";
import type { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import type { SinkRule } from "../../core/rules/RuleSchema";
import type { TaintFlow } from "../../core/kernel/model/TaintFlow";
import { ApiEffectRuntimeIndex } from "../../core/api/effects";
import { createAssetIdentityIndex } from "../../core/assets/schema";
import { createCanonicalApiRegistry } from "../../core/api/identity";
import { projectApiEffectAssetFromMethod } from "./ApiEffectTestAssets";

export function resolveUniqueMethodByExactNameForTest(engineOrScene: TaintPropagationEngine | { getMethods?: () => ArkMethod[] }, methodName: string): ArkMethod {
    const methods = methodsFromEngineOrScene(engineOrScene).filter(method => method.getName?.() === methodName);
    if (methods.length !== 1) {
        throw new Error(`expected exactly one method named ${methodName}, got ${methods.length}`);
    }
    return methods[0];
}

export function resolveUniqueMethodByExactSignatureForTest(engineOrScene: TaintPropagationEngine | { getMethods?: () => ArkMethod[] }, signature: string): ArkMethod {
    const methods = methodsFromEngineOrScene(engineOrScene).filter(method =>
        String(method.getSignature?.()?.toString?.() || "") === signature);
    if (methods.length !== 1) {
        throw new Error(`expected exactly one method with signature ${signature}, got ${methods.length}`);
    }
    return methods[0];
}

export function detectSinksByExactMethodsForTest(
    engine: TaintPropagationEngine,
    sinkMethods: ArkMethod | ArkMethod[],
): TaintFlow[] {
    const scene = (engine as any).scene;
    const methods = Array.isArray(sinkMethods) ? sinkMethods : [sinkMethods];
    if (methods.length === 0) return [];

    const exactAssets = methods.map(method => ({
        method,
        exact: projectApiEffectAssetFromMethod({
            id: `sink.${stableMethodId(method)}`,
            role: "sink",
            method,
            endpoint: { base: { kind: "arg", index: 0 } },
            sinkKind: "test",
        }),
    }));
    const registry = createCanonicalApiRegistry(exactAssets.map(item => item.exact.canonicalApiDescriptor));
    const index = createAssetIdentityIndex({ canonicalApiRegistry: registry });
    for (const item of exactAssets) {
        index.addAsset(item.exact.asset);
    }
    (engine as any).apiEffectRuntimeIndex = ApiEffectRuntimeIndex.build({
        scene,
        assets: exactAssets.map(item => item.exact.asset),
        assetIdentityIndex: index,
        canonicalApiRegistry: registry,
    });

    const rules: SinkRule[] = exactAssets.map(({ method, exact }) => ({
            id: `test.sink.${stableMethodId(method)}`,
            enabled: true,
            match: {
                kind: "canonical_api_id_equals",
                value: exact.canonicalApiDescriptor.canonicalApiId,
            },
            apiEffect: exact.apiEffect,
            target: { endpoint: "arg0" },
    }));

    return engine.detectSinksByRules(rules);
}

function methodsFromEngineOrScene(engineOrScene: TaintPropagationEngine | { getMethods?: () => ArkMethod[] }): ArkMethod[] {
    const scene = (engineOrScene as any).scene || engineOrScene;
    const methods = scene?.getMethods?.();
    if (!Array.isArray(methods)) {
        throw new Error("expected engine or scene with getMethods()");
    }
    return methods;
}

function stableMethodId(method: ArkMethod): string {
    return String(method.getSignature?.()?.toString?.() || method.getName?.() || "sink")
        .replace(/[^A-Za-z0-9_.-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 120) || "sink";
}
