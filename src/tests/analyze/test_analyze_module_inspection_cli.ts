import * as fs from "fs";
import * as path from "path";
import { runShell } from "../helpers/ProcessRunner";
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
    const inspectProjectDir = path.join(moduleRoot, "project", "inspect_demo");
    const traceProjectDir = path.join(moduleRoot, "project", "trace_demo");

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
            "export default class EntryAbility extends UIAbility {",
            "  onCreate(): void {",
            "    const value = Source();",
            "    Pass(value);",
            "  }",
            "}",
            "",
        ].join("\n"),
    );

    writeText(
        path.join(moduleRoot, "trace.rules.json"),
        JSON.stringify({
            schemaVersion: "2.0",
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
        }, null, 2),
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
            "  setup() {",
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

    const listProjectsCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repoRoot}"`,
        "--module-root", `"${moduleRoot}"`,
        "--enable-module-project", "trace_demo",
        "--list-module-projects",
    ].join(" ");
    const listProjectsResult = runShell(listProjectsCommand, { stdio: "pipe" });
    if (listProjectsResult.status !== 0) {
        throw new Error(`list-module-projects failed:\n${listProjectsResult.stdout}\n${listProjectsResult.stderr}`);
    }
    const listProjectsOutput = `${listProjectsResult.stdout}\n${listProjectsResult.stderr}`;
    assert(listProjectsOutput.includes("project=inspect_demo"), "list-module-projects should include inspect_demo");
    assert(listProjectsOutput.includes("project=trace_demo"), "list-module-projects should include trace_demo");
    assert(listProjectsOutput.includes("project=trace_demo\tenabled=true"), "trace_demo should be marked enabled");
    assert(listProjectsOutput.includes("project=inspect_demo\tenabled=false"), "inspect_demo should be marked disabled");

    const listModulesCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repoRoot}"`,
        "--module-root", `"${moduleRoot}"`,
        "--enable-module-project", "trace_demo",
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

    const explainCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repoRoot}"`,
        "--module-root", `"${moduleRoot}"`,
        "--enable-module-project", "trace_demo",
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
        "--module-root", `"${moduleRoot}"`,
        "--enable-module-project", "trace_demo",
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
    assert(traceOutput.includes("pass-observed"), "trace-module should include the pass-observed debug marker");

    console.log("PASS test_analyze_module_inspection_cli");
    console.log(`module_root=${moduleRoot}`);
    console.log(`trace_output_dir=${outputDir}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
