import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import type { AssetDocumentBase, AssetEndpoint, AssetSurface } from "../../core/assets/schema";
import { fromProjectDeclaration } from "../../core/api/identity";
import { lowerModuleAssetToInternalModuleLoweringIR } from "../../core/kernel/contracts/ModuleAssetLowering";
import type { TaintModule } from "../../core/kernel/contracts/ModuleContract";
import { compileInternalModuleLoweringIR } from "../../core/orchestration/modules/InternalModuleLoweringIRCompiler";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { makeRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import { findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import { resolveTestRunDir } from "../helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function writeJson(filePath: string, value: unknown): void {
    writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function buildScene(projectDir: string): Scene {
    const config = new SceneConfig();
    config.buildFromProjectDir(projectDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    return scene;
}

interface ProjectSurface {
    surface: AssetSurface;
    logicalFile: string;
    className: string;
    methodName: string;
}

function collectProjectSurfaces(scene: Scene, assetId: string): ProjectSurface[] {
    const out: ProjectSurface[] = [];
    let index = 0;
    for (const method of scene.getMethods() as any[]) {
        const methodSig = method.getSignature?.();
        const classSig = methodSig?.getDeclaringClassSignature?.();
        const subSig = methodSig?.getMethodSubSignature?.();
        const className = String(classSig?.getClassName?.() || "").trim();
        const methodName = String(subSig?.getMethodName?.() || method.getName?.() || "").trim();
        if (!className || className === "%dflt" || !methodName) continue;
        if (methodName === "%instInit" || methodName === "constructor") continue;
        const surface = projectInvokeSurfaceFromMethod(assetId, method, index++);
        out.push({
            surface,
            logicalFile: String(surface.provenance?.location?.file || ""),
            className,
            methodName,
        });
    }
    return out;
}

function idsFor(
    surfaces: readonly ProjectSurface[],
    className: string,
    methodName: string,
): string[] {
    return surfaces
        .filter(item => item.className === className && item.methodName === methodName)
        .map(item => String(item.surface.canonicalApiId || ""))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
}

function surfacesFor(
    surfaces: readonly ProjectSurface[],
    pairs: Array<{ className: string; methodName: string }>,
): AssetSurface[] {
    const wanted = new Set(pairs.map(item => `${item.className}.${item.methodName}`));
    return surfaces
        .filter(item => wanted.has(`${item.className}.${item.methodName}`))
        .map(item => item.surface);
}

function projectInvokeSurfaceFromMethod(assetId: string, method: any, index: number): AssetSurface {
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
        throw new Error(`fixture canonical identity rejected for ${className}.${methodName}: ${result.reason}`);
    }
    return {
        surfaceId: `surface.${assetId}.${sanitizeId(logicalFile)}.${className}.${methodName}.${index}`,
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

function projectDecoratorSurface(assetId: string, logicalFile: string, decoratorName: string): AssetSurface {
    const result = fromProjectDeclaration({
        domain: "local",
        moduleSpecifier: logicalFile,
        logicalDeclarationFile: logicalFile,
        exportPath: [{ kind: "named", name: decoratorName }],
        declarationOwner: { kind: "file", path: ["file"], normalizedName: "file" },
        member: { kind: "decorator", name: decoratorName },
        invoke: { kind: "decorator" },
        signature: {
            parameters: [{ index: 0, type: { text: "string" } }],
            returnType: { text: "PropertyDecorator" },
        },
        declarationLocations: [{ file: logicalFile }],
    });
    if (result.status !== "accepted") {
        throw new Error(`fixture decorator canonical identity rejected for ${decoratorName}: ${result.reason}`);
    }
    return {
        surfaceId: `surface.${assetId}.decorator.${decoratorName}`,
        canonicalApiId: result.descriptor.canonicalApiId,
        kind: "decorator",
        confidence: "certain",
        provenance: { source: "manual", location: { file: logicalFile } },
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
    if (markerIndex >= 0) return normalized.slice(markerIndex + 1);
    if (normalized.startsWith("inputs/")) return normalized;
    return normalized;
}

function typeTextOf(value: any): string {
    return String(value?.getType?.()?.toString?.() || value?.toString?.() || "unknown").trim() || "unknown";
}

function sanitizeId(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "fixture";
}

function argEndpoint(index: number): AssetEndpoint {
    return { base: { kind: "arg", index } };
}

function restEndpoint(startIndex: number): AssetEndpoint {
    return { base: { kind: "rest", startIndex } };
}

function buildRuleAsset(fileName: string): AssetDocumentBase {
    return makeRuleAssetFixture({
        id: "asset.rule.fixture.storage_state_worker_scheduler",
        sources: [{
            id: "source.fixture.storage_state_worker_scheduler.source_return",
            sourceKind: "call_return",
            surface: {
                kind: "invoke",
                modulePath: `inputs/${fileName}`,
                ownerName: "file",
                ownerKind: "namespace",
                methodName: "Source",
                invokeKind: "free-function",
                argCount: 0,
                parameterTypes: [],
                returnType: "string",
            },
            target: "result",
        }],
        sinks: [{
            id: "sink.fixture.storage_state_worker_scheduler.sink_arg0",
            surface: {
                kind: "invoke",
                modulePath: `inputs/${fileName}`,
                ownerName: "file",
                ownerKind: "namespace",
                methodName: "Sink",
                invokeKind: "free-function",
                argCount: 1,
                parameterTypes: ["string"],
                returnType: "void",
            },
            target: "arg0",
        }],
    });
}

function buildKeyedStorageAsset(
    surfaces: readonly ProjectSurface[],
    unresolvedEndpoint = false,
): AssetDocumentBase {
    const assetId = unresolvedEndpoint
        ? "asset.module.fixture.storage_state_worker_scheduler.keyed_storage.unresolved"
        : "asset.module.fixture.storage_state_worker_scheduler.keyed_storage";
    const templateId = `${assetId}.template.storage`;
    const storageSurfaces = surfacesFor(surfaces, [
        { className: "FixtureStorage", methodName: "set" },
        { className: "FixtureStorage", methodName: "setAndLink" },
        { className: "FixtureStorage", methodName: "get" },
        { className: "FixtureStorage", methodName: "delete" },
    ]);
    return {
        id: assetId,
        plane: "module",
        status: "official",
        surfaces: storageSurfaces,
        bindings: storageSurfaces.map((surface, index) => ({
            bindingId: `${assetId}.binding.${index}`,
            surfaceId: surface.surfaceId,
            canonicalApiId: surface.canonicalApiId,
            assetId,
            plane: "module",
            role: "handoff",
            ...(unresolvedEndpoint ? { endpoint: argEndpoint(99) } : {}),
            effectTemplateRefs: [templateId],
            semanticsFamily: "fixture.storage-state-worker.keyed-storage",
            metadata: { description: "Keyed storage accepted semantic site scheduler fixture." },
            completeness: "complete",
            confidence: "certain",
        })),
        effectTemplates: [
            {
                id: templateId,
                kind: "core.capability",
                capability: "module.keyed-storage",
                payload: {
                    writeApis: [{
                        canonicalApiIds: idsFor(surfaces, "FixtureStorage", "set"),
                        valueIndex: 1,
                    }],
                    writeResultApis: [{
                        canonicalApiIds: idsFor(surfaces, "FixtureStorage", "setAndLink"),
                        valueIndex: 1,
                        updateStrength: "weak",
                    }],
                    readCanonicalApiIds: idsFor(surfaces, "FixtureStorage", "get"),
                    killCanonicalApiIds: idsFor(surfaces, "FixtureStorage", "delete"),
                    propDecoratorCanonicalApiIds: [],
                    linkDecoratorCanonicalApiIds: [],
                },
                confidence: "certain",
            },
        ],
        provenance: { source: "manual" },
    };
}

function buildStateAsset(logicalFile: string): AssetDocumentBase {
    const assetId = "asset.module.fixture.storage_state_worker_scheduler.state";
    const templateId = `${assetId}.template.state`;
    const state = projectDecoratorSurface(assetId, logicalFile, "FixtureState");
    const prop = projectDecoratorSurface(assetId, logicalFile, "FixtureProp");
    const link = projectDecoratorSurface(assetId, logicalFile, "FixtureLink");
    const provide = projectDecoratorSurface(assetId, logicalFile, "FixtureProvide");
    const consume = projectDecoratorSurface(assetId, logicalFile, "FixtureConsume");
    const decoratorSurfaces = [state, prop, link, provide, consume];
    return {
        id: assetId,
        plane: "module",
        status: "official",
        surfaces: decoratorSurfaces,
        bindings: decoratorSurfaces.map((surface, index) => ({
            bindingId: `${assetId}.binding.${index}`,
            surfaceId: surface.surfaceId,
            canonicalApiId: surface.canonicalApiId,
            assetId,
            plane: "module",
            role: "handoff",
            effectTemplateRefs: [templateId],
            semanticsFamily: "fixture.storage-state-worker.state",
            metadata: { description: "State binding accepted decorator site scheduler fixture." },
            completeness: "complete",
            confidence: "certain",
        })),
        effectTemplates: [
            {
                id: templateId,
                kind: "core.capability",
                capability: "module.state-binding",
                payload: {
                    stateDecoratorCanonicalApiIds: [state.canonicalApiId],
                    propDecoratorCanonicalApiIds: [prop.canonicalApiId],
                    linkDecoratorCanonicalApiIds: [link.canonicalApiId],
                    provideDecoratorCanonicalApiIds: [provide.canonicalApiId],
                    consumeDecoratorCanonicalApiIds: [consume.canonicalApiId],
                },
                confidence: "certain",
            },
        ],
        provenance: { source: "manual" },
    };
}

function buildTaskpoolAsset(
    surfaces: readonly ProjectSurface[],
    unresolvedEndpoint = false,
): AssetDocumentBase {
    const assetId = unresolvedEndpoint
        ? "asset.module.fixture.storage_state_worker_scheduler.taskpool.unresolved"
        : "asset.module.fixture.storage_state_worker_scheduler.taskpool";
    const templateId = `${assetId}.template.bridge`;
    const taskpoolSurface = surfacesFor(surfaces, [{ className: "FixtureTaskPool", methodName: "execute" }]);
    assert(taskpoolSurface.length === 1, `taskpool fixture must have exactly one execute surface, got ${taskpoolSurface.length}`);
    const canonicalApiId = String(taskpoolSurface[0].canonicalApiId || "");
    return {
        id: assetId,
        plane: "module",
        status: "official",
        surfaces: taskpoolSurface,
        bindings: taskpoolSurface.map((surface, index) => ({
            bindingId: `${assetId}.binding.${index}`,
            surfaceId: surface.surfaceId,
            canonicalApiId: surface.canonicalApiId,
            assetId,
            plane: "module",
            role: "handoff",
            endpoint: unresolvedEndpoint ? restEndpoint(99) : restEndpoint(1),
            effectTemplateRefs: [templateId],
            semanticsFamily: "fixture.storage-state-worker.taskpool",
            metadata: { description: "TaskPool accepted semantic site scheduler fixture." },
            completeness: "complete",
            confidence: "certain",
        })),
        effectTemplates: [
            {
                id: templateId,
                kind: "core.capability",
                capability: "module.bridge",
                payload: {
                    bridge: {
                        from: {
                            surface: { canonicalApiId },
                            slot: "arg",
                            index: 1,
                            rest: true,
                        },
                        to: {
                            surface: { canonicalApiId },
                            slot: "callback_param",
                            callbackArgIndex: 0,
                            paramIndex: 0,
                            rest: true,
                        },
                        emit: {
                            reason: "Fixture-TaskPool",
                            allowUnreachableTarget: true,
                        },
                        dispatch: {
                            reason: "Fixture-TaskPool",
                            preset: "callback_sync",
                        },
                    },
                },
                confidence: "certain",
            },
        ],
        provenance: { source: "manual" },
    };
}

function compileModules(assets: AssetDocumentBase[]): TaintModule[] {
    return assets.flatMap(asset =>
        compileInternalModuleLoweringIR(
            lowerModuleAssetToInternalModuleLoweringIR(asset, { loadMode: "trusted-analysis" }),
        ),
    );
}

async function runCase(input: {
    scene: Scene;
    loadedRules: ReturnType<typeof loadRuleSet>;
    moduleAssets: AssetDocumentBase[];
    modules: TaintModule[];
    relativeFile: string;
    entry: string;
}): Promise<{
    flowCount: number;
    totalEmissionCount: number;
    moduleSemanticSiteCount: number;
    moduleResolvedCount: number;
    moduleEndpointGapCount: number;
    emissionReasons: string[];
    semanticSiteSamples: Array<{
        canonicalApiId: string;
        status: string;
        endpointPath?: string;
        endpointBaseKind?: string;
        reason?: string;
        nodeIds?: number[];
        carrierNodeIds?: number[];
    }>;
}> {
    const engine = new TaintPropagationEngine(input.scene, 1, {
        includeBuiltinModules: false,
        modules: input.modules,
        apiAssets: [...input.loadedRules.assets, ...input.moduleAssets],
    });
    engine.verbose = false;
    const entryRef = resolveCaseMethod(input.scene, input.relativeFile, input.entry);
    const entryMethod = findCaseMethod(input.scene, entryRef);
    assert(!!entryMethod, `missing entry method: ${input.entry}`);
    await engine.buildPAG({
        syntheticEntryMethods: [entryMethod!],
        entryModel: "explicit",
    });
    try {
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
    } catch {
        engine.setActiveReachableMethodSignatures(undefined);
    }
    engine.propagateWithSourceRules(input.loadedRules.ruleSet.sources || []);
    const flows = engine.detectSinksByRules(input.loadedRules.ruleSet.sinks || []);
    const moduleStats = Object.values(engine.getModuleAuditSnapshot().moduleStats) as any[];
    const semanticSites = engine.getSemanticEffectLedger()
        .filter((record: any) => record.recordKind === "semantic_effect_site" && record.capability === "module");
    return {
        flowCount: flows.length,
        totalEmissionCount: moduleStats.reduce((sum, item) => sum + Number(item.totalEmissionCount || 0), 0),
        moduleSemanticSiteCount: semanticSites.length,
        moduleResolvedCount: semanticSites.filter((record: any) => record.status === "resolved").length,
        moduleEndpointGapCount: semanticSites.filter((record: any) => record.status === "endpoint_gap").length,
        emissionReasons: moduleStats.flatMap(item =>
            (item.emissionSamples || []).map((sample: any) => String(sample.reason || "")),
        ).filter(Boolean).sort(),
        semanticSiteSamples: semanticSites.slice(0, 12).map((record: any) => ({
            canonicalApiId: String(record.canonicalApiId || ""),
            status: String(record.status || ""),
            endpointPath: record.endpointPath ? String(record.endpointPath) : undefined,
            endpointBaseKind: record.endpointBaseKind ? String(record.endpointBaseKind) : undefined,
            reason: record.reason ? String(record.reason) : undefined,
            nodeIds: Array.isArray(record.nodeIds) ? record.nodeIds : undefined,
            carrierNodeIds: Array.isArray(record.carrierNodeIds) ? record.carrierNodeIds : undefined,
        })),
    };
}

const FIXTURE_FILE = "storage_state_worker_scheduler.ets";

function fixtureSource(): string {
    return [
        "function Source(): string { return \"taint\"; }",
        "function Sink(v: string): void {}",
        "",
        "function FixtureStorageProp(_key: string): any { return (_target: any, _field: string) => {}; }",
        "function FixtureStorageLink(_key: string): any { return (_target: any, _field: string) => {}; }",
        "function FixtureState(): any { return (_target: any, _field: string) => {}; }",
        "function FixtureProp(): any { return (_target: any, _field: string) => {}; }",
        "function FixtureLink(): any { return (_target: any, _field: string) => {}; }",
        "function FixtureProvide(_key?: string): any { return (_target: any, _field: string) => {}; }",
        "function FixtureConsume(_key?: string): any { return (_target: any, _field: string) => {}; }",
        "",
        "class FixtureStorage {",
        "  static set(key: string, value: string): void {}",
        "  static setAndLink(key: string, value: string): string { return \"safe\"; }",
        "  static get(key: string): string { return \"safe\"; }",
        "  static delete(key: string): void {}",
        "}",
        "",
        "class FixtureTaskPool {",
        "  static execute(callback: (first: string, second: string) => void, first: string, second: string): void {}",
        "}",
        "",
        "class StateConsumer {",
        "  @FixtureConsume(\"token\")",
        "  token: string = \"safe\";",
        "  render(): void { Sink(this.token); }",
        "}",
        "",
        "class StateConsumerOther {",
        "  @FixtureConsume(\"token\")",
        "  token: string = \"safe\";",
        "  render(): void { Sink(this.token); }",
        "}",
        "",
        "class StateProvider {",
        "  @FixtureProvide(\"token\")",
        "  token: string = \"safe\";",
        "  build(value: string): void {",
        "    this.token = value;",
        "    new StateConsumer().render();",
        "  }",
        "}",
        "",
        "class StateProviderOther {",
        "  @FixtureProvide(\"other\")",
        "  token: string = \"safe\";",
        "  build(value: string): void {",
        "    this.token = value;",
        "    new StateConsumerOther().render();",
        "  }",
        "}",
        "",
        "export function storage_same_key_T(): void {",
        "  FixtureStorage.set(\"token\", Source());",
        "  Sink(FixtureStorage.get(\"token\"));",
        "}",
        "",
        "export function storage_set_and_link_default_T(): void {",
        "  const wrapped = FixtureStorage.setAndLink(\"token\", Source());",
        "  Sink(wrapped);",
        "}",
        "",
        "export function storage_set_and_link_existing_T(): void {",
        "  FixtureStorage.set(\"token\", Source());",
        "  const wrapped = FixtureStorage.setAndLink(\"token\", \"clean\");",
        "  Sink(wrapped);",
        "}",
        "",
        "export function storage_set_and_link_clean_F(): void {",
        "  const wrapped = FixtureStorage.setAndLink(\"token\", \"clean\");",
        "  Sink(wrapped);",
        "}",
        "",
        "export function storage_other_key_F(): void {",
        "  FixtureStorage.set(\"token\", Source());",
        "  Sink(FixtureStorage.get(\"other\"));",
        "}",
        "",
        "export function storage_delete_F(): void {",
        "  FixtureStorage.set(\"token\", Source());",
        "  FixtureStorage.delete(\"token\");",
        "  Sink(FixtureStorage.get(\"token\"));",
        "}",
        "",
        "export function state_same_key_T(): void {",
        "  new StateProvider().build(Source());",
        "}",
        "",
        "export function state_other_key_F(): void {",
        "  new StateProviderOther().build(Source());",
        "}",
        "",
        "export function taskpool_execute_T(): void {",
        "  FixtureTaskPool.execute((first: string, second: string) => Sink(second), \"clean\", Source());",
        "}",
        "",
        "export function taskpool_clean_F(): void {",
        "  FixtureTaskPool.execute((first: string, second: string) => Sink(second), \"clean\", \"clean\");",
        "}",
        "",
    ].join("\n");
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("runtime", "module_storage_state_worker_scheduler");
    const inputsDir = path.join(root, "inputs");
    const fixturePath = path.join(inputsDir, FIXTURE_FILE);
    const projectRulePath = path.join(root, "project.rules.json");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(inputsDir, { recursive: true });
    writeText(fixturePath, fixtureSource());
    const ruleAsset = buildRuleAsset(FIXTURE_FILE);
    writeJson(projectRulePath, ruleAsset);

    const scene = buildScene(inputsDir);
    const projectSurfaces = collectProjectSurfaces(scene, "asset.module.fixture.storage_state_worker_scheduler");
    const storageAsset = buildKeyedStorageAsset(projectSurfaces);
    const storageUnresolvedAsset = buildKeyedStorageAsset(projectSurfaces, true);
    const stateAsset = buildStateAsset(`inputs/${FIXTURE_FILE}`);
    const taskpoolAsset = buildTaskpoolAsset(projectSurfaces);
    const taskpoolUnresolvedAsset = buildTaskpoolAsset(projectSurfaces, true);
    const allAssets = [storageAsset, stateAsset, taskpoolAsset];
    const unresolvedAssets = [storageUnresolvedAsset, stateAsset, taskpoolUnresolvedAsset];
    writeJson(path.join(root, "module_assets.json"), allAssets);
    writeJson(path.join(root, "module_assets_unresolved.json"), unresolvedAssets);

    const loadedRules = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        projectRulePath,
        allowMissingProject: false,
        autoDiscoverRuleSources: false,
    });
    const modules = compileModules(allAssets);
    const unresolvedModules = compileModules(unresolvedAssets);
    const noModules: TaintModule[] = [];

    const cases: Record<string, Awaited<ReturnType<typeof runCase>>> = {};
    const run = async (
        name: string,
        moduleAssets: AssetDocumentBase[],
        caseModules: TaintModule[],
    ) => {
        process.stdout.write(`[module-storage-state-worker] start ${name}\n`);
        cases[name] = await runCase({
            scene,
            loadedRules,
            moduleAssets,
            modules: caseModules,
            relativeFile: FIXTURE_FILE,
            entry: name,
        });
        writeJson(path.join(root, "results.json"), cases);
        process.stdout.write(`[module-storage-state-worker] done ${name} flows=${cases[name].flowCount} emissions=${cases[name].totalEmissionCount}\n`);
    };

    await run("storage_same_key_T", allAssets, modules);
    await run("storage_set_and_link_default_T", allAssets, modules);
    await run("storage_set_and_link_existing_T", allAssets, modules);
    await run("storage_set_and_link_clean_F", allAssets, modules);
    await run("storage_other_key_F", allAssets, modules);
    await run("storage_delete_F", allAssets, modules);
    await run("state_same_key_T", allAssets, modules);
    await run("state_other_key_F", allAssets, modules);
    await run("taskpool_execute_T", allAssets, modules);
    await run("taskpool_clean_F", allAssets, modules);
    await run("storage_same_key_T_no_module", [], noModules);
    await run("storage_set_and_link_default_T_no_module", [], noModules);
    await run("state_same_key_T_no_module", [], noModules);
    process.stdout.write("[module-storage-state-worker] start storage_same_key_T_unresolved\n");
    cases.storage_same_key_T_unresolved = await runCase({
        scene,
        loadedRules,
        moduleAssets: [storageUnresolvedAsset],
        modules: compileModules([storageUnresolvedAsset]),
        relativeFile: FIXTURE_FILE,
        entry: "storage_same_key_T",
    });
    writeJson(path.join(root, "results.json"), cases);
    process.stdout.write(`[module-storage-state-worker] done storage_same_key_T_unresolved flows=${cases.storage_same_key_T_unresolved.flowCount} emissions=${cases.storage_same_key_T_unresolved.totalEmissionCount}\n`);
    process.stdout.write("[module-storage-state-worker] start taskpool_execute_T_unresolved\n");
    cases.taskpool_execute_T_unresolved = await runCase({
        scene,
        loadedRules,
        moduleAssets: [taskpoolUnresolvedAsset],
        modules: compileModules([taskpoolUnresolvedAsset]),
        relativeFile: FIXTURE_FILE,
        entry: "taskpool_execute_T",
    });
    writeJson(path.join(root, "results.json"), cases);
    process.stdout.write(`[module-storage-state-worker] done taskpool_execute_T_unresolved flows=${cases.taskpool_execute_T_unresolved.flowCount} emissions=${cases.taskpool_execute_T_unresolved.totalEmissionCount}\n`);

    assert(cases.storage_same_key_T.flowCount > 0, "storage same key should produce a flow");
    assert(cases.storage_same_key_T.totalEmissionCount > 0, "storage same key should emit module facts");
    assert(cases.storage_set_and_link_default_T.flowCount > 0, "storage setAndLink default value should flow through returned wrapper");
    assert(cases.storage_set_and_link_existing_T.flowCount > 0, "storage setAndLink clean default must not kill an existing tainted key");
    assert(cases.storage_set_and_link_clean_F.flowCount === 0, "storage setAndLink clean default should not create taint");
    assert(cases.storage_other_key_F.flowCount === 0, "storage other key should not produce a flow");
    assert(cases.storage_delete_F.flowCount === 0, "storage delete should kill the key before read");
    assert(cases.state_same_key_T.flowCount > 0, "state provide/consume same key should produce a flow");
    assert(cases.state_same_key_T.totalEmissionCount > 0, "state provide/consume should emit module facts");
    assert(cases.state_other_key_F.flowCount === 0, "state provide/consume other key should not produce a flow");
    assert(cases.state_same_key_T_no_module.flowCount === 0, "state provide/consume should require the state module");
    assert(cases.taskpool_execute_T.flowCount > 0, "taskpool execute should bridge payload into callback");
    assert(cases.taskpool_execute_T.totalEmissionCount > 0, "taskpool execute should emit module facts");
    assert(cases.taskpool_clean_F.flowCount === 0, "taskpool clean payload should not produce a flow");
    assert(cases.storage_same_key_T_no_module.flowCount === 0, "without module assets storage should not produce a flow");
    assert(cases.storage_same_key_T_no_module.moduleSemanticSiteCount === 0, "without module assets storage should have no module semantic sites");
    assert(cases.storage_set_and_link_default_T_no_module.flowCount === 0, "setAndLink wrapper flow should require the storage module");
    assert(cases.storage_same_key_T_unresolved.flowCount === 0, "unresolved storage endpoint should not produce a flow");
    assert(cases.storage_same_key_T_unresolved.moduleEndpointGapCount > 0, "unresolved storage endpoint should record module endpoint gaps");
    assert(cases.taskpool_execute_T_unresolved.flowCount === 0, "unresolved taskpool endpoint should not produce a flow");
    assert(cases.taskpool_execute_T_unresolved.moduleEndpointGapCount > 0, "unresolved taskpool endpoint should record module endpoint gaps");

    console.log("PASS test_module_storage_state_worker_scheduler");
    console.log(`storage_positive_flows=${cases.storage_same_key_T.flowCount}`);
    console.log(`storage_set_and_link_default_flows=${cases.storage_set_and_link_default_T.flowCount}`);
    console.log(`storage_set_and_link_existing_flows=${cases.storage_set_and_link_existing_T.flowCount}`);
    console.log(`state_positive_flows=${cases.state_same_key_T.flowCount}`);
    console.log(`taskpool_positive_flows=${cases.taskpool_execute_T.flowCount}`);
    console.log(`storage_unresolved_endpoint_gap_rows=${cases.storage_same_key_T_unresolved.moduleEndpointGapCount}`);
    console.log(`taskpool_unresolved_endpoint_gap_rows=${cases.taskpool_execute_T_unresolved.moduleEndpointGapCount}`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
