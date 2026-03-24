import * as path from "path";
import { runShell } from "./helpers/ProcessRunner";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const cli = path.resolve("out/cli/analyze.js");
    const packDir = path.resolve("tests/fixtures/semantic_pack_runtime/demo_pack");
    const outputDir = path.resolve("tmp/phase8/analyze_semantic_pack_cli");
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

    console.log("====== Analyze Semantic Pack CLI Test ======");
    console.log(`pack_dir=${packDir}`);
    console.log("disabled_packs=harmony.router");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
