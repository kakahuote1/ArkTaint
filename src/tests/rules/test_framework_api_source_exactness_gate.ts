import * as path from "path";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SourceRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function hasScopeAnchor(rule: SourceRule): boolean {
    return !!(rule.scope || rule.calleeScope);
}

function main(): void {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const apiRules = (loaded.ruleSet.sources || []).filter(
        rule => rule.sourceKind === "call_return" || rule.sourceKind === "field_read",
    );
    assert(apiRules.length >= 900, `expected v2 official API source inventory, got ${apiRules.length}`);

    const loose = apiRules.filter(rule => {
        const match = rule.match;
        return match.kind === "method_name_equals"
            && (
                match.invokeKind === undefined
                || match.invokeKind === "any"
                || match.argCount === undefined
                || !hasScopeAnchor(rule)
            );
    });
    assert(
        loose.length === 0,
        `v2 official API source rules must not use loose method-name selectors: ${loose.slice(0, 5).map(rule => rule.id).join(", ")}`,
    );

    const exactKinds = new Set(["signature_equals", "declaring_class_equals", "method_name_equals", "field_name_equals"]);
    const broad = apiRules.filter(rule => !exactKinds.has(rule.match.kind));
    assert(
        broad.length === 0,
        `v2 official API sources must use exact selectors only: ${broad.slice(0, 5).map(rule => rule.id).join(", ")}`,
    );

    console.log("====== Framework API Source Exactness Gate ======");
    console.log(`api_source_rules=${apiRules.length}`);
    console.log("loose_method_selectors=0");
    console.log("unanchored_broad_selectors=0");
}

main();
