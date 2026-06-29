import * as path from "path";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SourceRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function assertCanonicalSourceRules(rules: SourceRule[]): void {
    const nonCanonical = rules.filter(rule =>
        rule.match.kind !== "canonical_api_id_equals"
        || !rule.apiEffect
        || rule.apiEffect.role !== "source"
        || rule.apiEffect.canonicalApiId !== rule.match.value
    );
    assert(
        nonCanonical.length === 0,
        `official API sources must bind canonical identity and source apiEffect: ${nonCanonical.slice(0, 5).map(rule => rule.id).join(", ")}`,
    );
}

function main(): void {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const apiSources = (loaded.ruleSet.sources || []).filter(
        rule => rule.sourceKind === "call_return" || rule.sourceKind === "field_read",
    );

    assert(apiSources.length >= 900, `expected v2 official API source inventory, got ${apiSources.length}`);
    assertCanonicalSourceRules(apiSources);

    console.log("====== Framework API Source Family Contract ======");
    console.log(`api_source_rules=${apiSources.length}`);
    console.log("runtime_loader=v2_official_assets");
    console.log("legacy_catalog_injection=false");
    console.log("canonical_identity_sources=true");
}

main();
