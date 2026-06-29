import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import type { AssetDocumentBase, AssetEndpoint, AssetSurface } from "../../core/assets/schema";
import { fromProjectDeclaration } from "../../core/api/identity";
import type {
    InternalModuleLoweringIR,
    ModuleSemanticSurfaceRef,
} from "../../core/kernel/contracts/InternalModuleLoweringIR";
import { lowerModuleAssetToInternalModuleLoweringIR } from "../../core/kernel/contracts/ModuleAssetLowering";
import type { TaintModule } from "../../core/kernel/contracts/ModuleContract";
import { compileInternalModuleLoweringIR } from "../../core/orchestration/modules/InternalModuleLoweringIRCompiler";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { makeRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";
import tsjsContainerModuleAsset from "../../models/kernel/modules/tsjs/container";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function capabilityPayload(asset: AssetDocumentBase): Record<string, any> {
    const template = (asset.effectTemplates || []).find(item => item.kind === "core.capability") as any;
    if (!template || typeof template.payload !== "object" || template.payload === null) {
        throw new Error(`module asset ${asset.id} must expose a core.capability payload for this fixture`);
    }
    return template.payload as Record<string, any>;
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

async function runCase(
    scene: Scene,
    relativePath: string,
    caseName: string,
    modules: TaintModule[],
    projectRulePath: string,
    moduleAssets: AssetDocumentBase[],
): Promise<{
    totalFlows: number;
    loadedModuleIds: string[];
    totalEmissionCount: number;
    emissionReasons: string[];
    moduleSemanticSiteCount: number;
    moduleResolvedCount: number;
    moduleEndpointGapCount: number;
}> {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        projectRulePath: path.resolve(projectRulePath),
        allowMissingProject: false,
        autoDiscoverRuleSources: false,
    });
    const sourceRules = loaded.ruleSet.sources || [];
    const sinkRules = loaded.ruleSet.sinks || [];
    const entry = resolveCaseMethod(scene, relativePath, caseName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, `missing entry method: ${caseName}`);

    const engine = new TaintPropagationEngine(scene, 1, {
        includeBuiltinModules: false,
        modules,
        apiAssets: [...loaded.assets, ...moduleAssets],
    });
    engine.verbose = false;
    await engine.buildPAG({
        syntheticEntryMethods: [entryMethod!],
        entryModel: "explicit",
    });
    try {
        const reachable = engine.computeReachableMethodSignatures();
        engine.setActiveReachableMethodSignatures(reachable);
    } catch {
        engine.setActiveReachableMethodSignatures(undefined);
    }

    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const moduleStats = Object.values(engine.getModuleAuditSnapshot().moduleStats) as any[];
    const semanticSites = engine.getSemanticEffectLedger()
        .filter((record: any) => record.recordKind === "semantic_effect_site" && record.capability === "module");
    return {
        totalFlows: flows.length,
        loadedModuleIds: engine.getModuleAuditSnapshot().loadedModuleIds,
        totalEmissionCount: moduleStats.reduce((sum, item) => sum + Number(item.totalEmissionCount || 0), 0),
        emissionReasons: moduleStats.flatMap(item =>
            (item.emissionSamples || []).map((sample: any) => String(sample.reason || "")),
        ).filter(Boolean).sort(),
        moduleSemanticSiteCount: semanticSites.length,
        moduleResolvedCount: semanticSites.filter((record: any) => record.status === "resolved").length,
        moduleEndpointGapCount: semanticSites.filter((record: any) => record.status === "endpoint_gap").length,
    };
}

type RuntimeCase = {
    id: string;
    file: string;
    entry: string;
    expectedFlows: number;
    note: string;
};

type RuntimeFamily = {
    id: string;
    title: string;
    semantic: string;
    why: string;
    spec: InternalModuleLoweringIR | ((surfaceForMethod: (methodName: string) => ModuleSemanticSurfaceRef) => InternalModuleLoweringIR);
    identityHints?: {
        eventEmitter?: {
            on: string[];
            emit: string[];
        };
        keyedStorage?: {
            writes: Array<{ methodName: string; valueIndex: number }>;
            reads: string[];
            kills?: string[];
        };
        routeBridge?: {
            pushes: Array<{
                methodName: string;
                routeField?: string;
                routeArgIndex?: number;
                payloadArgIndex?: number;
                payloadField?: string;
            }>;
            gets: string[];
            navRegisters?: string[];
            navTriggers?: string[];
        };
        bridge?: {
            invokes: string[];
        };
    };
    files: Record<string, string>;
    projectRules?: Record<string, unknown>;
    cases: RuntimeCase[];
};

type CompileCase = {
    id: string;
    spec: unknown;
    expectedSubstrings: string[];
    note: string;
};

type CompileFamily = {
    id: string;
    title: string;
    semantic: string;
    why: string;
    cases: CompileCase[];
};

type RuntimeResult = {
    kind: "runtime";
    id: string;
    title: string;
    semantic: string;
    why: string;
    compiledModuleIds: string[];
    cases: Array<RuntimeCase & {
        actualFlows: number;
        passed: boolean;
        totalEmissionCount?: number;
        emissionReasons?: string[];
        moduleSemanticSiteCount?: number;
        moduleResolvedCount?: number;
        moduleEndpointGapCount?: number;
    }>;
};

type CompileResult = {
    kind: "compile";
    id: string;
    title: string;
    semantic: string;
    why: string;
    cases: Array<CompileCase & { passed: boolean; message: string }>;
};

function writeProjectRules(projectRulePath: string, asset: AssetDocumentBase): void {
    writeText(projectRulePath, JSON.stringify(asset, null, 2));
}

function projectRuleAsset(files: Record<string, string>, rules?: Record<string, unknown>): AssetDocumentBase {
    if (rules) {
        return typeof rules.id === "string" && rules.plane === "rule"
            ? rules as unknown as AssetDocumentBase
            : makeRuleAssetFixture({
                id: "asset.rule.fixture.semantic_edge_suite.custom",
                sources: (rules.sources as any[]) || [],
                sinks: (rules.sinks as any[]) || [],
                sanitizers: (rules.sanitizers as any[]) || [],
                transfers: (rules.transfers as any[]) || [],
            });
    }
    return defaultSemanticEdgeRuleAsset(files);
}

function defaultSemanticEdgeRuleAsset(files: Record<string, string>): ReturnType<typeof makeRuleAssetFixture> {
    const fileNames = Object.keys(files);
    return makeRuleAssetFixture({
        id: "asset.rule.fixture.semantic_edge_suite",
        sources: fileNames.map(file => ({
            id: `source.fixture.semantic_edge_suite.${sanitizeId(file)}`,
            sourceKind: "call_return",
            surface: {
                kind: "invoke",
                modulePath: modulePathForGeneratedInput(file),
                ownerName: "file",
                ownerKind: "namespace",
                methodName: "Source",
                invokeKind: "free-function",
                argCount: 0,
                parameterTypes: [],
                returnType: "string",
            },
            target: "result",
        })),
        sinks: fileNames.map(file => ({
            id: `sink.fixture.semantic_edge_suite.${sanitizeId(file)}`,
            surface: {
                kind: "invoke",
                modulePath: modulePathForGeneratedInput(file),
                ownerName: "file",
                ownerKind: "namespace",
                methodName: "Sink",
                invokeKind: "free-function",
                argCount: 1,
                parameterTypes: ["string"],
                returnType: "void",
            },
            target: "arg0",
        })),
    });
}

function modulePathForGeneratedInput(file: string): string {
    return `inputs/${file.replace(/\\/g, "/")}`;
}

function sanitizeId(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "fixture";
}

