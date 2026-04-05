import * as fs from "fs";
import * as path from "path";
import { buildSmokeRuleConfig, loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule, TaintRuleSet } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function walkRuleFiles(dirPath: string, out: string[] = []): string[] {
    if (!fs.existsSync(dirPath)) {
        return out;
    }
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.resolve(dirPath, entry.name);
        if (entry.isDirectory()) {
            walkRuleFiles(fullPath, out);
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".rules.json")) {
            out.push(fullPath);
        }
    }
    return out;
}

function readKernelSinkRules(): SinkRule[] {
    const files = walkRuleFiles(path.resolve("src/rules/sinks/kernel")).sort((a, b) => a.localeCompare(b));
    return files.flatMap(filePath => {
        const ruleSet = JSON.parse(fs.readFileSync(filePath, "utf-8")) as TaintRuleSet;
        return ruleSet.sinks || [];
    });
}

function isSweepRule(rule: SinkRule): boolean {
    return rule.match.kind === "signature_contains"
        && !rule.target
        && (
            String(rule.id || "").startsWith("sink.sig.")
            || String(rule.id || "").startsWith("sink.keyword.")
        );
}

function sortStrings(values: string[]): string[] {
    return [...values].sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
    const rawKernelSinks = readKernelSinkRules();
    const expectedKeywords = sortStrings(
        [...new Set(
            rawKernelSinks
                .filter(rule => isSweepRule(rule) && String(rule.id || "").startsWith("sink.keyword."))
                .map(rule => rule.match.value)
        )]
    );
    const expectedSignatures = sortStrings(
        [...new Set(
            rawKernelSinks
                .filter(rule => isSweepRule(rule) && String(rule.id || "").startsWith("sink.sig."))
                .map(rule => rule.match.value)
        )]
    );

    assert(expectedKeywords.length > 0, "expected kernel sink sweep keyword inventory");
    assert(expectedSignatures.length > 0, "expected kernel sink sweep signature inventory");

    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/rules"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });

    const activeSinks = loaded.ruleSet.sinks || [];
    const activeSweepRules = activeSinks.filter(isSweepRule);
    assert(activeSweepRules.length === 0, `active sink inventory should exclude fallback sweep rules: ${activeSweepRules.map(rule => rule.id).join(", ")}`);
    assert(
        !activeSinks.some(rule => String(rule.id || "").startsWith("sink.sig.")),
        "active sink inventory should not contain signature sweep sinks",
    );
    assert(
        !activeSinks.some(rule => String(rule.id || "").startsWith("sink.keyword.")),
        "active sink inventory should not contain keyword sweep sinks",
    );

    const smokeConfig = buildSmokeRuleConfig(loaded);
    assert(
        JSON.stringify(sortStrings(smokeConfig.sinkKeywords)) === JSON.stringify(expectedKeywords),
        "smoke sink keyword sweep should come from dedicated sweep inventory",
    );
    assert(
        JSON.stringify(sortStrings(smokeConfig.sinkSignatures)) === JSON.stringify(expectedSignatures),
        "smoke sink signature sweep should come from dedicated sweep inventory",
    );

    console.log("====== Sink Inventory Boundary ======");
    console.log(`active_sink_rules=${activeSinks.length}`);
    console.log(`active_sweep_rules=${activeSweepRules.length}`);
    console.log(`smoke_keywords=${smokeConfig.sinkKeywords.length}`);
    console.log(`smoke_signatures=${smokeConfig.sinkSignatures.length}`);
    console.log("PASS test_sink_inventory_boundary");
}

main().catch(error => {
    console.error("FAIL test_sink_inventory_boundary");
    console.error(error);
    process.exit(1);
});
