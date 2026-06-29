import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { createHarmonyRouteBridgeSemanticModule } from "../../core/orchestration/modules/harmony_semantics/router";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import type { AssetDocumentBase, InvokeSurface } from "../../core/assets/schema";
import { fromProjectDeclaration } from "../../core/api/identity";
import { buildEngineForCase, findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import { resolveSuiteCaseExpectation } from "../helpers/SuiteExpectationResolver";
import * as fs from "fs";
import * as path from "path";

interface CliOptions {
    sourceDir: string;
    kernelRulePath: string;
    projectRulePath: string;
    k: number;
}

interface CaseResult {
    name: string;
    expected: boolean;
    detected: boolean;
    seedCount: number;
    pass: boolean;
}

interface MockRouterMethodInput {
    className: string;
    methodName: string;
    parameterTypes: string[];
    returnType: string;
}

const MOCK_ROUTER_MODULE_PATH = "harmony_router_bridge/taint_mock.ts";

function mockRouterMethodCanonicalApiId(input: MockRouterMethodInput): string {
    const result = fromProjectDeclaration({
        domain: "local",
        moduleSpecifier: MOCK_ROUTER_MODULE_PATH,
        logicalDeclarationFile: "tests/api/harmony_router_bridge_taint_mock.d.ts",
        exportPath: [{ kind: "namespace", name: input.className }],
        declarationOwner: {
            kind: "class",
            path: [input.className],
            normalizedName: input.className,
            arkanalyzerName: input.className,
        },
        member: { kind: "method", name: input.methodName, static: true },
        invoke: { kind: "call" },
        signature: {
            parameters: input.parameterTypes.map((type, index) => ({ index, type: { text: type } })),
            returnType: { text: input.returnType },
        },
        arkanalyzer: {
            declaringFileName: MOCK_ROUTER_MODULE_PATH,
            declaringNamespacePath: [],
            declaringClassName: input.className,
            methodName: input.methodName,
            parameterTypes: input.parameterTypes,
            returnType: input.returnType,
            staticFlag: true,
        },
        declarationLocations: [{ file: "tests/api/harmony_router_bridge_taint_mock.d.ts" }],
    });
    if (result.status !== "accepted") {
        throw new Error(`mock router canonical identity rejected for ${input.className}.${input.methodName}: ${result.reason}`);
    }
    return result.descriptor.canonicalApiId;
}

function mockRouterSurface(input: MockRouterMethodInput): InvokeSurface {
    return {
        surfaceId: `surface.test.harmony_router_bridge.${input.className}.${input.methodName}`,
        canonicalApiId: mockRouterMethodCanonicalApiId(input),
        kind: "invoke",
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: MOCK_ROUTER_MODULE_PATH,
                    declaringNamespacePath: [],
                    declaringClassName: input.className,
                    methodName: input.methodName,
                    parameterTypes: input.parameterTypes,
                    returnType: input.returnType,
                    staticFlag: true,
                },
            },
        },
        confidence: "certain",
        provenance: { source: "manual" },
    };
}

function mockRouterMethodInputs(): MockRouterMethodInput[] {
    return [
        { className: "Router", methodName: "pushUrl", parameterTypes: ["@harmony_router_bridge/taint_mock.ts: %AC0"], returnType: "void" },
        { className: "Router", methodName: "replaceUrl", parameterTypes: ["@harmony_router_bridge/taint_mock.ts: %AC1"], returnType: "void" },
        { className: "Router", methodName: "pushNamedRoute", parameterTypes: ["@harmony_router_bridge/taint_mock.ts: %AC2"], returnType: "void" },
        { className: "Router", methodName: "getParams", parameterTypes: [], returnType: "any" },
        { className: "router", methodName: "pushUrl", parameterTypes: ["@harmony_router_bridge/taint_mock.ts: %AC3"], returnType: "void" },
        { className: "router", methodName: "getParams", parameterTypes: [], returnType: "any" },
        { className: "NavPathStack", methodName: "pushPath", parameterTypes: ["@harmony_router_bridge/taint_mock.ts: %AC4"], returnType: "void" },
        { className: "NavPathStack", methodName: "pushPathByName", parameterTypes: ["@harmony_router_bridge/taint_mock.ts: %AC5"], returnType: "void" },
        { className: "NavPathStack", methodName: "getParams", parameterTypes: ["string"], returnType: "any" },
        { className: "NavDestination", methodName: "register", parameterTypes: ["string", "@harmony_router_bridge/taint_mock.ts: NavDestination.%AM0(any)"], returnType: "void" },
        { className: "NavDestination", methodName: "trigger", parameterTypes: ["string"], returnType: "void" },
    ];
}

