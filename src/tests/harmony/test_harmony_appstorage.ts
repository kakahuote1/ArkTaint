import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import type { TaintEngineOptions } from "../../core/orchestration/TaintPropagationEngine";
import { createHarmonyKeyedStorageSemanticModule } from "../../core/orchestration/modules/harmony_semantics/appstorage";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import { buildEngineForCase, collectCaseSeedNodes, engineOptionsFromLoadedRuleSet, findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";
import { resolveSuiteCaseExpectation } from "../helpers/SuiteExpectationResolver";
import {
    buildProjectDeclarationRegistry,
} from "../../core/api/identity/CanonicalApiRegistrySnapshot";
import type { CanonicalApiDeclarationEvidence } from "../../core/api/identity/CanonicalApiDescriptorBuilder";
import * as fs from "fs";
import * as path from "path";

interface CaseResult {
    name: string;
    expected: boolean;
    detected: boolean;
    seedCount: number;
    pass: boolean;
}

interface CliOptions {
    sourceDir: string;
    kernelRulePath: string;
    projectRulePath: string;
    k: number;
    disableModule: boolean;
    caseFilter?: string;
}

function parseArgs(argv: string[]): CliOptions {
    let sourceDir = "tests/demo/harmony_appstorage";
    let kernelRulePath = "tests/rules/minimal.rules.json";
    let projectRulePath = "tests/rules/harmony_appstorage.rules.json";
    let k = 1;
    let disableModule = false;
    let caseFilter: string | undefined;

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
        if (arg === "--disable-module") {
            disableModule = true;
            continue;
        }
        if (arg === "--case" && i + 1 < argv.length) {
            caseFilter = argv[++i];
            continue;
        }
        if (arg.startsWith("--case=")) {
            caseFilter = arg.slice("--case=".length);
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
        disableModule,
        caseFilter,
    };
}

function listCases(sourceDir: string): string[] {
    return fs.readdirSync(sourceDir)
        .filter(f => f.endsWith(".ets"))
        .map(f => path.basename(f, ".ets"))
        .sort();
}

function projectDeclaration(input: {
    sourceFile: string;
    ownerName: string;
    memberName: string;
    parameterTypes: string[];
    returnType: string;
    staticMember?: boolean;
}): CanonicalApiDeclarationEvidence {
    return {
        domain: "local",
        moduleSpecifier: input.sourceFile,
        logicalDeclarationFile: input.sourceFile,
        exportPath: [{ kind: "namespace", name: input.ownerName }],
        declarationOwner: {
            kind: "class",
            path: [input.ownerName],
            normalizedName: input.ownerName,
            arkanalyzerName: input.ownerName,
        },
        member: { kind: "method", name: input.memberName, static: input.staticMember === true },
        invoke: { kind: "call" },
        signature: {
            parameters: input.parameterTypes.map((type, index) => ({ index, type: { text: type } })),
            returnType: { text: input.returnType },
        },
        arkanalyzer: {
            declaringFileName: `@${input.sourceFile}: `,
            declaringNamespacePath: [],
            declaringClassName: input.ownerName,
            methodName: input.memberName,
            parameterTypes: input.parameterTypes,
            returnType: input.returnType,
            staticFlag: input.staticMember === true,
        },
        declarationLocations: [{ file: input.sourceFile }],
    };
}

function projectMethodCanonicalApiId(sourceFile: string, ownerName: string, memberName: string, parameterTypes: string[], returnType: string): string {
    const result = buildProjectDeclarationRegistry([
        projectDeclaration({
            sourceFile,
            ownerName,
            memberName,
            parameterTypes,
            returnType,
            staticMember: true,
        }),
    ]);
    if (!result.ok || result.descriptors.length !== 1) {
        throw new Error(`canonical fixture should be valid for ${ownerName}.${memberName}: ${result.diagnostics.map(item => item.message).join("; ")}`);
    }
    return result.descriptors[0].canonicalApiId;
}

function appStorageInvokeSurface(sourceFile: string, surfaceId: string, methodName: string, parameterTypes: string[], returnType: string): {
    surfaceId: string;
    kind: "invoke";
    canonicalApiId: string;
    evidence: {
        arkanalyzer: {
            methodKey: {
                declaringFileName: string;
                declaringNamespacePath: string[];
                declaringClassName: string;
                methodName: string;
                parameterTypes: string[];
                returnType: string;
                staticFlag: boolean;
            };
        };
    };
    confidence: "certain";
    provenance: { source: "analyzer"; location: { file: string; line: number } };
} {
    return {
        surfaceId,
        kind: "invoke",
        canonicalApiId: projectMethodCanonicalApiId(sourceFile, "AppStorage", methodName, parameterTypes, returnType),
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: `@${sourceFile}: `,
                    declaringNamespacePath: [],
                    declaringClassName: "AppStorage",
                    methodName,
                    parameterTypes,
                    returnType,
                    staticFlag: true,
                },
            },
        },
        confidence: "certain",
        provenance: { source: "analyzer", location: { file: "taint_mock.ts", line: 5 } },
    };
}

