import * as path from "path";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { collectRulesMissingFamily } from "../../core/rules/RuleFamily";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
    const loaded = loadRuleSet({
        ruleCatalogPath: path.resolve("src/models"),
    });
    const missing = collectRulesMissingFamily(loaded.ruleSet);
    assert(missing.length === 0, `active runtime rule set still has missing family: ${missing.slice(0, 10).join(", ")}`);

    const allRules = [
        ...loaded.ruleSet.sources,
        ...loaded.ruleSet.sinks,
        ...(loaded.ruleSet.sanitizers || []),
        ...loaded.ruleSet.transfers,
    ];
    const apiEffectRules = allRules.filter(rule => !!rule.apiEffect);
    assert(allRules.length > 0, "expected loaded runtime rules");
    assert(apiEffectRules.length > 0, "expected identity-backed runtime rules");
    assert(
        loaded.appliedRuleSources.includes("kernel"),
        "expected kernel rule source to be applied",
    );
    assert(
        loaded.ruleSourceStatus.some(status => status.name === "kernel" && status.applied),
        "expected applied kernel rule source status",
    );

    console.log("====== Rule Family Normalization ======");
    console.log(`runtime_missing_family=${missing.length}`);
    console.log(`runtime_rules=${allRules.length}`);
    console.log(`identity_backed_rules=${apiEffectRules.length}`);
    console.log(`applied_rule_sources=${loaded.appliedRuleSources.join(",")}`);
}

main().catch(error => {
    console.error("FAIL test_rule_governance_normalization");
    console.error(error);
    process.exit(1);
});