function mockRouterAsset(): AssetDocumentBase {
    const surfaces = mockRouterMethodInputs().map(mockRouterSurface);
    const templateId = "template.test.harmony_router_bridge.mock_router.identity";
    return {
        id: "asset.module.test.harmony_router_bridge.mock_router_api",
        plane: "module",
        status: "reviewed",
        surfaces,
        bindings: surfaces.map(surface => ({
            bindingId: `binding.${surface.surfaceId}.identity`,
            surfaceId: surface.surfaceId,
            canonicalApiId: surface.canonicalApiId,
            assetId: "asset.module.test.harmony_router_bridge.mock_router_api",
            plane: "module",
            role: "handoff",
            endpoint: { base: { kind: "return" } },
            effectTemplateRefs: [templateId],
            semanticsFamily: "test.harmony_router_bridge.mock_router",
            completeness: "complete",
            confidence: "certain",
        })),
        effectTemplates: [{
            id: templateId,
            kind: "core.capability",
            capability: "module.route-bridge",
            payload: { testOnly: true },
            confidence: "certain",
        }],
        provenance: { source: "manual" },
    };
}

function mockRouterApiIds(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const input of mockRouterMethodInputs()) {
        const key = `${input.className}.${input.methodName}`;
        out[key] = [...(out[key] || []), mockRouterMethodCanonicalApiId(input)];
    }
    return out;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/harmony_router_bridge";
    let kernelRulePath = "tests/rules/minimal.rules.json";
    let projectRulePath = "tests/rules/harmony_router_bridge.rules.json";
    let k = 1;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--sourceDir" && i + 1 < argv.length) {
            sourceDir = argv[++i];
            continue;
        }
        if (arg.startsWith("--sourceDir=")) {
            sourceDir = arg.slice("--sourceDir=".length);
            continue;
        }
        if (arg === "--kernelRule" && i + 1 < argv.length) {
            kernelRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--kernelRule=")) {
            kernelRulePath = arg.slice("--kernelRule=".length);
            continue;
        }
        if (arg === "--project" && i + 1 < argv.length) {
            projectRulePath = argv[++i];
            continue;
        }
        if (arg.startsWith("--project=")) {
            projectRulePath = arg.slice("--project=".length);
            continue;
        }
        if (arg === "--k" && i + 1 < argv.length) {
            k = Number(argv[++i]);
            continue;
        }
        if (arg.startsWith("--k=")) {
            k = Number(arg.slice("--k=".length));
            continue;
        }
    }

    if (k !== 0 && k !== 1) {
        throw new Error(`Invalid --k value: ${k}. Expected 0 or 1.`);
    }

    return {
        sourceDir: path.resolve(sourceDir),
        kernelRulePath: path.resolve(kernelRulePath),
        projectRulePath: path.resolve(projectRulePath),
        k,
    };
}

function listCases(sourceDir: string): string[] {
    return fs.readdirSync(sourceDir)
        .filter(f => f.endsWith(".ets"))
        .map(f => path.basename(f, ".ets"))
        .filter(name => /_(T|F)$/.test(name))
        .sort();
}

