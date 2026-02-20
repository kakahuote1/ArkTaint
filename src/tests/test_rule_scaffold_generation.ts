import * as fs from "fs";
import * as path from "path";
import { generateProjectRuleScaffold } from "../cli/generate_project_rules";
import { validateRuleSet } from "../core/rules/RuleValidator";

async function main(): Promise<void> {
    const repo = path.resolve("tests/demo/rule_precision_transfer");
    const output = path.resolve("tmp/phase54c/project.rules.generated.json");

    const result = generateProjectRuleScaffold({
        repo,
        sourceDirs: ["."],
        output,
        maxEntries: 12,
        maxSinks: 16,
        maxTransfers: 20,
        entryHints: [],
        includePaths: [],
        excludePaths: [],
        enableCandidates: false,
    });

    if (!result.outputPath || !fs.existsSync(result.outputPath)) {
        throw new Error(`generated output file not found: ${result.outputPath || output}`);
    }
    const loaded = JSON.parse(fs.readFileSync(result.outputPath, "utf-8"));
    const validation = validateRuleSet(loaded);
    if (!validation.valid) {
        throw new Error(`generated rule set invalid: ${validation.errors.join("; ")}`);
    }

    const sourceCount = (loaded.sources || []).length;
    const sinkCount = (loaded.sinks || []).length;
    const transferCount = (loaded.transfers || []).length;
    console.log("====== Rule Scaffold Generation Test ======");
    console.log(`output=${result.outputPath}`);
    console.log(`sources=${sourceCount}`);
    console.log(`sinks=${sinkCount}`);
    console.log(`transfers=${transferCount}`);

    if (sourceCount <= 0) {
        throw new Error("expected generated sources > 0");
    }
    if (sinkCount <= 0) {
        throw new Error("expected generated sinks > 0");
    }
    if (transferCount <= 0) {
        throw new Error("expected generated transfers > 0");
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

