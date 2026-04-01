import * as fs from "fs";
import * as path from "path";
import { runShell } from "./helpers/ProcessRunner";
import {
    getAnalyzeDiagnosticsJsonPath,
    getAnalyzeDiagnosticsTextPath,
    getAnalyzeRunJsonPath,
} from "./helpers/AnalyzeCliRunner";
import { resolveTestRunDir, resolveTestRunPath } from "./helpers/TestWorkspaceLayout";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const cli = path.resolve("out/cli/analyze.js");
    const root = resolveTestRunDir("diagnostics", "analyze_top_level_diagnostics_cli");
    const missingRepo = resolveTestRunPath("diagnostics", "analyze_top_level_diagnostics_cli", "fixtures", "missing_repo");
    const outputDir = resolveTestRunPath("diagnostics", "analyze_top_level_diagnostics_cli", "runs", "top_level_failure");
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(missingRepo), { recursive: true });

    const command = [
        process.execPath,
        `"${cli}"`,
        "--repo", `"${missingRepo}"`,
        "--sourceDir", ".",
        "--no-incremental",
        "--outputDir", `"${outputDir}"`,
    ].join(" ");

    const result = runShell(command, { stdio: "pipe" });
    assert(result.status !== 0, "missing repo run should fail");

    const output = `${result.stdout}\n${result.stderr}`;
    assert(output.includes("SYSTEM_ANALYZE_THROW"), "top-level failure should emit a stable system diagnostic code");

    const diagnosticsTextPath = getAnalyzeDiagnosticsTextPath(outputDir);
    const diagnosticsJsonPath = getAnalyzeDiagnosticsJsonPath(outputDir);
    const runJsonPath = getAnalyzeRunJsonPath(outputDir);
    assert(fs.existsSync(diagnosticsTextPath), "top-level failure should still emit diagnostics.txt");
    assert(fs.existsSync(diagnosticsJsonPath), "top-level failure should still emit diagnostics.json");
    assert(fs.existsSync(runJsonPath), "top-level failure should still emit run.json");

    const diagnosticsText = fs.readFileSync(diagnosticsTextPath, "utf-8");
    assert(diagnosticsText.includes("SYSTEM_ANALYZE_THROW"), "top-level diagnostics text should include the system code");

    const diagnosticsJson = JSON.parse(fs.readFileSync(diagnosticsJsonPath, "utf-8")) as {
        items?: Array<{ category?: string; code?: string }>;
        rawDiagnostics?: { systemFailures?: Array<{ code?: string }> };
    };
    assert(
        (diagnosticsJson.items || []).some(item => item.category === "System" && item.code === "SYSTEM_ANALYZE_THROW"),
        "top-level diagnostics json should expose normalized system items",
    );
    assert(
        (diagnosticsJson.rawDiagnostics?.systemFailures || []).some(item => item.code === "SYSTEM_ANALYZE_THROW"),
        "top-level diagnostics json should preserve raw system failures",
    );

    console.log("PASS test_analyze_top_level_diagnostics_cli");
}

main().catch((error) => {
    console.error("FAIL test_analyze_top_level_diagnostics_cli");
    console.error(error);
    process.exit(1);
});