function materializeRuntimeFamilyIdentity(
    scene: Scene,
    family: RuntimeFamily,
): { spec: InternalModuleLoweringIR; asset: AssetDocumentBase; moduleAssets: AssetDocumentBase[] } {
    const asset = projectRuleAsset(family.files, family.projectRules);
    if (typeof family.spec === "function") {
        const hints = family.identityHints?.bridge;
        if (!hints) {
            throw new Error(`${family.id} spec factory requires identityHints.bridge`);
        }
        const canonicalIdsByMethodName = new Map<string, string[]>();
        for (const methodName of hints.invokes) {
            const canonicalApiIds = canonicalApiIdsForSceneMethods(scene, asset, [methodName], `bridge.${methodName}`);
            if (canonicalApiIds.length === 0) {
                throw new Error(`${family.id} bridge invoke ${methodName} requires exact canonicalApiIds`);
            }
            canonicalIdsByMethodName.set(methodName, canonicalApiIds);
        }
        const spec = family.spec(methodName => {
            const canonicalApiIds = canonicalIdsByMethodName.get(methodName);
            if (!canonicalApiIds || canonicalApiIds.length !== 1) {
                throw new Error(`bridge surface ${methodName} must resolve to exactly one canonicalApiId, got ${canonicalApiIds?.length || 0}`);
            }
            return invokeSurfaceRef(canonicalApiIds[0]);
        });
        return { spec, asset, moduleAssets: moduleAssetsForMaterializedSpec(family, spec, asset) };
    }
    const spec = JSON.parse(JSON.stringify(family.spec)) as InternalModuleLoweringIR;
    for (const semantic of spec.semantics || []) {
        if ((semantic as any).kind === "event_emitter") {
            const hints = family.identityHints?.eventEmitter;
            if (!hints) {
                throw new Error(`${family.id} event_emitter semantic requires identityHints.eventEmitter`);
            }
            const onCanonicalApiIds = mergeCanonicalApiIds(
                stringArray((semantic as any).onCanonicalApiIds),
                canonicalApiIdsForSceneMethods(scene, asset, hints.on, "on"),
            );
            const emitCanonicalApiIds = mergeCanonicalApiIds(
                stringArray((semantic as any).emitCanonicalApiIds),
                canonicalApiIdsForSceneMethods(scene, asset, hints.emit, "emit"),
            );
            if (onCanonicalApiIds.length === 0 || emitCanonicalApiIds.length === 0) {
                throw new Error(`${family.id} event_emitter semantic requires exact onCanonicalApiIds and emitCanonicalApiIds`);
            }
            (semantic as any).onCanonicalApiIds = onCanonicalApiIds;
            (semantic as any).emitCanonicalApiIds = emitCanonicalApiIds;
        }
        if ((semantic as any).kind === "keyed_storage") {
            const hints = family.identityHints?.keyedStorage;
            if (!hints) {
                throw new Error(`${family.id} keyed_storage semantic requires identityHints.keyedStorage`);
            }
            (semantic as any).writeApis = hints.writes.map((write, index) => {
                const canonicalApiIds = canonicalApiIdsForSceneMethods(scene, asset, [write.methodName], `write.${index}`);
                if (canonicalApiIds.length === 0) {
                    throw new Error(`${family.id} keyed_storage write ${write.methodName} requires exact canonicalApiIds`);
                }
                return {
                    canonicalApiIds,
                    valueIndex: write.valueIndex,
                };
            });
            (semantic as any).readCanonicalApiIds = canonicalApiIdsForSceneMethods(scene, asset, hints.reads, "read");
            if ((semantic as any).readCanonicalApiIds.length === 0) {
                throw new Error(`${family.id} keyed_storage read requires exact readCanonicalApiIds`);
            }
            const killCanonicalApiIds = canonicalApiIdsForSceneMethods(scene, asset, hints.kills || [], "kill");
            if (killCanonicalApiIds.length > 0) {
                (semantic as any).killCanonicalApiIds = killCanonicalApiIds;
            }
        }
        if ((semantic as any).kind === "route_bridge") {
            const hints = family.identityHints?.routeBridge;
            if (!hints) {
                throw new Error(`${family.id} route_bridge semantic requires identityHints.routeBridge`);
            }
            (semantic as any).pushApis = hints.pushes.map((push, index) => {
                const canonicalApiIds = canonicalApiIdsForSceneMethods(scene, asset, [push.methodName], `push.${index}`);
                if (canonicalApiIds.length === 0) {
                    throw new Error(`${family.id} route_bridge push ${push.methodName} requires exact canonicalApiIds`);
                }
                return {
                    canonicalApiIds,
                    ...(push.routeField ? { routeField: push.routeField } : {}),
                    ...(Number.isInteger(push.routeArgIndex) ? { routeArgIndex: push.routeArgIndex } : {}),
                    ...(Number.isInteger(push.payloadArgIndex) ? { payloadArgIndex: push.payloadArgIndex } : {}),
                    ...(push.payloadField ? { payloadField: push.payloadField } : {}),
                };
            });
            (semantic as any).getCanonicalApiIds = canonicalApiIdsForSceneMethods(scene, asset, hints.gets, "get");
            if ((semantic as any).getCanonicalApiIds.length === 0) {
                throw new Error(`${family.id} route_bridge get requires exact getCanonicalApiIds`);
            }
            const navDestinationRegisterCanonicalApiIds = canonicalApiIdsForSceneMethods(
                scene,
                asset,
                hints.navRegisters || [],
                "nav.register",
            );
            if (navDestinationRegisterCanonicalApiIds.length > 0) {
                (semantic as any).navDestinationRegisterApis = navDestinationRegisterCanonicalApiIds.map(canonicalApiId => ({
                    canonicalApiIds: [canonicalApiId],
                    callbackArgIndex: 1,
                    payloadParamIndex: 0,
                }));
            }
            const navDestinationTriggerCanonicalApiIds = canonicalApiIdsForSceneMethods(
                scene,
                asset,
                hints.navTriggers || [],
                "nav.trigger",
            );
            if (navDestinationTriggerCanonicalApiIds.length > 0) {
                (semantic as any).navDestinationTriggerApis = navDestinationTriggerCanonicalApiIds.map(canonicalApiId => ({
                    canonicalApiIds: [canonicalApiId],
                    routeArgIndex: 0,
                }));
            }
        }
        if ((semantic as any).kind === "bridge") {
            const hints = family.identityHints?.bridge;
            if (hints) {
                const canonicalIdsByMethodName = new Map<string, string[]>();
                for (const methodName of hints.invokes) {
                    const canonicalApiIds = canonicalApiIdsForSceneMethods(scene, asset, [methodName], `bridge.${methodName}`);
                    if (canonicalApiIds.length === 0) {
                        throw new Error(`${family.id} bridge invoke ${methodName} requires exact canonicalApiIds`);
                    }
                    canonicalIdsByMethodName.set(methodName, canonicalApiIds);
                }
                rewriteBridgeStringSurfaces(semantic as unknown as Record<string, unknown>, canonicalIdsByMethodName);
            }
        }
    }
    return { spec, asset, moduleAssets: moduleAssetsForMaterializedSpec(family, spec, asset) };
}

function moduleAssetsForMaterializedSpec(
    family: RuntimeFamily,
    spec: InternalModuleLoweringIR,
    ruleAsset: AssetDocumentBase,
): AssetDocumentBase[] {
    const assets: AssetDocumentBase[] = [];
    for (const [index, semantic] of (spec.semantics || []).entries()) {
        const semanticId = String((semantic as any).id || `${semantic.kind}.${index}`);
        if (semantic.kind === "event_emitter") {
            assets.push(eventEmitterModuleAssetForSemantic(family, semanticId, semantic as any, ruleAsset));
        }
        if (semantic.kind === "route_bridge") {
            assets.push(routeBridgeModuleAssetForSemantic(family, semanticId, semantic as any, ruleAsset));
        }
    }
    return assets;
}

function eventEmitterModuleAssetForSemantic(
    family: RuntimeFamily,
    semanticId: string,
    semantic: {
        onCanonicalApiIds: string[];
        emitCanonicalApiIds: string[];
        channelArgIndexes?: number[];
        payloadArgIndex?: number;
        callbackArgIndex?: number;
        callbackParamIndex?: number;
        maxCandidates?: number;
    },
    ruleAsset: AssetDocumentBase,
): AssetDocumentBase {
    const onCanonicalApiIds = stringArray(semantic.onCanonicalApiIds);
    const emitCanonicalApiIds = stringArray(semantic.emitCanonicalApiIds);
    assert(onCanonicalApiIds.length > 0, `${family.id} event_emitter requires exact onCanonicalApiIds`);
    assert(emitCanonicalApiIds.length > 0, `${family.id} event_emitter requires exact emitCanonicalApiIds`);
    const assetId = `asset.module.fixture.semantic_edge_suite.${sanitizeId(family.id)}.${sanitizeId(semanticId)}`;
    const templateId = `${assetId}.template.eventEmitter`;
    const surfaces = surfacesForCanonicalApiIds(ruleAsset, [...onCanonicalApiIds, ...emitCanonicalApiIds], family.id);
    return {
        id: assetId,
        plane: "module",
        status: "official",
        surfaces,
        bindings: surfaces.map((surface, bindingIndex) => ({
            bindingId: `${assetId}.binding.${bindingIndex}`,
            surfaceId: surface.surfaceId,
            canonicalApiId: surface.canonicalApiId,
            assetId,
            plane: "module",
            role: "handoff",
            effectTemplateRefs: [templateId],
            semanticsFamily: `semantic-edge-suite.${family.id}.event_emitter`,
            metadata: { description: `${family.id} event emitter runtime fixture` },
            completeness: "complete",
            confidence: "certain",
        })),
        effectTemplates: [
            {
                id: templateId,
                kind: "module.eventEmitter",
                onCanonicalApiIds,
                emitCanonicalApiIds,
                ...(semantic.channelArgIndexes ? { channelArgIndexes: [...semantic.channelArgIndexes] } : {}),
                ...(Number.isInteger(semantic.payloadArgIndex) ? { payloadArgIndex: semantic.payloadArgIndex } : {}),
                ...(Number.isInteger(semantic.callbackArgIndex) ? { callbackArgIndex: semantic.callbackArgIndex } : {}),
                ...(Number.isInteger(semantic.callbackParamIndex) ? { callbackParamIndex: semantic.callbackParamIndex } : {}),
                ...(Number.isInteger(semantic.maxCandidates) ? { maxCandidates: semantic.maxCandidates } : {}),
                confidence: "certain",
            },
        ],
        provenance: { source: "manual" },
    };
}

