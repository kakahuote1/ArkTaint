import * as path from "path";
import { loadRuleSet } from "../../core/rules/RuleLoader";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function main(): void {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const apiRules = (loaded.ruleSet.sources || []).filter(
        rule => rule.sourceKind === "call_return" || rule.sourceKind === "field_read",
    );
    assert(apiRules.length > 0, "expected at least one official API source rule");

    const nonCanonical = apiRules.filter(rule =>
        rule.match.kind !== "canonical_api_id_equals"
        || !rule.apiEffect
        || rule.apiEffect.role !== "source"
        || rule.apiEffect.canonicalApiId !== rule.match.value
    );
    assert(
        nonCanonical.length === 0,
        `v2 official API sources must use canonical identity selectors only: ${nonCanonical.slice(0, 5).map(rule => rule.id).join(", ")}`,
    );

    console.log("====== Framework API Source Exactness Gate ======");
    console.log(`api_source_rules=${apiRules.length}`);
    console.log("canonical_identity_sources=true");
}

main();
