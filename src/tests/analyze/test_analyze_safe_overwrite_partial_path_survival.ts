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
function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
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
function buildProjectRegistry(sourceFile: string) {
    return buildProjectDeclarationRegistry([
        projectDeclaration({ sourceFile, ownerName: "EntryAbility", memberName: "onCreate", parameterTypes: [], returnType: "void" }),
        projectDeclaration({ sourceFile, ownerName: "file", memberName: "Source", parameterTypes: [], returnType: "string", fileFunction: true }),
        projectDeclaration({ sourceFile, ownerName: "file", memberName: "Merge", parameterTypes: [`@${sourceFile}: Vault`, "string", "string"], returnType: "void", fileFunction: true }),
        projectDeclaration({ sourceFile, ownerName: "file", memberName: "Sink", parameterTypes: ["string"], returnType: "void", fileFunction: true }),
        projectDeclaration({ sourceFile, ownerName: "StorageBox", memberName: "putSync", parameterTypes: ["string", "string"], returnType: "void" }),
        projectDeclaration({ sourceFile, ownerName: "StorageBox", memberName: "getSync", parameterTypes: ["string"], returnType: "string" }),
    ]);
}
function writeCanonicalRegistry(registryPath: string, sourceFile: string): void {
    const result = buildProjectRegistry(sourceFile);
    if (!result.ok) {
        throw new Error(`canonical registry fixture should be valid: ${result.diagnostics.map(item => item.message).join("; ")}`);
    }
    writeCanonicalApiRegistrySnapshot(registryPath, toCanonicalApiRegistrySnapshot(result));
}
function projectCanonicalApiId(sourceFile: string, ownerName: string, memberName: string, parameterTypes: string[], returnType: string, fileFunction = false): string {
    const result = buildProjectDeclarationRegistry([
        projectDeclaration({ sourceFile, ownerName, memberName, parameterTypes, returnType, fileFunction }),
    ]);
    if (!result.ok || result.descriptors.length !== 1) {
        throw new Error(`canonical fixture should be valid for ${memberName}: ${result.diagnostics.map(item => item.message).join("; ")}`);
    }
    return result.descriptors[0].canonicalApiId;
}
interface AnalyzeSummary {
    reportMode: "light" | "full";
    summary: {
        totalFlows: number;
    };
    entries: Array<{
        entryName: string;
        flowCount: number;
        materializedTaintFlows?: Array<{
            sinkFactId: string;
            judgement?: string;
            evidenceKinds?: string[];
            paths: Array<{
                factIds: string[];
                judgement?: string;
                evidenceKinds?: string[];
                truncated?: boolean;
            }>;
        }>;
        postsolveResults?: Array<{
            flow: {
                source: string;
                sinkText: string;
                sinkFactId?: string;
            };
            paths: Array<{
                factIds: string[];
                truncated?: boolean;
                evidence: Array<{
                    kind: string;
                }>;
                judgement: {
                    kind: string;
                };
            }>;
            evidenceSummary: {
                evidenceKinds: string[];
                primaryReason?: string;
            };
            judgement: {
                kind: string;
                primaryReason?: string;
            };
        }>;
    }>;
}
async function main(): Promise<void> {
    const root = resolveTestRunDir("diagnostics", "analyze_safe_overwrite_partial_path_survival");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_safe_overwrite_partial_path_survival", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_safe_overwrite_partial_path_survival", "fixtures", "module_root");
    const baselineOutput = resolveTestRunPath("diagnostics", "analyze_safe_overwrite_partial_path_survival", "runs", "baseline");
    const moduleOutput = resolveTestRunPath("diagnostics", "analyze_safe_overwrite_partial_path_survival", "runs", "module");
    const sourceFile = "ets/EntryAbility.ets";
    const registryPath = path.join(moduleRoot, "canonical_api_registry.json");
    fs.rmSync(root, { recursive: true, force: true });
    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const moduleProjectDir = path.join(moduleRoot, "project", "safe_overwrite_partial_path_survival", "modules");
    const arkMainProjectDir = path.join(moduleRoot, "project", "safe_overwrite_partial_path_survival", "arkmain");
    const mergeCanonicalApiId = projectCanonicalApiId(sourceFile, "file", "Merge", [`@${sourceFile}: Vault`, "string", "string"], "void", true);
    const getSyncCanonicalApiId = projectCanonicalApiId(sourceFile, "StorageBox", "getSync", ["string"], "string");
    writeText(path.join(repoSourceDir, "EntryAbility.ets"), [
        "import { UIAbility } from '@kit.AbilityKit';",
        "",
        "class Vault {",
        "  saved: string = \"\";",
        "}",
        "",
        "class StorageBox {",
        "  putSync(_key: string, _value: string): void {}",
        "  getSync(_key: string): string { return \"\"; }",
        "}",
        "",
        "function Source(): string {",
        "  return \"taint\";",
        "}",
        "",
        "function Merge(box: Vault, left: string, right: string): void {}",
        "",
        "function Sink(v: string): void {}",
        "",
        "export default class EntryAbility extends UIAbility {",
        "  onCreate(): void {",
        "    const box = new Vault();",
        "    const source = Source();",
        "    const leftStore = new StorageBox();",
        "    leftStore.putSync(\"token\", source);",
        "    leftStore.putSync(\"token\", \"safe\");",
        "    const leftValue = leftStore.getSync(\"token\");",
        "    const rightStore = new StorageBox();",
        "    rightStore.putSync(\"token\", source);",
        "    const rightValue = rightStore.getSync(\"token\");",
        "    Merge(box, leftValue, rightValue);",
        "    Sink(box.saved);",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeText(path.join(moduleRoot, "safe_overwrite_partial_path_survival.rules.json"), stringifyRuleAssetFixture({
        id: "asset.rule.fixture.safe_overwrite_partial_path_survival",
        sources: [
            {
                id: "source.fixture.safe_overwrite_partial_path_survival",
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
                    scope: {
                        file: { mode: "equals", value: "EntryAbility.ets" },
                    }
                },
                target: "result"
            }
        ],
        sinks: [
            {
                id: "sink.fixture.safe_overwrite_partial_path_survival",
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
                    scope: {
                        file: { mode: "equals", value: "EntryAbility.ets" },
                    }
                },
                target: "arg0"
            }
        ],
        sanitizers: [],
        transfers: []
    }));
    writeText(path.join(moduleProjectDir, "storage_box.asset.json"), JSON.stringify(storageBoxHandoffAsset("safe_overwrite_partial_path_survival", sourceFile), null, 2));
    writeText(path.join(arkMainProjectDir, "entry_ability.arkmain.asset.json"), JSON.stringify(entryAbilityArkMainAsset("safe_overwrite_partial_path_survival", sourceFile), null, 2));
    writeCanonicalRegistry(registryPath, sourceFile);
    writeText(path.join(moduleProjectDir, "safe_overwrite_partial_path_survival_bridge.ts"), [
        "import { defineModule } from \"@arktaint/module\";",
        "",
        "export default defineModule({",
        "  id: \"fixture.safe_overwrite_partial_path_survival_bridge\",",
        "  description: \"Bridge Merge arguments into box.saved for safe-overwrite partial survival.\",",
        "  setup(ctx) {",
        `    const mergeCalls = ctx.scan.invokes({ canonicalApiIds: [${JSON.stringify(mergeCanonicalApiId)}] }).filter(call => call.args().length >= 3);`,
        `    const readCalls = ctx.scan.invokes({ canonicalApiIds: [${JSON.stringify(getSyncCanonicalApiId)}] });`,
        "    const readResultNodeIds = new Set();",
        "    for (const call of readCalls) {",
        "      for (const nodeId of call.resultNodeIds()) readResultNodeIds.add(nodeId);",
        "      for (const nodeId of call.resultCarrierNodeIds()) readResultNodeIds.add(nodeId);",
        "    }",
        "    ctx.debug.summary(\"SafeOverwritePartialBridgeSetup\", {",
        "      merge_calls: mergeCalls.length,",
        "      read_calls: readCalls.length,",
        "      read_result_nodes: Array.from(readResultNodeIds).join(\",\"),",
        "    }, { omitEmpty: true });",
        "    return {",
        "      onFact(event) {",
        "        if (!readResultNodeIds.has(event.current.nodeId)) return;",
        "        const emissions = [];",
        "        for (const call of mergeCalls) {",
        "          const target = call.arg(0);",
        "          if (!target) continue;",
        "          emissions.push(...event.emit.toValueField(target, [\"saved\"], \"Fixture-SafeOverwritePartialRead\"));",
        "        }",
        "        return emissions.length > 0 ? emissions : undefined;",
        "      },",
        "    };",
        "  },",
        "});",
        "",
    ].join("\n"));
    const sharedArgs = [
        "--repo", repoRoot,
        "--sourceDir", "src/main/ets",
        "--project", path.join(moduleRoot, "safe_overwrite_partial_path_survival.rules.json"),
        "--canonicalRegistry", registryPath,
        "--model-root", moduleRoot,
        "--enable-model", "safe_overwrite_partial_path_survival:arkmain",
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
        "--enable-model", "safe_overwrite_partial_path_survival:modules",
        "--outputDir", moduleOutput,
    ]);
    const baseline = readAnalyzeSummary<AnalyzeSummary>(baselineOutput);
    const withModule = readAnalyzeSummary<AnalyzeSummary>(moduleOutput);
    assert(withModule.reportMode === "full", `expected reportMode=full, got ${withModule.reportMode}`);
    assert(baseline.summary.totalFlows === 0, `expected baseline without Merge bridge to contain no sink flows, got ${baseline.summary.totalFlows}`);
    assert(withModule.summary.totalFlows >= 1, `expected module run to retain surviving flows, got ${withModule.summary.totalFlows}`);
    const materializedEntries = (withModule.entries || []).filter(item => Array.isArray(item.materializedTaintFlows) && item.materializedTaintFlows.length > 0);
    assert(materializedEntries.length >= 1, `expected at least one entry with surviving materialized flows, got ${materializedEntries.length}`);
    const materialized = materializedEntries.flatMap(item => item.materializedTaintFlows || []);
    assert(materialized.length >= 1, `expected at least one surviving materialized taint flow, got ${materialized.length}`);
    const survivingPathCount = materialized.flatMap(item => item.paths || []).length;
    assert(survivingPathCount >= 1, `expected at least one surviving path, got ${survivingPathCount}`);
    const pathJudgements = materialized.flatMap(flow => (flow.paths || []).map(pathItem => pathItem.judgement || flow.judgement || ""));
    assert(pathJudgements.every(kind => kind === "Confirmed"), `expected all surviving paths to be Confirmed, got ${JSON.stringify(pathJudgements)}`);
    const evidenceKinds = new Set(materialized.flatMap(flow => [
        ...(flow.evidenceKinds || []),
        ...(flow.paths || []).flatMap(pathItem => pathItem.evidenceKinds || []),
    ]));
    assert(evidenceKinds.has("currentness_certificate"), "expected surviving path to carry currentness_certificate evidence");
    assert(!evidenceKinds.has("safe_overwrite"), "safe_overwrite must not remain as an independent postsolve evidence");
    console.log("PASS test_analyze_safe_overwrite_partial_path_survival");
    console.log(`baseline_total_flows=${baseline.summary.totalFlows}`);
    console.log(`module_total_flows=${withModule.summary.totalFlows}`);
    console.log(`path_judgements=${pathJudgements.join(",")}`);
    console.log(`surviving_paths=${survivingPathCount}`);
}
function entryAbilityArkMainAsset(projectId: string, sourceFile: string): unknown {
    const canonicalApiId = projectCanonicalApiId(sourceFile, "EntryAbility", "onCreate", [], "void");
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
                provenance: {
                    source: "analyzer",
                    location: { file: "EntryAbility.ets", line: 20 },
                },
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
            evidenceLocations: [{ file: "EntryAbility.ets", line: 20 }],
        },
    };
}
function storageBoxHandoffAsset(projectId: string, sourceFile: string): unknown {
    const putSync = invokeSurface(sourceFile, "surface.storage_box.putSync", "putSync", ["string", "string"], "void");
    const getSync = invokeSurface(sourceFile, "surface.storage_box.getSync", "getSync", ["string"], "string");
    return {
        id: `asset.module.${projectId}.storage_box`,
        plane: "module",
        status: "reviewed",
        surfaces: [
            putSync,
            getSync,
        ],
        bindings: [
            handoffBinding(`asset.module.${projectId}.storage_box`, `binding.${projectId}.putSync`, "surface.storage_box.putSync", putSync.canonicalApiId, ["template.putSync"]),
            handoffBinding(`asset.module.${projectId}.storage_box`, `binding.${projectId}.getSync`, "surface.storage_box.getSync", getSync.canonicalApiId, ["template.getSync"]),
        ],
        effectTemplates: [
            {
                id: "template.putSync",
                kind: "handoff.put",
                handle: firstArgHandle(),
                value: { base: { kind: "arg", index: 1 } },
            },
            {
                id: "template.getSync",
                kind: "handoff.get",
                handle: firstArgHandle(),
                target: { base: { kind: "return" } },
            },
        ],
        provenance: {
            source: "llm",
            projectId,
            createdAt: "2026-05-27T00:00:00.000Z",
            evidenceLocations: [{ file: "EntryAbility.ets", line: 7 }],
        },
    };
}
function invokeSurface(sourceFile: string, surfaceId: string, methodName: string, parameterTypes: string[], returnType: string): {
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
        canonicalApiId: projectCanonicalApiId(sourceFile, "StorageBox", methodName, parameterTypes, returnType),
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: `@${sourceFile}: `,
                    declaringNamespacePath: [],
                    declaringClassName: "StorageBox",
                    methodName,
                    parameterTypes,
                    returnType,
                    staticFlag: false,
                },
            },
        },
        confidence: "certain",
        provenance: {
            source: "analyzer",
            location: { file: "EntryAbility.ets", line: 7 },
        },
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
        semanticsFamily: "project-keyed-storage",
        completeness: "partial",
        confidence: "certain",
    };
}
function firstArgHandle(): unknown {
    return {
        cellKind: "keyed-semantic-slot",
        family: "project.storage_box",
        key: [{ kind: "fromLiteralArg", index: 0 }],
        precision: "exact",
    };
}
main().catch((error) => {
    console.error("FAIL test_analyze_safe_overwrite_partial_path_survival");
    console.error(error);
    process.exit(1);
});
