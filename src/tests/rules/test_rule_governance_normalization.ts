import * as path from "path";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { collectRulesMissingGovernance } from "../../core/rules/RuleGovernance";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function countLayers(rules: Array<{ layer?: string }>): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const rule of rules) {
        const key = rule.layer || "missing";
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

async function main(): Promise<void> {
    const layered = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/layer_priority/kernel.rules.json"),
        projectRulePath: path.resolve("tests/rules/layer_priority/project.rules.json"),
        candidateRulePath: path.resolve("tests/rules/layer_priority/llm_candidate.rules.json"),
    });
    const layeredMissing = collectRulesMissingGovernance(layered.ruleSet);
    assert(layeredMissing.length === 0, `layer_priority fixture still has missing governance: ${layeredMissing.join(", ")}`);

    const actual = loadRuleSet({
        ruleCatalogPath: path.resolve("src/models"),
    });
    const actualMissing = collectRulesMissingGovernance(actual.ruleSet);
    assert(actualMissing.length === 0, `active runtime rule set still has missing governance: ${actualMissing.slice(0, 10).join(", ")}`);

    const allRules = [
        ...actual.ruleSet.sources,
        ...actual.ruleSet.sinks,
        ...(actual.ruleSet.sanitizers || []),
        ...actual.ruleSet.transfers,
    ];
    const layerCounts = countLayers(allRules);
    assert(layerCounts.kernel > 0, "expected kernel-governed rules in active runtime inventory");
    assert(!layerCounts.missing, "no loaded runtime rule should miss governance layer");

    console.log("====== Rule Governance Normalization ======");
    console.log(`fixture_missing_governance=${layeredMissing.length}`);
    console.log(`runtime_missing_governance=${actualMissing.length}`);
    console.log(`runtime_layers=${Object.keys(layerCounts).sort().map(key => `${key}:${layerCounts[key]}`).join(",")}`);
    console.log(`runtime_rules=${allRules.length}`);
}

main().catch(error => {
    console.error("FAIL test_rule_governance_normalization");
    console.error(error);
    process.exit(1);
});

