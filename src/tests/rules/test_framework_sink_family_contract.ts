import * as path from "path";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SinkRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function assertCanonicalSinkRules(rules: SinkRule[]): void {
    const nonCanonical = rules.filter(rule =>
        rule.match.kind !== "canonical_api_id_equals"
        || !rule.apiEffect
        || rule.apiEffect.role !== "sink"
        || rule.apiEffect.canonicalApiId !== rule.match.value
    );
    assert(
        nonCanonical.length === 0,
        `official sinks must bind canonical identity and sink apiEffect: ${nonCanonical.slice(0, 5).map(rule => rule.id).join(", ")}`,
    );
}

function findSinkByCanonicalId(rules: SinkRule[], canonicalApiId: string): SinkRule {
    const rule = rules.find(item => item.match.kind === "canonical_api_id_equals" && item.match.value === canonicalApiId);
    assert(rule, `missing canonical official sink: ${canonicalApiId}`);
    return rule;
}

function assertCanonicalSink(
    rules: SinkRule[],
    canonicalApiId: string,
    expectedFamily: string,
): void {
    const rule = findSinkByCanonicalId(rules, canonicalApiId);
    assert(rule.family === expectedFamily, `${rule.id} should keep semantic family ${expectedFamily}`);
    assert(rule.apiEffect?.role === "sink", `${rule.id} must keep sink apiEffect role`);
    assert(rule.apiEffect?.canonicalApiId === canonicalApiId, `${rule.id} apiEffect canonical id mismatch`);
    assert(typeof rule.apiEffect.assetId === "string" && rule.apiEffect.assetId.length > 0, `${rule.id} must bind an asset`);
    assert(typeof rule.apiEffect.bindingId === "string" && rule.apiEffect.bindingId.length > 0, `${rule.id} must bind an asset binding`);
}

function main(): void {
    const loaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const sinks = loaded.ruleSet.sinks || [];

    assert(sinks.length >= 1200, `expected v2 official sink inventory, got ${sinks.length}`);
    assertCanonicalSinkRules(sinks);

    const ids = new Set(sinks.map(rule => rule.id));
    const obsoleteSinkIds = [
        "sink.harmony.distributedkv.putBatch.arg0.for.sink.harmony.distributedkv.putBatch.arg0.0.exact.putBatch.class.KVStore.argCount1",
        "sink.harmony.webcontroller.loadUrl.arg0.for.sink.harmony.webcontroller.loadUrl.arg0.0.exact.loadUrl.class.WebviewController",
    ];
    for (const id of obsoleteSinkIds) {
        assert(!ids.has(id), `legacy sink rule id must not remain: ${id}`);
    }
    const createFormBindingDataId = "api:official:openharmony:module=%40ohos.app.form.formBindingData:file=api%2F%40ohos.app.form.formBindingData.d.ts:export=namespace%3AformBindingData:decl=namespace%3AformBindingData:member=function%3Afree-function%3AcreateFormBindingData:invoke=call:params=0%3AObject:ret=FormBindingData";
    assert(
        !sinks.some(rule => rule.match.kind === "canonical_api_id_equals" && rule.match.value === createFormBindingDataId),
        "formBindingData.createFormBindingData creates a local carrier and must not remain a sink",
    );
    assertCanonicalSink(
        sinks,
        "api:official:openharmony:module=%40ohos.file.picker:file=api%2F%40ohos.file.picker.d.ts:export=namespace%3Apicker.PhotoViewPicker:decl=class%3Apicker.PhotoViewPicker:member=method%3Ainstance%3Asave:invoke=call:params=0%3APhotoSaveOptions%2C1%3AAsyncCallback%3CArray%3Cstring%3E%3E:ret=void",
        "file-uri-source-sink",
    );
    const webLoadUrlRule = sinks.find(rule =>
        rule.match.kind === "canonical_api_id_equals"
        && decodeURIComponent(rule.match.value).includes("module=@internal/component/ets/web")
        && decodeURIComponent(rule.match.value).includes("export=component:WebController")
        && decodeURIComponent(rule.match.value).includes("member=method:instance:loadUrl")
    );
    assert(webLoadUrlRule, "WebController.loadUrl official sink must remain registered");
    assert(webLoadUrlRule.family === "webview-bridge-source-sink", `${webLoadUrlRule.id} should keep webview family`);

    console.log("====== Framework Sink Family Contract ======");
    console.log(`sink_rules=${sinks.length}`);
    console.log("runtime_loader=v2_official_assets");
    console.log("legacy_catalog_injection=false");
    console.log("canonical_identity_sinks=true");
}

main();
