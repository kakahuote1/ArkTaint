import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { stringifyRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";
import {
    buildProjectDeclarationRegistry,
    toCanonicalApiRegistrySnapshot,
    writeCanonicalApiRegistrySnapshot,
} from "../../core/api/identity/CanonicalApiRegistrySnapshot";
import type { CanonicalApiDeclarationEvidence } from "../../core/api/identity/CanonicalApiDescriptorBuilder";
import * as fs from "fs";
import * as path from "path";
function assert(condition: unknown, message: string): asserts condition {
    if (!condition)
        throw new Error(message);
}
interface AnalyzeSummary {
    reportMode: "light" | "full";
    summary: {
        totalFlows: number;
        withSeeds: number;
    };
    entries: Array<{
        entryName: string;
        status: string;
        materializedTaintFlows?: Array<{
            sinkFactId?: string;
        }>;
        postsolveResults?: Array<{
            evidenceSummary: {
                evidenceKinds: string[];
                primaryReason?: string;
            };
            judgement: {
                kind: string;
            };
            paths: Array<{
                judgement: {
                    kind: string;
                };
                evidence: Array<{
                    kind: string;
                }>;
            }>;
        }>;
    }>;
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
    staticMember?: boolean;
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
            : { kind: "method", name: input.memberName, static: input.staticMember === true },
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
            staticFlag: input.fileFunction ? true : input.staticMember === true,
        },
        declarationLocations: [{ file: input.sourceFile }],
    };
}

function writeCanonicalRegistry(registryPath: string, sourceFile: string): void {
    const result = buildProjectDeclarationRegistry([
        projectDeclaration({
            sourceFile,
            ownerName: "EntryAbility",
            memberName: "onCreate",
            parameterTypes: ["string"],
            returnType: "void",
        }),
        projectDeclaration({
            sourceFile,
            ownerName: "file",
            memberName: "Source",
            parameterTypes: ["string"],
            returnType: "string",
            fileFunction: true,
        }),
        projectDeclaration({
            sourceFile,
            ownerName: "file",
            memberName: "Sink",
            parameterTypes: ["string"],
            returnType: "void",
            fileFunction: true,
        }),
        projectDeclaration({
            sourceFile,
            ownerName: "KeyStorage",
            memberName: "setItem",
            parameterTypes: ["string", "string"],
            returnType: "void",
            staticMember: true,
        }),
        projectDeclaration({
            sourceFile,
            ownerName: "KeyStorage",
            memberName: "getItem",
            parameterTypes: ["string"],
            returnType: "string",
            staticMember: true,
        }),
        projectDeclaration({
            sourceFile,
            ownerName: "KeyStorage",
            memberName: "deleteItem",
            parameterTypes: ["string"],
            returnType: "void",
            staticMember: true,
        }),
    ]);
    if (!result.ok) {
        throw new Error(`canonical registry fixture should be valid: ${result.diagnostics.map(item => item.message).join("; ")}`);
    }
    writeCanonicalApiRegistrySnapshot(registryPath, toCanonicalApiRegistrySnapshot(result));
}

