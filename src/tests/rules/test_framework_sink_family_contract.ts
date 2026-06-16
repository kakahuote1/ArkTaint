import * as path from "path";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function hasScopeAnchor(rule: SinkRule): boolean {
    return !!(rule.scope || rule.calleeScope);
}

function assertNoLooseMethodSelectors(rules: SinkRule[]): void {
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
        `official sinks must not contain loose method selectors: ${loose.slice(0, 5).map(rule => rule.id).join(", ")}`,
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
    const sinks = loaded.ruleSet.sinks || [];

    assert(sinks.length >= 1200, `expected v2 official sink inventory, got ${sinks.length}`);
    assertNoLooseMethodSelectors(sinks);

    const ids = new Set(sinks.map(rule => rule.id));
    const expectedIds = [
        "sink.harmony.formbindingdata.create.arg0",
        "sink.harmony.filePicker.PhotoViewPicker.save.arg0",
        "sink.harmony.distributedkv.putBatch.arg0.for.sink.harmony.distributedkv.putBatch.arg0.0.exact.putBatch.class.KVStore.argCount1",
        "sink.harmony.webcontroller.loadUrl.arg0.for.sink.harmony.webcontroller.loadUrl.arg0.0.exact.loadUrl.class.WebviewController",
    ];
    for (const id of expectedIds) {
        assert(ids.has(id), `missing v2 official sink rule: ${id}`);
    }

    console.log("====== Framework Sink Family Contract ======");
    console.log(`sink_rules=${sinks.length}`);
    console.log("runtime_loader=v2_official_assets");
    console.log("legacy_catalog_injection=false");
    console.log("loose_method_selectors=0");
}

main();