function routeBridgeModuleAssetForSemantic(
    family: RuntimeFamily,
    semanticId: string,
    semantic: {
        pushApis: Array<{
            canonicalApiIds: string[];
            routeField?: string;
            routeArgIndex?: number;
            payloadArgIndex?: number;
            payloadField?: string;
        }>;
        getCanonicalApiIds: string[];
        navDestinationRegisterApis?: Array<{
            canonicalApiIds: string[];
            callbackArgIndex: number;
            routeParamIndex?: number;
            payloadParamIndex: number;
        }>;
        navDestinationTriggerApis?: Array<{
            canonicalApiIds: string[];
            routeField?: string;
            routeArgIndex?: number;
            payloadArgIndex?: number;
            payloadField?: string;
        }>;
        payloadUnwrapPrefixes?: string[];
    },
    ruleAsset: AssetDocumentBase,
): AssetDocumentBase {
    const pushApis = (semantic.pushApis || []).map(api => ({
        canonicalApiIds: stringArray(api.canonicalApiIds),
        ...(api.routeField ? { routeField: api.routeField } : {}),
        ...(Number.isInteger(api.routeArgIndex) ? { routeArgIndex: api.routeArgIndex } : {}),
        ...(Number.isInteger(api.payloadArgIndex) ? { payloadArgIndex: api.payloadArgIndex } : {}),
        ...(api.payloadField ? { payloadField: api.payloadField } : {}),
    }));
    const getCanonicalApiIds = stringArray(semantic.getCanonicalApiIds);
    const navDestinationRegisterApis = (semantic.navDestinationRegisterApis || []).map(api => ({
        canonicalApiIds: stringArray(api.canonicalApiIds),
        callbackArgIndex: api.callbackArgIndex,
        ...(Number.isInteger(api.routeParamIndex) ? { routeParamIndex: api.routeParamIndex } : {}),
        payloadParamIndex: api.payloadParamIndex,
    }));
    const navDestinationTriggerApis = (semantic.navDestinationTriggerApis || []).map(api => ({
        canonicalApiIds: stringArray(api.canonicalApiIds),
        ...(api.routeField ? { routeField: api.routeField } : {}),
        ...(Number.isInteger(api.routeArgIndex) ? { routeArgIndex: api.routeArgIndex } : {}),
        ...(Number.isInteger(api.payloadArgIndex) ? { payloadArgIndex: api.payloadArgIndex } : {}),
        ...(api.payloadField ? { payloadField: api.payloadField } : {}),
    }));
    assert(pushApis.some(api => api.canonicalApiIds.length > 0), `${family.id} route_bridge requires exact push canonicalApiIds`);
    assert(getCanonicalApiIds.length > 0, `${family.id} route_bridge requires exact getCanonicalApiIds`);
    const assetId = `asset.module.fixture.semantic_edge_suite.${sanitizeId(family.id)}.${sanitizeId(semanticId)}`;
    const templateId = `${assetId}.template.routeBridge`;
    const canonicalApiIds = [
        ...pushApis.flatMap(api => api.canonicalApiIds),
        ...getCanonicalApiIds,
        ...navDestinationRegisterApis.flatMap(api => api.canonicalApiIds),
        ...navDestinationTriggerApis.flatMap(api => api.canonicalApiIds),
    ];
    const surfaces = surfacesForCanonicalApiIds(ruleAsset, canonicalApiIds, family.id);
    return {
        id: assetId,
        plane: "module",
        status: "official",
        surfaces,
        bindings: surfaces.map((surface, bindingIndex) => ({
            bindingId: `${assetId}.binding.${bindingIndex}`,
            surfaceId: surface.surfaceId,
            canonicalApiId: surface.canonicalApiId,
            assetId,
            plane: "module",
            role: "handoff",
            endpoint: endpointForRouteBridgeCanonicalApiId(String(surface.canonicalApiId || ""), {
                pushApis,
                getCanonicalApiIds,
                navDestinationRegisterApis,
                navDestinationTriggerApis,
            }),
            effectTemplateRefs: [templateId],
            semanticsFamily: `semantic-edge-suite.${family.id}.route_bridge`,
            metadata: { description: `${family.id} route bridge runtime fixture` },
            completeness: "complete",
            confidence: "certain",
        })),
        effectTemplates: [
            {
                id: templateId,
                kind: "core.capability",
                capability: "module.route-bridge",
                payload: {
                    pushApis,
                    getCanonicalApiIds,
                    navDestinationRegisterApis,
                    navDestinationTriggerApis,
                    ...(semantic.payloadUnwrapPrefixes ? { payloadUnwrapPrefixes: [...semantic.payloadUnwrapPrefixes] } : {}),
                },
                confidence: "certain",
            },
        ],
        provenance: { source: "manual" },
    };
}

function surfacesForCanonicalApiIds(
    asset: AssetDocumentBase,
    canonicalApiIds: string[],
    familyId: string,
): AssetSurface[] {
    const wanted = new Set(stringArray(canonicalApiIds));
    const surfaces = (asset.surfaces || []).filter(surface => wanted.has(String(surface.canonicalApiId || "")));
    const found = new Set(surfaces.map(surface => String(surface.canonicalApiId || "")));
    const missing = [...wanted].filter(canonicalApiId => !found.has(canonicalApiId));
    assert(missing.length === 0, `${familyId} module asset references missing canonical surfaces: ${missing.join(", ")}`);
    const bySurfaceId = new Map<string, AssetSurface>();
    for (const surface of surfaces) {
        bySurfaceId.set(surface.surfaceId, surface);
    }
    return [...bySurfaceId.values()].sort((left, right) => left.surfaceId.localeCompare(right.surfaceId));
}

function endpointForRouteBridgeCanonicalApiId(
    canonicalApiId: string,
    semantic: {
        pushApis: Array<{ canonicalApiIds: string[]; routeArgIndex?: number; payloadArgIndex?: number }>;
        getCanonicalApiIds: string[];
        navDestinationRegisterApis: Array<{ canonicalApiIds: string[]; callbackArgIndex: number }>;
        navDestinationTriggerApis: Array<{ canonicalApiIds: string[]; routeArgIndex?: number; payloadArgIndex?: number }>;
    },
): AssetEndpoint {
    const pushApi = semantic.pushApis.find(api => api.canonicalApiIds.includes(canonicalApiId));
    if (pushApi) {
        return argEndpoint(requiredRouteEndpointIndex(pushApi, canonicalApiId, "push"));
    }
    if (semantic.getCanonicalApiIds.includes(canonicalApiId)) {
        return returnEndpoint();
    }
    const registerApi = semantic.navDestinationRegisterApis.find(api => api.canonicalApiIds.includes(canonicalApiId));
    if (registerApi) {
        return argEndpoint(registerApi.callbackArgIndex);
    }
    const triggerApi = semantic.navDestinationTriggerApis.find(api => api.canonicalApiIds.includes(canonicalApiId));
    if (triggerApi) {
        return argEndpoint(requiredRouteEndpointIndex(triggerApi, canonicalApiId, "trigger"));
    }
    throw new Error(`route_bridge canonicalApiId is not declared by semantic payload: ${canonicalApiId}`);
}

function requiredRouteEndpointIndex(
    api: { routeArgIndex?: number; payloadArgIndex?: number },
    canonicalApiId: string,
    role: string,
): number {
    if (Number.isInteger(api.payloadArgIndex)) return api.payloadArgIndex!;
    if (Number.isInteger(api.routeArgIndex)) return api.routeArgIndex!;
    throw new Error(`route_bridge ${role} API ${canonicalApiId} requires explicit routeArgIndex or payloadArgIndex`);
}

function argEndpoint(index: number): AssetEndpoint {
    return { base: { kind: "arg", index } };
}

function returnEndpoint(): AssetEndpoint {
    return { base: { kind: "return" } };
}

function compileRuntimeModules(materialized: { spec: InternalModuleLoweringIR; moduleAssets: AssetDocumentBase[] }): TaintModule[] {
    if (materialized.moduleAssets.length === 0) {
        return compileInternalModuleLoweringIR(materialized.spec);
    }
    return materialized.moduleAssets.flatMap(asset =>
        compileInternalModuleLoweringIR(
            lowerModuleAssetToInternalModuleLoweringIR(asset, { loadMode: "trusted-analysis" }),
        ),
    );
}

function rewriteBridgeStringSurfaces(value: unknown, canonicalIdsByMethodName: Map<string, string[]>): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
        value.forEach(item => rewriteBridgeStringSurfaces(item, canonicalIdsByMethodName));
        return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.surface === "string") {
        const canonicalApiIds = canonicalIdsByMethodName.get(record.surface);
        if (!canonicalApiIds || canonicalApiIds.length !== 1) {
            throw new Error(`bridge surface ${record.surface} must resolve to exactly one canonicalApiId, got ${canonicalApiIds?.length || 0}`);
        }
        record.surface = invokeSurfaceRef(canonicalApiIds[0]);
    }
    for (const nested of Object.values(record)) {
        rewriteBridgeStringSurfaces(nested, canonicalIdsByMethodName);
    }
}

function invokeSurfaceRef(canonicalApiId: string): ModuleSemanticSurfaceRef {
    return {
        kind: "invoke",
        selector: {
            surfaceKind: "invoke",
            canonicalApiId,
        },
    };
}

function compileGuardMutationSurface(): ModuleSemanticSurfaceRef {
    const canonicalApiId = String(capabilityPayload(tsjsContainerModuleAsset).mutationCanonicalApiIds?.[0] || "");
    if (!canonicalApiId) throw new Error("tsjs container fixture must expose a mutation canonicalApiId");
    return invokeSurfaceRef(canonicalApiId);
}

function compileGuardAccessSurface(): ModuleSemanticSurfaceRef {
    const canonicalApiId = String(capabilityPayload(tsjsContainerModuleAsset).accessCanonicalApiIds?.[0] || "");
    if (!canonicalApiId) throw new Error("tsjs container fixture must expose an access canonicalApiId");
    return invokeSurfaceRef(canonicalApiId);
}

