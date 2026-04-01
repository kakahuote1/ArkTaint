import * as fs from "fs";
import * as path from "path";
import { runShell } from "./helpers/ProcessRunner";
import {
    getAnalyzeDiagnosticsJsonPath,
    getAnalyzeDiagnosticsTextPath,
    getAnalyzeRunJsonPath,
    getAnalyzeSummaryJsonPath,
} from "./helpers/AnalyzeCliRunner";
import { resolveTestRunDir, resolveTestRunPath } from "./helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const cli = path.resolve("out/cli/analyze.js");
    const packDir = path.resolve("tests/fixtures/semantic_pack_runtime/demo_pack");
    const root = resolveTestRunDir("diagnostics", "analyze_semantic_pack_cli");
    const brokenPackDir = resolveTestRunPath("diagnostics", "analyze_semantic_pack_cli", "fixtures", "broken_pack");
    const brokenPackRepo = path.resolve("tests/fixtures/engine_plugin_runtime/project");
    const brokenPackRulePath = path.join(brokenPackDir, "broken_pack.rules.json");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_semantic_pack_cli", "runs", "healthy_pack");
    const brokenOutputDir = resolveTestRunPath("diagnostics", "analyze_semantic_pack_cli", "runs", "broken_pack");
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(brokenPackDir, { recursive: true, force: true });
    fs.mkdirSync(brokenPackDir, { recursive: true });
    const packImportPath = path.relative(
        brokenPackDir,
        path.resolve("src/core/kernel/contracts/SemanticPack"),
    ).replace(/\\/g, "/");
    const brokenPackFile = path.join(brokenPackDir, "broken_setup.pack.ts");
    fs.writeFileSync(
        brokenPackFile,
        [
            `import { defineSemanticPack } from "./${packImportPath}";`,
            "",
            "export default defineSemanticPack({",
            "  id: \"fixture.cli_broken_pack\",",
            "  description: \"broken semantic pack for CLI diagnostics\",",
            "  setup() {",
            "    throw new Error(\"broken-pack-from-cli\");",
            "  },",
            "});",
            "",
        ].join("\n"),
        "utf-8",
    );
    fs.writeFileSync(
        brokenPackRulePath,
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
        "utf-8",
    );
    const command = [
        process.execPath,
        `"${cli}"`,
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        "--packs", `"${packDir}"`,
        "--disable-packs", "harmony.router",
        "--outputDir", `"${outputDir}"`,
    ].join(" ");

    const result = runShell(command, { stdio: "pipe" });
    if (result.status !== 0) {
        throw new Error(`analyze with semantic packs failed:\n${result.stdout}\n${result.stderr}`);
    }

    const output = `${result.stdout}\n${result.stderr}`;
    assert(output.includes("entries=1"), "analyze output should include entries=1");
    assert(output.includes("summary_json="), "analyze output should include summary_json path");

    const brokenCommand = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${brokenPackRepo}"`,
        "--sourceDir", ".",
        "--packs", `"${brokenPackDir}"`,
        "--project", `"${brokenPackRulePath}"`,
        "--no-incremental",
        "--outputDir", `"${brokenOutputDir}"`,
    ].join(" ");
    const brokenResult = runShell(brokenCommand, { stdio: "pipe" });
    if (brokenResult.status !== 0) {
        throw new Error(`analyze with broken semantic pack failed:\n${brokenResult.stdout}\n${brokenResult.stderr}`);
    }
    const brokenOutput = `${brokenResult.stdout}\n${brokenResult.stderr}`;
    assert(
        brokenOutput.includes("ArkTaint diagnostics"),
        "broken semantic pack analyze output should include a human-readable diagnostics section",
    );
    assert(
        brokenOutput.includes("fixture.cli_broken_pack"),
        "broken semantic pack diagnostics should identify the failing pack and phase",
    );
    assert(
        brokenOutput.includes("broken_setup.pack.ts:7:5"),
        "broken semantic pack diagnostics should point at the throw line instead of the closing brace",
    );
    assert(
        brokenOutput.includes("PACK_SETUP_THROW"),
        "broken semantic pack diagnostics should include a stable error code",
    );
    assert(
        brokenOutput.includes("~~~~"),
        "broken semantic pack diagnostics should render a code-frame squiggle",
    );
    const brokenDiagnosticsTextPath = getAnalyzeDiagnosticsTextPath(brokenOutputDir);
    const brokenDiagnosticsJsonPath = getAnalyzeDiagnosticsJsonPath(brokenOutputDir);
    const brokenSummaryPath = getAnalyzeSummaryJsonPath(brokenOutputDir);
    const brokenRunJsonPath = getAnalyzeRunJsonPath(brokenOutputDir);
    assert(fs.existsSync(brokenDiagnosticsTextPath), "broken semantic pack diagnostics.txt should exist");
    assert(fs.existsSync(brokenSummaryPath), "broken semantic pack summary.json should exist");
    assert(fs.existsSync(brokenRunJsonPath), "broken semantic pack run.json should exist");
    const brokenDiagnosticsText = fs.readFileSync(brokenDiagnosticsTextPath, "utf-8");
    assert(
        brokenDiagnosticsText.includes("broken-pack-from-cli"),
        "broken semantic pack diagnostics.txt should include the runtime error message",
    );
    assert(
        brokenDiagnosticsText.includes("PACK_SETUP_THROW"),
        "broken semantic pack diagnostics.txt should include a readable next-step suggestion",
    );
    const brokenDiagnosticsJson = JSON.parse(fs.readFileSync(brokenDiagnosticsJsonPath, "utf-8")) as {
        items?: Array<{ category?: string; code?: string }>;
    };
    assert(
        (brokenDiagnosticsJson.items || []).some(item => item.category === "Pack" && item.code === "PACK_SETUP_THROW"),
        "broken semantic pack diagnostics.json should expose normalized diagnostic items",
    );
    const brokenSummary = JSON.parse(fs.readFileSync(brokenSummaryPath, "utf-8")) as {
        summary?: { diagnosticItems?: Array<{ category?: string; code?: string }> };
    };
    assert(
        (brokenSummary.summary?.diagnosticItems || []).some(item => item.category === "Pack" && item.code === "PACK_SETUP_THROW"),
        "broken semantic pack summary.json should expose normalized diagnostic items",
    );
    assert(
        brokenOutput.includes("with_flows=1") || brokenOutput.includes("total_flows=1"),
        "broken semantic pack analyze should still continue and produce baseline flows",
    );

    console.log("PASS test_analyze_semantic_pack_cli");
    console.log(`pack_dir=${packDir}`);
    console.log("disabled_packs=harmony.router");
    console.log(`broken_output_dir=${brokenOutputDir}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});


