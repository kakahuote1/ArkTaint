import * as fs from "fs";
import * as path from "path";
import { AssetDocumentBase } from "../../core/assets/schema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule } from "../../core/rules/RuleSchema";

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
    const files = walkRuleFiles(path.resolve("src/models/kernel/rules/sinks")).sort((a, b) => a.localeCompare(b));
    return files.flatMap(filePath => {
        const asset = JSON.parse(fs.readFileSync(filePath, "utf-8")) as AssetDocumentBase;
        const ruleSet = lowerRuleAssetsToRuleSet([asset]).ruleSet;
        return ruleSet.sinks || [];
    });
}

function isSweepRule(rule: SinkRule): boolean {
    return !rule.target
        && (
            String(rule.id || "").startsWith("sink.sig.")
            || String(rule.id || "").startsWith("sink.keyword.")
        );
}

async function main(): Promise<void> {
    const rawKernelSinks = readKernelSinkRules();
    const rawSweepRules = rawKernelSinks.filter(isSweepRule);
    assert(rawSweepRules.length === 0, `kernel official assets must not contain sweep inventory: ${rawSweepRules.map(rule => rule.id).join(", ")}`);

    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });

    const activeSinks = loaded.ruleSet.sinks || [];
    const activeSweepRules = activeSinks.filter(isSweepRule);
    assert(activeSweepRules.length === 0, `active sink inventory should exclude legacy sweep rules: ${activeSweepRules.map(rule => rule.id).join(", ")}`);
    assert(
        !activeSinks.some(rule => String(rule.id || "").startsWith("sink.sig.")),
        "active sink inventory should not contain signature sweep sinks",
    );
    assert(
        !activeSinks.some(rule => String(rule.id || "").startsWith("sink.keyword.")),
        "active sink inventory should not contain keyword sweep sinks",
    );

    console.log("====== Sink Inventory Boundary ======");
    console.log(`active_sink_rules=${activeSinks.length}`);
    console.log(`active_sweep_rules=${activeSweepRules.length}`);
    console.log("PASS test_sink_inventory_boundary");
}

main().catch(error => {
    console.error("FAIL test_sink_inventory_boundary");
    console.error(error);
    process.exit(1);
});

