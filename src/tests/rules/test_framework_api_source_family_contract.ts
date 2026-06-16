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

function assertNoLooseMethodSelectors(rules: SourceRule[]): void {
    const loose = rules.filter(rule => {
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
        `official API sources must not contain loose method selectors: ${loose.slice(0, 5).map(rule => rule.id).join(", ")}`,
    );
}

function main(): void {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const apiSources = (loaded.ruleSet.sources || []).filter(
        rule => rule.sourceKind === "call_return" || rule.sourceKind === "field_read",
    );

    assert(apiSources.length >= 900, `expected v2 official API source inventory, got ${apiSources.length}`);
    assertNoLooseMethodSelectors(apiSources);

    const ids = new Set(apiSources.map(rule => rule.id));
    const expectedIds = [
        "source.harmony.filePicker.select.result.argCount0.PhotoViewPicker",
        "source.harmony.filePicker.select.result.argCount1.DocumentViewPicker",
        "source.harmony.distributedkv.getEntries.result.argCount1.distributedData.KVStore",
        "source.harmony.distributedkv.getEntries.result.argCount1.distributedKVStore.SingleKVStore",
    ];
    for (const id of expectedIds) {
        assert(ids.has(id), `missing v2 official API source rule: ${id}`);
    }

    console.log("====== Framework API Source Family Contract ======");
    console.log(`api_source_rules=${apiSources.length}`);
    console.log("runtime_loader=v2_official_assets");
    console.log("legacy_catalog_injection=false");
    console.log("loose_method_selectors=0");
}

main();
