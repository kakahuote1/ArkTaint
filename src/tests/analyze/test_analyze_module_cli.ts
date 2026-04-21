import * as fs from "fs";
import * as path from "path";
import { runShell } from "../helpers/ProcessRunner";
import {
    getAnalyzeDiagnosticsJsonPath,
    getAnalyzeDiagnosticsTextPath,
    getAnalyzeRunJsonPath,
    getAnalyzeSummaryJsonPath,
} from "../helpers/AnalyzeCliRunner";
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
    const root = resolveTestRunDir("diagnostics", "analyze_module_cli");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_module_cli", "fixtures", "module_root");
    const brokenModuleRepo = path.resolve("tests/fixtures/engine_plugin_runtime/project");
    const brokenRulePath = path.join(moduleRoot, "broken_module.rules.json");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_module_cli", "runs", "healthy_module");
    const brokenOutputDir = resolveTestRunPath("diagnostics", "analyze_module_cli", "runs", "broken_module");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(moduleRoot, { recursive: true });

    const healthyModuleDir = path.join(moduleRoot, "project", "cli_demo", "modules");
    const brokenModuleDir = path.join(moduleRoot, "project", "cli_broken", "modules");
    const privateModuleDir = path.join(moduleRoot, "project", "cli_private_import", "modules");
    const privateSupportImport = path.relative(
        privateModuleDir,
        path.resolve("src/core/orchestration/modules/ModuleRuntime"),
    ).replace(/\\/g, "/");

    writeText(
        path.join(healthyModuleDir, "healthy.ts"),
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"fixture.cli_healthy_module\",",
            "  description: \"healthy module for CLI diagnostics\",",
            "});",
            "",
        ].join("\n"),
    );

    const brokenModuleFile = path.join(brokenModuleDir, "broken_setup.ts");
    writeText(
        brokenModuleFile,
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"fixture.cli_broken_module\",",
            "  description: \"broken module for CLI diagnostics\",",
            "  setup() {",
            "    throw new Error(\"broken-module-from-cli\");",
            "  },",
            "});",
            "",
        ].join("\n"),
    );
    const privateModuleFile = path.join(privateModuleDir, "private_import.ts");
    writeText(
        privateModuleFile,
        [
            `import { defineModule } from "@arktaint/module";`,
            `import { createModuleRuntime } from "./${privateSupportImport}";`,
            "",
            "void createModuleRuntime;",
            "",
            "export default defineModule({",
            "  id: \"fixture.cli_private_import_module\",",
            "  description: \"private-import module for CLI diagnostics\",",
            "});",
            "",
        ].join("\n"),
    );

    writeText(
        brokenRulePath,
        JSON.stringify({
            schemaVersion: "2.0",
            sources: [
                {
                    id: "source.fixture.cli",
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
                    id: "sink.fixture.cli",
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

    const healthyCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        "--model-root", `"${moduleRoot}"`,
        "--enable-model", "cli_demo:modules",
        "--disable-module", "harmony.router",
        "--outputDir", `"${outputDir}"`,
    ].join(" ");
    const result = runShell(healthyCommand, { stdio: "pipe" });
    if (result.status !== 0) {
        throw new Error(`analyze with modules failed:\n${result.stdout}\n${result.stderr}`);
    }

    const output = `${result.stdout}\n${result.stderr}`;
    assert(output.includes("entries=1"), "analyze output should include entries=1");
    assert(output.includes("summary_json="), "analyze output should include summary_json path");

    const brokenCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${brokenModuleRepo}"`,
        "--sourceDir", ".",
        "--model-root", `"${moduleRoot}"`,
        "--enable-model", "cli_broken:modules",
        "--project", `"${brokenRulePath}"`,
        "--no-incremental",
        "--outputDir", `"${brokenOutputDir}"`,
    ].join(" ");
    const brokenResult = runShell(brokenCommand, { stdio: "pipe" });
    if (brokenResult.status !== 0) {
        throw new Error(`analyze with broken module failed:\n${brokenResult.stdout}\n${brokenResult.stderr}`);
    }
    const brokenOutput = `${brokenResult.stdout}\n${brokenResult.stderr}`;
    assert(brokenOutput.includes("ArkTaint diagnostics"), "broken module analyze output should include a diagnostics section");
    assert(brokenOutput.includes("fixture.cli_broken_module"), "broken module diagnostics should identify the failing module");
    assert(brokenOutput.includes("broken_setup.ts:7:5"), "broken module diagnostics should point at the throw line");
    assert(brokenOutput.includes("MODULE_SETUP_THROW"), "broken module diagnostics should include a stable module error code");
    assert(brokenOutput.includes("~~~~"), "broken module diagnostics should render a code-frame squiggle");

    const brokenDiagnosticsTextPath = getAnalyzeDiagnosticsTextPath(brokenOutputDir);
    const brokenDiagnosticsJsonPath = getAnalyzeDiagnosticsJsonPath(brokenOutputDir);
    const brokenSummaryPath = getAnalyzeSummaryJsonPath(brokenOutputDir);
    const brokenRunJsonPath = getAnalyzeRunJsonPath(brokenOutputDir);
    assert(fs.existsSync(brokenDiagnosticsTextPath), "broken module diagnostics.txt should exist");
    assert(fs.existsSync(brokenSummaryPath), "broken module summary.json should exist");
    assert(fs.existsSync(brokenRunJsonPath), "broken module run.json should exist");

    const brokenDiagnosticsText = fs.readFileSync(brokenDiagnosticsTextPath, "utf-8");
    assert(brokenDiagnosticsText.includes("broken-module-from-cli"), "broken module diagnostics.txt should include the runtime error");
    assert(brokenDiagnosticsText.includes("MODULE_SETUP_THROW"), "broken module diagnostics.txt should include a stable code");

    const brokenDiagnosticsJson = JSON.parse(fs.readFileSync(brokenDiagnosticsJsonPath, "utf-8")) as {
        items?: Array<{ category?: string; code?: string }>;
    };
    assert(
        (brokenDiagnosticsJson.items || []).some(item => item.category === "Module" && item.code === "MODULE_SETUP_THROW"),
        "broken module diagnostics.json should expose normalized module diagnostic items",
    );

    const brokenSummary = JSON.parse(fs.readFileSync(brokenSummaryPath, "utf-8")) as {
        summary?: { diagnosticItems?: Array<{ category?: string; code?: string }> };
    };
    assert(
        (brokenSummary.summary?.diagnosticItems || []).some(item => item.category === "Module" && item.code === "MODULE_SETUP_THROW"),
        "broken module summary.json should expose normalized module diagnostic items",
    );
    assert(
        brokenOutput.includes("with_flows=1") || brokenOutput.includes("total_flows=1"),
        "broken module analyze should still continue and produce baseline flows",
    );

    const privateOutputDir = resolveTestRunPath("diagnostics", "analyze_module_cli", "runs", "private_import_module");
    const privateCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${brokenModuleRepo}"`,
        "--sourceDir", ".",
        "--model-root", `"${moduleRoot}"`,
        "--enable-model", "cli_private_import:modules",
        "--project", `"${brokenRulePath}"`,
        "--no-incremental",
        "--outputDir", `"${privateOutputDir}"`,
    ].join(" ");
    const privateResult = runShell(privateCommand, { stdio: "pipe" });
    if (privateResult.status !== 0) {
        throw new Error(`analyze with private-import module failed:\n${privateResult.stdout}\n${privateResult.stderr}`);
    }
    const privateOutput = `${privateResult.stdout}\n${privateResult.stderr}`;
    assert(privateOutput.includes("MODULE_PROJECT_PRIVATE_IMPORT"), "private-import diagnostics should include the stable author-contract code");
    assert(privateOutput.includes("private_import.ts:2:"), "private-import diagnostics should point at the import line");
    const privateDiagnosticsText = fs.readFileSync(getAnalyzeDiagnosticsTextPath(privateOutputDir), "utf-8");
    assert(privateDiagnosticsText.includes("private_import.ts"), "private-import diagnostics.txt should point at the rejected file");
    assert(privateDiagnosticsText.includes("ModuleRuntime"), "private-import diagnostics.txt should include the rejected private import target");
    assert(privateDiagnosticsText.includes("MODULE_PROJECT_PRIVATE_IMPORT"), "private-import diagnostics.txt should include the author-contract code");
    const privateDiagnosticsJson = JSON.parse(fs.readFileSync(getAnalyzeDiagnosticsJsonPath(privateOutputDir), "utf-8")) as {
        items?: Array<{ category?: string; code?: string }>;
    };
    assert(
        (privateDiagnosticsJson.items || []).some(item => item.category === "Module" && item.code === "MODULE_PROJECT_PRIVATE_IMPORT"),
        "private-import diagnostics.json should expose normalized module diagnostic items",
    );

    console.log("PASS test_analyze_module_cli");
    console.log(`model_root=${moduleRoot}`);
    console.log("disabled_modules=harmony.router");
    console.log(`broken_output_dir=${brokenOutputDir}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
