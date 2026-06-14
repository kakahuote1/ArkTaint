import * as fs from "fs";
import * as path from "path";
import { validateAssetDocument, type AssetDocumentBase } from "../../core/assets/schema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import type { RuleMatch, SinkRule, TransferRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function loadAsset(relativePath: string): AssetDocumentBase {
    return JSON.parse(fs.readFileSync(path.resolve(relativePath), "utf-8").replace(/^\uFEFF/, ""));
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
    return new Map(items.map(item => [item.id, item]));
}

function assertExactMethodSelector(rule: SinkRule | TransferRule, id: string): void {
    const match = rule.match as RuleMatch;
    assert(match.kind === "method_name_equals", `${id} must use exact method-name selector`);
    assert(!["signature_contains", "signature_regex", "method_name_regex"].includes(match.kind), `${id} must not use broad selector`);
}

function main(): void {
    const assets = [
        loadAsset("src/models/kernel/rules/sinks/form.rules.json"),
        loadAsset("src/models/kernel/rules/sinks/ui_display.rules.json"),
        loadAsset("src/models/kernel/rules/transfers/form.rules.json"),
    ];

    for (const asset of assets) {
        const validation = validateAssetDocument(asset);
        assert(validation.valid, `${asset.id} must validate: ${validation.errors.join("; ")}`);
        assert(asset.status === "official", `${asset.id} must be official`);
        assert(asset.plane === "rule", `${asset.id} must be a rule asset`);
    }

    const lowered = lowerRuleAssetsToRuleSet(assets);
    assert(lowered.diagnostics.length === 0, `lowering diagnostics must be empty: ${lowered.diagnostics.join("; ")}`);

    const sinks = byId(lowered.ruleSet.sinks);
    const transfers = byId(lowered.ruleSet.transfers);

    const expectedSinkIds = [
        "sink.harmony.formbindingdata.create.arg0",
        "sink.harmony.formProvider.updateForm.arg1",
        "sink.harmony.formProvider.requestPublishForm.arg1",
        "sink.harmony.arkui.Text.arg0",
        "sink.harmony.arkui.Image.arg0",
        "sink.harmony.arkui.Video.arg0",
        "sink.harmony.arkui.CanvasRenderer.fillText.arg0",
        "sink.harmony.arkui.CanvasRenderer.strokeText.arg0",
        "sink.harmony.arkui.CanvasRenderer.drawImage.arg0",
        "sink.harmony.promptAction.showToast.arg0",
        "sink.harmony.promptAction.showDialog.arg0",
    ];

    for (const id of expectedSinkIds) {
        const rule = sinks.get(id);
        assert(rule, `missing official sink rule: ${id}`);
        assertExactMethodSelector(rule, id);
    }

    const formCreate = transfers.get("transfer.official.formbindingdata.create");
    assert(formCreate, "missing formBindingData create transfer");
    assert(formCreate.from === "arg0", "formBindingData.createFormBindingData must transfer arg0");
    assert(formCreate.to === "result", "formBindingData.createFormBindingData must transfer to result");
    assertExactMethodSelector(formCreate, formCreate.id);

    console.log(
        `PASS test_official_form_ui_asset_coverage sinks=${lowered.ruleSet.sinks.length} `
        + `transfers=${lowered.ruleSet.transfers.length}`,
    );
}

main();
