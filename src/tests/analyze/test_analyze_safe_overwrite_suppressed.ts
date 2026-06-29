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
    if (!condition) {
        throw new Error(message);
    }
}
interface AnalyzeSummary {
    reportMode: "light" | "full";
    summary: {
        withSeeds: number;
        totalFlows: number;
    };
    entries: Array<{
        entryName: string;
        status: string;
        seedCount: number;
        flowCount: number;
        materializedTaintFlows?: Array<unknown>;
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
            };
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
            ownerName: "StorageBox",
            memberName: "putSync",
            parameterTypes: ["string", "string"],
            returnType: "void",
        }),
        projectDeclaration({
            sourceFile,
            ownerName: "StorageBox",
            memberName: "getSync",
            parameterTypes: ["string"],
            returnType: "string",
        }),
    ]);
    if (!result.ok) {
        throw new Error(`canonical registry fixture should be valid: ${result.diagnostics.map(item => item.message).join("; ")}`);
    }
    writeCanonicalApiRegistrySnapshot(registryPath, toCanonicalApiRegistrySnapshot(result));
}
async function main(): Promise<void> {
    const root = resolveTestRunDir("analyze", "safe_overwrite_suppressed");
    const caseRoot = resolveTestRunPath("analyze", "safe_overwrite_suppressed", "preferences_overwrite_safe");
    const repoRoot = path.join(caseRoot, "repo");
    const moduleRoot = path.join(caseRoot, "module_root");
    const moduleProjectDir = path.join(moduleRoot, "project", "safe_overwrite_suppressed", "modules");
    const arkMainProjectDir = path.join(moduleRoot, "project", "safe_overwrite_suppressed", "arkmain");
    const outputDir = path.join(caseRoot, "out");
    const sourceDir = path.join(repoRoot, "src", "main", "ets");
    const rulePath = path.join(caseRoot, "safe_overwrite.rules.json");
    const registryPath = path.join(caseRoot, "canonical_api_registry.json");
    const sourceFile = "ets/EntryAbility.ets";
    fs.rmSync(root, { recursive: true, force: true });
    writeText(path.join(sourceDir, "EntryAbility.ets"), [
        "import { UIAbility } from '@kit.AbilityKit';",
        "",
        "class StorageBox {",
        "  putSync(_key: string, _value: string): void {}",
        "  getSync(_key: string): string { return \"\"; }",
        "}",
        "",
        "function Source(v: string): string { return v; }",
        "function Sink(v: string): void {}",
        "",
        "export default class EntryAbility extends UIAbility {",
        "  onCreate(taint_src: string): void {",
        "    const secret = Source(taint_src);",
        "    const p = new StorageBox();",
        "    p.putSync(\"token\", secret);",
        "    p.putSync(\"token\", \"safe\");",
        "    Sink(p.getSync(\"token\"));",
        "  }",
        "}",
        "",
    ].join("\n"));
    writeText(rulePath, stringifyRuleAssetFixture({
        id: "asset.rule.fixture.safe_overwrite",
        sources: [
            {
                id: "source.fixture.safe_overwrite",
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
            }
        ],
        sinks: [
            {
                id: "sink.fixture.safe_overwrite",
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
            }
        ],
        sanitizers: [],
        transfers: []
    }));
    writeText(path.join(moduleProjectDir, "storage_box.asset.json"), JSON.stringify(storageBoxHandoffAsset("safe_overwrite_suppressed", sourceFile), null, 2));
    writeText(path.join(arkMainProjectDir, "entry_ability.arkmain.asset.json"), JSON.stringify(entryAbilityArkMainAsset("safe_overwrite_suppressed", sourceFile), null, 2));
    writeCanonicalRegistry(registryPath, sourceFile);
    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", "src/main/ets",
        "--project", rulePath,
        "--canonicalRegistry", registryPath,
        "--model-root", moduleRoot,
        "--enable-model", "safe_overwrite_suppressed:modules",
        "--enable-model", "safe_overwrite_suppressed:arkmain",
        "--kernelRule", "tests/rules/minimal.rules.json",
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);
    const report = readAnalyzeSummary<AnalyzeSummary>(outputDir);
    const entry = report.entries.find(item => item.entryName === "@arkMain") || report.entries[0];
    assert(report.reportMode === "full", `expected reportMode=full, got ${report.reportMode}`);
    assert(report.summary.withSeeds > 0, `expected withSeeds > 0, got ${report.summary.withSeeds}`);
    assert(!!entry, "expected one entry result");
    assert(entry.status === "ok", `expected entry status ok, got ${entry.status}`);
    assert(entry.seedCount > 0, `expected seedCount > 0, got ${entry.seedCount}`);
    assert(report.summary.totalFlows === 0, `expected OCLFS currentness to suppress stale storage flow before postsolve, got ${report.summary.totalFlows}`);
    const postsolveResults = entry.postsolveResults || [];
    assert(postsolveResults.length === 0, `expected no postsolve flow after OCLFS suppression, got ${postsolveResults.length}`);
    console.log("PASS test_analyze_safe_overwrite_suppressed");
    console.log(`root=${root}`);
    console.log(`surviving_total_flows=${report.summary.totalFlows}`);
    console.log("currentness_reason=strong_clean_overwrite");
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
                    location: { file: "EntryAbility.ets", line: 9 },
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
            evidenceLocations: [{ file: "EntryAbility.ets", line: 9 }],
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
            evidenceLocations: [{ file: "EntryAbility.ets", line: 3 }],
        },
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
        canonicalApiId: projectMethodCanonicalApiId(sourceFile, "StorageBox", methodName, parameterTypes, returnType),
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
        family: "project.storage_box",
        key: [{ kind: "fromLiteralArg", index: 0 }],
        precision: "exact",
    };
}
main().catch(error => {
    console.error("FAIL test_analyze_safe_overwrite_suppressed");
    console.error(error);
    process.exit(1);
});