function canonicalApiIdsForSceneMethods(
    scene: Scene,
    asset: AssetDocumentBase,
    methodNames: string[],
    role: string,
): string[] {
    const wanted = new Set(methodNames);
    if (wanted.size === 0) return [];
    const out = new Set<string>();
    let index = 0;
    for (const method of scene.getMethods() as any[]) {
        const methodSig = method.getSignature?.();
        const subSig = methodSig?.getMethodSubSignature?.();
        const methodName = String(subSig?.getMethodName?.() || method.getName?.() || "").trim();
        if (!wanted.has(methodName)) continue;
        const classSig = methodSig?.getDeclaringClassSignature?.();
        const className = String(classSig?.getClassName?.() || "").trim();
        if (!className || className === "%dflt") continue;
        const surface = projectInvokeSurfaceFromMethod(asset.id, method, role, index++);
        if (!asset.surfaces.some(existing => existing.canonicalApiId === surface.canonicalApiId)) {
            asset.surfaces.push(surface);
        }
        if (surface.canonicalApiId) out.add(surface.canonicalApiId);
    }
    return [...out.values()].sort((left, right) => left.localeCompare(right));
}

function projectInvokeSurfaceFromMethod(
    assetId: string,
    method: any,
    role: string,
    index: number,
): AssetSurface {
    const methodSig = method.getSignature?.();
    const classSig = methodSig?.getDeclaringClassSignature?.();
    const subSig = methodSig?.getMethodSubSignature?.();
    const rawDeclaringFile = String(classSig?.getDeclaringFileSignature?.()?.toString?.() || "").trim();
    const logicalFile = logicalGeneratedInputFile(rawDeclaringFile);
    const className = String(classSig?.getClassName?.() || "").trim();
    const methodName = String(subSig?.getMethodName?.() || method.getName?.() || "").trim();
    const parameterTypes = (subSig?.getParameters?.() || []).map((param: any) => typeTextOf(param));
    const returnType = typeTextOf(subSig?.getReturnType?.() || method.getReturnType?.());
    const staticFlag = !!subSig?.isStatic?.();
    const result = fromProjectDeclaration({
        domain: "local",
        moduleSpecifier: logicalFile,
        logicalDeclarationFile: logicalFile,
        exportPath: [{ kind: "namespace", name: className }],
        declarationOwner: {
            kind: "class",
            path: [className],
            normalizedName: className,
            arkanalyzerName: className,
        },
        member: { kind: "method", name: methodName, static: staticFlag },
        invoke: { kind: "call" },
        signature: {
            parameters: parameterTypes.map((type, parameterIndex) => ({ index: parameterIndex, type: { text: type } })),
            returnType: { text: returnType },
        },
        arkanalyzer: {
            declaringFileName: rawDeclaringFile,
            declaringNamespacePath: [],
            declaringClassName: className,
            methodName,
            parameterTypes,
            returnType,
            staticFlag,
        },
        declarationLocations: [{ file: logicalFile, line: method.getLine?.() || undefined, column: method.getColumn?.() || undefined }],
    });
    if (result.status !== "accepted") {
        throw new Error(`event emitter identity rejected for ${className}.${methodName}: ${result.reason}`);
    }
    return {
        surfaceId: `surface.${assetId}.event.${role}.${sanitizeId(logicalFile)}.${sanitizeId(className)}.${sanitizeId(methodName)}.${index}`,
        canonicalApiId: result.descriptor.canonicalApiId,
        kind: "invoke",
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: rawDeclaringFile,
                    declaringNamespacePath: [],
                    declaringClassName: className,
                    methodName,
                    parameterTypes,
                    returnType,
                    staticFlag,
                },
            },
        },
        confidence: "certain",
        provenance: { source: "manual", location: { file: logicalFile, line: method.getLine?.() || undefined, column: method.getColumn?.() || undefined } },
    };
}

function logicalGeneratedInputFile(rawFile: string): string {
    const normalized = String(rawFile || "")
        .replace(/\\/g, "/")
        .replace(/^@/, "")
        .replace(/:\s*$/, "")
        .replace(/^\/+|\/+$/g, "");
    const marker = "/inputs/";
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex >= 0) {
        return normalized.slice(markerIndex + 1);
    }
    if (normalized.startsWith("inputs/")) return normalized;
    return normalized;
}

function typeTextOf(value: any): string {
    return String(value?.getType?.()?.toString?.() || value?.toString?.() || "unknown").trim() || "unknown";
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(item => String(item || "").trim()).filter(Boolean) : [];
}

function mergeCanonicalApiIds(left: string[], right: string[]): string[] {
    return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b));
}