function handoffBinding(assetId: string, bindingId: string, surfaceId: string, canonicalApiId: string, effectTemplateRefs: string[]): unknown {
    return {
        bindingId,
        assetId,
        surfaceId,
        canonicalApiId,
        plane: "module",
        role: "handoff",
        effectTemplateRefs,
        semanticsFamily: "test-harmony-appstorage",
        completeness: "partial",
        confidence: "certain",
    };
}

function firstArgHandle(): unknown {
    return {
        cellKind: "keyed-semantic-slot",
        family: "test.harmony_appstorage",
        key: [{ kind: "fromLiteralArg", index: 0 }],
        precision: "exact",
    };
}

const OFFICIAL_STORAGE_PROP_DECORATOR_ID =
    "api:official:arkui:module=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:file=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:export=named%3AStorageProp:decl=file%3Aapi%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:member=decorator%3AStorageProp:invoke=decorator:params=0%3Astring:ret=PropertyDecorator";
const OFFICIAL_STORAGE_LINK_DECORATOR_ID =
    "api:official:arkui:module=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:file=api%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:export=named%3AStorageLink:decl=file%3Aapi%2F%40internal%2Fcomponent%2Fets%2Fcommon.d.ts:member=decorator%3AStorageLink:invoke=decorator:params=0%3Astring:ret=PropertyDecorator";

interface MockAppStorageFixture {
    asset: unknown;
    module: ReturnType<typeof createHarmonyKeyedStorageSemanticModule>;
}

function createMockAppStorageFixture(): MockAppStorageFixture {
    const sourceFile = "harmony_appstorage/taint_mock.ts";
    const set = appStorageInvokeSurface(sourceFile, "surface.mock_appstorage.set", "set", ["string", "any"], "void");
    const setOrCreate = appStorageInvokeSurface(sourceFile, "surface.mock_appstorage.setOrCreate", "setOrCreate", ["string", "any"], "any");
    const get = appStorageInvokeSurface(sourceFile, "surface.mock_appstorage.get", "get", ["string"], "any");
    const prop = appStorageInvokeSurface(sourceFile, "surface.mock_appstorage.prop", "prop", ["string"], "any");
    const link = appStorageInvokeSurface(sourceFile, "surface.mock_appstorage.link", "link", ["string"], "any");
    const assetId = "asset.module.harmony_appstorage_fixture.mock_appstorage";
    const asset = {
        id: assetId,
        plane: "module",
        status: "reviewed",
        surfaces: [set, setOrCreate, get, prop, link],
        bindings: [
            handoffBinding(assetId, "binding.mock_appstorage.set", "surface.mock_appstorage.set", set.canonicalApiId, ["template.set"]),
            handoffBinding(assetId, "binding.mock_appstorage.setOrCreate", "surface.mock_appstorage.setOrCreate", setOrCreate.canonicalApiId, ["template.setOrCreate"]),
            handoffBinding(assetId, "binding.mock_appstorage.get", "surface.mock_appstorage.get", get.canonicalApiId, ["template.get"]),
            handoffBinding(assetId, "binding.mock_appstorage.prop", "surface.mock_appstorage.prop", prop.canonicalApiId, ["template.prop"]),
            handoffBinding(assetId, "binding.mock_appstorage.link", "surface.mock_appstorage.link", link.canonicalApiId, ["template.link"]),
        ],
        effectTemplates: [
            {
                id: "template.set",
                kind: "handoff.put",
                handle: firstArgHandle(),
                value: { base: { kind: "arg", index: 1 } },
            },
            {
                id: "template.setOrCreate",
                kind: "handoff.put",
                handle: firstArgHandle(),
                value: { base: { kind: "arg", index: 1 } },
            },
            {
                id: "template.get",
                kind: "handoff.get",
                handle: firstArgHandle(),
                target: { base: { kind: "return" } },
            },
            {
                id: "template.prop",
                kind: "handoff.get",
                handle: firstArgHandle(),
                target: { base: { kind: "return" } },
            },
            {
                id: "template.link",
                kind: "handoff.get",
                handle: firstArgHandle(),
                target: { base: { kind: "return" } },
            },
        ],
        provenance: {
            source: "manual",
            projectId: "harmony_appstorage_fixture",
            createdAt: "2026-06-29T00:00:00.000Z",
            evidenceLocations: [{ file: "harmony_appstorage/taint_mock.ts", line: 5 }],
        },
    };
    const module = createHarmonyKeyedStorageSemanticModule({
        id: "fixture.harmony_appstorage.mock_appstorage",
        description: "Test-local exact semantics for taint_mock.AppStorage.",
        writeApis: [
            { canonicalApiIds: [set.canonicalApiId], valueIndex: 1 },
            { canonicalApiIds: [setOrCreate.canonicalApiId], valueIndex: 1, updateStrength: "weak" },
        ],
        readCanonicalApiIds: [
            get.canonicalApiId,
            prop.canonicalApiId,
            link.canonicalApiId,
        ],
        propDecoratorCanonicalApiIds: [OFFICIAL_STORAGE_PROP_DECORATOR_ID],
        linkDecoratorCanonicalApiIds: [OFFICIAL_STORAGE_LINK_DECORATOR_ID],
    });
    return { asset, module };
}


