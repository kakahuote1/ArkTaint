import * as fs from "fs";
import * as path from "path";
import { validateAssetDocument, type AssetDocumentBase } from "../../core/assets/schema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import type { RuleMatch, SinkRule, SourceRule } from "../../core/rules/RuleSchema";
import appstorage from "../../models/kernel/modules/harmony/appstorage";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function loadAsset(relativePath: string): AssetDocumentBase {
    return JSON.parse(fs.readFileSync(path.resolve(relativePath), "utf-8").replace(/^\uFEFF/, ""));
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
    return new Map(items.map(item => [item.id, item]));
}

function assertExactMethodSelector(rule: SourceRule | SinkRule, id: string): void {
    const match = rule.match as RuleMatch;
    assert(match.kind === "method_name_equals", `${id} must use exact method-name selector`);
    assert(typeof match.argCount === "number", `${id} must carry exact argCount`);
}

function main(): void {
    const assets = [
        loadAsset("src/models/kernel/rules/sources/distributed.rules.json"),
        loadAsset("src/models/kernel/rules/sources/file_picker.rules.json"),
        loadAsset("src/models/kernel/rules/sinks/data.rules.json"),
        loadAsset("src/models/kernel/rules/sinks/file.rules.json"),
    ];

    for (const asset of assets) {
        const validation = validateAssetDocument(asset);
        assert(validation.valid, `${asset.id} must validate: ${validation.errors.join("; ")}`);
        assert(asset.status === "official", `${asset.id} must be official`);
        assert(asset.plane === "rule", `${asset.id} must be a rule asset`);
    }

    const lowered = lowerRuleAssetsToRuleSet(assets);
    assert(lowered.diagnostics.length === 0, `lowering diagnostics must be empty: ${lowered.diagnostics.join("; ")}`);
    const sources = byId(lowered.ruleSet.sources);
    const sinks = byId(lowered.ruleSet.sinks);

    const expectedSources = [
        "source.harmony.distributedkv.getEntries.result.argCount1.distributedData.KVStore",
        "source.harmony.distributedkv.getEntries.callbackArg1.result.argCount2.distributedData.KVStore",
        "source.harmony.distributedkv.getEntries.result.argCount1.distributedKVStore.SingleKVStore",
        "source.harmony.distributedkv.getEntries.callbackArg1.result.argCount2.distributedKVStore.SingleKVStore",
        "source.harmony.distributedkv.getEntries.result.argCount1.distributedData.DeviceKVStore",
        "source.harmony.distributedkv.getEntries.callbackArg1.result.argCount2.distributedData.DeviceKVStore",
        "source.harmony.distributedkv.getEntries.result.argCount2.distributedData.DeviceKVStore",
        "source.harmony.distributedkv.getEntries.callbackArg2.result.argCount3.distributedData.DeviceKVStore",
        "source.harmony.distributedkv.getEntries.result.argCount1.distributedKVStore.DeviceKVStore",
        "source.harmony.distributedkv.getEntries.callbackArg1.result.argCount2.distributedKVStore.DeviceKVStore",
        "source.harmony.distributedkv.getEntries.result.argCount2.distributedKVStore.DeviceKVStore",
        "source.harmony.distributedkv.getEntries.callbackArg2.result.argCount3.distributedKVStore.DeviceKVStore",
        "source.harmony.filePicker.select.result.argCount0.PhotoViewPicker",
        "source.harmony.filePicker.select.result.argCount1.PhotoViewPicker",
        "source.harmony.filePicker.select.callbackArg0.result.PhotoViewPicker",
        "source.harmony.filePicker.select.callbackArg1.result.PhotoViewPicker",
        "source.harmony.filePicker.select.result.argCount0.DocumentViewPicker",
        "source.harmony.filePicker.select.result.argCount1.DocumentViewPicker",
        "source.harmony.filePicker.select.callbackArg0.result.DocumentViewPicker",
        "source.harmony.filePicker.select.callbackArg1.result.DocumentViewPicker",
        "source.harmony.filePicker.select.result.argCount0.AudioViewPicker",
        "source.harmony.filePicker.select.result.argCount1.AudioViewPicker",
        "source.harmony.filePicker.select.callbackArg0.result.AudioViewPicker",
        "source.harmony.filePicker.select.callbackArg1.result.AudioViewPicker",
    ];
    for (const id of expectedSources) {
        const rule = sources.get(id);
        assert(rule, `missing official source rule: ${id}`);
        assertExactMethodSelector(rule, id);
        assert(rule.calleeScope?.className?.mode === "equals", `${id} must carry exact class callee scope in asset form`);
    }

    const expectedSinks = [
        "sink.harmony.distributedkv.putBatch.arg0.for.sink.harmony.distributedkv.putBatch.arg0.0.exact.putBatch.class.KVStore.argCount1",
        "sink.harmony.distributedkv.putBatch.arg0.for.sink.harmony.distributedkv.putBatch.arg0.0.exact.putBatch.class.KVStore.argCount2",
        "sink.harmony.distributedkv.putBatch.arg0.for.sink.harmony.distributedkv.putBatch.arg0.0.exact.putBatch.class.SingleKVStore.argCount1",
        "sink.harmony.distributedkv.putBatch.arg0.for.sink.harmony.distributedkv.putBatch.arg0.0.exact.putBatch.class.SingleKVStore.argCount2",
        "sink.harmony.filePicker.PhotoViewPicker.save.arg0",
        "sink.harmony.filePicker.DocumentViewPicker.save.arg0",
        "sink.harmony.filePicker.AudioViewPicker.save.arg0",
    ];
    for (const id of expectedSinks) {
        const rule = sinks.get(id);
        assert(rule, `missing official sink rule: ${id}`);
        assertExactMethodSelector(rule, id);
        assert(
            rule.target === "arg0" || (rule.target && typeof rule.target === "object" && rule.target.endpoint === "arg0"),
            `${id} must target arg0`,
        );
    }

    const appstorageAsset = Array.isArray(appstorage) ? appstorage[0] : appstorage;
    const capabilityTemplate = (appstorageAsset as any).effectTemplates?.find(
        (template: any) => template.id === "harmony.appstorage.capability",
    );
    const writeMethods = capabilityTemplate?.payload?.writeMethods || [];
    assert(
        writeMethods.some((method: any) => method.methodName === "putBatch" && method.valueIndex === 0),
        "harmony.appstorage module must model putBatch(entries) as a write from arg0",
    );

    console.log(
        `PASS test_official_kv_picker_asset_coverage sources=${expectedSources.length} `
        + `sinks=${expectedSinks.length}`,
    );
}

main();
