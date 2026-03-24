import * as fs from "fs";
import * as path from "path";
import { runShell } from "./helpers/ProcessRunner";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const cli = path.resolve("out/cli/analyze.js");
    const repo = path.resolve("tests/fixtures/engine_plugin_runtime/project");
    const pluginDir = path.resolve("tests/fixtures/engine_plugin_runtime/external_plugins");
    const outputDir = path.resolve("tmp/phase85/analyze_engine_plugin_cli");
    const disabledOutputDir = path.resolve("tmp/phase85/analyze_engine_plugin_cli_disabled");
    const command = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repo}"`,
        "--sourceDir", ".",
        "--plugins", `"${pluginDir}"`,
        "--no-incremental",
        "--plugin-audit",
        "--outputDir", `"${outputDir}"`,
    ].join(" ");

    const result = runShell(command, { stdio: "pipe" });
    if (result.status !== 0) {
        throw new Error(`analyze with engine plugins failed:\n${result.stdout}\n${result.stderr}`);
    }

    const output = `${result.stdout}\n${result.stderr}`;
    assert(output.includes("entries=1"), "analyze output should include entries=1");
    assert(output.includes("summary_json="), "analyze output should include summary_json path");

    const summaryPath = path.resolve(outputDir, "summary.json");
    const pluginAuditPath = path.resolve(outputDir, "plugin_audit.json");
    assert(fs.existsSync(summaryPath), "summary.json should exist");
    assert(fs.existsSync(pluginAuditPath), "plugin_audit.json should exist");

    const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8")) as {
        summary?: { totalFlows?: number };
    };
    const pluginAudit = JSON.parse(fs.readFileSync(pluginAuditPath, "utf-8")) as {
        loadedPlugins?: string[];
    };
    assert((summary.summary?.totalFlows || 0) > 0, "engine plugin CLI run should produce flows");
    assert(
        (pluginAudit.loadedPlugins || []).includes("fixture.entry_and_rules"),
        "plugin audit should include loaded plugin name",
    );

    const disabledCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repo}"`,
        "--sourceDir", ".",
        "--plugins", `"${pluginDir}"`,
        "--disable-plugins", "fixture.entry_and_rules",
        "--no-incremental",
        "--plugin-audit",
        "--outputDir", `"${disabledOutputDir}"`,
    ].join(" ");
    const disabledResult = runShell(disabledCommand, { stdio: "pipe" });
    if (disabledResult.status !== 0) {
        throw new Error(`analyze with disabled engine plugins failed:\n${disabledResult.stdout}\n${disabledResult.stderr}`);
    }
    const disabledSummaryPath = path.resolve(disabledOutputDir, "summary.json");
    const disabledPluginAuditPath = path.resolve(disabledOutputDir, "plugin_audit.json");
    assert(fs.existsSync(disabledSummaryPath), "disabled summary.json should exist");
    assert(fs.existsSync(disabledPluginAuditPath), "disabled plugin_audit.json should exist");
    const disabledSummary = JSON.parse(fs.readFileSync(disabledSummaryPath, "utf-8")) as {
        summary?: { ruleHits?: { source?: Record<string, number>; sink?: Record<string, number> } };
    };
    const disabledPluginAudit = JSON.parse(fs.readFileSync(disabledPluginAuditPath, "utf-8")) as {
        loadedPlugins?: string[];
    };
    assert(
        !(disabledPluginAudit.loadedPlugins || []).includes("fixture.entry_and_rules"),
        "disable-plugins should suppress the targeted external plugin",
    );
    assert(
        !("source.fixture.plugin.source" in (disabledSummary.summary?.ruleHits?.source || {})),
        "disabling the fixture plugin should prevent its source rule from taking effect",
    );
    assert(
        !("sink.fixture.plugin.sink" in (disabledSummary.summary?.ruleHits?.sink || {})),
        "disabling the fixture plugin should prevent its sink rule from taking effect",
    );

    console.log("PASS test_analyze_engine_plugin_cli");
    console.log(`plugin_dir=${pluginDir}`);
    console.log(`output_dir=${outputDir}`);
    console.log(`disabled_output_dir=${disabledOutputDir}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_engine_plugin_cli");
    console.error(error);
    process.exit(1);
});
