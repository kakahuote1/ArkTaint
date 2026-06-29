import * as fs from "fs";
import * as path from "path";
import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import type { AssetDocumentBase, AssetSurface } from "../../core/assets/schema";
import { fromProjectDeclaration } from "../../core/api/identity";
import type { TaintModule } from "../../core/kernel/contracts/ModuleContract";
import { defineModule } from "../../core/kernel/contracts/ModuleApi";
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

function buildFixtureRuleAsset(file: string): AssetDocumentBase {
    return makeRuleAssetFixture({
        id: "asset.rule.fixture.module_oninvoke_scheduler",
        sources: [
            {
                id: "source.fixture.module_oninvoke_scheduler",
                sourceKind: "call_return",
                surface: {
                    kind: "invoke",
                    modulePath: file,
                    ownerName: "file",
                    ownerKind: "namespace",
                    methodName: "Source",
                    invokeKind: "free-function",
                    argCount: 0,
                    parameterTypes: [],
                    returnType: "string",
                },
                target: "result",
            },
        ],
        sinks: [
            {
                id: "sink.fixture.module_oninvoke_scheduler",
                surface: {
                    kind: "invoke",
                    modulePath: file,
                    ownerName: "file",
                    ownerKind: "namespace",
                    methodName: "Sink",
                    invokeKind: "free-function",
                    argCount: 1,
                    parameterTypes: ["string"],
                    returnType: "void",
                },
                target: "arg0",
            },
        ],
    });
}

function moduleAssetForForward(surface: AssetSurface): AssetDocumentBase {
    assert(!!surface.canonicalApiId, "module forward surface requires canonicalApiId");
    const templateId = "template.fixture.module_oninvoke_scheduler.capability";
    return {
        id: "asset.module.fixture.module_oninvoke_scheduler",
        plane: "module",
        status: "official",
        surfaces: [{ ...surface }],
        bindings: [
            {
                bindingId: "binding.fixture.module_oninvoke_scheduler.forward.arg0",
                surfaceId: surface.surfaceId,
                canonicalApiId: surface.canonicalApiId,
                assetId: "asset.module.fixture.module_oninvoke_scheduler",
                plane: "module",
                role: "module",
                endpoint: { base: { kind: "arg", index: 0 } },
                effectTemplateRefs: [templateId],
                semanticsFamily: "fixture.module-oninvoke-scheduler",
                metadata: {
                    description: "Exact module onInvoke scheduler fixture: current fact must be Bridge.forward arg0.",
                },
                completeness: "complete",
                confidence: "certain",
            },
        ],
        effectTemplates: [
            {
                id: templateId,
                kind: "core.capability",
                capability: "module.bridge",
                payload: {
                    source: "arg0",
                    target: "arg1",
                },
                confidence: "certain",
            },
        ],
        provenance: { source: "manual" },
    };
}

function canonicalForwardSurface(scene: Scene, assetId: string): AssetSurface {
    for (const method of scene.getMethods() as any[]) {
        const methodSig = method.getSignature?.();
        const subSig = methodSig?.getMethodSubSignature?.();
        const methodName = String(subSig?.getMethodName?.() || method.getName?.() || "").trim();
        if (methodName !== "forward") continue;
        const classSig = methodSig?.getDeclaringClassSignature?.();
        const className = String(classSig?.getClassName?.() || "").trim();
        if (className !== "Bridge") continue;
        return projectInvokeSurfaceFromMethod(assetId, method);
    }
    throw new Error("fixture Bridge.forward method not found");
}

