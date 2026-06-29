import * as fs from "fs";
import * as path from "path";
import type { AssetDocumentBase } from "../../core/assets/schema";
import { serializeCanonicalApiId } from "../../core/api/identity/CanonicalApiId";
import {
    buildProjectDeclarationRegistry,
    toCanonicalApiRegistrySnapshot,
    writeCanonicalApiRegistrySnapshot,
} from "../../core/api/identity/CanonicalApiRegistrySnapshot";
import type { CanonicalApiDeclarationEvidence } from "../../core/api/identity/CanonicalApiDescriptorBuilder";
import { readAnalyzeSummary, runAnalyzeCli } from "../helpers/AnalyzeCliRunner";
import { stringifyRuleAssetFixture } from "../helpers/RuleAssetFixtureFactory";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";
function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}
function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}
function writeJson(filePath: string, value: unknown): void {
    writeText(filePath, JSON.stringify(value, null, 2));
}
interface AnalyzeSummary {
    summary: {
        totalFlows: number;
    };
    entries: Array<{
        flowCount: number;
        postsolveResults?: Array<{
            judgement: {
                kind: string;
            };
            flow: {
                sinkText?: string;
            };
        }>;
    }>;
}
function projectWrapperCanonicalApiId(sourceFile: string, className: string, methodName: string, params: string, ret: string): string {
    return serializeCanonicalApiId({
        authority: "project",
        domain: "local",
        module: sourceFile,
        file: sourceFile,
        export: `namespace:${className}`,
        decl: `class:${className}`,
        member: `method:static:${methodName}`,
        invoke: "call",
        params,
        ret,
    });
}
function projectDeclaration(input: {
    sourceFile: string;
    ownerName: string;
    memberName: string;
    parameterTypes: string[];
    returnType: string;
    staticMethod?: boolean;
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
            arkanalyzerName: ownerName,
        },
        member: input.fileFunction
            ? { kind: "function", name: input.memberName }
            : { kind: "method", name: input.memberName, static: !!input.staticMethod },
        invoke: { kind: "call" },
        signature: {
            parameters: input.parameterTypes.map((type, index) => ({ index, type: { text: type } })),
            returnType: { text: input.returnType },
        },
        arkanalyzer: input.fileFunction ? undefined : {
            declaringFileName: input.sourceFile,
            declaringNamespacePath: [],
            declaringClassName: ownerName,
            methodName: input.memberName,
            parameterTypes: input.parameterTypes,
            returnType: input.returnType,
            staticFlag: !!input.staticMethod,
        },
        declarationLocations: [{ file: input.sourceFile }],
    };
}
function writeCanonicalRegistry(registryPath: string, sourceFile: string, className: string, assetClassName: string): void {
    const result = buildProjectDeclarationRegistry([
        projectDeclaration({
            sourceFile,
            ownerName: "SearchResult",
            memberName: "onCreate",
            parameterTypes: ["string"],
            returnType: "void",
        }),
        projectDeclaration({
            sourceFile,
            ownerName: "TaintApi",
            memberName: "Source",
            parameterTypes: ["string"],
            returnType: "string",
            staticMethod: true,
        }),
        projectDeclaration({
            sourceFile,
            ownerName: "TaintApi",
            memberName: "Sink",
            parameterTypes: ["string"],
            returnType: "void",
            staticMethod: true,
        }),
        projectDeclaration({
            sourceFile,
            ownerName: assetClassName,
            memberName: "push",
            parameterTypes: ["RouteOptions"],
            returnType: "void",
            staticMethod: true,
        }),
        projectDeclaration({
            sourceFile,
            ownerName: assetClassName,
            memberName: "getParams",
            parameterTypes: [],
            returnType: "string",
            staticMethod: true,
        }),
    ]);
    assert(result.ok, `canonical registry fixture should be valid: ${result.diagnostics.map(item => item.message).join("; ")}`);
    writeCanonicalApiRegistrySnapshot(registryPath, toCanonicalApiRegistrySnapshot(result));
}
function routeBridgeAsset(projectId: string, className: string, sourceFile: string): AssetDocumentBase {
    const assetId = `asset.project.${projectId}.router_wrapper`;
    const templateId = `${assetId}.route_bridge`;
    const pushCanonicalApiId = projectWrapperCanonicalApiId(sourceFile, className, "push", "0:RouteOptions", "void");
    const getParamsCanonicalApiId = projectWrapperCanonicalApiId(sourceFile, className, "getParams", "none", "string");
    return {
        id: assetId,
        plane: "module",
        status: "reviewed",
        surfaces: [
            {
                surfaceId: `${assetId}.push.surface`,
                canonicalApiId: pushCanonicalApiId,
                kind: "invoke",
                evidence: {
                    arkanalyzer: {
                        methodKey: {
                            declaringFileName: sourceFile,
                            declaringNamespacePath: [],
                            declaringClassName: className,
                            methodName: "push",
                            parameterTypes: ["RouteOptions"],
                            returnType: "void",
                            staticFlag: true,
                        },
                    },
                },
                confidence: "certain",
                provenance: { source: "manual" },
            },
            {
                surfaceId: `${assetId}.getParams.surface`,
                canonicalApiId: getParamsCanonicalApiId,
                kind: "invoke",
                evidence: {
                    arkanalyzer: {
                        methodKey: {
                            declaringFileName: sourceFile,
                            declaringNamespacePath: [],
                            declaringClassName: className,
                            methodName: "getParams",
                            parameterTypes: [],
                            returnType: "string",
                            staticFlag: true,
                        },
                    },
                },
                confidence: "certain",
                provenance: { source: "manual" },
            },
        ],
        bindings: [
            {
                bindingId: `${assetId}.push.binding`,
                surfaceId: `${assetId}.push.surface`,
                canonicalApiId: pushCanonicalApiId,
                assetId,
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "arg", index: 0 } },
                effectTemplateRefs: [templateId],
                semanticsFamily: "project-router-wrapper",
                completeness: "partial",
                confidence: "certain",
            },
            {
                bindingId: `${assetId}.getParams.binding`,
                surfaceId: `${assetId}.getParams.surface`,
                canonicalApiId: getParamsCanonicalApiId,
                assetId,
                plane: "module",
                role: "handoff",
                endpoint: { base: { kind: "return" } },
                effectTemplateRefs: [templateId],
                semanticsFamily: "project-router-wrapper",
                completeness: "partial",
                confidence: "certain",
            },
        ],
        effectTemplates: [
            {
                id: templateId,
                kind: "core.capability",
                capability: "module.route-bridge",
                payload: {
                    pushApis: [{
                        canonicalApiIds: [pushCanonicalApiId],
                        routeField: "url",
                        payloadArgIndex: 0,
                        payloadField: "params",
                    }],
                    getCanonicalApiIds: [getParamsCanonicalApiId],
                    payloadUnwrapPrefixes: ["params", "param"],
                },
                confidence: "certain",
            },
        ],
        provenance: {
            source: "manual",
            projectId,
            reviewedBy: "test",
        },
    };
}
function writeRules(rulePath: string, sourceFile: string): void {
    writeText(rulePath, stringifyRuleAssetFixture({
        id: "asset.rule.fixture.project_router_wrapper",
        sources: [
            {
                id: "source.fixture.project_router_wrapper",
                sourceKind: "call_return",
                surface: {
                    kind: "invoke",
                    modulePath: sourceFile,
                    ownerName: "TaintApi",
                    methodName: "Source",
                    invokeKind: "static",
                    parameterTypes: ["string"],
                    returnType: "string",
                    arkanalyzerDeclaringFileName: sourceFile,
                    arkanalyzerDeclaringClassName: "TaintApi",
                    arkanalyzerStaticFlag: true,
                },
                target: "result"
            }
        ],
        sinks: [
            {
                id: "sink.fixture.project_router_wrapper",
                surface: {
                    kind: "invoke",
                    modulePath: sourceFile,
                    ownerName: "TaintApi",
                    methodName: "Sink",
                    invokeKind: "static",
                    parameterTypes: ["string"],
                    returnType: "void",
                    arkanalyzerDeclaringFileName: sourceFile,
                    arkanalyzerDeclaringClassName: "TaintApi",
                    arkanalyzerStaticFlag: true,
                },
                target: "arg0"
            }
        ],
        sanitizers: [],
        transfers: []
    }));
}
function writeProject(repoSourceDir: string, className: string): void {
    writeText(path.join(repoSourceDir, "pages", "SearchResult.ets"), [
        "import { UIAbility } from '@kit.AbilityKit';",
        "",
        "class RouteOptions {",
        "  url: string = '';",
        "  params: string = '';",
        "}",
        "",
        `class ${className} {`,
        "  static push(_opts: RouteOptions): void {}",
        "  static getParams(): string {",
        "    return '';",
        "  }",
        "}",
        "",
        "class TaintApi {",
        "  static Source(v: string): string {",
        "    return v;",
        "  }",
        "  static Sink(v: string): void {}",
        "}",
        "",
        "export default class SearchResult extends UIAbility {",
        "  onCreate(taint_src: string): void {",
        "    const route = new RouteOptions();",
        "    route.url = 'pages/SearchResult';",
        "    route.params = TaintApi.Source(taint_src);",
        `    ${className}.push(route);`,
        `    const params = ${className}.getParams();`,
        "    TaintApi.Sink(params);",
        "  }",
        "}",
        "",
    ].join("\n"));
}
function runCase(rootLabel: string, projectId: string, className: string, assetClassName: string): AnalyzeSummary {
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_project_router_wrapper_asset", "fixtures", rootLabel, "repo");
    const modelRoot = resolveTestRunPath("diagnostics", "analyze_project_router_wrapper_asset", "fixtures", rootLabel, "model_root");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_project_router_wrapper_asset", "runs", rootLabel);
    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const sourceFile = "src/main/ets/pages/SearchResult.ets";
    const rulePath = path.join(modelRoot, "project.rules.json");
    const registryPath = path.join(modelRoot, "canonical_api_registry.json");
    const modulePath = path.join(modelRoot, "project", projectId, "modules", "semanticflow.modules.json");
    writeProject(repoSourceDir, className);
    writeRules(rulePath, sourceFile);
    writeCanonicalRegistry(registryPath, sourceFile, className, assetClassName);
    writeJson(modulePath, routeBridgeAsset(projectId, assetClassName, sourceFile));
    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", "src/main/ets",
        "--project", rulePath,
        "--canonicalRegistry", registryPath,
        "--model-root", modelRoot,
        "--enable-model", `${projectId}:modules`,
        "--reportMode", "full",
        "--no-incremental",
        "--k", "1",
        "--outputDir", outputDir,
    ]);
    return readAnalyzeSummary<AnalyzeSummary>(outputDir);
}
function main(): void {
    const root = resolveTestRunDir("diagnostics", "analyze_project_router_wrapper_asset");
    fs.rmSync(root, { recursive: true, force: true });
    const positive = runCase("positive", "router_wrapper_positive", "ProjectRouter", "ProjectRouter");
    assert(positive.summary.totalFlows === 0, `exact project router fixture should stay blocked without a matched project source occurrence, got ${positive.summary.totalFlows}`);
    assert(JSON.stringify(positive).includes("source_rule_no_matching_callsite"), "exact project router fixture should record the blocked source-occurrence reason");
    const negative = runCase("negative_scope", "router_wrapper_negative", "FakeRouter", "ProjectRouter");
    assert(negative.summary.totalFlows === 0, `out-of-scope FakeRouter should not be bridged, got ${negative.summary.totalFlows}`);
    console.log("PASS test_analyze_project_router_wrapper_asset");
    console.log(`positive_total_flows=${positive.summary.totalFlows}`);
    console.log(`negative_total_flows=${negative.summary.totalFlows}`);
}
main();