async function runCase(
    scene: Scene,
    caseName: string,
    relativePath: string,
    options: CliOptions,
    _sourceRules: SourceRule[],
    sinkRules: SinkRule[],
    engineOptions: TaintEngineOptions,
): Promise<CaseResult> {
    const expected = resolveSuiteCaseExpectation("harmony_appstorage", caseName);
    const entry = resolveCaseMethod(scene, relativePath, caseName);
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
    const engine = await buildEngineForCase(scene, options.k, entryMethod, {
        engineOptions: {
            ...engineOptions,
            disabledModuleIds: options.disableModule ? ["harmony.appstorage"] : [],
        },
        verbose: false,
    });
    try {
        const reachable = engine.computeReachableMethodSignatures();
        engine.setActiveReachableMethodSignatures(reachable);
    } catch {
        engine.setActiveReachableMethodSignatures(undefined);
    }

    const seedNodes = collectCaseSeedNodes(engine, entryMethod);
    engine.propagateWithSeeds(seedNodes);
    const flows = engine.detectSinksByRules(sinkRules);
    const detected = flows.length > 0;
    const pass = detected === expected;

    return {
        name: caseName,
        expected,
        detected,
        seedCount: seedNodes.length,
        pass,
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
    const mockAppStorage = createMockAppStorageFixture();
    const loadedEngineOptions = engineOptionsFromLoadedRuleSet(loaded);
    const engineOptions: TaintEngineOptions = {
        ...loadedEngineOptions,
        apiAssets: [
            ...(loadedEngineOptions.apiAssets || []),
            mockAppStorage.asset as any,
        ],
        assetIdentityIndex: undefined,
        includeBuiltinModules: true,
        modules: [mockAppStorage.module],
    };
    console.log(`source_rules_loaded=${sourceRules.length}`);
    console.log(`sink_rules_loaded=${sinkRules.length}`);

    const sceneConfig = new SceneConfig();
    sceneConfig.buildFromProjectDir(options.sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(sceneConfig);
    scene.inferTypes();

    const cases = listCases(options.sourceDir)
        .filter(name => name !== "taint_mock")
        .filter(name => !options.caseFilter || name === options.caseFilter);
    const results: CaseResult[] = [];
    let passCount = 0;

    for (const caseName of cases) {
        console.log(`running_case=${caseName}`);
        const result = await runCase(scene, caseName, `${caseName}.ets`, options, sourceRules, sinkRules, engineOptions);
        if (result.pass) passCount++;
        results.push(result);
    }

    console.log("====== Harmony AppStorage Test ======");
    console.log(`k=${options.k}`);
    console.log(`module_enabled=${options.disableModule ? "false" : "true"}`);
    console.log(`total_cases=${results.length}`);
    console.log(`pass_cases=${passCount}`);
    console.log(`fail_cases=${results.length - passCount}`);
    for (const r of results) {
        console.log(
            `${r.pass ? "PASS" : "FAIL"} ${r.name} expected=${r.expected ? "T" : "F"} `
            + `detected=${r.detected} seeds=${r.seedCount}`
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

