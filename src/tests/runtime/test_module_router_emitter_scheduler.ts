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

function appendJsonLine(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf-8");
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

function logicalGeneratedInputFile(rawFile: string): string {
    const normalized = String(rawFile || "")
        .replace(/\\/g, "/")
        .replace(/^@/, "")
        .replace(/:\s*$/, "")
        .replace(/^\/+|\/+$/g, "")
        .trim();
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

function returnEndpoint(): AssetEndpoint {
    return { base: { kind: "return" } };
}

function buildRuleAsset(files: string[]): AssetDocumentBase {
    return makeRuleAssetFixture({
        id: "asset.rule.fixture.router_emitter_scheduler",
        sources: files.map(file => ({
            id: `source.fixture.router_emitter_scheduler.${sanitizeId(file)}`,
            sourceKind: "call_return",
            surface: {
                kind: "invoke",
                modulePath: `inputs/${file}`,
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
        sinks: files.map(file => ({
            id: `sink.fixture.router_emitter_scheduler.${sanitizeId(file)}`,
            surface: {
                kind: "invoke",
                modulePath: `inputs/${file}`,
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

function buildEmitterAsset(
    surfaces: readonly ProjectSurface[],
    unresolvedEndpoint: boolean,
): AssetDocumentBase {
    const assetId = unresolvedEndpoint
        ? "asset.module.fixture.router_emitter_scheduler.emitter.unresolved"
        : "asset.module.fixture.router_emitter_scheduler.emitter";
    const templateId = `${assetId}.template.event`;
    const eventSurfaces = surfacesFor(surfaces, [
        { className: "FixtureEventBus", methodName: "on" },
        { className: "FixtureEventBus", methodName: "emit" },
    ]);
    const endpoint = unresolvedEndpoint ? argEndpoint(99) : undefined;
    return {
        id: assetId,
        plane: "module",
        status: "official",
        surfaces: eventSurfaces,
        bindings: eventSurfaces.map((surface, index) => ({
            bindingId: `${assetId}.binding.${index}`,
            surfaceId: surface.surfaceId,
            canonicalApiId: surface.canonicalApiId,
            assetId,
            plane: "module",
            role: "handoff",
            ...(endpoint ? { endpoint } : {}),
            effectTemplateRefs: [templateId],
            semanticsFamily: "fixture.router-emitter-scheduler.event",
            metadata: { description: "Event emitter accepted semantic site scheduler fixture." },
            completeness: "complete",
            confidence: "certain",
        })),
        effectTemplates: [
            {
                id: templateId,
                kind: "module.eventEmitter",
                onCanonicalApiIds: idsFor(surfaces, "FixtureEventBus", "on"),
                emitCanonicalApiIds: idsFor(surfaces, "FixtureEventBus", "emit"),
                channelArgIndexes: [0],
                payloadArgIndex: 1,
                callbackArgIndex: 1,
                callbackParamIndex: 0,
                maxCandidates: 8,
                confidence: "certain",
            },
        ],
        provenance: { source: "manual" },
    };
}

function buildRouterAsset(
    surfaces: readonly ProjectSurface[],
    unresolvedEndpoint: boolean,
): AssetDocumentBase {
    const assetId = unresolvedEndpoint
        ? "asset.module.fixture.router_emitter_scheduler.router.unresolved"
        : "asset.module.fixture.router_emitter_scheduler.router";
    const templateId = `${assetId}.template.route`;
    const routeSurfaces = surfacesFor(surfaces, [
        { className: "FixtureNavPathStack", methodName: "pushPath" },
        { className: "FixtureNavPathStack", methodName: "getParams" },
        { className: "FixtureNavPathStack", methodName: "getParamByName" },
    ]);
    return {
        id: assetId,
        plane: "module",
        status: "official",
        surfaces: routeSurfaces,
        bindings: routeSurfaces.map((surface, index) => ({
            bindingId: `${assetId}.binding.${index}`,
            surfaceId: surface.surfaceId,
            canonicalApiId: surface.canonicalApiId,
            assetId,
            plane: "module",
            role: "handoff",
            endpoint: unresolvedEndpoint
                ? argEndpoint(99)
                : endpointForRouterMethod(surface, surfaces),
            effectTemplateRefs: [templateId],
            semanticsFamily: "fixture.router-emitter-scheduler.route",
            metadata: { description: "Router accepted semantic site scheduler fixture." },
            completeness: "complete",
            confidence: "certain",
        })),
        effectTemplates: [
            {
                id: templateId,
                kind: "core.capability",
                capability: "module.route-bridge",
                payload: {
                    pushApis: [
                        {
                            canonicalApiIds: idsFor(surfaces, "FixtureNavPathStack", "pushPath"),
                            routeField: "name",
                            payloadArgIndex: 0,
                            payloadField: "param",
                        },
                    ],
                    getCanonicalApiIds: idsFor(surfaces, "FixtureNavPathStack", "getParams"),
                    getApis: [
                        {
                            canonicalApiIds: idsFor(surfaces, "FixtureNavPathStack", "getParamByName"),
                            routeField: "name",
                            routeArgIndex: 0,
                        },
                    ],
                    navDestinationRegisterApis: [],
                    navDestinationTriggerApis: [],
                    payloadUnwrapPrefixes: ["param"],
                },
                confidence: "certain",
            },
        ],
        provenance: { source: "manual" },
    };
}

function endpointForRouterMethod(surface: AssetSurface, surfaces: readonly ProjectSurface[]): AssetEndpoint {
    const meta = surfaces.find(item => item.surface.surfaceId === surface.surfaceId);
    assert(!!meta, `missing router surface metadata for ${surface.surfaceId}`);
    if (meta.methodName === "getParams" || meta.methodName === "getParamByName") return returnEndpoint();
    return argEndpoint(0);
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
    progressPath?: string;
}): Promise<{
    flowCount: number;
    loadedModuleIds: string[];
    totalEmissionCount: number;
    factHookCalls: number;
    invokeHookCalls: number;
    emissionReasons: string[];
    semanticSiteCount: number;
    moduleSemanticSiteCount: number;
    moduleResolvedCount: number;
    moduleEndpointGapCount: number;
    semanticResolvedCount: number;
    semanticEndpointGapCount: number;
    endpointStatusCounts: Record<string, number>;
    worklistTruncation?: unknown;
}> {
    const progress = (stage: string, extra: Record<string, unknown> = {}): void => {
        if (!input.progressPath) return;
        appendJsonLine(input.progressPath, { stage, caseName: input.entry, ...extra, at: new Date().toISOString() });
    };
    process.stderr.write(`[router-emitter-scheduler] start ${input.entry}\n`);
    progress("runCase_start");
    const engine = new TaintPropagationEngine(input.scene, 1, {
        includeBuiltinModules: false,
        modules: input.modules,
        apiAssets: [...input.loadedRules.assets, ...input.moduleAssets],
    });
    engine.verbose = false;
    const entryRef = resolveCaseMethod(input.scene, input.relativeFile, input.entry);
    const entryMethod = findCaseMethod(input.scene, entryRef);
    assert(!!entryMethod, `missing entry method: ${input.entry}`);
    process.stderr.write(`[router-emitter-scheduler] buildPAG ${input.entry}\n`);
    progress("buildPAG_start");
    await engine.buildPAG({
        syntheticEntryMethods: [entryMethod!],
        entryModel: "explicit",
    });
    progress("buildPAG_done");
    process.stderr.write(`[router-emitter-scheduler] reachable ${input.entry}\n`);
    progress("reachable_start");
    try {
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
    } catch {
        engine.setActiveReachableMethodSignatures(undefined);
    }
    progress("reachable_done");
    process.stderr.write(`[router-emitter-scheduler] propagate ${input.entry}\n`);
    progress("propagate_start");
    engine.propagateWithSourceRules(input.loadedRules.ruleSet.sources || []);
    progress("propagate_done", { worklistTruncation: engine.getWorklistTruncation() });
    process.stderr.write(`[router-emitter-scheduler] detect ${input.entry}\n`);
    progress("detect_start");
    const flows = engine.detectSinksByRules(input.loadedRules.ruleSet.sinks || []);
    progress("detect_done", { flowCount: flows.length });
    const moduleStats = Object.values(engine.getModuleAuditSnapshot().moduleStats) as any[];
    const semanticLedger = engine.getSemanticEffectLedger();
    const siteRows = semanticLedger.filter((record: any) => record.recordKind === "semantic_effect_site");
    const moduleSiteRows = siteRows.filter((record: any) => record.capability === "module");
    const endpointSummary = engine.getPagNodeResolutionAuditSnapshot().endpointResolutionStatusCounts || {};
    const result = {
        flowCount: flows.length,
        loadedModuleIds: engine.getModuleAuditSnapshot().loadedModuleIds,
        totalEmissionCount: moduleStats.reduce((sum, item) => sum + Number(item.totalEmissionCount || 0), 0),
        factHookCalls: moduleStats.reduce((sum, item) => sum + Number(item.factHookCalls || 0), 0),
        invokeHookCalls: moduleStats.reduce((sum, item) => sum + Number(item.invokeHookCalls || 0), 0),
        emissionReasons: moduleStats.flatMap(item =>
            (item.emissionSamples || []).map((sample: any) => String(sample.reason || "")),
        ).filter(Boolean).sort(),
        semanticSiteCount: siteRows.length,
        moduleSemanticSiteCount: moduleSiteRows.length,
        moduleResolvedCount: moduleSiteRows.filter((record: any) => record.status === "resolved").length,
        moduleEndpointGapCount: moduleSiteRows.filter((record: any) => record.status === "endpoint_gap").length,
        semanticResolvedCount: siteRows.filter((record: any) => record.status === "resolved").length,
        semanticEndpointGapCount: siteRows.filter((record: any) => record.status === "endpoint_gap").length,
        endpointStatusCounts: endpointSummary as Record<string, number>,
        worklistTruncation: engine.getWorklistTruncation(),
    };
    process.stderr.write(`[router-emitter-scheduler] done ${input.entry} flows=${result.flowCount} emissions=${result.totalEmissionCount}\n`);
    progress("runCase_done", { result });
    return result;
}

function hasReasonPrefix(reasons: readonly string[], prefix: string): boolean {
    return reasons.some(reason => reason.indexOf(prefix) === 0);
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("runtime", "module_router_emitter_scheduler");
    const inputsDir = path.join(root, "inputs");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(inputsDir, { recursive: true });
    const progressPath = path.join(root, "progress.jsonl");
    const progress = (stage: string, extra: Record<string, unknown> = {}): void =>
        appendJsonLine(progressPath, { stage, ...extra, at: new Date().toISOString() });

    const routerFile = "pages/Detail.ets";
    const emitterFile = "emitter_scheduler.ets";
    progress("write_inputs_start");
    writeText(path.join(inputsDir, routerFile), [
        "class FixtureNavPathStack {",
        "  static pushPath(options: { name: string; param: string }): void { void options; }",
        "  static getParams(name?: string): string {",
        "    void name;",
        "    return \"safe\";",
        "  }",
        "  static getParamByName(name: string): string {",
        "    void name;",
        "    return \"safe\";",
        "  }",
        "}",
        "",
        "function Source(): string { return \"taint\"; }",
        "function Sink(v: string): void {}",
        "",
        "export function router_same_route_T(): void {",
        "  const payload = Source();",
        "  FixtureNavPathStack.pushPath({ name: \"pages/Detail\", param: payload });",
        "  const params = FixtureNavPathStack.getParams();",
        "  Sink(params);",
        "}",
        "",
        "export function router_other_route_F(): void {",
        "  const payload = Source();",
        "  FixtureNavPathStack.pushPath({ name: \"pages/SafeDetail\", param: payload });",
        "  const params = FixtureNavPathStack.getParams();",
        "  Sink(params);",
        "}",
        "",
        "export function router_get_by_name_T(): void {",
        "  const payload = Source();",
        "  FixtureNavPathStack.pushPath({ name: \"pages/Detail\", param: payload });",
        "  const params = FixtureNavPathStack.getParamByName(\"pages/Detail\");",
        "  Sink(params);",
        "}",
        "",
        "export function router_get_by_other_name_F(): void {",
        "  const payload = Source();",
        "  FixtureNavPathStack.pushPath({ name: \"pages/Detail\", param: payload });",
        "  const params = FixtureNavPathStack.getParamByName(\"pages/Other\");",
        "  Sink(params);",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(inputsDir, emitterFile), [
        "class FixtureEventBus {",
        "  static on(topic: string, callback: (payload: string) => void): void {}",
        "  static emit(topic: string, payload: string): void {}",
        "}",
        "",
        "function Source(): string { return \"taint\"; }",
        "function Sink(v: string): void {}",
        "",
        "export function emitter_same_channel_T(): void {",
        "  FixtureEventBus.on(\"ready\", (payload: string) => { Sink(payload); });",
        "  FixtureEventBus.emit(\"ready\", Source());",
        "}",
        "",
        "export function emitter_other_channel_F(): void {",
        "  FixtureEventBus.on(\"ready\", (payload: string) => { Sink(payload); });",
        "  FixtureEventBus.emit(\"other\", Source());",
        "}",
        "",
    ].join("\n"));
    progress("write_inputs_done");

    progress("build_scene_start");
    const scene = buildScene(inputsDir);
    progress("build_scene_done", { methodCount: (scene.getMethods() as any[]).length });
    progress("collect_surfaces_start");
    const surfaces = collectProjectSurfaces(scene, "asset.module.fixture.router_emitter_scheduler");
    progress("collect_surfaces_done", { surfaceCount: surfaces.length });
    const ruleAsset = buildRuleAsset([routerFile, emitterFile]);
    const projectRulePath = path.join(root, "project.rules.json");
    writeJson(projectRulePath, ruleAsset);
    progress("load_rules_start");
    const loadedRules = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        projectRulePath: path.resolve(projectRulePath),
        allowMissingProject: false,
        autoDiscoverRuleSources: false,
    });
    progress("load_rules_done");

    const routerAsset = buildRouterAsset(surfaces, false);
    const emitterAsset = buildEmitterAsset(surfaces, false);
    const unresolvedRouterAsset = buildRouterAsset(surfaces, true);
    const unresolvedEmitterAsset = buildEmitterAsset(surfaces, true);
    writeJson(path.join(root, "router.module.rules.json"), routerAsset);
    writeJson(path.join(root, "emitter.module.rules.json"), emitterAsset);
    writeJson(path.join(root, "router_unresolved.module.rules.json"), unresolvedRouterAsset);
    writeJson(path.join(root, "emitter_unresolved.module.rules.json"), unresolvedEmitterAsset);

    progress("compile_modules_start");
    const modules = compileModules([routerAsset, emitterAsset]);
    const unresolvedModules = compileModules([unresolvedRouterAsset, unresolvedEmitterAsset]);
    progress("compile_modules_done", { moduleCount: modules.length, unresolvedModuleCount: unresolvedModules.length });

    progress("case_start", { caseName: "router_same_route_T" });
    const routerPositive = await runCase({
        scene,
        loadedRules,
        moduleAssets: [routerAsset, emitterAsset],
        modules,
        relativeFile: routerFile,
        entry: "router_same_route_T",
        progressPath,
    });
    progress("case_done", { caseName: "router_same_route_T", result: routerPositive });
    progress("case_start", { caseName: "router_other_route_F" });
    const routerOtherRoute = await runCase({
        scene,
        loadedRules,
        moduleAssets: [routerAsset, emitterAsset],
        modules,
        relativeFile: routerFile,
        entry: "router_other_route_F",
        progressPath,
    });
    progress("case_done", { caseName: "router_other_route_F", result: routerOtherRoute });
    progress("case_start", { caseName: "router_get_by_name_T" });
    const routerGetByName = await runCase({
        scene,
        loadedRules,
        moduleAssets: [routerAsset, emitterAsset],
        modules,
        relativeFile: routerFile,
        entry: "router_get_by_name_T",
        progressPath,
    });
    progress("case_done", { caseName: "router_get_by_name_T", result: routerGetByName });
    progress("case_start", { caseName: "router_get_by_other_name_F" });
    const routerGetByOtherName = await runCase({
        scene,
        loadedRules,
        moduleAssets: [routerAsset, emitterAsset],
        modules,
        relativeFile: routerFile,
        entry: "router_get_by_other_name_F",
        progressPath,
    });
    progress("case_done", { caseName: "router_get_by_other_name_F", result: routerGetByOtherName });
    progress("case_start", { caseName: "emitter_same_channel_T" });
    const emitterPositive = await runCase({
        scene,
        loadedRules,
        moduleAssets: [routerAsset, emitterAsset],
        modules,
        relativeFile: emitterFile,
        entry: "emitter_same_channel_T",
        progressPath,
    });
    progress("case_done", { caseName: "emitter_same_channel_T", result: emitterPositive });
    progress("case_start", { caseName: "emitter_other_channel_F" });
    const emitterOtherChannel = await runCase({
        scene,
        loadedRules,
        moduleAssets: [routerAsset, emitterAsset],
        modules,
        relativeFile: emitterFile,
        entry: "emitter_other_channel_F",
        progressPath,
    });
    progress("case_done", { caseName: "emitter_other_channel_F", result: emitterOtherChannel });
    progress("case_start", { caseName: "no_module_site" });
    const noModuleSite = await runCase({
        scene,
        loadedRules,
        moduleAssets: [],
        modules,
        relativeFile: emitterFile,
        entry: "emitter_same_channel_T",
        progressPath,
    });
    progress("case_done", { caseName: "no_module_site", result: noModuleSite });
    progress("case_start", { caseName: "unresolved_endpoint" });
    const unresolvedEndpoint = await runCase({
        scene,
        loadedRules,
        moduleAssets: [unresolvedRouterAsset, unresolvedEmitterAsset],
        modules: unresolvedModules,
        relativeFile: emitterFile,
        entry: "emitter_same_channel_T",
        progressPath,
    });
    progress("case_done", { caseName: "unresolved_endpoint", result: unresolvedEndpoint });

    assert(routerPositive.flowCount > 0, `accepted router site should emit route handoff flow, got ${routerPositive.flowCount}`);
    assert(routerPositive.moduleResolvedCount > 0, "router positive must have resolved module semantic endpoint rows");
    assert(hasReasonPrefix(routerPositive.emissionReasons, "Harmony-Router"), "router positive must expose Harmony-Router emission reason");
    assert(routerPositive.factHookCalls > 0, "router positive must execute module fact hook");
    assert(!routerPositive.worklistTruncation, "router positive must not rely on worklist truncation");
    assert(routerGetByName.flowCount > 0, `router getParamByName same name should emit route handoff flow, got ${routerGetByName.flowCount}`);
    assert(routerGetByName.moduleResolvedCount > 0, "router getParamByName positive must have resolved module semantic endpoint rows");
    assert(hasReasonPrefix(routerGetByName.emissionReasons, "Harmony-Router"), "router getParamByName positive must expose Harmony-Router emission reason");
    assert(!routerGetByName.worklistTruncation, "router getParamByName positive must not rely on worklist truncation");

    assert(emitterPositive.flowCount > 0, `accepted emitter site should emit event payload flow, got ${emitterPositive.flowCount}`);
    assert(emitterPositive.moduleResolvedCount > 0, "emitter positive must have resolved module semantic endpoint rows");
    assert(hasReasonPrefix(emitterPositive.emissionReasons, "Harmony event payload"), "emitter positive must expose Harmony event payload emission reason");
    assert(emitterPositive.factHookCalls > 0, "emitter positive must execute module fact hook");
    assert(!emitterPositive.worklistTruncation, "emitter positive must not rely on worklist truncation");

    assert(routerOtherRoute.flowCount === 0, `different router route must stay isolated, got ${routerOtherRoute.flowCount}`);
    assert(routerGetByOtherName.flowCount === 0, `router getParamByName different name must stay isolated, got ${routerGetByOtherName.flowCount}`);
    assert(emitterOtherChannel.flowCount === 0, `different emitter channel must stay isolated, got ${emitterOtherChannel.flowCount}`);
    assert(routerOtherRoute.totalEmissionCount === 0, `different router route must not emit, got ${routerOtherRoute.totalEmissionCount}`);
    assert(routerGetByOtherName.totalEmissionCount === 0, `router getParamByName different name must not emit, got ${routerGetByOtherName.totalEmissionCount}`);
    assert(emitterOtherChannel.totalEmissionCount === 0, `different emitter channel must not emit, got ${emitterOtherChannel.totalEmissionCount}`);
    assert(!routerOtherRoute.worklistTruncation, "router negative must not rely on worklist truncation");
    assert(!routerGetByOtherName.worklistTruncation, "router getParamByName negative must not rely on worklist truncation");
    assert(!emitterOtherChannel.worklistTruncation, "emitter negative must not rely on worklist truncation");

    assert(noModuleSite.moduleSemanticSiteCount === 0, "missing module asset must not create module semantic site rows");
    assert(noModuleSite.totalEmissionCount === 0, "missing module asset must not produce module emissions");
    assert(!noModuleSite.worklistTruncation, "missing module asset case must not rely on worklist truncation");

    assert(unresolvedEndpoint.flowCount === 0, `unresolved module endpoint must not emit, got ${unresolvedEndpoint.flowCount}`);
    assert(unresolvedEndpoint.moduleSemanticSiteCount > 0, "unresolved endpoint case must still expose accepted module semantic site rows");
    assert(unresolvedEndpoint.moduleEndpointGapCount > 0, "unresolved endpoint case must record module endpoint_gap rows");
    assert(unresolvedEndpoint.totalEmissionCount === 0, "unresolved endpoint case must not produce module emissions");
    assert(!unresolvedEndpoint.worklistTruncation, "unresolved endpoint case must not rely on worklist truncation");

    const resultPath = path.join(root, "results.json");
    writeJson(resultPath, {
        routerPositive,
        routerOtherRoute,
        routerGetByName,
        routerGetByOtherName,
        emitterPositive,
        emitterOtherChannel,
        noModuleSite,
        unresolvedEndpoint,
    });
    console.log("PASS test_module_router_emitter_scheduler");
    console.log(`result_path=${resultPath}`);
    console.log(`router_positive_flows=${routerPositive.flowCount}`);
    console.log(`router_get_by_name_flows=${routerGetByName.flowCount}`);
    console.log(`emitter_positive_flows=${emitterPositive.flowCount}`);
    console.log(`unresolved_endpoint_gap_rows=${unresolvedEndpoint.semanticEndpointGapCount}`);
}

main().catch(error => {
    console.error("FAIL test_module_router_emitter_scheduler");
    console.error(error);
    process.exit(1);
});
