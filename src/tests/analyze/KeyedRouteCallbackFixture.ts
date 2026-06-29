import * as fs from "fs";
import * as path from "path";
import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { stringifyRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";
import {
    buildProjectDeclarationRegistry,
    toCanonicalApiRegistrySnapshot,
    writeCanonicalApiRegistrySnapshot,
} from "../../core/api/identity/CanonicalApiRegistrySnapshot";
import type { CanonicalApiDeclarationEvidence } from "../../core/api/identity/CanonicalApiDescriptorBuilder";

export interface KeyedRouteCallbackSummary {
    summary: {
        totalFlows: number;
        withSeeds?: number;
    };
    entries: Array<{
        entryName: string;
        status: string;
        seedCount: number;
        flowCount: number;
        materializedTaintFlows?: Array<{
            sinkFactId?: string;
            judgement?: string;
            evidenceKinds?: string[];
            paths?: Array<{
                factIds: string[];
                judgement?: string;
                evidenceKinds?: string[];
            }>;
        }>;
        moduleAudit?: {
            failedModuleIds?: string[];
            failureEvents?: unknown[];
            moduleStats?: Record<string, unknown>;
        };
    }>;
}

export interface KeyedRouteCallbackRunResult {
    baseline: KeyedRouteCallbackSummary;
    withModule: KeyedRouteCallbackSummary;
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

function projectDeclaration(input: {
    sourceFile: string;
    ownerName: string;
    memberName: string;
    parameterTypes: string[];
    returnType: string;
    fileFunction?: boolean;
}): CanonicalApiDeclarationEvidence {
    const ownerName = input.fileFunction ? "file" : input.ownerName;
    return {
        domain: "local",
        moduleSpecifier: input.sourceFile,
        logicalDeclarationFile: input.sourceFile,
        exportPath: [input.fileFunction
            ? { kind: "default", name: "file" }
            : { kind: "namespace", name: ownerName }],
        declarationOwner: {
            kind: input.fileFunction ? "namespace" : "class",
            path: [ownerName],
            normalizedName: ownerName,
            arkanalyzerName: input.fileFunction ? "%dflt" : ownerName,
        },
        member: input.fileFunction
            ? { kind: "function", name: input.memberName }
            : { kind: "method", name: input.memberName, static: false },
        invoke: { kind: "call" },
        signature: {
            parameters: input.parameterTypes.map((type, index) => ({ index, type: { text: type } })),
            returnType: { text: input.returnType },
        },
        arkanalyzer: {
            declaringFileName: `@${input.sourceFile}: `,
            declaringNamespacePath: [],
            declaringClassName: input.fileFunction ? "%dflt" : ownerName,
            methodName: input.memberName,
            parameterTypes: input.parameterTypes,
            returnType: input.returnType,
            staticFlag: input.fileFunction === true,
        },
        declarationLocations: [{ file: input.sourceFile }],
    };
}

function buildRegistry(sourceFile: string) {
    const callbackType = `@${sourceFile}: %dflt.%AM0(string)`;
    return buildProjectDeclarationRegistry([
        projectDeclaration({ sourceFile, ownerName: "EntryAbility", memberName: "onCreate", parameterTypes: [], returnType: "void" }),
        projectDeclaration({ sourceFile, ownerName: "file", memberName: "Source", parameterTypes: [], returnType: "string", fileFunction: true }),
        projectDeclaration({ sourceFile, ownerName: "file", memberName: "RegisterRoute", parameterTypes: ["string", callbackType], returnType: "void", fileFunction: true }),
        projectDeclaration({ sourceFile, ownerName: "file", memberName: "PushRoute", parameterTypes: ["string", "string"], returnType: "void", fileFunction: true }),
        projectDeclaration({ sourceFile, ownerName: "file", memberName: "TriggerRoute", parameterTypes: ["string"], returnType: "void", fileFunction: true }),
        projectDeclaration({ sourceFile, ownerName: "file", memberName: "Sink", parameterTypes: ["string"], returnType: "void", fileFunction: true }),
    ]);
}

function writeCanonicalRegistry(registryPath: string, sourceFile: string): void {
    const result = buildRegistry(sourceFile);
    if (!result.ok) {
        throw new Error(`canonical registry fixture should be valid: ${result.diagnostics.map(item => item.message).join("; ")}`);
    }
    writeCanonicalApiRegistrySnapshot(registryPath, toCanonicalApiRegistrySnapshot(result));
}

function projectCanonicalApiId(sourceFile: string, memberName: string, parameterTypes: string[], returnType: string): string {
    const result = buildProjectDeclarationRegistry([
        projectDeclaration({ sourceFile, ownerName: "file", memberName, parameterTypes, returnType, fileFunction: true }),
    ]);
    if (!result.ok || result.descriptors.length !== 1) {
        throw new Error(`canonical fixture should be valid for ${memberName}: ${result.diagnostics.map(item => item.message).join("; ")}`);
    }
    return result.descriptors[0].canonicalApiId;
}

function entryCanonicalApiId(sourceFile: string): string {
    const result = buildProjectDeclarationRegistry([
        projectDeclaration({ sourceFile, ownerName: "EntryAbility", memberName: "onCreate", parameterTypes: [], returnType: "void" }),
    ]);
    if (!result.ok || result.descriptors.length !== 1) {
        throw new Error(`canonical fixture should be valid for EntryAbility.onCreate: ${result.diagnostics.map(item => item.message).join("; ")}`);
    }
    return result.descriptors[0].canonicalApiId;
}

function invokeSurface(sourceFile: string, surfaceId: string, memberName: string, parameterTypes: string[], returnType: string): unknown {
    return {
        surfaceId,
        kind: "invoke",
        canonicalApiId: projectCanonicalApiId(sourceFile, memberName, parameterTypes, returnType),
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: `@${sourceFile}: `,
                    declaringNamespacePath: [],
                    declaringClassName: "%dflt",
                    methodName: memberName,
                    parameterTypes,
                    returnType,
                    staticFlag: true,
                },
            },
        },
        confidence: "certain",
        provenance: { source: "analyzer", location: { file: "EntryAbility.ets", line: 3 } },
    };
}

