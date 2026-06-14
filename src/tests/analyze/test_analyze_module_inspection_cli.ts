import * as fs from "fs";
import * as path from "path";
import { runShell } from "../helpers/ProcessRunner";
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

async function main(): Promise<void> {
    const cli = path.resolve("out/cli/analyze.js");
    const root = resolveTestRunDir("diagnostics", "analyze_module_inspection_cli");
    const repoRoot = resolveTestRunPath("diagnostics", "analyze_module_inspection_cli", "fixtures", "repo");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_module_inspection_cli", "fixtures", "module_root");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_module_inspection_cli", "runs", "trace");
    fs.rmSync(root, { recursive: true, force: true });

    const repoSourceDir = path.join(repoRoot, "src", "main", "ets");
    const inspectProjectDir = path.join(moduleRoot, "project", "inspect_demo", "modules");
    const traceProjectDir = path.join(moduleRoot, "project", "trace_demo", "modules");
    const evalProjectDir = path.join(moduleRoot, "project", "eval_demo", "modules");
    const webDavEvalProjectDir = path.join(moduleRoot, "project", "webdav_eval", "modules");
    const webDavTraceOutputDir = resolveTestRunPath("diagnostics", "analyze_module_inspection_cli", "runs", "webdav_object_field_trace");

    writeText(
        path.join(repoSourceDir, "EntryAbility.ets"),
        [
            "import { UIAbility } from '@kit.AbilityKit';",
            "",
            "function Source(): string {",
            "  return \"taint\";",
            "}",
            "",
            "function Pass(v: string): void {",
            "  Sink(v);",
            "}",
            "",
            "function Sink(v: string): void {}",
            "",
            "class WebDavClient {",
            "  config: string = \"\";",
            "  authHeaders: string = \"\";",
            "  otherHeaders: string = \"\";",
            "",
            "  buildAuthHeaders(): string {",
            "    return this.config;",
            "  }",
            "",
            "  _request(): void {",
            "    const finalHeaders = this.authHeaders;",
            "    Sink(finalHeaders);",
            "  }",
            "",
            "  _requestOther(): void {",
            "    const finalHeaders = this.otherHeaders;",
            "    Sink(finalHeaders);",
            "  }",
            "}",
            "",
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(): void {",
            "    const value = Source();",
            "    Pass(value);",
            "    const client = new WebDavClient();",
            "    client.config = Source();",
            "    const generated = client.buildAuthHeaders();",
            "    const ignored = generated.length;",
            "    client._request();",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(moduleRoot, "trace.rules.json"),
        stringifyRuleAssetFixture({
            id: "asset.rule.fixture.trace",
            sources: [
                {
                    id: "source.fixture.trace",
                    sourceKind: "call_return",
                    match: {
                        kind: "method_name_equals",
                        value: "Source",
                    },
                    target: "result",
                },
            ],
            sinks: [
                {
                    id: "sink.fixture.trace",
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

    writeText(
        path.join(inspectProjectDir, "active.ts"),
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"fixture.inspect_active\",",
            "  description: \"active module for list/explain CLI\",",
            "});",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(inspectProjectDir, "disabled.ts"),
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"fixture.inspect_disabled\",",
            "  description: \"disabled module for list/explain CLI\",",
            "  enabled: false,",
            "});",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(traceProjectDir, "trace.ts"),
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"fixture.trace_module\",",
            "  description: \"trace module for CLI inspection\",",
            "  setup(ctx) {",
            "    ctx.debug.summary(\"setup-trace\", { scanned: 1 });",
            "    return {",
            "      onInvoke(event) {",
            "        if (!event.call.matchesMethod(\"Pass\")) return;",
            "        event.debug.hit(\"pass-observed\");",
            "        return event.emit.toNode(event.current.nodeId, \"Trace-Pass\");",
            "      },",
            "    };",
            "  },",
            "});",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(evalProjectDir, "semanticflow.modules.json"),
        JSON.stringify({
            id: "asset.project.eval_demo.object_field",
            plane: "module",
            status: "schema-valid",
            surfaces: [
                {
                    surfaceId: "surface.EvalCarrier.put",
                    kind: "invoke",
                    modulePath: "src/main/ets/EvalCarrier.ets",
                    ownerName: "EvalCarrier",
                    methodName: "put",
                    invokeKind: "instance",
                    argCount: 1,
                    confidence: "likely",
                    provenance: { source: "llm-proposal", location: { file: "src/main/ets/EvalCarrier.ets", line: 1 } },
                },
                {
                    surfaceId: "surface.EvalCarrier.get",
                    kind: "invoke",
                    modulePath: "src/main/ets/EvalCarrier.ets",
                    ownerName: "EvalCarrier",
                    methodName: "get",
                    invokeKind: "instance",
                    argCount: 0,
                    confidence: "likely",
                    provenance: { source: "llm-proposal", location: { file: "src/main/ets/EvalCarrier.ets", line: 2 } },
                },
            ],
            bindings: [
                {
                    bindingId: "binding.EvalCarrier.put",
                    surfaceId: "surface.EvalCarrier.put",
                    assetId: "asset.project.eval_demo.object_field",
                    plane: "module",
                    role: "handoff",
                    endpoint: { base: { kind: "arg", index: 0 } },
                    effectTemplateRefs: ["template.EvalCarrier.put"],
                    completeness: "partial",
                    confidence: "likely",
                },
                {
                    bindingId: "binding.EvalCarrier.get",
                    surfaceId: "surface.EvalCarrier.get",
                    assetId: "asset.project.eval_demo.object_field",
                    plane: "module",
                    role: "handoff",
                    endpoint: { base: { kind: "return" } },
                    effectTemplateRefs: ["template.EvalCarrier.get"],
                    completeness: "partial",
                    confidence: "likely",
                },
            ],
            effectTemplates: [
                {
                    id: "template.EvalCarrier.put",
                    kind: "handoff.put",
                    handle: {
                        cellKind: "object-field",
                        family: "project.eval_demo",
                        key: [{ kind: "const", value: "field" }],
                        precision: "exact",
                    },
                    value: { base: { kind: "arg", index: 0 } },
                    confidence: "likely",
                },
                {
                    id: "template.EvalCarrier.get",
                    kind: "handoff.get",
                    handle: {
                        cellKind: "object-field",
                        family: "project.eval_demo",
                        key: [{ kind: "const", value: "field" }],
                        precision: "exact",
                    },
                    target: { base: { kind: "return" } },
                    confidence: "likely",
                },
            ],
            relations: [],
            provenance: { source: "llm", evidenceLocations: [{ file: "src/main/ets/EvalCarrier.ets", line: 1 }] },
        }, null, 2),
    );

    writeText(
        path.join(webDavEvalProjectDir, "semanticflow.modules.json"),
        JSON.stringify({
            id: "asset.project.webdav_eval.authHeaders.objectField",
            plane: "module",
            status: "schema-valid",
            surfaces: [
                {
                    surfaceId: "surface.WebDavClient.buildAuthHeaders",
                    kind: "invoke",
                    modulePath: "src/main/ets/EntryAbility.ets",
                    ownerName: "WebDavClient",
                    methodName: "buildAuthHeaders",
                    invokeKind: "instance",
                    argCount: 0,
                    confidence: "likely",
                    provenance: { source: "llm-proposal", location: { file: "src/main/ets/EntryAbility.ets", line: 15 } },
                },
                {
                    surfaceId: "surface.WebDavClient._request",
                    kind: "invoke",
                    modulePath: "src/main/ets/EntryAbility.ets",
                    ownerName: "WebDavClient",
                    methodName: "_request",
                    invokeKind: "instance",
                    argCount: 0,
                    confidence: "likely",
                    provenance: { source: "llm-proposal", location: { file: "src/main/ets/EntryAbility.ets", line: 19 } },
                },
            ],
            bindings: [
                {
                    bindingId: "binding.WebDavClient.buildAuthHeaders.authHeaders.put",
                    surfaceId: "surface.WebDavClient.buildAuthHeaders",
                    assetId: "asset.project.webdav_eval.authHeaders.objectField",
                    plane: "module",
                    role: "handoff",
                    endpoint: { base: { kind: "return" } },
                    effectTemplateRefs: ["template.WebDavClient.buildAuthHeaders.authHeaders.put"],
                    semanticsFamily: "project.webdav_eval.object_field",
                    completeness: "partial",
                    confidence: "likely",
                },
                {
                    bindingId: "binding.WebDavClient._request.authHeaders.get",
                    surfaceId: "surface.WebDavClient._request",
                    assetId: "asset.project.webdav_eval.authHeaders.objectField",
                    plane: "module",
                    role: "handoff",
                    endpoint: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                    effectTemplateRefs: ["template.WebDavClient._request.authHeaders.get"],
                    semanticsFamily: "project.webdav_eval.object_field",
                    completeness: "partial",
                    confidence: "likely",
                },
            ],
            effectTemplates: [
                {
                    id: "template.WebDavClient.buildAuthHeaders.authHeaders.put",
                    kind: "handoff.put",
                    handle: {
                        cellKind: "object-field",
                        family: "project.webdav_eval",
                        key: [{ kind: "const", value: "authHeaders" }],
                        precision: "exact",
                    },
                    value: { base: { kind: "return" } },
                    confidence: "likely",
                },
                {
                    id: "template.WebDavClient._request.authHeaders.get",
                    kind: "handoff.get",
                    handle: {
                        cellKind: "object-field",
                        family: "project.webdav_eval",
                        key: [{ kind: "const", value: "authHeaders" }],
                        precision: "exact",
                    },
                    target: { base: { kind: "receiver" }, accessPath: ["authHeaders"] },
                    confidence: "likely",
                },
            ],
            relations: [],
            provenance: { source: "llm", evidenceLocations: [{ file: "src/main/ets/EntryAbility.ets", line: 15 }] },
        }, null, 2),
    );

    const listProjectsCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repoRoot}"`,
        "--model-root", `"${moduleRoot}"`,
        "--enable-model", "trace_demo:modules",
        "--list-models",
    ].join(" ");
    const listProjectsResult = runShell(listProjectsCommand, { stdio: "pipe" });
    if (listProjectsResult.status !== 0) {
        throw new Error(`list-models failed:\n${listProjectsResult.stdout}\n${listProjectsResult.stderr}`);
    }
    const listProjectsOutput = `${listProjectsResult.stdout}\n${listProjectsResult.stderr}`;
    assert(listProjectsOutput.includes("pack=inspect_demo"), "list-models should include inspect_demo");
    assert(listProjectsOutput.includes("pack=trace_demo"), "list-models should include trace_demo");
    assert(
        listProjectsOutput.includes("pack=trace_demo") && listProjectsOutput.includes("enabled=modules"),
        "trace_demo should be marked enabled for modules",
    );
    assert(
        listProjectsOutput.includes("pack=inspect_demo") && listProjectsOutput.includes("enabled=-"),
        "inspect_demo should be marked disabled",
    );

    const listModulesCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repoRoot}"`,
        "--model-root", `"${moduleRoot}"`,
        "--enable-model", "trace_demo:modules",
        "--list-modules",
    ].join(" ");
    const listModulesResult = runShell(listModulesCommand, { stdio: "pipe" });
    if (listModulesResult.status !== 0) {
        throw new Error(`list-modules failed:\n${listModulesResult.stdout}\n${listModulesResult.stderr}`);
    }
    const listModulesOutput = `${listModulesResult.stdout}\n${listModulesResult.stderr}`;
    assert(listModulesOutput.includes("module=fixture.inspect_active\tstatus=project_not_enabled"), "inspect active module should be marked project_not_enabled");
    assert(listModulesOutput.includes("module=fixture.inspect_disabled\tstatus=disabled_by_file"), "disabled module should be marked disabled_by_file");
    assert(listModulesOutput.includes("module=fixture.trace_module\tstatus=active"), "trace module should be active");

    const listEvaluationModulesCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repoRoot}"`,
        "--model-root", `"${moduleRoot}"`,
        "--semanticflow-evaluation-model-root", `"${moduleRoot}"`,
        "--enable-model", "eval_demo:modules",
        "--list-modules",
    ].join(" ");
    const listEvaluationModulesResult = runShell(listEvaluationModulesCommand, { stdio: "pipe" });
    if (listEvaluationModulesResult.status !== 0) {
        throw new Error(`list evaluation modules failed:\n${listEvaluationModulesResult.stdout}\n${listEvaluationModulesResult.stderr}`);
    }
    const listEvaluationModulesOutput = `${listEvaluationModulesResult.stdout}\n${listEvaluationModulesResult.stderr}`;
    assert(
        listEvaluationModulesOutput.includes("module=asset.project.eval_demo.object_field\tstatus=active"),
        "list-modules should honor semanticflow evaluation model roots for schema-valid generated modules",
    );

    const traceEvaluationObjectFieldCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repoRoot}"`,
        "--sourceDir", "src/main/ets",
        "--model-root", `"${moduleRoot}"`,
        "--semanticflow-evaluation-model-root", `"${moduleRoot}"`,
        "--enable-model", "webdav_eval:modules",
        "--project", `"${path.join(moduleRoot, "trace.rules.json")}"`,
        "--trace-module", "asset.project.webdav_eval.authHeaders.objectField",
        "--no-incremental",
        "--outputDir", `"${webDavTraceOutputDir}"`,
    ].join(" ");
    const traceEvaluationObjectFieldResult = runShell(traceEvaluationObjectFieldCommand, { stdio: "pipe" });
    if (traceEvaluationObjectFieldResult.status !== 0) {
        throw new Error(`trace evaluation object-field module failed:\n${traceEvaluationObjectFieldResult.stdout}\n${traceEvaluationObjectFieldResult.stderr}`);
    }
    const traceEvaluationObjectFieldOutput = `${traceEvaluationObjectFieldResult.stdout}\n${traceEvaluationObjectFieldResult.stderr}`;
    assert(traceEvaluationObjectFieldOutput.includes("module=asset.project.webdav_eval.authHeaders.objectField"), "object-field evaluation trace should print target module id");
    assert(traceEvaluationObjectFieldOutput.includes("loaded=true"), "object-field evaluation module should be loaded");
    const hookMatch = traceEvaluationObjectFieldOutput.match(/invoke_hook_calls=(\d+)/);
    const emissionMatch = traceEvaluationObjectFieldOutput.match(/total_emissions=(\d+)/);
    assert(hookMatch && Number(hookMatch[1]) > 0, `object-field evaluation module should receive invoke hooks:\n${traceEvaluationObjectFieldOutput}`);
    assert(emissionMatch && Number(emissionMatch[1]) > 0, `object-field evaluation module should emit handoff facts:\n${traceEvaluationObjectFieldOutput}`);

    const explainCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repoRoot}"`,
        "--model-root", `"${moduleRoot}"`,
        "--enable-model", "trace_demo:modules",
        "--explain-module", "fixture.inspect_disabled",
    ].join(" ");
    const explainResult = runShell(explainCommand, { stdio: "pipe" });
    if (explainResult.status !== 0) {
        throw new Error(`explain-module failed:\n${explainResult.stdout}\n${explainResult.stderr}`);
    }
    const explainOutput = `${explainResult.stdout}\n${explainResult.stderr}`;
    assert(explainOutput.includes("module=fixture.inspect_disabled"), "explain-module should include module id");
    assert(explainOutput.includes("status=disabled_by_file"), "explain-module should include disabled_by_file status");
    assert(explainOutput.includes("project=inspect_demo"), "explain-module should include project id");
    assert(explainOutput.includes("disabled.ts"), "explain-module should include source path");

    const traceCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repoRoot}"`,
        "--sourceDir", "src/main/ets",
        "--model-root", `"${moduleRoot}"`,
        "--enable-model", "trace_demo:modules",
        "--project", `"${path.join(moduleRoot, "trace.rules.json")}"`,
        "--trace-module", "fixture.trace_module",
        "--no-incremental",
        "--outputDir", `"${outputDir}"`,
    ].join(" ");
    const traceResult = runShell(traceCommand, { stdio: "pipe" });
    if (traceResult.status !== 0) {
        throw new Error(`trace-module analyze failed:\n${traceResult.stdout}\n${traceResult.stderr}`);
    }
    const traceOutput = `${traceResult.stdout}\n${traceResult.stderr}`;
    assert(traceOutput.includes("====== ArkTaint Module Trace ======"), "trace-module should print module trace header");
    assert(traceOutput.includes("module=fixture.trace_module"), "trace-module should print target module id");
    assert(traceOutput.includes("loaded=true"), "trace-module should show loaded=true");
    assert(traceOutput.includes("invoke_hook_calls="), "trace-module should show invoke hook calls");
    assert(traceOutput.includes("debug_hits="), "trace-module should show debug hits");
    assert(traceOutput.includes("recent_debug_messages="), "trace-module should include recent debug messages");
    assert(traceOutput.includes("setup-trace"), "trace-module should include setup debug summaries");
    assert(traceOutput.includes("pass-observed"), "trace-module should include the pass-observed debug marker");

    console.log("PASS test_analyze_module_inspection_cli");
    console.log(`module_root=${moduleRoot}`);
    console.log(`trace_output_dir=${outputDir}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