async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "delete_before_read_refinement");
    const caseRoot = resolveTestRunPath("analyze", "delete_before_read_refinement", "preferences_delete_then_read");
    const repoRoot = path.join(caseRoot, "repo");
    const moduleRoot = path.join(caseRoot, "module_root");
    const moduleProjectDir = path.join(moduleRoot, "project", "delete_before_read_refinement", "modules");
    const arkMainProjectDir = path.join(moduleRoot, "project", "delete_before_read_refinement", "arkmain");
    const outputDir = path.join(caseRoot, "out");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const projectRuleDir = path.join(caseRoot, "project_rules");
    const rulePath = path.join(projectRuleDir, "delete_before_read.rules.json");
    const keyStorageRuleAssetPath = path.join(projectRuleDir, "key_storage.rules.json");
    const registryPath = path.join(caseRoot, "canonical_api_registry.json");
    const sourceFile = "ets/EntryAbility.ets";
    fs.rmSync(root, { recursive: true, force: true });
    writeText(path.join(sourceDir, "EntryAbility.ets"), [
        "import { UIAbility } from '@kit.AbilityKit';",
        "",
        "class KeyStorage {",
        "  static setItem(_key: string, _value: string): void {}",
        "  static deleteItem(_key: string): void {}",
        "  static getItem(_key: string): string { return \"\"; }",
        "}",
        "",
        "function Source(_v: string): string { return _v; }",
        "function Sink(_v: string): void {}",
        "",
        "export default class EntryAbility extends UIAbility {",
        "  onCreate(taint_src: string): void {",
        "    const secret = Source(taint_src);",
        "    KeyStorage.setItem(\"token\", secret);",
        "    KeyStorage.deleteItem(\"token\");",
        "    Sink(KeyStorage.getItem(\"token\"));",
        "    KeyStorage.deleteItem(\"live\");",
        "    KeyStorage.setItem(\"live\", secret);",
        "    Sink(KeyStorage.getItem(\"live\"));",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeText(rulePath, stringifyRuleAssetFixture({
        id: "asset.rule.fixture.delete_before_read",
        sources: [{
                id: "source.fixture.delete_before_read",
                sourceKind: "call_return",
                surface: {
                    kind: "invoke",
                    modulePath: sourceFile,
                    functionName: "Source",
                    invokeKind: "free-function",
                    methodName: "Source",
                    argCount: 1,
                    parameterTypes: ["string"],
                    returnType: "string",
                    arkanalyzerDeclaringFileName: `@${sourceFile}: `,
                    arkanalyzerDeclaringClassName: "%dflt",
                    arkanalyzerMethodName: "Source",
                    arkanalyzerStaticFlag: true,
                    scope: { file: { mode: "equals", value: "EntryAbility.ets" } }
                },
                target: "result"
            }],
        sinks: [{
                id: "sink.fixture.delete_before_read",
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
                    scope: { file: { mode: "equals", value: "EntryAbility.ets" } }
                },
                target: "arg0"
            }],
        sanitizers: [],
        transfers: []
    }));
    const keyStorageAsset = keyStorageHandoffAsset("delete_before_read_refinement", sourceFile);
    writeText(path.join(moduleProjectDir, "key_storage.asset.json"), JSON.stringify(keyStorageAsset, null, 2));
    writeText(keyStorageRuleAssetPath, JSON.stringify(keyStorageAsset, null, 2));
    writeText(path.join(arkMainProjectDir, "entry_ability.arkmain.asset.json"), JSON.stringify(entryAbilityArkMainAsset("delete_before_read_refinement", sourceFile), null, 2));
    writeCanonicalRegistry(registryPath, sourceFile);
    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", "src/main/ets",
        "--project", projectRuleDir,
        "--canonicalRegistry", registryPath,
        "--model-root", moduleRoot,
        "--enable-model", "delete_before_read_refinement:modules",
        "--enable-model", "delete_before_read_refinement:arkmain",
        "--kernelRule", "tests/rules/minimal.rules.json",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);
    const report = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    const entry = report.entries.find(item => item.entryName === "@arkMain") || report.entries[0];
    assert(report.reportMode === "full", `expected reportMode=full, got ${report.reportMode}`);
    assert(report.summary.withSeeds > 0, "expected withSeeds > 0");
    assert(entry?.status === "ok", `expected ok entry, got ${entry?.status}`);
    assert(report.summary.totalFlows === 1, `expected OCLFS to keep only the put-after-delete flow, got ${report.summary.totalFlows}`);
    const materialized = entry.materializedTaintFlows || [];
    assert(materialized.length === 1, `expected exactly one materialized live flow, got ${materialized.length}`);
    assert(
        materialized[0]?.sinkFactId?.startsWith("45@"),
        `expected surviving flow to target the put-after-delete read, got ${materialized[0]?.sinkFactId || "<none>"}`,
    );
    const results = entry.postsolveResults || [];
    assert(!results.some(item => item.evidenceSummary.evidenceKinds.includes("delete_before_read")), "delete_before_read must not remain as an independent postsolve evidence");
    console.log("PASS test_analyze_delete_before_read_refinement");
    console.log(`surviving_total_flows=${report.summary.totalFlows}`);
    console.log(`postsolve_results=${results.length}`);
}