function entryAbilityArkMainAsset(projectId: string, sourceFile: string): unknown {
    const canonicalApiId = entryCanonicalApiId(sourceFile);
    return {
        id: `asset.arkmain.${projectId}.entry_ability`,
        plane: "arkmain",
        status: "reviewed",
        surfaces: [
            {
                surfaceId: "surface.EntryAbility.onCreate.entry",
                kind: "entry",
                canonicalApiId,
                evidence: {
                    arkanalyzer: {
                        methodKey: {
                            declaringFileName: `@${sourceFile}: `,
                            declaringNamespacePath: [],
                            declaringClassName: "EntryAbility",
                            methodName: "onCreate",
                            parameterTypes: [],
                            returnType: "void",
                            staticFlag: false,
                        },
                    },
                },
                confidence: "certain",
                provenance: { source: "analyzer", location: { file: "EntryAbility.ets", line: 12 } },
            },
        ],
        bindings: [
            {
                bindingId: `binding.${projectId}.EntryAbility.onCreate.entry`,
                assetId: `asset.arkmain.${projectId}.entry_ability`,
                surfaceId: "surface.EntryAbility.onCreate.entry",
                canonicalApiId,
                plane: "arkmain",
                role: "entry",
                effectTemplateRefs: ["template.EntryAbility.onCreate.lifecycle"],
                semanticsFamily: "ability_lifecycle",
                completeness: "partial",
                confidence: "certain",
            },
        ],
        effectTemplates: [
            {
                id: "template.EntryAbility.onCreate.lifecycle",
                kind: "entry.lifecycle",
                entryKind: "ability_lifecycle",
                phase: "bootstrap",
                ownerKind: "ability",
                entryShape: "override_slot",
                confidence: "certain",
            },
        ],
        provenance: {
            source: "manual",
            projectId,
            createdAt: "2026-05-27T00:00:00.000Z",
            evidenceLocations: [{ file: "EntryAbility.ets", line: 12 }],
        },
    };
}

function writeRuleAsset(rulePath: string, sourceFile: string, projectId: string): void {
    writeText(rulePath, stringifyRuleAssetFixture({
        id: `asset.rule.fixture.${projectId}`,
        sources: [
            {
                id: `source.fixture.${projectId}`,
                sourceKind: "call_return",
                surface: {
                    kind: "invoke",
                    modulePath: sourceFile,
                    functionName: "Source",
                    invokeKind: "free-function",
                    methodName: "Source",
                    argCount: 0,
                    parameterTypes: [],
                    returnType: "string",
                    arkanalyzerDeclaringFileName: `@${sourceFile}: `,
                    arkanalyzerDeclaringClassName: "%dflt",
                    arkanalyzerMethodName: "Source",
                    arkanalyzerStaticFlag: true,
                    scope: { file: { mode: "equals", value: "EntryAbility.ets" } },
                },
                target: "result",
            },
        ],
        sinks: [
            {
                id: `sink.fixture.${projectId}`,
                surface: {
                    kind: "invoke",
                    modulePath: sourceFile,
                    functionName: "Sink",
                    invokeKind: "free-function",
                    methodName: "Sink",
                    argCount: 1,
                    parameterTypes: ["string"],
                    returnType: "void",
                    arkanalyzerDeclaringFileName: `@${sourceFile}: `,
                    arkanalyzerDeclaringClassName: "%dflt",
                    arkanalyzerMethodName: "Sink",
                    arkanalyzerStaticFlag: true,
                    scope: { file: { mode: "equals", value: "EntryAbility.ets" } },
                },
                target: "arg0",
            },
        ],
        sanitizers: [],
        transfers: [],
    }));
}

