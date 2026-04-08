import * as fs from "fs";
import * as path from "path";
import { runShell } from "../helpers/ProcessRunner";
import {
    getAnalyzeDiagnosticsJsonPath,
    getAnalyzeDiagnosticsTextPath,
    getAnalyzePluginAuditPath,
    getAnalyzeRunJsonPath,
    getAnalyzeSummaryJsonPath,
} from "../helpers/AnalyzeCliRunner";
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
    const root = resolveTestRunDir("diagnostics", "analyze_engine_plugin_cli");
    const brokenPluginDir = resolveTestRunPath("diagnostics", "analyze_engine_plugin_cli", "fixtures", "broken_plugin");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_engine_plugin_cli", "runs", "healthy_plugins");
    const disabledOutputDir = resolveTestRunPath("diagnostics", "analyze_engine_plugin_cli", "runs", "plugins_disabled");
    const brokenOutputDir = resolveTestRunPath("diagnostics", "analyze_engine_plugin_cli", "runs", "broken_plugin");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(brokenPluginDir, { recursive: true, force: true });
    fs.mkdirSync(brokenPluginDir, { recursive: true });
    const brokenPluginFile = path.join(brokenPluginDir, "broken_on_start.ts");
    fs.writeFileSync(
        brokenPluginFile,
        [
            `import { defineEnginePlugin } from "@arktaint/plugin";`,
            "",
            "export default defineEnginePlugin({",
            "  name: \"fixture.cli_broken_plugin\",",
            "  onStart() {",
            "    throw new Error(\"broken-start-from-cli\");",
            "  },",
            "});",
            "",
        ].join("\n"),
        "utf-8",
    );
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
    assert(output.includes("diagnostics_txt="), "analyze output should include diagnostics_txt path");
    assert(
        !output.includes("overrides builtin plugin"),
        "analyze CLI should not duplicate-load builtin plugins via explicit plugin objects",
    );

    const summaryPath = getAnalyzeSummaryJsonPath(outputDir);
    const diagnosticsPath = getAnalyzeDiagnosticsJsonPath(outputDir);
    const diagnosticsTextPath = getAnalyzeDiagnosticsTextPath(outputDir);
    const pluginAuditPath = getAnalyzePluginAuditPath(outputDir);
    const runJsonPath = getAnalyzeRunJsonPath(outputDir);
    assert(fs.existsSync(summaryPath), "summary.json should exist");
    assert(fs.existsSync(diagnosticsPath), "diagnostics.json should exist");
    assert(fs.existsSync(diagnosticsTextPath), "diagnostics.txt should exist");
    assert(fs.existsSync(pluginAuditPath), "plugin_audit.json should exist");
    assert(fs.existsSync(runJsonPath), "run.json should exist");

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
    const disabledSummaryPath = getAnalyzeSummaryJsonPath(disabledOutputDir);
    const disabledDiagnosticsPath = getAnalyzeDiagnosticsJsonPath(disabledOutputDir);
    const disabledDiagnosticsTextPath = getAnalyzeDiagnosticsTextPath(disabledOutputDir);
    const disabledPluginAuditPath = getAnalyzePluginAuditPath(disabledOutputDir);
    assert(fs.existsSync(disabledSummaryPath), "disabled summary.json should exist");
    assert(fs.existsSync(disabledDiagnosticsPath), "disabled diagnostics.json should exist");
    assert(fs.existsSync(disabledDiagnosticsTextPath), "disabled diagnostics.txt should exist");
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

    const brokenCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${repo}"`,
        "--sourceDir", ".",
        "--plugins", `"${pluginDir},${brokenPluginDir}"`,
        "--no-incremental",
        "--plugin-audit",
        "--outputDir", `"${brokenOutputDir}"`,
    ].join(" ");
    const brokenResult = runShell(brokenCommand, { stdio: "pipe" });
    if (brokenResult.status !== 0) {
        throw new Error(`analyze with broken engine plugin failed:\n${brokenResult.stdout}\n${brokenResult.stderr}`);
    }
    const brokenOutput = `${brokenResult.stdout}\n${brokenResult.stderr}`;
    assert(
        brokenOutput.includes("ArkTaint diagnostics"),
        "broken plugin analyze output should include a human-readable diagnostics section",
    );
    assert(
        brokenOutput.includes("fixture.cli_broken_plugin"),
        "broken plugin diagnostics should identify the failing plugin and phase",
    );
    assert(
        brokenOutput.includes("broken_on_start.ts:6:5"),
        "broken plugin diagnostics should point at the throw line instead of the closing brace",
    );
    assert(
        brokenOutput.includes("PLUGIN_ON_START_THROW"),
        "broken plugin diagnostics should include a stable error code",
    );
    assert(
        brokenOutput.includes("~~~~"),
        "broken plugin diagnostics should render a code-frame squiggle",
    );
    const brokenDiagnosticsTextPath = getAnalyzeDiagnosticsTextPath(brokenOutputDir);
    const brokenDiagnosticsJsonPath = getAnalyzeDiagnosticsJsonPath(brokenOutputDir);
    const brokenPluginAuditPath = getAnalyzePluginAuditPath(brokenOutputDir);
    const brokenSummaryPath = getAnalyzeSummaryJsonPath(brokenOutputDir);
    assert(fs.existsSync(brokenDiagnosticsTextPath), "broken plugin diagnostics.txt should exist");
    assert(fs.existsSync(brokenPluginAuditPath), "broken plugin audit should exist");
    assert(fs.existsSync(brokenSummaryPath), "broken plugin summary.json should exist");
    const brokenDiagnosticsText = fs.readFileSync(brokenDiagnosticsTextPath, "utf-8");
    assert(
        brokenDiagnosticsText.includes("broken-start-from-cli"),
        "broken plugin diagnostics.txt should include the runtime error message",
    );
    assert(
        brokenDiagnosticsText.includes("PLUGIN_ON_START_THROW"),
        "broken plugin diagnostics.txt should include a readable next-step suggestion",
    );
    const brokenDiagnosticsJson = JSON.parse(fs.readFileSync(brokenDiagnosticsJsonPath, "utf-8")) as {
        items?: Array<{ category?: string; code?: string }>;
    };
    assert(
        (brokenDiagnosticsJson.items || []).some(item => item.category === "Plugin" && item.code === "PLUGIN_ON_START_THROW"),
        "broken plugin diagnostics.json should expose normalized diagnostic items",
    );
    const brokenPluginAudit = JSON.parse(fs.readFileSync(brokenPluginAuditPath, "utf-8")) as {
        runtimeFailures?: Array<{ pluginName?: string; phase?: string }>;
        diagnosticItems?: Array<{ category?: string; code?: string }>;
    };
    assert(
        (brokenPluginAudit.runtimeFailures || []).some(item => item.pluginName === "fixture.cli_broken_plugin" && item.phase === "onStart"),
        "broken plugin audit should record the failing plugin runtime event",
    );
    assert(
        (brokenPluginAudit.diagnosticItems || []).some(item => item.category === "Plugin" && item.code === "PLUGIN_ON_START_THROW"),
        "broken plugin audit should expose normalized plugin diagnostic items",
    );
    const brokenSummary = JSON.parse(fs.readFileSync(brokenSummaryPath, "utf-8")) as {
        summary?: { diagnosticItems?: Array<{ category?: string; code?: string }> };
    };
    assert(
        (brokenSummary.summary?.diagnosticItems || []).some(item => item.category === "Plugin" && item.code === "PLUGIN_ON_START_THROW"),
        "broken plugin summary.json should expose normalized diagnostic items",
    );

    console.log("PASS test_analyze_engine_plugin_cli");
    console.log(`plugin_dir=${pluginDir}`);
    console.log(`output_dir=${outputDir}`);
    console.log(`disabled_output_dir=${disabledOutputDir}`);
    console.log(`broken_output_dir=${brokenOutputDir}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_engine_plugin_cli");
    console.error(error);
    process.exit(1);
});