async function runCase(
    scene: Scene,
    caseName: string,
    options: CliOptions,
    loaded: ReturnType<typeof loadRuleSet>,
    sourceRules: SourceRule[],
    sinkRules: SinkRule[]
): Promise<CaseResult> {
    const expected = resolveSuiteCaseExpectation("harmony_router_bridge", caseName);
    const entry = resolveCaseMethod(scene, `${caseName}.ets`, caseName);
    const entryMethod = findCaseMethod(scene, entry);
    if (!entryMethod) {
        return {
            name: caseName,
            expected,
            detected: false,
            seedCount: 0,
            pass: !expected,
        };
    }
    const routerApiIds = mockRouterApiIds();
    const engine = await buildEngineForCase(scene, options.k, entryMethod, {
        engineOptions: {
            apiAssets: [...loaded.assets, mockRouterAsset()],
            modules: [
                createHarmonyRouteBridgeSemanticModule({
                    id: "test.harmony.router.bridge.local_mock",
                    description: "Test-only explicit route bridge model for the local harmony_router_bridge fixture.",
                    pushApis: [
                        { routeField: "url", canonicalApiIds: [...(routerApiIds["Router.pushUrl"] || []), ...(routerApiIds["router.pushUrl"] || [])] },
                        { routeField: "url", canonicalApiIds: routerApiIds["Router.replaceUrl"] || [] },
                        { routeField: "name", canonicalApiIds: routerApiIds["Router.pushNamedRoute"] || [] },
                        { routeField: "name", canonicalApiIds: routerApiIds["NavPathStack.pushPath"] || [] },
                        { routeField: "name", canonicalApiIds: routerApiIds["NavPathStack.pushPathByName"] || [] },
                    ],
                    getCanonicalApiIds: [
                        ...(routerApiIds["Router.getParams"] || []),
                        ...(routerApiIds["router.getParams"] || []),
                        ...(routerApiIds["NavPathStack.getParams"] || []),
                    ],
                    navDestinationRegisterApis: [{
                        canonicalApiIds: routerApiIds["NavDestination.register"] || [],
                        callbackArgIndex: 1,
                        routeParamIndex: 0,
                        payloadParamIndex: 0,
                    }],
                    navDestinationTriggerApis: [{
                        canonicalApiIds: routerApiIds["NavDestination.trigger"] || [],
                        routeArgIndex: 0,
                    }],
                    payloadUnwrapPrefixes: ["params", "param"],
                }),
            ],
            disabledAutoSourceRuleIdPrefixes: [
                "source.arkmain.contract.router.trigger.",
                "source.auto.framework.navigation_context.",
            ],
        },
        verbose: false,
    });
    try {
        const reachable = engine.computeReachableMethodSignatures();
        engine.setActiveReachableMethodSignatures(reachable);
    } catch {
        engine.setActiveReachableMethodSignatures(undefined);
    }

    const seedInfo = engine.propagateWithSourceRules(sourceRules);
    const flows = engine.detectSinksByRules(sinkRules);
    const detected = flows.length > 0;
    return {
        name: caseName,
        expected,
        detected,
        seedCount: seedInfo.seedCount,
        pass: expected === detected,
    };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.sourceDir)) {
        throw new Error(`sourceDir not found: ${options.sourceDir}`);
    }
    if (!fs.existsSync(options.kernelRulePath)) {
        throw new Error(`kernelRulePath not found: ${options.kernelRulePath}`);
    }
    if (!fs.existsSync(options.projectRulePath)) {
        throw new Error(`projectRulePath not found: ${options.projectRulePath}`);
    }

    const loaded = loadRuleSet({
        kernelRulePath: options.kernelRulePath,
        projectRulePath: options.projectRulePath,
        allowMissingProject: false,
        autoDiscoverRuleSources: false,
    });
    const sourceRules: SourceRule[] = loaded.ruleSet.sources || [];
    const sinkRules: SinkRule[] = loaded.ruleSet.sinks || [];

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(options.sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const caseNames = listCases(options.sourceDir).filter(name => name !== "taint_mock");
    const results: CaseResult[] = [];
    let passCount = 0;
    for (const caseName of caseNames) {
        const result = await runCase(scene, caseName, options, loaded, sourceRules, sinkRules);
        if (result.pass) passCount++;
        results.push(result);
    }

    console.log("====== Harmony Router Bridge Test ======");
    console.log(`k=${options.k}`);
    console.log(`total_cases=${results.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${results.length - passCount}`);
    for (const result of results) {
        console.log(
            `${result.pass ? "PASS" : "FAIL"} ${result.name} expected=${result.expected ? "T" : "F"} `
            + `detected=${result.detected} seeds=${result.seedCount}`
        );
    }

    if (passCount !== results.length) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