function writeRouteBridge(moduleFile: string, sourceFile: string): void {
    const callbackType = `@${sourceFile}: %dflt.%AM0(string)`;
    const registerCanonicalApiId = projectCanonicalApiId(sourceFile, "RegisterRoute", ["string", callbackType], "void");
    const pushCanonicalApiId = projectCanonicalApiId(sourceFile, "PushRoute", ["string", "string"], "void");
    writeText(moduleFile, [
        `import { defineModule } from "@arktaint/module";`,
        "",
        "export default defineModule({",
        "  id: \"fixture.keyed_route_callback_bridge\",",
        "  description: \"Bridge PushRoute(name, param) into RegisterRoute(name, callback) param0 by exact literal route key.\",",
        "  setup(ctx) {",
        "    const relay = ctx.bridge.keyedNodeRelay();",
        "    const firstExactKey = (call: any): string | undefined => {",
        "      const keys = ctx.analysis.stringCandidates(call.arg(0), 2);",
        "      return keys.length === 1 ? keys[0] : undefined;",
        "    };",
        `    for (const call of ctx.scan.invokes({ canonicalApiIds: [${JSON.stringify(registerCanonicalApiId)}] })) {`,
        "      if (call.args().length < 2) continue;",
        "      const key = firstExactKey(call);",
        "      if (!key) continue;",
        "      relay.addTargets(key, call.callbackParamNodeIds(1, 0, { maxCandidates: 8 }));",
        "      ctx.deferred.imperativeFromInvoke(call, 1, { reason: \"Fixture-KeyedRouteBinding\" });",
        "    }",
        `    for (const call of ctx.scan.invokes({ canonicalApiIds: [${JSON.stringify(pushCanonicalApiId)}] })) {`,
        "      if (call.args().length < 2) continue;",
        "      const key = firstExactKey(call);",
        "      if (!key) continue;",
        "      relay.addSources(key, call.argNodeIds(1));",
        "    }",
        "    relay.materialize();",
        "    return {",
        "      onFact(event) {",
        "        return relay.emitPreserve(event, \"Fixture-KeyedRouteBridge\", { allowUnreachableTarget: true });",
        "      },",
        "    };",
        "  },",
        "});",
        "",
    ].join("\n"));
}

export function runKeyedRouteCallbackFixture(input: {
    testName: string;
    projectId: string;
    registerKey: string;
    pushKey: string;
    triggerKey: string;
}): KeyedRouteCallbackRunResult {
    const root = resolveTestRunDir("diagnostics", input.testName);
    const repoRoot = resolveTestRunPath("diagnostics", input.testName, "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", input.testName, "fixtures", "module_root");
    const baselineOutput = resolveTestRunPath("diagnostics", input.testName, "runs", "baseline");
    const moduleOutput = resolveTestRunPath("diagnostics", input.testName, "runs", "module");
    const sourceFile = "ets/EntryAbility.ets";
    const rulePath = path.join(moduleRoot, "keyed_route.rules.json");
    const registryPath = path.join(moduleRoot, "canonical_api_registry.json");
    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", input.projectId, "modules");
    const arkMainProjectDir = path.join(moduleRoot, "project", input.projectId, "arkmain");
    fs.rmSync(root, { recursive: true, force: true });
    writeText(path.join(repoSourceDir, "EntryAbility.ets"), [
        "import { UIAbility } from '@kit.AbilityKit';",
        "",
        "function RegisterRoute(_name: string, _callback: (param: string) => void): void {}",
        "function PushRoute(_name: string, _param: string): void {}",
        "function TriggerRoute(_name: string): void {}",
        "",
        "function Source(): string { return \"taint\"; }",
        "function Sink(v: string): void {}",
        "",
        "export default class EntryAbility extends UIAbility {",
        "  onCreate(): void {",
        `    RegisterRoute(${JSON.stringify(input.registerKey)}, (param: string) => {`,
        "      Sink(param);",
        "    });",
        "    const secret = Source();",
        `    PushRoute(${JSON.stringify(input.pushKey)}, secret);`,
        `    TriggerRoute(${JSON.stringify(input.triggerKey)});`,
        "  }",
        "}",
        "",
    ].join("\n"));
    writeRuleAsset(rulePath, sourceFile, input.projectId);
    writeText(path.join(moduleProjectDir, "keyed_route_bridge.ts"), "");
    writeRouteBridge(path.join(moduleProjectDir, "keyed_route_bridge.ts"), sourceFile);
    writeText(path.join(arkMainProjectDir, "entry_ability.arkmain.asset.json"), JSON.stringify(entryAbilityArkMainAsset(input.projectId, sourceFile), null, 2));
    writeCanonicalRegistry(registryPath, sourceFile);
    const sharedArgs = [
        "--repo", repoRoot,
        "--sourceDir", "src/main/ets",
        "--project", rulePath,
        "--canonicalRegistry", registryPath,
        "--model-root", moduleRoot,
        "--enable-model", `${input.projectId}:arkmain`,
        "--kernelRule", "tests/rules/minimal.rules.json",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
    ];
    runAnalyzeCli([
        ...sharedArgs,
        "--outputDir", baselineOutput,
    ]);
    runAnalyzeCli([
        ...sharedArgs,
        "--enable-model", `${input.projectId}:modules`,
        "--outputDir", moduleOutput,
    ]);
    return {
        baseline: readAnalyzeSummary<KeyedRouteCallbackSummary>(baselineOutput),
        withModule: readAnalyzeSummary<KeyedRouteCallbackSummary>(moduleOutput),
    };
}