function projectInvokeSurfaceFromMethod(assetId: string, method: any): AssetSurface {
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
            parameters: parameterTypes.map((type, index) => ({ index, type: { text: type } })),
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
        surfaceId: `surface.${assetId}.bridge.forward`,
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

function buildOnInvokeModules(canonicalApiId: string): TaintModule[] {
    return [
        defineModule({
            id: "fixture.module_oninvoke_scheduler",
            description: "Focused module onInvoke scheduler fixture.",
            setup() {
                return {
                    onInvoke(event) {
                        if (event.call.canonicalApiId !== canonicalApiId) return;
                        if (!event.match.arg(0)) return;
                        const target = event.values.arg(1);
                        if (target === undefined) return;
                        const targetNodeIds = event.analysis.nodeIdsForValue(target, event.raw.stmt);
                        return event.emit.toNodes(
                            targetNodeIds,
                            "fixture.module_oninvoke_scheduler.forward_arg0_to_arg1",
                        );
                    },
                };
            },
        }),
    ];
}

async function runCase(input: {
    scene: Scene;
    relativePath: string;
    caseName: string;
    modules: TaintModule[];
    projectRulePath: string;
    canonicalApiId: string;
}): Promise<{
    flowCount: number;
    invokeHookCalls: number;
    invokeEmissionCount: number;
    apiStats: unknown;
    moduleSemanticSiteCount: number;
    moduleBindingAccepted: boolean;
    endpointStatusCounts: Record<string, number>;
    loadedModuleIds: string[];
    registryHasForward: boolean;
    loadedAssetIds: string[];
    loadedCanonicalIds: string[];
    occurrenceReasons: string[];
}> {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        projectRulePath: path.resolve(input.projectRulePath),
        allowMissingProject: false,
        autoDiscoverRuleSources: false,
    });
    const registryHasForward = loaded.canonicalApiRegistry.has(input.canonicalApiId);
    const sourceRules = loaded.ruleSet.sources || [];
    const sinkRules = loaded.ruleSet.sinks || [];
    const entry = resolveCaseMethod(input.scene, input.relativePath, input.caseName);
    const entryMethod = findCaseMethod(input.scene, entry);
    assert(!!entryMethod, `missing entry method: ${input.caseName}`);

    const engine = new TaintPropagationEngine(input.scene, 1, {
        includeBuiltinModules: false,
        modules: input.modules,
        apiAssets: loaded.assets,
        assetIdentityIndex: loaded.assetIdentityIndex,
        canonicalApiRegistry: loaded.canonicalApiRegistry,
    });
    engine.verbose = false;
    await engine.buildPAG({
        syntheticEntryMethods: [entryMethod!],
        entryModel: "explicit",
    });
    try {
        engine.setActiveReachableMethodSignatures(engine.computeReachableMethodSignatures());
    } catch {
        engine.setActiveReachableMethodSignatures(undefined);
    }
    engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const audit = engine.getModuleAuditSnapshot();
    const moduleStats = Object.values(audit.moduleStats)[0];
    const apiIndex = (engine as any).apiEffectRuntimeIndex;
    const endpointSummary = engine.getPagNodeResolutionAuditSnapshot().endpointResolutionStatusCounts || {};
    return {
        flowCount: flows.length,
        invokeHookCalls: moduleStats?.invokeHookCalls || 0,
        invokeEmissionCount: moduleStats?.invokeEmissionCount || 0,
        apiStats: apiIndex?.getStats?.(),
        moduleSemanticSiteCount: (apiIndex?.listSemanticEffectSites?.() || []).filter((site: any) => site.capability === "module").length,
        moduleBindingAccepted: apiIndex?.hasModuleSemanticAssetBinding?.(
            String((apiIndex?.listSemanticEffectSites?.() || []).find((site: any) => site.capability === "module")?.canonicalApiId || ""),
        ) === true,
        endpointStatusCounts: endpointSummary,
        loadedModuleIds: audit.loadedModuleIds,
        registryHasForward,
        loadedAssetIds: loaded.assets.map(asset => asset.id).sort(),
        loadedCanonicalIds: loaded.assets.flatMap(asset => asset.surfaces || [])
            .map(surface => String(surface.canonicalApiId || ""))
            .filter(Boolean)
            .sort(),
        occurrenceReasons: engine.getOfficialOccurrenceLedger().slice(0, 8).map(record => [
            record.status,
            record.reasonCode,
            record.canonicalApiId || "",
            record.descriptor?.memberName || "",
            record.descriptor?.logicalDeclarationFile || "",
            record.descriptor?.ownerPath?.join(".") || "",
            record.sourceFile,
            record.statementText || "",
        ].join("|")),
    };
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("runtime", "module_oninvoke_scheduler");
    const inputsDir = path.join(root, "inputs");
    const fullAssetDir = path.join(root, "assets_full");
    const ruleOnlyAssetDir = path.join(root, "assets_rule_only");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(inputsDir, { recursive: true });
    fs.mkdirSync(fullAssetDir, { recursive: true });
    fs.mkdirSync(ruleOnlyAssetDir, { recursive: true });

    const fileName = "oninvoke_direct.ets";
    const logicalFile = `inputs/${fileName}`;
    writeText(path.join(inputsDir, fileName), [
        "class Bridge {",
        "  forward(source: string, target: string): void {}",
        "}",
        "",
        "function Source(): string { return \"taint\"; }",
        "function Sink(v: string): void {}",
        "",
        "export function oninvoke_arg0_to_arg1_T(): void {",
        "  const bridge = new Bridge();",
        "  const target = \"safe\";",
        "  bridge.forward(Source(), target);",
        "  Sink(target);",
        "}",
        "",
        "export function oninvoke_arg1_source_no_reverse_F(): void {",
        "  const bridge = new Bridge();",
        "  const source = \"safe\";",
        "  const target = Source();",
        "  bridge.forward(source, target);",
        "  Sink(source);",
        "}",
        "",
    ].join("\n"));

    const scene = buildScene(inputsDir);
    const ruleAsset = buildFixtureRuleAsset(logicalFile);
    const moduleSurface = canonicalForwardSurface(scene, "asset.module.fixture.module_oninvoke_scheduler");
    const moduleAsset = moduleAssetForForward(moduleSurface);
    const canonicalApiId = String(moduleSurface.canonicalApiId || "");
    assert(!!canonicalApiId, "Bridge.forward canonicalApiId missing");

    writeJson(path.join(fullAssetDir, "rule.rules.json"), ruleAsset);
    writeJson(path.join(fullAssetDir, "module.rules.json"), moduleAsset);
    writeJson(path.join(ruleOnlyAssetDir, "rule.rules.json"), ruleAsset);

    const modules = buildOnInvokeModules(canonicalApiId);

    const positive = await runCase({
        scene,
        relativePath: fileName,
        caseName: "oninvoke_arg0_to_arg1_T",
        modules,
        projectRulePath: fullAssetDir,
        canonicalApiId,
    });
    const reverseNegative = await runCase({
        scene,
        relativePath: fileName,
        caseName: "oninvoke_arg1_source_no_reverse_F",
        modules,
        projectRulePath: fullAssetDir,
        canonicalApiId,
    });
    assert(reverseNegative.flowCount === 0, `arg1 taint should not flow back to arg0, got ${reverseNegative.flowCount}`);
    assert(reverseNegative.invokeHookCalls === 0, `arg1 taint should not schedule arg0-bound onInvoke, got ${reverseNegative.invokeHookCalls}`);

    const noModuleAsset = await runCase({
        scene,
        relativePath: fileName,
        caseName: "oninvoke_arg0_to_arg1_T",
        modules,
        projectRulePath: ruleOnlyAssetDir,
        canonicalApiId,
    });

    const details = { positive, reverseNegative, noModuleAsset };
    assert(
        positive.flowCount === 1,
        `positive should produce exactly one flow, got ${JSON.stringify(details)}`,
    );
    assert(positive.invokeHookCalls > 0, `positive should call module onInvoke: ${JSON.stringify(details)}`);
    assert(positive.invokeEmissionCount > 0, `positive should emit from module onInvoke: ${JSON.stringify(details)}`);
    assert(noModuleAsset.flowCount === 0, `missing module asset binding must not produce a flow, got ${noModuleAsset.flowCount}`);
    assert(noModuleAsset.invokeHookCalls === 0, `missing module asset binding must not schedule onInvoke, got ${noModuleAsset.invokeHookCalls}`);

    console.log("PASS test_module_oninvoke_scheduler");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
