import * as path from "path";
import { runShell } from "./helpers/ProcessRunner";
import { resolveTestRunDir } from "./helpers/TestWorkspaceLayout";

function runAnalyzeWithFlag(flag: string, value: string): { status: number | null; output: string } {
    const cli = path.resolve("out/cli/analyze.js");
    const command = [
        process.execPath,
        `"${cli}"`,
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        flag, value,
        "--outputDir", resolveTestRunDir("analyze", "invalid_flags"),
    ].join(" ");
    const result = runShell(command, { stdio: "pipe" });
    return {
        status: result.status,
        output: `${result.stdout}\n${result.stderr}`.trim(),
    };
}

function assertUnknown(flag: string): void {
    const result = runAnalyzeWithFlag(flag, "probe");
    if (result.status === 0) {
        throw new Error(`expected ${flag} to be rejected by analyze CLI`);
    }
    if (!result.output.includes(`unknown option: ${flag}`)) {
        throw new Error(`expected unknown option message for ${flag}, got: ${result.output}`);
    }
}

async function main(): Promise<void> {
    assertUnknown("--entryHint");
    assertUnknown("--include");
    assertUnknown("--exclude");
    assertUnknown("--crossFunctionFallback");
    assertUnknown("--providers-dir");
    assertUnknown("--disable-builtin-providers");
    assertUnknown("--disable-builtin-packs");

    console.log("====== Analyze Invalid Flags Test ======");
    console.log("rejected_flags=7");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
