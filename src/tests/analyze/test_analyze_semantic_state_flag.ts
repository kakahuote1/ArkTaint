import * as assert from "assert";
import { parseArgs } from "../../cli/analyzeCliOptions";

function run(): void {
    const baseArgs = [
        "--repo", ".",
        "--sourceDir", ".",
        "--k", "1",
        "--maxEntries", "1",
        "--outputDir", "tmp/test_runs/analyze/semantic_state_flag",
    ];

    const onOptions = parseArgs([...baseArgs, "--semanticStateSolver", "on"]);
    assert.strictEqual(onOptions.semanticStateSolver, "on");

    const offOptions = parseArgs([...baseArgs, "--semantic-state-solver=off"]);
    assert.strictEqual(offOptions.semanticStateSolver, "off");

    assert.throws(() => parseArgs([...baseArgs, "--semanticStateSolver", "maybe"]), /invalid --semanticStateSolver/);
    assert.throws(() => parseArgs([...baseArgs, "--semantic-state-solver", "legacy"]), /invalid --semanticStateSolver/);

    console.log("test_analyze_semantic_state_flag=PASS");
}

if (require.main === module) {
    try {
        run();
    } catch (error) {
        console.error("test_analyze_semantic_state_flag=FAIL");
        console.error(error);
        process.exitCode = 1;
    }
}