function entryAbilityArkMainAsset(projectId: string, sourceFile: string): unknown {
    const canonicalApiId = projectMethodCanonicalApiId(sourceFile, "EntryAbility", "onCreate", ["string"], "void");
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
                            parameterTypes: ["string"],
                            returnType: "void",
                            staticFlag: false,
                        },
                    },
                },
                confidence: "certain",
                provenance: {
                    source: "analyzer",
                    location: { file: "EntryAbility.ets", line: 11 },
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
            evidenceLocations: [{ file: "EntryAbility.ets", line: 11 }],
        },
    };
}

function keyStorageHandoffAsset(projectId: string, sourceFile: string): unknown {
    const setItem = invokeSurface(sourceFile, "surface.key_storage.setItem", "setItem", ["string", "string"], "void");
    const getItem = invokeSurface(sourceFile, "surface.key_storage.getItem", "getItem", ["string"], "string");
    const deleteItem = invokeSurface(sourceFile, "surface.key_storage.deleteItem", "deleteItem", ["string"], "void");
    return {
        id: `asset.module.${projectId}.key_storage`,
        plane: "module",
        status: "reviewed",
        surfaces: [
            setItem,
            getItem,
            deleteItem,
        ],
        bindings: [
            handoffBinding(`asset.module.${projectId}.key_storage`, `binding.${projectId}.setItem`, "surface.key_storage.setItem", setItem.canonicalApiId, ["template.setItem"]),
            handoffBinding(`asset.module.${projectId}.key_storage`, `binding.${projectId}.getItem`, "surface.key_storage.getItem", getItem.canonicalApiId, ["template.getItem"]),
            handoffBinding(`asset.module.${projectId}.key_storage`, `binding.${projectId}.deleteItem`, "surface.key_storage.deleteItem", deleteItem.canonicalApiId, ["template.deleteItem"]),
        ],
        effectTemplates: [
            {
                id: "template.setItem",
                kind: "handoff.put",
                handle: firstArgHandle(),
                value: { base: { kind: "arg", index: 1 } },
            },
            {
                id: "template.getItem",
                kind: "handoff.get",
                handle: firstArgHandle(),
                target: { base: { kind: "return" } },
            },
            {
                id: "template.deleteItem",
                kind: "handoff.kill",
                handle: firstArgHandle(),
            },
        ],
        provenance: {
            source: "manual",
            projectId,
            createdAt: "2026-05-27T00:00:00.000Z",
            evidenceLocations: [{ file: "EntryAbility.ets", line: 3 }],
        },
    };
}
function projectMethodCanonicalApiId(sourceFile: string, ownerName: string, memberName: string, parameterTypes: string[], returnType: string, staticMember = false): string {
    const result = buildProjectDeclarationRegistry([
        projectDeclaration({
            sourceFile,
            ownerName,
            memberName,
            parameterTypes,
            returnType,
            staticMember,
        }),
    ]);
    if (!result.ok || result.descriptors.length !== 1) {
        throw new Error(`canonical method fixture should be valid for ${ownerName}.${memberName}: ${result.diagnostics.map(item => item.message).join("; ")}`);
    }
    return result.descriptors[0].canonicalApiId;
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
        canonicalApiId: projectMethodCanonicalApiId(sourceFile, "KeyStorage", methodName, parameterTypes, returnType, true),
        evidence: {
            arkanalyzer: {
                methodKey: {
                    declaringFileName: `@${sourceFile}: `,
                    declaringNamespacePath: [],
                    declaringClassName: "KeyStorage",
                    methodName,
                    parameterTypes,
                    returnType,
                    staticFlag: true,
                },
            },
        },
        confidence: "certain",
        provenance: {
            source: "analyzer",
            location: { file: "EntryAbility.ets", line: 3 },
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
        family: "project.key_storage",
        key: [{ kind: "fromLiteralArg", index: 0 }],
        precision: "exact",
    };
}
main().catch(error => {
    console.error("FAIL test_analyze_delete_before_read_refinement");
    console.error(error);
    process.exit(1);
});
