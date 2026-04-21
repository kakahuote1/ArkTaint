import * as path from "path";
import { runShell } from "../helpers/ProcessRunner";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const cli = path.resolve("out/cli/analyze.js");
    const repo = path.resolve("tests/fixtures/engine_plugin_runtime/project");
    const pluginDir = path.resolve("tests/fixtures/engine_plugin_runtime/external_plugins");
    const root = resolveTestRunDir("diagnostics", "analyze_plugin_inspection_cli");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_plugin_inspection_cli", "runs", "trace");

    const listCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repo}"`,
        "--plugins", `"${pluginDir}"`,
        "--list-plugins",
    ].join(" ");
    const listResult = runShell(listCommand, { stdio: "pipe" });
    if (listResult.status !== 0) {
        throw new Error(`list-plugins failed:\n${listResult.stdout}\n${listResult.stderr}`);
    }
    const listOutput = `${listResult.stdout}\n${listResult.stderr}`;
    assert(
        listOutput.includes("plugin=fixture.entry_and_rules\tstatus=active"),
        "list-plugins should include the active external plugin",
    );
    assert(
        listOutput.includes("plugin=fixture.disabled_file\tstatus=disabled_by_file"),
        "list-plugins should include disabled-by-file plugin entries",
    );
    assert(
        listOutput.includes("plugin=fixture.disabled_inline\tstatus=disabled_by_file"),
        "list-plugins should include inline disabled plugin entries",
    );

    const explainCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repo}"`,
        "--plugins", `"${pluginDir}"`,
        "--explain-plugin", "fixture.entry_and_rules",
    ].join(" ");
    const explainResult = runShell(explainCommand, { stdio: "pipe" });
    if (explainResult.status !== 0) {
        throw new Error(`explain-plugin failed:\n${explainResult.stdout}\n${explainResult.stderr}`);
    }
    const explainOutput = `${explainResult.stdout}\n${explainResult.stderr}`;
    assert(explainOutput.includes("plugin=fixture.entry_and_rules"), "explain-plugin should include plugin name");
    assert(explainOutput.includes("status=active"), "explain-plugin should include active status");
    assert(explainOutput.includes("source=external"), "explain-plugin should describe plugin source");
    assert(explainOutput.includes("add_entry_and_rules.ts"), "explain-plugin should include source path");

    const traceCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repo}"`,
        "--sourceDir", ".",
        "--plugins", `"${pluginDir}"`,
        "--no-incremental",
        "--outputDir", `"${outputDir}"`,
        "--trace-plugin", "fixture.entry_and_rules",
    ].join(" ");
    const traceResult = runShell(traceCommand, { stdio: "pipe" });
    if (traceResult.status !== 0) {
        throw new Error(`trace-plugin analyze failed:\n${traceResult.stdout}\n${traceResult.stderr}`);
    }
    const traceOutput = `${traceResult.stdout}\n${traceResult.stderr}`;
    assert(traceOutput.includes("====== ArkTaint Plugin Trace ======"), "trace-plugin should print trace header");
    assert(traceOutput.includes("plugin=fixture.entry_and_rules"), "trace-plugin should print plugin name");
    assert(traceOutput.includes("loaded=true"), "trace-plugin should show loaded=true");
    assert(traceOutput.includes("start_hook_calls="), "trace-plugin should show start hook calls");
    assert(traceOutput.includes("entry_hook_calls="), "trace-plugin should show entry hook calls");
    assert(traceOutput.includes("source_rules_added="), "trace-plugin should show source rule additions");
    assert(traceOutput.includes("sink_rules_added="), "trace-plugin should show sink rule additions");

    console.log("PASS test_analyze_plugin_inspection_cli");
    console.log(`plugin_dir=${pluginDir}`);
    console.log(`output_dir=${outputDir}`);
    console.log(`root=${root}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_plugin_inspection_cli");
    console.error(error);
    process.exit(1);
});