function buildRuntimeFamilies(): RuntimeFamily[] {
    return [
        {
            id: "event_receiver_scope",
            title: "EventEmitter receiver/class isolation",
            semantic: "event_emitter",
            why: "Ensure identical on/emit names do not cross-connect across instances or classes.",
            spec: {
                id: "edge.event_receiver_scope",
                semantics: [
                    {
                        kind: "event_emitter",
                        onCanonicalApiIds: [],
                        emitCanonicalApiIds: [],
                    },
                ],
            },
            identityHints: {
                eventEmitter: {
                    on: ["on"],
                    emit: ["emit"],
                },
            },
            files: {
                "event_same_receiver_same_topic_T.ets": [
                    "class SignalBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                    "class OtherSignalBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function event_same_receiver_same_topic_T(): void {",
                    "  const bus = new SignalBus();",
                    "  bus.on(\"ready\", (payload: string) => { Sink(payload); });",
                    "  bus.emit(\"ready\", Source());",
                    "}",
                    "",
                ].join("\n"),
                "event_other_receiver_same_topic_F.ets": [
                    "class SignalBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function event_other_receiver_same_topic_F(): void {",
                    "  const left = new SignalBus();",
                    "  const right = new SignalBus();",
                    "  left.on(\"ready\", (payload: string) => { Sink(payload); });",
                    "  right.emit(\"ready\", Source());",
                    "}",
                    "",
                ].join("\n"),
                "event_other_class_same_topic_F.ets": [
                    "class SignalBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                    "class OtherSignalBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function event_other_class_same_topic_F(): void {",
                    "  const left = new SignalBus();",
                    "  const right = new OtherSignalBus();",
                    "  left.on(\"ready\", (payload: string) => { Sink(payload); });",
                    "  right.emit(\"ready\", Source());",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "event_same_receiver_same_topic_T",
                    file: "event_same_receiver_same_topic_T.ets",
                    entry: "event_same_receiver_same_topic_T",
                    expectedFlows: 1,
                    note: "same receiver, same topic should connect",
                },
                {
                    id: "event_other_receiver_same_topic_F",
                    file: "event_other_receiver_same_topic_F.ets",
                    entry: "event_other_receiver_same_topic_F",
                    expectedFlows: 0,
                    note: "same class, different receiver should stay isolated",
                },
                {
                    id: "event_other_class_same_topic_F",
                    file: "event_other_class_same_topic_F.ets",
                    entry: "event_other_class_same_topic_F",
                    expectedFlows: 0,
                    note: "different class, same method names should stay isolated",
                },
            ],
        },
        {
            id: "event_composite_channel",
            title: "EventEmitter composite channel isolation",
            semantic: "event_emitter",
            why: "Ensure topic + lane is treated as a composite channel rather than one flat key.",
            spec: {
                id: "edge.event_composite_channel",
                semantics: [
                    {
                        kind: "event_emitter",
                        onCanonicalApiIds: [],
                        emitCanonicalApiIds: [],
                        channelArgIndexes: [0, 1],
                        payloadArgIndex: 2,
                        callbackArgIndex: 2,
                        callbackParamIndex: 0,
                    },
                ],
            },
            identityHints: {
                eventEmitter: {
                    on: ["on"],
                    emit: ["publish"],
                },
            },
            files: {
                "lane_same_topic_same_lane_T.ets": [
                    "class LaneBus {",
                    "  on(topic: string, lane: string, callback: (payload: string) => void): void {}",
                    "  publish(topic: string, lane: string, payload: string): void {}",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function lane_same_topic_same_lane_T(): void {",
                    "  const bus = new LaneBus();",
                    "  bus.on(\"ready\", \"left\", (payload: string) => { Sink(payload); });",
                    "  bus.publish(\"ready\", \"left\", Source());",
                    "}",
                    "",
                ].join("\n"),
                "lane_same_topic_other_lane_F.ets": [
                    "class LaneBus {",
                    "  on(topic: string, lane: string, callback: (payload: string) => void): void {}",
                    "  publish(topic: string, lane: string, payload: string): void {}",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function lane_same_topic_other_lane_F(): void {",
                    "  const bus = new LaneBus();",
                    "  bus.on(\"ready\", \"left\", (payload: string) => { Sink(payload); });",
                    "  bus.publish(\"ready\", \"right\", Source());",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "lane_same_topic_same_lane_T",
                    file: "lane_same_topic_same_lane_T.ets",
                    entry: "lane_same_topic_same_lane_T",
                    expectedFlows: 1,
                    note: "same topic and same lane should connect",
                },
                {
                    id: "lane_same_topic_other_lane_F",
                    file: "lane_same_topic_other_lane_F.ets",
                    entry: "lane_same_topic_other_lane_F",
                    expectedFlows: 0,
                    note: "same topic but different lane should stay isolated",
                },
            ],
        },
        {
            id: "event_static_wrapper_enum_key",
            title: "Project EventHub static enum-key dispatch",
            semantic: "event_emitter",
            why: "Ensure explicit project event-emitter assets can model static on/sendEvent wrappers with enum keys and no payload without kernel hardcoding.",
            spec: {
                id: "edge.event_static_wrapper_enum_key",
                semantics: [
                    {
                        kind: "event_emitter",
                        onCanonicalApiIds: [],
                        emitCanonicalApiIds: [],
                        channelArgIndexes: [0],
                        payloadArgIndex: -1,
                        callbackArgIndex: 1,
                        callbackParamIndex: 0,
                    },
                ],
            },
            identityHints: {
                eventEmitter: {
                    on: ["on"],
                    emit: ["sendEvent"],
                },
            },
            files: {
                "project_eventhub_static_enum_same_key_T.ets": [
                    "enum EventKey {",
                    "  Login = 10019,",
                    "  Other = 10020,",
                    "}",
                    "",
                    "class ProjectEventHub {",
                    "  static on(key: EventKey, callback: () => void): void {}",
                    "  static sendEvent(key: EventKey): void {}",
                    "}",
                    "",
                    "class BackupComponent {",
                    "  password: string = \"safe\";",
                    "  connect(): void {",
                    "    ProjectEventHub.on(EventKey.Login, () => { Sink(this.password); });",
                    "    ProjectEventHub.sendEvent(EventKey.Login);",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function project_eventhub_static_enum_same_key_T(): void {",
                    "  const component = new BackupComponent();",
                    "  component.password = Source();",
                    "  component.connect();",
                    "}",
                    "",
                ].join("\n"),
                "project_eventhub_static_enum_safe_field_F.ets": [
                    "enum EventKey {",
                    "  Login = 10019,",
                    "}",
                    "",
                    "class ProjectEventHub {",
                    "  static on(key: EventKey, callback: () => void): void {}",
                    "  static sendEvent(key: EventKey): void {}",
                    "}",
                    "",
                    "class BackupComponent {",
                    "  password: string = \"safe\";",
                    "  connect(): void {",
                    "    ProjectEventHub.on(EventKey.Login, () => { Sink(this.password); });",
                    "    ProjectEventHub.sendEvent(EventKey.Login);",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function project_eventhub_static_enum_safe_field_F(): void {",
                    "  const component = new BackupComponent();",
                    "  component.connect();",
                    "}",
                    "",
                ].join("\n"),
                "project_eventhub_static_enum_sibling_field_F.ets": [
                    "enum EventKey {",
                    "  Login = 10019,",
                    "}",
                    "",
                    "class ProjectEventHub {",
                    "  static on(key: EventKey, callback: () => void): void {}",
                    "  static sendEvent(key: EventKey): void {}",
                    "}",
                    "",
                    "class BackupComponent {",
                    "  password: string = \"safe\";",
                    "  username: string = \"safe\";",
                    "  connect(): void {",
                    "    ProjectEventHub.on(EventKey.Login, () => { Sink(this.password); });",
                    "    ProjectEventHub.sendEvent(EventKey.Login);",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function project_eventhub_static_enum_sibling_field_F(): void {",
                    "  const component = new BackupComponent();",
                    "  component.username = Source();",
                    "  component.connect();",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "project_eventhub_static_enum_same_key_T",
                    file: "project_eventhub_static_enum_same_key_T.ets",
                    entry: "project_eventhub_static_enum_same_key_T",
                    expectedFlows: 1,
                    note: "same static wrapper owner and enum key should activate the callback",
                },
                {
                    id: "project_eventhub_static_enum_safe_field_F",
                    file: "project_eventhub_static_enum_safe_field_F.ets",
                    entry: "project_eventhub_static_enum_safe_field_F",
                    expectedFlows: 0,
                    note: "callback activation without a source should not create a flow",
                },
                {
                    id: "project_eventhub_static_enum_sibling_field_F",
                    file: "project_eventhub_static_enum_sibling_field_F.ets",
                    entry: "project_eventhub_static_enum_sibling_field_F",
                    expectedFlows: 0,
                    note: "tainted sibling receiver field should not satisfy password sink",
                },
            ],
        },
        {
            id: "event_static_wrapper_enum_payload",
            title: "Project EventHub static enum-key payload isolation",
            semantic: "event_emitter",
            why: "Ensure explicit project event-emitter assets preserve enum-key and owner isolation for payload-carrying static dispatch.",
            spec: {
                id: "edge.event_static_wrapper_enum_payload",
                semantics: [
                    {
                        kind: "event_emitter",
                        onCanonicalApiIds: [],
                        emitCanonicalApiIds: [],
                        channelArgIndexes: [0],
                        payloadArgIndex: 1,
                        callbackArgIndex: 1,
                        callbackParamIndex: 0,
                    },
                ],
            },
            identityHints: {
                eventEmitter: {
                    on: ["on"],
                    emit: ["sendEvent"],
                },
            },
            files: {
                "project_eventhub_static_payload_same_key_T.ets": [
                    "enum EventKey { Login = 10019, Other = 10020 }",
                    "class ProjectEventHub {",
                    "  static on(key: EventKey, callback: (payload: string) => void): void {}",
                    "  static sendEvent(key: EventKey, payload: string): void {}",
                    "}",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "export function project_eventhub_static_payload_same_key_T(): void {",
                    "  ProjectEventHub.on(EventKey.Login, (payload: string) => Sink(payload));",
                    "  ProjectEventHub.sendEvent(EventKey.Login, Source());",
                    "}",
                    "",
                ].join("\n"),
                "project_eventhub_static_payload_other_key_F.ets": [
                    "enum EventKey { Login = 10019, Other = 10020 }",
                    "class ProjectEventHub {",
                    "  static on(key: EventKey, callback: (payload: string) => void): void {}",
                    "  static sendEvent(key: EventKey, payload: string): void {}",
                    "}",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "export function project_eventhub_static_payload_other_key_F(): void {",
                    "  ProjectEventHub.on(EventKey.Login, (payload: string) => Sink(payload));",
                    "  ProjectEventHub.sendEvent(EventKey.Other, Source());",
                    "}",
                    "",
                ].join("\n"),
                "project_eventhub_static_payload_other_owner_F.ets": [
                    "enum EventKey { Login = 10019 }",
                    "class ProjectEventHub {",
                    "  static on(key: EventKey, callback: (payload: string) => void): void {}",
                    "}",
                    "class OtherEventHub {",
                    "  static sendEvent(key: EventKey, payload: string): void {}",
                    "}",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "export function project_eventhub_static_payload_other_owner_F(): void {",
                    "  ProjectEventHub.on(EventKey.Login, (payload: string) => Sink(payload));",
                    "  OtherEventHub.sendEvent(EventKey.Login, Source());",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "project_eventhub_static_payload_same_key_T",
                    file: "project_eventhub_static_payload_same_key_T.ets",
                    entry: "project_eventhub_static_payload_same_key_T",
                    expectedFlows: 1,
                    note: "same static wrapper owner and enum key should pass payload to callback",
                },
                {
                    id: "project_eventhub_static_payload_other_key_F",
                    file: "project_eventhub_static_payload_other_key_F.ets",
                    entry: "project_eventhub_static_payload_other_key_F",
                    expectedFlows: 0,
                    note: "different enum keys should not pass payload",
                },
                {
                    id: "project_eventhub_static_payload_other_owner_F",
                    file: "project_eventhub_static_payload_other_owner_F.ets",
                    entry: "project_eventhub_static_payload_other_owner_F",
                    expectedFlows: 0,
                    note: "same method names on different static owners should stay isolated",
                },
            ],
        },
        {
            id: "event_cross_file_receiver",
            title: "EventEmitter cross-file receiver isolation",
            semantic: "event_emitter",
            why: "Ensure same-receiver matching holds across files, and different instances stay isolated.",
            spec: {
                id: "edge.event_cross_file_receiver",
                semantics: [
                    {
                        kind: "event_emitter",
                        onCanonicalApiIds: [],
                        emitCanonicalApiIds: [],
                    },
                ],
            },
            identityHints: {
                eventEmitter: {
                    on: ["on"],
                    emit: ["emit"],
                },
            },
            files: {
                "bus.ts": [
                    "export class CrossBus {",
                    "  on(topic: string, callback: (payload: string) => void): void {}",
                    "  emit(topic: string, payload: string): void {}",
                    "}",
                    "",
                ].join("\n"),
                "helpers.ts": [
                    "export function Source(): string { return \"taint\"; }",
                    "export function Sink(v: string): void {}",
                    "",
                ].join("\n"),
                "register.ts": [
                    "import { CrossBus } from \"./bus\";",
                    "import { Sink } from \"./helpers\";",
                    "",
                    "export function register(bus: CrossBus): void {",
                    "  bus.on(\"ready\", (payload: string) => Sink(payload));",
                    "}",
                    "",
                ].join("\n"),
                "fire.ts": [
                    "import { CrossBus } from \"./bus\";",
                    "import { Source } from \"./helpers\";",
                    "",
                    "export function fire(bus: CrossBus): void {",
                    "  bus.emit(\"ready\", Source());",
                    "}",
                    "",
                ].join("\n"),
                "cross_file_same_receiver_T.ets": [
                    "import { CrossBus } from \"./bus\";",
                    "import { register } from \"./register\";",
                    "import { fire } from \"./fire\";",
                    "",
                    "export function cross_file_same_receiver_T(): void {",
                    "  const bus = new CrossBus();",
                    "  register(bus);",
                    "  fire(bus);",
                    "}",
                    "",
                ].join("\n"),
                "cross_file_other_receiver_F.ets": [
                    "import { CrossBus } from \"./bus\";",
                    "import { register } from \"./register\";",
                    "import { fire } from \"./fire\";",
                    "",
                    "export function cross_file_other_receiver_F(): void {",
                    "  const left = new CrossBus();",
                    "  const right = new CrossBus();",
                    "  register(left);",
                    "  fire(right);",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "cross_file_same_receiver_T",
                    file: "cross_file_same_receiver_T.ets",
                    entry: "cross_file_same_receiver_T",
                    expectedFlows: 1,
                    note: "same receiver across files should connect",
                },
                {
                    id: "cross_file_other_receiver_F",
                    file: "cross_file_other_receiver_F.ets",
                    entry: "cross_file_other_receiver_F",
                    expectedFlows: 0,
                    note: "different instances across files should stay isolated",
                },
            ],
        },
        {
            id: "keyed_storage_instance_scope",
            title: "KeyedStorage instance isolation",
            semantic: "keyed_storage",
            why: "Ensure the semantic does not collapse different instances onto one global key domain.",
            spec: {
                id: "edge.keyed_storage_instance_scope",
                semantics: [
                    {
                        kind: "keyed_storage",
                        writeApis: [],
                        readCanonicalApiIds: [],
                        propDecoratorCanonicalApiIds: [],
                        linkDecoratorCanonicalApiIds: [],
                    },
                ],
            },
            identityHints: {
                keyedStorage: {
                    writes: [{ methodName: "put", valueIndex: 1 }],
                    reads: ["take"],
                },
            },
            files: {
                "store_same_instance_same_key_T.ets": [
                    "class PocketStore {",
                    "  put(key: string, value: string): void {}",
                    "  take(key: string): string { return \"safe\"; }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function store_same_instance_same_key_T(): void {",
                    "  const store = new PocketStore();",
                    "  store.put(\"token\", Source());",
                    "  Sink(store.take(\"token\"));",
                    "}",
                    "",
                ].join("\n"),
                "store_same_instance_other_key_F.ets": [
                    "class PocketStore {",
                    "  put(key: string, value: string): void {}",
                    "  take(key: string): string { return \"safe\"; }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function store_same_instance_other_key_F(): void {",
                    "  const store = new PocketStore();",
                    "  store.put(\"token\", Source());",
                    "  Sink(store.take(\"other\"));",
                    "}",
                    "",
                ].join("\n"),
                "store_other_instance_same_key_F.ets": [
                    "class PocketStore {",
                    "  put(key: string, value: string): void {}",
                    "  take(key: string): string { return \"safe\"; }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function store_other_instance_same_key_F(): void {",
                    "  const left = new PocketStore();",
                    "  const right = new PocketStore();",
                    "  left.put(\"token\", Source());",
                    "  Sink(right.take(\"token\"));",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "store_same_instance_same_key_T",
                    file: "store_same_instance_same_key_T.ets",
                    entry: "store_same_instance_same_key_T",
                    expectedFlows: 1,
                    note: "same instance, same key should connect",
                },
                {
                    id: "store_same_instance_other_key_F",
                    file: "store_same_instance_other_key_F.ets",
                    entry: "store_same_instance_other_key_F",
                    expectedFlows: 0,
                    note: "same instance, different key should stay isolated",
                },
                {
                    id: "store_other_instance_same_key_F",
                    file: "store_other_instance_same_key_F.ets",
                    entry: "store_other_instance_same_key_F",
                    expectedFlows: 0,
                    note: "different instance, same key should stay isolated",
                },
            ],
        },
        {
            id: "route_bridge_route_scope",
            title: "RouteBridge route-key isolation",
            semantic: "route_bridge",
            why: "Ensure navigation callbacks only receive params for the matched route key.",
            spec: {
                id: "edge.route_bridge_route_scope",
                semantics: [
                    {
                        kind: "route_bridge",
                        pushApis: [],
                        getCanonicalApiIds: [],
                        navDestinationRegisterApis: [],
                        navDestinationTriggerApis: [],
                        payloadUnwrapPrefixes: ["param"],
                    },
                ],
            },
            identityHints: {
                routeBridge: {
                    pushes: [{
                        methodName: "pushPath",
                        routeField: "name",
                        payloadArgIndex: 0,
                        payloadField: "param",
                    }],
                    gets: ["getParams"],
                    navRegisters: ["register"],
                    navTriggers: ["trigger"],
                },
            },
            files: {
                "nav_same_route_T.ets": [
                    "class Payload020 {",
                    "  secret: string = \"safe\";",
                    "}",
                    "",
                    "class NavPathStack {",
                    "  private static store: Map<string, Payload020> = new Map<string, Payload020>();",
                    "  static pushPath(options: { name: string; param: Payload020 }): void {",
                    "    NavPathStack.store.set(options.name, options.param);",
                    "  }",
                    "  static getParams(name?: string): Payload020 {",
                    "    return name && NavPathStack.store.has(name) ? NavPathStack.store.get(name)! : new Payload020();",
                    "  }",
                    "}",
                    "",
                    "class NavDestination {",
                    "  private static builders: Map<string, (param: Payload020) => void> = new Map<string, (param: Payload020) => void>();",
                    "  static register(name: string, builder: (param: Payload020) => void): void {",
                    "    NavDestination.builders.set(name, builder);",
                    "  }",
                    "  static trigger(name: string): void {",
                    "    const builder = NavDestination.builders.get(name);",
                    "    if (builder) builder(NavPathStack.getParams(name));",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function nav_same_route_T(): void {",
                    "  NavDestination.register(\"Detail\", (param: Payload020) => { Sink(param.secret); });",
                    "  const payload = new Payload020();",
                    "  payload.secret = Source();",
                    "  NavPathStack.pushPath({ name: \"Detail\", param: payload });",
                    "  NavDestination.trigger(\"Detail\");",
                    "}",
                    "",
                ].join("\n"),
                "nav_other_route_F.ets": [
                    "class Payload020 {",
                    "  secret: string = \"safe\";",
                    "}",
                    "",
                    "class NavPathStack {",
                    "  private static store: Map<string, Payload020> = new Map<string, Payload020>();",
                    "  static pushPath(options: { name: string; param: Payload020 }): void {",
                    "    NavPathStack.store.set(options.name, options.param);",
                    "  }",
                    "  static getParams(name?: string): Payload020 {",
                    "    return name && NavPathStack.store.has(name) ? NavPathStack.store.get(name)! : new Payload020();",
                    "  }",
                    "}",
                    "",
                    "class NavDestination {",
                    "  private static builders: Map<string, (param: Payload020) => void> = new Map<string, (param: Payload020) => void>();",
                    "  static register(name: string, builder: (param: Payload020) => void): void {",
                    "    NavDestination.builders.set(name, builder);",
                    "  }",
                    "  static trigger(name: string): void {",
                    "    const builder = NavDestination.builders.get(name);",
                    "    if (builder) builder(NavPathStack.getParams(name));",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function nav_other_route_F(): void {",
                    "  NavDestination.register(\"Detail\", (param: Payload020) => { Sink(param.secret); });",
                    "  const payload = new Payload020();",
                    "  payload.secret = Source();",
                    "  NavPathStack.pushPath({ name: \"SafeDetail\", param: payload });",
                    "  NavDestination.trigger(\"Detail\");",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "nav_same_route_T",
                    file: "nav_same_route_T.ets",
                    entry: "nav_same_route_T",
                    expectedFlows: 1,
                    note: "register/trigger with the same route should connect",
                },
                {
                    id: "nav_other_route_F",
                    file: "nav_other_route_F.ets",
                    entry: "nav_other_route_F",
                    expectedFlows: 0,
                    note: "different route key should stay isolated",
                },
            ],
        },
        {
            id: "state_binding_key_scope",
            title: "StateBinding key and field-name isolation",
            semantic: "state_binding",
            why: "Ensure provide/consume pairs match by explicit key or by implicit field name only.",
            spec: {
                id: "edge.state_binding_key_scope",
                semantics: [
                    {
                        kind: "state_binding",
                        stateDecoratorCanonicalApiIds: [],
                        propDecoratorCanonicalApiIds: [],
                        linkDecoratorCanonicalApiIds: [],
                        provideDecoratorCanonicalApiIds: [],
                        consumeDecoratorCanonicalApiIds: [],
                        eventDecoratorCanonicalApiIds: [],
                    },
                ],
            },
            files: {
                "provide_consume_same_key_T.ets": [
                    "function Provide(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "function Consume(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "",
                    "class Consumer031 {",
                    "  @Consume(\"token\")",
                    "  token: string = \"\";",
                    "  render(): void { Sink(this.token); }",
                    "}",
                    "",
                    "class Provider031 {",
                    "  @Provide(\"token\")",
                    "  token: string = \"\";",
                    "  build(v: string): void {",
                    "    this.token = v;",
                    "    new Consumer031().render();",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function provide_consume_same_key_T(): void {",
                    "  new Provider031().build(Source());",
                    "}",
                    "",
                ].join("\n"),
                "provide_consume_other_key_F.ets": [
                    "function Provide(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "function Consume(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "",
                    "class Consumer032 {",
                    "  @Consume(\"token\")",
                    "  token: string = \"\";",
                    "  render(): void { Sink(this.token); }",
                    "}",
                    "",
                    "class Provider032 {",
                    "  @Provide(\"other\")",
                    "  token: string = \"\";",
                    "  build(v: string): void {",
                    "    this.token = v;",
                    "    new Consumer032().render();",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function provide_consume_other_key_F(): void {",
                    "  new Provider032().build(Source());",
                    "}",
                    "",
                ].join("\n"),
                "provide_consume_noarg_same_field_T.ets": [
                    "function Provide(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "function Consume(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "",
                    "class Consumer033 {",
                    "  @Consume()",
                    "  token: string = \"\";",
                    "  render(): void { Sink(this.token); }",
                    "}",
                    "",
                    "class Provider033 {",
                    "  @Provide()",
                    "  token: string = \"\";",
                    "  build(v: string): void {",
                    "    this.token = v;",
                    "    new Consumer033().render();",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function provide_consume_noarg_same_field_T(): void {",
                    "  new Provider033().build(Source());",
                    "}",
                    "",
                ].join("\n"),
                "provide_consume_noarg_other_field_F.ets": [
                    "function Provide(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "function Consume(_key?: string): any { return (_target: any, _field: string) => {}; }",
                    "",
                    "class Consumer034 {",
                    "  @Consume()",
                    "  token: string = \"\";",
                    "  render(): void { Sink(this.token); }",
                    "}",
                    "",
                    "class Provider034 {",
                    "  @Provide()",
                    "  other: string = \"\";",
                    "  build(v: string): void {",
                    "    this.other = v;",
                    "    new Consumer034().render();",
                    "  }",
                    "}",
                    "",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function provide_consume_noarg_other_field_F(): void {",
                    "  new Provider034().build(Source());",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "provide_consume_same_key_T",
                    file: "provide_consume_same_key_T.ets",
                    entry: "provide_consume_same_key_T",
                    expectedFlows: 1,
                    note: "explicit same key should connect",
                },
                {
                    id: "provide_consume_other_key_F",
                    file: "provide_consume_other_key_F.ets",
                    entry: "provide_consume_other_key_F",
                    expectedFlows: 0,
                    note: "explicit different key should stay isolated",
                },
                {
                    id: "provide_consume_noarg_same_field_T",
                    file: "provide_consume_noarg_same_field_T.ets",
                    entry: "provide_consume_noarg_same_field_T",
                    expectedFlows: 1,
                    note: "implicit same field name should connect",
                },
                {
                    id: "provide_consume_noarg_other_field_F",
                    file: "provide_consume_noarg_other_field_F.ets",
                    entry: "provide_consume_noarg_other_field_F",
                    expectedFlows: 0,
                    note: "implicit different field name should stay isolated",
                },
            ],
        },
        {
            id: "ability_handoff_guards",
            title: "AbilityHandoff target guards",
            semantic: "ability_handoff",
            why: "Ensure only ability-like lifecycle methods participate and self-targeting is excluded.",
            spec: {
                id: "edge.ability_handoff_guards",
                semantics: [
                    {
                        kind: "ability_handoff",
                        startCanonicalApiIds: [],
                        targetCanonicalApiIds: [],
                    },
                ],
            },
            projectRules: {
                sources: [
                    {
                        id: "source.fixture.ability_handoff.entry_page_target",
                        surface: {
                            kind: "invoke",
                            modulePath: "inputs/ability_target_T.ets",
                            ownerName: "EntryPage",
                            methodName: "build",
                            invokeKind: "instance",
                            argCount: 1,
                            parameterTypes: ["string"],
                            returnType: "void",
                        },
                        sourceKind: "entry_param",
                        target: "arg0",
                    },
                    {
                        id: "source.fixture.ability_handoff.entry_page_plain",
                        surface: {
                            kind: "invoke",
                            modulePath: "inputs/ability_plain_class_F.ets",
                            ownerName: "EntryPage",
                            methodName: "build",
                            invokeKind: "instance",
                            argCount: 1,
                            parameterTypes: ["string"],
                            returnType: "void",
                        },
                        sourceKind: "entry_param",
                        target: "arg0",
                    },
                    {
                        id: "source.fixture.ability_handoff.self_ability",
                        surface: {
                            kind: "invoke",
                            modulePath: "inputs/ability_same_class_self_F.ets",
                            ownerName: "SelfAbility",
                            methodName: "build",
                            invokeKind: "instance",
                            argCount: 1,
                            parameterTypes: ["string"],
                            returnType: "void",
                        },
                        sourceKind: "entry_param",
                        target: "arg0",
                    },
                ],
                sinks: [
                    {
                        id: "sink.fixture.ability_handoff",
                        surface: {
                            kind: "invoke",
                            modulePath: "inputs/taint_mock.ts",
                            ownerName: "taint",
                            methodName: "Sink",
                            invokeKind: "static",
                            argCount: 1,
                            parameterTypes: ["string"],
                            returnType: "void",
                        },
                        target: "arg0",
                    },
                ],
                sanitizers: [],
                transfers: [],
            },
            files: {
                "taint_mock.ts": [
                    "export class Want {",
                    "  token: any;",
                    "  constructor(token: any) {",
                    "    this.token = token;",
                    "  }",
                    "}",
                    "",
                    "export class AbilityContext {",
                    "  startAbility(want: any): void {",
                    "    void want;",
                    "  }",
                    "}",
                    "",
                    "export class UIAbility {",
                    "  context: AbilityContext = new AbilityContext();",
                    "}",
                    "",
                    "export namespace taint {",
                    "  export function Sink(v: string): void {",
                    "    void v;",
                    "  }",
                    "}",
                    "",
                ].join("\n"),
                "ability_target_T.ets": [
                    "import { UIAbility, Want, taint } from \"./taint_mock\";",
                    "",
                    "class TargetAbility extends UIAbility {",
                    "  onCreate(want: Want): void { taint.Sink(want.token); }",
                    "}",
                    "",
                    "class EntryPage {",
                    "  context: any;",
                    "  constructor(context: any) {",
                    "    this.context = context;",
                    "  }",
                    "  build(taint_src: string): void {",
                    "    const want = new Want(taint_src);",
                    "    this.context.startAbility(want);",
                    "  }",
                    "}",
                    "",
                    "export function ability_target_T(taint_src: string): void {",
                    "  const entryTarget = new TargetAbility();",
                    "  new EntryPage(entryTarget.context).build(taint_src);",
                    "  const renderTarget = new TargetAbility();",
                    "  renderTarget.onCreate(new Want(\"clean\"));",
                    "}",
                    "",
                ].join("\n"),
                "ability_plain_class_F.ets": [
                    "import { UIAbility, Want, taint } from \"./taint_mock\";",
                    "",
                    "class PlainController {",
                    "  onCreate(want: Want): void { taint.Sink(want.token); }",
                    "}",
                    "",
                    "class EntryPage {",
                    "  context: any;",
                    "  constructor(context: any) {",
                    "    this.context = context;",
                    "  }",
                    "  build(taint_src: string): void {",
                    "    const want = new Want(taint_src);",
                    "    this.context.startAbility(want);",
                    "  }",
                    "}",
                    "",
                    "export function ability_plain_class_F(taint_src: string): void {",
                    "  const ability = new UIAbility();",
                    "  new EntryPage(ability.context).build(taint_src);",
                    "  new PlainController().onCreate(new Want(\"clean\"));",
                    "}",
                    "",
                ].join("\n"),
                "ability_same_class_self_F.ets": [
                    "import { UIAbility, Want, taint } from \"./taint_mock\";",
                    "",
                    "class SelfAbility extends UIAbility {",
                    "  build(taint_src: string): void { this.context.startAbility(new Want(taint_src)); }",
                    "  onCreate(want: Want): void {",
                    "    taint.Sink(want.token);",
                    "  }",
                    "}",
                    "",
                    "export function ability_same_class_self_F(taint_src: string): void {",
                    "  const ability = new SelfAbility();",
                    "  ability.build(taint_src);",
                    "  ability.onCreate(new Want(\"clean\"));",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "ability_target_T",
                    file: "ability_target_T.ets",
                    entry: "ability_target_T",
                    expectedFlows: 1,
                    note: "ability-like onCreate should receive Want payloads",
                },
                {
                    id: "ability_plain_class_F",
                    file: "ability_plain_class_F.ets",
                    entry: "ability_plain_class_F",
                    expectedFlows: 0,
                    note: "plain classes named onCreate should be ignored",
                },
                {
                    id: "ability_same_class_self_F",
                    file: "ability_same_class_self_F.ets",
                    entry: "ability_same_class_self_F",
                    expectedFlows: 0,
                    note: "source class should not target its own lifecycle method",
                },
            ],
        },
        {
            id: "generic_same_address_bridge",
            title: "Generic bridge same_address guard",
            semantic: "bridge",
            why: "Ensure generic same_address matching still behaves precisely for keyed bridge semantics.",
            spec: surfaceForMethod => ({
                id: "edge.generic_same_address_bridge",
                semantics: [
                    {
                        kind: "bridge",
                        from: {
                            surface: surfaceForMethod("PutAddress"),
                            slot: "arg",
                            index: 1,
                        },
                        to: {
                            surface: surfaceForMethod("GetAddress"),
                            slot: "result",
                        },
                        constraints: [
                            {
                                kind: "same_address",
                                left: {
                                    kind: "endpoint",
                                    endpoint: {
                                        surface: surfaceForMethod("PutAddress"),
                                        slot: "arg",
                                        index: 0,
                                    },
                                },
                                right: {
                                    kind: "endpoint",
                                    endpoint: {
                                        surface: surfaceForMethod("GetAddress"),
                                        slot: "arg",
                                        index: 0,
                                    },
                                },
                            },
                        ],
                        emit: {
                            allowUnreachableTarget: true,
                        },
                    },
                ],
            }),
            identityHints: {
                bridge: {
                    invokes: ["PutAddress", "GetAddress"],
                },
            },
            files: {
                "same_address_same_key_T.ets": [
                    "function PutAddress(key: string, value: string): void {}",
                    "function GetAddress(key: string): string { return \"safe\"; }",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function same_address_same_key_T(): void {",
                    "  PutAddress(\"token\", Source());",
                    "  Sink(GetAddress(\"token\"));",
                    "}",
                    "",
                ].join("\n"),
                "same_address_other_key_F.ets": [
                    "function PutAddress(key: string, value: string): void {}",
                    "function GetAddress(key: string): string { return \"safe\"; }",
                    "function Source(): string { return \"taint\"; }",
                    "function Sink(v: string): void {}",
                    "",
                    "export function same_address_other_key_F(): void {",
                    "  PutAddress(\"token\", Source());",
                    "  Sink(GetAddress(\"other\"));",
                    "}",
                    "",
                ].join("\n"),
            },
            cases: [
                {
                    id: "same_address_same_key_T",
                    file: "same_address_same_key_T.ets",
                    entry: "same_address_same_key_T",
                    expectedFlows: 1,
                    note: "same address should connect",
                },
                {
                    id: "same_address_other_key_F",
                    file: "same_address_other_key_F.ets",
                    entry: "same_address_other_key_F",
                    expectedFlows: 0,
                    note: "different address should stay isolated",
                },
            ],
        },
    ];
}

function buildCompileFamilies(): CompileFamily[] {
    return [
        {
            id: "generic_constraint_guard",
            title: "Generic bridge constraint guard",
            semantic: "bridge",
            why: "Keep the canonical guard that forbids mixing same_receiver and same_address in one bridge.",
            cases: [
                {
                    id: "bridge_same_receiver_and_same_address_rejected",
                    spec: {
                        id: "edge.invalid.receiver_and_address",
                        semantics: [
                            {
                                kind: "bridge",
                                from: {
                                    surface: compileGuardMutationSurface(),
                                    slot: "arg",
                                    index: 1,
                                },
                                to: {
                                    surface: compileGuardAccessSurface(),
                                    slot: "result",
                                },
                                constraints: [
                                    { kind: "same_receiver" },
                                    {
                                        kind: "same_address",
                                        left: {
                                            kind: "endpoint",
                                            endpoint: {
                                                surface: compileGuardMutationSurface(),
                                                slot: "arg",
                                                index: 0,
                                            },
                                        },
                                        right: {
                                            kind: "endpoint",
                                            endpoint: {
                                                surface: compileGuardAccessSurface(),
                                                slot: "arg",
                                                index: 0,
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                    expectedSubstrings: [
                        "cannot combine same_receiver and same_address in one bridge",
                    ],
                    note: "mixed receiver/address bridge should be rejected explicitly",
                },
            ],
        },
    ];
}

async function runRuntimeFamily(root: string, family: RuntimeFamily): Promise<RuntimeResult> {
    const familyDir = path.join(root, family.id);
    const inputsDir = path.join(familyDir, "inputs");
    const projectRulePath = path.join(familyDir, "project.rules.json");
    const internalModuleLoweringIRPath = path.join(familyDir, "internal_module_lowering_ir.json");
    const moduleAssetsPath = path.join(familyDir, "module_assets.json");
    for (const [name, content] of Object.entries(family.files)) {
        writeText(path.join(inputsDir, name), content);
    }
    const scene = buildScene(inputsDir);
    const materialized = materializeRuntimeFamilyIdentity(scene, family);
    writeProjectRules(projectRulePath, materialized.asset);
    writeText(internalModuleLoweringIRPath, JSON.stringify(materialized.spec, null, 2));
    writeText(moduleAssetsPath, JSON.stringify(materialized.moduleAssets, null, 2));

    const compiled = compileRuntimeModules(materialized);
    const cases: RuntimeResult["cases"] = [];
    for (const item of family.cases) {
        const actual = await runCase(scene, item.file, item.entry, compiled, projectRulePath, materialized.moduleAssets);
        const passed = item.expectedFlows === 0
            ? actual.totalFlows === 0
            : actual.totalFlows >= item.expectedFlows;
        cases.push({
            ...item,
            actualFlows: actual.totalFlows,
            passed,
            totalEmissionCount: actual.totalEmissionCount,
            emissionReasons: actual.emissionReasons,
            moduleSemanticSiteCount: actual.moduleSemanticSiteCount,
            moduleResolvedCount: actual.moduleResolvedCount,
            moduleEndpointGapCount: actual.moduleEndpointGapCount,
        });
    }
    return {
        kind: "runtime",
        id: family.id,
        title: family.title,
        semantic: family.semantic,
        why: family.why,
        compiledModuleIds: compiled.map(module => module.id),
        cases,
    };
}

function runCompileFamily(family: CompileFamily): CompileResult {
    const cases: Array<CompileCase & { passed: boolean; message: string }> = [];
    for (const item of family.cases) {
        let passed = true;
        let message = "";
        try {
            compileInternalModuleLoweringIR(item.spec as InternalModuleLoweringIR);
            passed = false;
            message = "expected compileInternalModuleLoweringIR to fail";
        } catch (error) {
            message = String((error as any)?.message || error);
            for (const expected of item.expectedSubstrings) {
                if (!message.includes(expected)) {
                    passed = false;
                    break;
                }
            }
        }
        cases.push({
            ...item,
            passed,
            message,
        });
    }
    return {
        kind: "compile",
        id: family.id,
        title: family.title,
        semantic: family.semantic,
        why: family.why,
        cases,
    };
}

function renderReport(results: Array<RuntimeResult | CompileResult>): string {
    const lines: string[] = [];
    lines.push("# Module Semantic Edge Suite");
    lines.push("");
    lines.push("Goal: catch structural precision leaks instead of only re-running ordinary happy-path cases.");
    lines.push("");
    lines.push("Excluded: ability_handoff_guards (OOM in standalone run; keep as dedicated heavy fixture).");
    lines.push("");
    for (const family of results) {
        lines.push(`## ${family.title}`);
        lines.push("");
        lines.push(`- family id: \`${family.id}\``);
        lines.push(`- semantic: \`${family.semantic}\``);
        lines.push(`- why: ${family.why}`);
        if (family.kind === "runtime") {
            lines.push(`- compiled modules: \`${family.compiledModuleIds.join(", ")}\``);
            lines.push("");
            lines.push("| case | expected | actual | result | note |");
            lines.push("| --- | --- | --- | --- | --- |");
            for (const item of family.cases) {
                lines.push(`| \`${item.id}\` | \`${item.expectedFlows}\` | \`${item.actualFlows}\` | \`${item.passed ? "PASS" : "FAIL"}\` | ${item.note} |`);
            }
        } else {
            lines.push("");
            lines.push("| case | result | note |");
            lines.push("| --- | --- | --- |");
            for (const item of family.cases) {
                lines.push(`| \`${item.id}\` | \`${item.passed ? "PASS" : "FAIL"}\` | ${item.note} |`);
            }
        }
        lines.push("");
    }
    return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("runtime", "module_semantic_edge_suite");
    const runtimeFamilies = buildRuntimeFamilies();
    const compileFamilies = buildCompileFamilies();
    const requestedFamilyId = process.argv[2];
    if (requestedFamilyId) {
        const runtimeFamily = runtimeFamilies.find(family => family.id === requestedFamilyId);
        if (runtimeFamily) {
            const result = await runRuntimeFamily(root, runtimeFamily);
            process.stdout.write(JSON.stringify(result));
            if (result.cases.some(item => !item.passed)) {
                process.exitCode = 1;
            }
            return;
        }
        const compileFamily = compileFamilies.find(family => family.id === requestedFamilyId);
        if (compileFamily) {
            const result = runCompileFamily(compileFamily);
            process.stdout.write(JSON.stringify(result));
            if (result.cases.some(item => !item.passed)) {
                process.exitCode = 1;
            }
            return;
        }
        throw new Error(`unknown module semantic edge family: ${requestedFamilyId}`);
    }

    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });

    const results: Array<RuntimeResult | CompileResult> = [];
    const stableRuntimeFamilies = runtimeFamilies.filter(family => family.id !== "ability_handoff_guards");
    const familyIds = [
        ...stableRuntimeFamilies.map(family => family.id),
        ...compileFamilies.map(family => family.id),
    ];
    for (const familyId of familyIds) {
        const stdout = execFileSync(process.execPath, [__filename, familyId], {
            cwd: process.cwd(),
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
        });
        results.push(JSON.parse(stdout) as RuntimeResult | CompileResult);
    }

    writeText(path.join(root, "results.json"), JSON.stringify(results, null, 2));
    writeText(path.join(root, "REPORT.md"), renderReport(results));

    const failed = results.some(family => family.cases.some(item => !item.passed));
    if (failed) {
        throw new Error("module semantic edge suite has failing cases");
    }

    console.log("PASS test_module_semantic_edge_suite");
    for (const family of results) {
        const passCount = family.cases.filter(item => item.passed).length;
        console.log(`${family.id}_pass=${passCount}/${family.cases.length}`);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
