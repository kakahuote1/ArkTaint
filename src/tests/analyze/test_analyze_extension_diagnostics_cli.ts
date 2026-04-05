import * as fs from "fs";
import * as path from "path";
import { runShell } from "../helpers/ProcessRunner";
import {
    getAnalyzeDiagnosticsJsonPath,
    getAnalyzeDiagnosticsTextPath,
} from "../helpers/AnalyzeCliRunner";
import { resolveTestRunDir, resolveTestRunPath } from "../helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function writeRuleFile(
    rulePath: string,
    payload: {
        sources: any[];
        sinks: any[];
        transfers?: any[];
        sanitizers?: any[];
    },
): void {
    fs.writeFileSync(
        rulePath,
        JSON.stringify({
            schemaVersion: "2.0",
            sources: payload.sources,
            sinks: payload.sinks,
            sanitizers: payload.sanitizers || [],
            transfers: payload.transfers || [],
        }, null, 2),
        "utf-8",
    );
}

function writeText(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

async function main(): Promise<void> {
    const cli = path.resolve("out/cli/analyze.js");
    const fixtureRepo = path.resolve("tests/fixtures/engine_plugin_runtime/project");
    const root = resolveTestRunDir("diagnostics", "analyze_extension_diagnostics_cli");
    const moduleRoot = resolveTestRunPath("diagnostics", "analyze_extension_diagnostics_cli", "fixtures", "module_root");
    const pluginDir = resolveTestRunPath("diagnostics", "analyze_extension_diagnostics_cli", "fixtures", "plugins");
    const privatePluginImportPath = path.relative(
        pluginDir,
        path.resolve("src/core/orchestration/plugins/EnginePluginRuntime"),
    ).replace(/\\/g, "/");
    const outputRoot = resolveTestRunPath("diagnostics", "analyze_extension_diagnostics_cli", "runs");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(moduleRoot, { recursive: true });
    fs.mkdirSync(pluginDir, { recursive: true });

    const noSeedModuleDir = path.join(moduleRoot, "project", "cli_broken_no_seed");
    const invalidEmissionModuleDir = path.join(moduleRoot, "project", "cli_invalid_emission");
    const noSeedModuleFile = path.join(noSeedModuleDir, "broken_setup_no_seed.ts");
    writeText(
        noSeedModuleFile,
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"fixture.cli_broken_module_no_seed\",",
            "  description: \"broken module that should still fail without seeds\",",
            "  setup() {",
            "    throw new Error(\"broken-module-no-seed\");",
            "  },",
            "});",
            "",
        ].join("\n"),
    );
    const noSeedRules = path.join(root, "no_seed.rules.json");
    writeRuleFile(noSeedRules, { sources: [], sinks: [] });
    const noSeedOutput = path.join(outputRoot, "no_seed_module");
    const noSeedCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${fixtureRepo}"`,
        "--sourceDir", ".",
        "--module-root", `"${moduleRoot}"`,
        "--enable-module-project", "cli_broken_no_seed",
        "--project", `"${noSeedRules}"`,
        "--no-incremental",
        "--outputDir", `"${noSeedOutput}"`,
    ].join(" ");
    const noSeedResult = runShell(noSeedCommand, { stdio: "pipe" });
    if (noSeedResult.status !== 0) {
        throw new Error(`no-seed module diagnostics run failed:\n${noSeedResult.stdout}\n${noSeedResult.stderr}`);
    }
    const noSeedOutputText = `${noSeedResult.stdout}\n${noSeedResult.stderr}`;
    assert(noSeedOutputText.includes("with_seeds=0"), "no-seed run should stay at zero seeds");
    assert(noSeedOutputText.includes("fixture.cli_broken_module_no_seed"), "no-seed run should still report the broken module");
    const noSeedDiagnosticsPath = getAnalyzeDiagnosticsTextPath(noSeedOutput);
    assert(fs.existsSync(noSeedDiagnosticsPath), "no-seed run should still emit diagnostics.txt");
    const noSeedDiagnostics = fs.readFileSync(noSeedDiagnosticsPath, "utf-8");
    assert(noSeedDiagnostics.includes("broken-module-no-seed"), "no-seed diagnostics should include module setup error");

    const invalidEmissionModuleFile = path.join(invalidEmissionModuleDir, "invalid_emission.ts");
    writeText(
        invalidEmissionModuleFile,
        [
            `import { defineModule } from "@arktaint/module";`,
            "",
            "export default defineModule({",
            "  id: \"fixture.cli_invalid_emission_module\",",
            "  description: \"module that returns an invalid emission\",",
            "  setup() {",
            "    return {",
            "      onFact() {",
            "        return [({} as any)];",
            "      },",
            "    };",
            "  },",
            "});",
            "",
        ].join("\n"),
    );
    const seededRules = path.join(root, "seeded.rules.json");
    writeRuleFile(seededRules, {
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
    });
    const invalidEmissionOutput = path.join(outputRoot, "invalid_emission_module");
    const invalidEmissionCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${fixtureRepo}"`,
        "--sourceDir", ".",
        "--module-root", `"${moduleRoot}"`,
        "--enable-module-project", "cli_invalid_emission",
        "--project", `"${seededRules}"`,
        "--disable-module", "fixture.cli_broken_module_no_seed",
        "--no-incremental",
        "--outputDir", `"${invalidEmissionOutput}"`,
    ].join(" ");
    const invalidEmissionResult = runShell(invalidEmissionCommand, { stdio: "pipe" });
    if (invalidEmissionResult.status !== 0) {
        throw new Error(`invalid-emission module diagnostics run failed:\n${invalidEmissionResult.stdout}\n${invalidEmissionResult.stderr}`);
    }
    const invalidEmissionDiagnosticsPath = getAnalyzeDiagnosticsTextPath(invalidEmissionOutput);
    const invalidEmissionDiagnosticsJsonPath = getAnalyzeDiagnosticsJsonPath(invalidEmissionOutput);
    const invalidEmissionDiagnostics = fs.readFileSync(invalidEmissionDiagnosticsPath, "utf-8");
    assert(
        invalidEmissionDiagnostics.includes("fixture.cli_invalid_emission_module"),
        "invalid emission diagnostics should identify the module",
    );
    assert(
        invalidEmissionDiagnostics.includes(path.basename(invalidEmissionModuleFile)),
        "invalid emission diagnostics should point back to the module file instead of runtime internals",
    );
    assert(
        !invalidEmissionDiagnostics.includes("ModuleRuntime.ts"),
        "invalid emission diagnostics should not blame the legacy runtime wrapper",
    );
    assert(
        invalidEmissionDiagnostics.includes("MODULE_ON_FACT_INVALID_EMISSION"),
        "invalid emission diagnostics should expose the invalid emission code",
    );
    const invalidEmissionDiagnosticsJson = JSON.parse(fs.readFileSync(invalidEmissionDiagnosticsJsonPath, "utf-8")) as {
        items?: Array<{ category?: string; code?: string }>;
    };
    assert(
        (invalidEmissionDiagnosticsJson.items || []).some(item => item.category === "Module" && item.code === "MODULE_ON_FACT_INVALID_EMISSION"),
        "invalid emission diagnostics.json should keep the normalized module error code",
    );

    const invalidMutationPluginFile = path.join(pluginDir, "invalid_mutation.plugin.ts");
    writeText(
        invalidMutationPluginFile,
        [
            `import { defineEnginePlugin } from "@arktaint/plugin";`,
            "",
            "export default defineEnginePlugin({",
            "  name: \"fixture.cli_invalid_mutation_plugin\",",
            "  onPropagation(api) {",
            "    api.addFlow({ nodeId: 1, reason: \"bad-plugin-flow\" });",
            "  },",
            "});",
            "",
        ].join("\n"),
    );
    const invalidMutationOutput = path.join(outputRoot, "invalid_mutation_plugin");
    const invalidMutationCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${fixtureRepo}"`,
        "--sourceDir", ".",
        "--plugins", `"${pluginDir}"`,
        "--project", `"${seededRules}"`,
        "--no-incremental",
        "--outputDir", `"${invalidMutationOutput}"`,
    ].join(" ");
    const invalidMutationResult = runShell(invalidMutationCommand, { stdio: "pipe" });
    if (invalidMutationResult.status !== 0) {
        throw new Error(`invalid-mutation plugin diagnostics run failed:\n${invalidMutationResult.stdout}\n${invalidMutationResult.stderr}`);
    }
    const invalidMutationDiagnosticsPath = getAnalyzeDiagnosticsTextPath(invalidMutationOutput);
    const invalidMutationDiagnostics = fs.readFileSync(invalidMutationDiagnosticsPath, "utf-8");
    assert(
        invalidMutationDiagnostics.includes("PLUGIN_ON_PROPAGATION_INVALID_MUTATION_CONTEXT"),
        "invalid mutation diagnostics should expose the specific plugin error code",
    );
    assert(
        invalidMutationDiagnostics.includes(path.basename(invalidMutationPluginFile)),
        "invalid mutation diagnostics should point at the plugin file",
    );
    assert(
        invalidMutationDiagnostics.includes("~~~~"),
        "invalid mutation diagnostics should render a code-frame squiggle",
    );
    assert(
        !invalidMutationDiagnostics.includes("EnginePluginRuntime.ts"),
        "invalid mutation diagnostics should not blame EnginePluginRuntime.ts",
    );

    const privateImportPluginFile = path.join(pluginDir, "private_import.plugin.ts");
    writeText(
        privateImportPluginFile,
        [
            `import { defineEnginePlugin } from "@arktaint/plugin";`,
            `import { createEnginePluginRuntime } from "${privatePluginImportPath}";`,
            "",
            "void createEnginePluginRuntime;",
            "",
            "export default defineEnginePlugin({",
            "  name: \"fixture.cli_private_import_plugin\",",
            "});",
            "",
        ].join("\n"),
    );
    const privateImportOutput = path.join(outputRoot, "private_import_plugin");
    const privateImportCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${fixtureRepo}"`,
        "--sourceDir", ".",
        "--plugins", `"${pluginDir}"`,
        "--project", `"${seededRules}"`,
        "--disable-plugins", "fixture.cli_invalid_mutation_plugin",
        "--no-incremental",
        "--outputDir", `"${privateImportOutput}"`,
    ].join(" ");
    const privateImportResult = runShell(privateImportCommand, { stdio: "pipe" });
    if (privateImportResult.status !== 0) {
        throw new Error(`private-import plugin diagnostics run failed:\n${privateImportResult.stdout}\n${privateImportResult.stderr}`);
    }
    const privateImportDiagnosticsPath = getAnalyzeDiagnosticsTextPath(privateImportOutput);
    const privateImportDiagnosticsJsonPath = getAnalyzeDiagnosticsJsonPath(privateImportOutput);
    const privateImportDiagnostics = fs.readFileSync(privateImportDiagnosticsPath, "utf-8");
    assert(
        privateImportDiagnostics.includes("PLUGIN_EXTERNAL_PRIVATE_IMPORT"),
        "private import diagnostics should expose the external private import error code",
    );
    assert(
        privateImportDiagnostics.includes(path.basename(privateImportPluginFile)),
        "private import diagnostics should point at the offending plugin file",
    );
    const privateImportDiagnosticsJson = JSON.parse(fs.readFileSync(privateImportDiagnosticsJsonPath, "utf-8")) as {
        items?: Array<{ category?: string; code?: string }>;
    };
    assert(
        (privateImportDiagnosticsJson.items || []).some(item => item.category === "Plugin" && item.code === "PLUGIN_EXTERNAL_PRIVATE_IMPORT"),
        "private import diagnostics.json should keep the normalized plugin private import code",
    );

    console.log("PASS test_analyze_extension_diagnostics_cli");
    console.log(`root=${root}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_extension_diagnostics_cli");
    console.error(error);
    process.exit(1);
});
