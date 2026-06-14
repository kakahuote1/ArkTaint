import * as fs from "fs";
import * as path from "path";
import type { AssetDocumentBase } from "../../core/assets/schema";
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

function routeBridgeAsset(projectId: string, className: string): AssetDocumentBase {
    const assetId = `asset.project.${projectId}.router_wrapper`;
    const templateId = `${assetId}.route_bridge`;
    return {
        id: assetId,
        plane: "module",
        status: "reviewed",
        surfaces: [
            {
                surfaceId: `${assetId}.push.surface`,
                kind: "invoke",
                modulePath: `project/${className}`,
                ownerName: className,
                methodName: "push",
                invokeKind: "static",
                argCount: 1,
                confidence: "certain",
                provenance: { source: "manual" },
            },
            {
                surfaceId: `${assetId}.getParams.surface`,
                kind: "invoke",
                modulePath: `project/${className}`,
                ownerName: className,
                methodName: "getParams",
                invokeKind: "static",
                argCount: 0,
                confidence: "certain",
                provenance: { source: "manual" },
            },
        ],
        bindings: [
            {
                bindingId: `${assetId}.push.binding`,
                surfaceId: `${assetId}.push.surface`,
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
                    pushMethods: [{ methodName: "push", routeField: "url" }],
                    getMethods: ["getParams"],
                    routerClassNames: [className],
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

function writeRules(rulePath: string): void {
    writeText(
        rulePath,
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.project_router_wrapper",
            sources: [
                {
                    id: "source.fixture.project_router_wrapper",
                    sourceKind: "entry_param",
                    match: {
                        kind: "local_name_regex",
                        value: "^taint_src$",
                    },
                    target: "arg0",
                },
            ],
            sinks: [
                {
                    id: "sink.fixture.project_router_wrapper",
                    match: {
                        kind: "method_name_equals",
                        value: "Sink",
                    },
                    target: "arg0",
                },
            ],
            sanitizers: [],
            transfers: [],
        }),
    );
}

function writeProject(repoSourceDir: string, className: string): void {
    writeText(
        path.join(repoSourceDir, "pages", "SearchResult.ets"),
        [
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
            "function Sink(v: string): void {}",
            "",
            "export default class SearchResult extends UIAbility {",
            "  onCreate(taint_src: string): void {",
            "    const route = new RouteOptions();",
            "    route.url = 'pages/SearchResult';",
            "    route.params = taint_src;",
            `    ${className}.push(route);`,
            `    const params = ${className}.getParams();`,
            "    Sink(params);",
            "  }",
            "}",
            "",
        ].join("\n"),
    );
}

function runCase(rootLabel: string, projectId: string, className: string, assetClassName: string): AnalyzeSummary {
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_project_router_wrapper_asset", "fixtures", rootLabel, "repo");
    const modelRoot = resolveTestRunPath("diagnostics", "analyze_project_router_wrapper_asset", "fixtures", rootLabel, "model_root");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_project_router_wrapper_asset", "runs", rootLabel);
    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const rulePath = path.join(modelRoot, "project.rules.json");
    const modulePath = path.join(modelRoot, "project", projectId, "modules", "semanticflow.modules.json");

    writeProject(repoSourceDir, className);
    writeRules(rulePath);
    writeJson(modulePath, routeBridgeAsset(projectId, assetClassName));

    runAnalyzeCli([
        "--repo", repoRoot,
        "--sourceDir", "src/main/ets",
        "--project", rulePath,
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
    assert(positive.summary.totalFlows > 0, `expected scoped project router asset to recover a flow, got ${positive.summary.totalFlows}`);
    assert(
        positive.entries.some(entry => (entry.postsolveResults || []).some(result =>
            result.judgement.kind === "Confirmed" || result.judgement.kind === "Unresolved"
        )),
        "expected at least one surviving route-wrapper flow",
    );

    const negative = runCase("negative_scope", "router_wrapper_negative", "FakeRouter", "ProjectRouter");
    assert(negative.summary.totalFlows === 0, `out-of-scope FakeRouter should not be bridged, got ${negative.summary.totalFlows}`);

    console.log("PASS test_analyze_project_router_wrapper_asset");
    console.log(`positive_total_flows=${positive.summary.totalFlows}`);
    console.log(`negative_total_flows=${negative.summary.totalFlows}`);
}

main();
