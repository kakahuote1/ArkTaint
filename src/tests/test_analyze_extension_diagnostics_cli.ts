import * as fs from "fs";
import * as path from "path";
import { runShell } from "./helpers/ProcessRunner";
import {
    getAnalyzeDiagnosticsJsonPath,
    getAnalyzeDiagnosticsTextPath,
} from "./helpers/AnalyzeCliRunner";
import { resolveTestRunDir, resolveTestRunPath } from "./helpers/TestWorkspaceLayout";

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

async function main(): Promise<void> {
    const cli = path.resolve("out/cli/analyze.js");
    const fixtureRepo = path.resolve("tests/fixtures/engine_plugin_runtime/project");
    const root = resolveTestRunDir("diagnostics", "analyze_extension_diagnostics_cli");
    const packDir = resolveTestRunPath("diagnostics", "analyze_extension_diagnostics_cli", "fixtures", "packs");
    const pluginDir = resolveTestRunPath("diagnostics", "analyze_extension_diagnostics_cli", "fixtures", "plugins");
    const outputRoot = resolveTestRunPath("diagnostics", "analyze_extension_diagnostics_cli", "runs");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(packDir, { recursive: true });
    fs.mkdirSync(pluginDir, { recursive: true });

    const semanticPackImportPath = path.relative(
        packDir,
        path.resolve("src/core/kernel/contracts/SemanticPack"),
    ).replace(/\\/g, "/");
    const pluginImportPath = path.relative(
        pluginDir,
        path.resolve("src/core/orchestration/plugins/EnginePlugin"),
    ).replace(/\\/g, "/");

    const noSeedPackFile = path.join(packDir, "broken_setup_no_seed.pack.ts");
    fs.writeFileSync(
        noSeedPackFile,
        [
            `import { defineSemanticPack } from "./${semanticPackImportPath}";`,
            "",
            "export default defineSemanticPack({",
            "  id: \"fixture.cli_broken_pack_no_seed\",",
            "  description: \"broken semantic pack that should still fail without seeds\",",
            "  setup() {",
            "    throw new Error(\"broken-pack-no-seed\");",
            "  },",
            "});",
            "",
        ].join("\n"),
        "utf-8",
    );
    const noSeedRules = path.join(root, "no_seed.rules.json");
    writeRuleFile(noSeedRules, { sources: [], sinks: [] });
    const noSeedOutput = path.join(outputRoot, "no_seed_pack");
    const noSeedCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${fixtureRepo}"`,
        "--sourceDir", ".",
        "--packs", `"${packDir}"`,
        "--project", `"${noSeedRules}"`,
        "--no-incremental",
        "--outputDir", `"${noSeedOutput}"`,
    ].join(" ");
    const noSeedResult = runShell(noSeedCommand, { stdio: "pipe" });
    if (noSeedResult.status !== 0) {
        throw new Error(`no-seed semantic pack diagnostics run failed:\n${noSeedResult.stdout}\n${noSeedResult.stderr}`);
    }
    const noSeedOutputText = `${noSeedResult.stdout}\n${noSeedResult.stderr}`;
    assert(noSeedOutputText.includes("with_seeds=0"), "no-seed run should stay at zero seeds");
    assert(noSeedOutputText.includes("fixture.cli_broken_pack_no_seed"), "no-seed run should still report the broken pack");
    const noSeedDiagnosticsPath = getAnalyzeDiagnosticsTextPath(noSeedOutput);
    assert(fs.existsSync(noSeedDiagnosticsPath), "no-seed run should still emit diagnostics.txt");
    const noSeedDiagnostics = fs.readFileSync(noSeedDiagnosticsPath, "utf-8");
    assert(noSeedDiagnostics.includes("broken-pack-no-seed"), "no-seed diagnostics should include pack setup error");

    const invalidEmissionPackFile = path.join(packDir, "invalid_emission.pack.ts");
    fs.writeFileSync(
        invalidEmissionPackFile,
        [
            `import { defineSemanticPack } from "./${semanticPackImportPath}";`,
            "",
            "export default defineSemanticPack({",
            "  id: \"fixture.cli_invalid_emission_pack\",",
            "  description: \"pack that returns an invalid emission\",",
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
        "utf-8",
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
    const invalidEmissionOutput = path.join(outputRoot, "invalid_emission_pack");
    const invalidEmissionCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${fixtureRepo}"`,
        "--sourceDir", ".",
        "--packs", `"${packDir}"`,
        "--project", `"${seededRules}"`,
        "--disable-packs", "fixture.cli_broken_pack_no_seed",
        "--no-incremental",
        "--outputDir", `"${invalidEmissionOutput}"`,
    ].join(" ");
    const invalidEmissionResult = runShell(invalidEmissionCommand, { stdio: "pipe" });
    if (invalidEmissionResult.status !== 0) {
        throw new Error(`invalid-emission semantic pack diagnostics run failed:\n${invalidEmissionResult.stdout}\n${invalidEmissionResult.stderr}`);
    }
    const invalidEmissionDiagnosticsPath = getAnalyzeDiagnosticsTextPath(invalidEmissionOutput);
    const invalidEmissionDiagnosticsJsonPath = getAnalyzeDiagnosticsJsonPath(invalidEmissionOutput);
    const invalidEmissionDiagnostics = fs.readFileSync(invalidEmissionDiagnosticsPath, "utf-8");
    assert(
        invalidEmissionDiagnostics.includes("fixture.cli_invalid_emission_pack"),
        "invalid emission diagnostics should identify the pack",
    );
    assert(
        invalidEmissionDiagnostics.includes(path.basename(invalidEmissionPackFile)),
        "invalid emission diagnostics should point back to the pack file instead of runtime internals",
    );
    assert(
        !invalidEmissionDiagnostics.includes("src/core/orchestration/packs/PackRuntime.ts"),
        "invalid emission diagnostics should not blame PackRuntime.ts",
    );
    assert(
        invalidEmissionDiagnostics.includes("PACK_ON_FACT_INVALID_EMISSION"),
        "invalid emission diagnostics should explain why there is no code frame",
    );
    const invalidEmissionDiagnosticsJson = JSON.parse(fs.readFileSync(invalidEmissionDiagnosticsJsonPath, "utf-8")) as {
        items?: Array<{ category?: string; code?: string }>;
    };
    assert(
        (invalidEmissionDiagnosticsJson.items || []).some(item => item.category === "Pack" && item.code === "PACK_ON_FACT_INVALID_EMISSION"),
        "invalid emission diagnostics.json should keep the normalized pack error code",
    );

    const invalidMutationPluginFile = path.join(pluginDir, "invalid_mutation.plugin.ts");
    fs.writeFileSync(
        invalidMutationPluginFile,
        [
            `import { defineEnginePlugin } from "./${pluginImportPath}";`,
            "",
            "export default defineEnginePlugin({",
            "  name: \"fixture.cli_invalid_mutation_plugin\",",
            "  onPropagation(api) {",
            "    api.addFlow({ nodeId: 1, reason: \"bad-plugin-flow\" });",
            "  },",
            "});",
            "",
        ].join("\n"),
        "utf-8",
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

    console.log("PASS test_analyze_extension_diagnostics_cli");
    console.log(`root=${root}`);
}

main().catch((error) => {
    console.error("FAIL test_analyze_extension_diagnostics_cli");
    console.error(error);
    process.exit(1);
});


