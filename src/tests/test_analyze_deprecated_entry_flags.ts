import * as path from "path";
import { runShell } from "./helpers/ProcessRunner";

function runAnalyzeWithFlag(flag: string, value: string): { status: number | null; output: string } {
    const cli = path.resolve("out/cli/analyze.js");
    const command = [
        process.execPath,
        `"${cli}"`,
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        flag, value,
        "--outputDir", "tmp/phase711/deprecated_flags_probe",
    ].join(" ");
    const result = runShell(command, { stdio: "pipe" });
    return {
        status: result.status,
        output: `${result.stdout}\n${result.stderr}`.trim(),
    };
}

function assertDeprecated(flag: string): void {
    const probeValue = flag === "--entryHint" ? "onClick" : "Login";
    const result = runAnalyzeWithFlag(flag, probeValue);
    if (result.status === 0) {
        throw new Error(`expected ${flag} to be rejected by analyze CLI`);
    }
    if (!result.output.includes(`deprecated ${flag}`)) {
        throw new Error(`expected deprecated message for ${flag}, got: ${result.output}`);
    }
}

async function main(): Promise<void> {
    assertDeprecated("--entryHint");
    assertDeprecated("--include");
    assertDeprecated("--exclude");

    console.log("====== Analyze Deprecated Entry Flags Test ======");
    console.log("rejected_flags=3");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
