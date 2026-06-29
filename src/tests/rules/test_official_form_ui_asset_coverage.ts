import * as fs from "fs";
import * as path from "path";
import { validateAssetDocument, type AssetDocumentBase } from "../../core/assets/schema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import type { SinkRule, TransferRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function loadAsset(relativePath: string): AssetDocumentBase {
    return JSON.parse(fs.readFileSync(path.resolve(relativePath), "utf-8").replace(/^\uFEFF/, ""));
}

function canonicalId(rule: SinkRule | TransferRule): string {
    return decodeURIComponent(rule.apiEffect?.canonicalApiId || "");
}

function endpointEquals(actual: unknown, endpoint: string, pathSegments?: string[]): boolean {
    if (typeof actual === "string") {
        return actual === endpoint && (!pathSegments || pathSegments.length === 0);
    }
    if (!actual || typeof actual !== "object") return false;
    const value = actual as { endpoint?: unknown; path?: unknown };
    if (value.endpoint !== endpoint) return false;
    if (!pathSegments) return true;
    return Array.isArray(value.path)
        && value.path.length === pathSegments.length
        && value.path.every((segment, index) => segment === pathSegments[index]);
}

function assertCanonicalRule(rule: SinkRule | TransferRule, id: string, role: "sink" | "transfer"): void {
    const match = rule.match;
    assert(match.kind === "canonical_api_id_equals", `${id} must use canonical API identity`);
    assert(match.value.startsWith("api:official:"), `${id} must bind an official canonical API`);
    assert(rule.apiEffect?.role === role, `${id} must keep ${role} apiEffect role`);
    assert(rule.apiEffect?.canonicalApiId === match.value, `${id} apiEffect canonical id mismatch`);
    assert(typeof rule.apiEffect.assetId === "string" && rule.apiEffect.assetId.length > 0, `${id} must bind an asset`);
    assert(typeof rule.apiEffect.surfaceId === "string" && rule.apiEffect.surfaceId.length > 0, `${id} must bind a surface`);
    assert(typeof rule.apiEffect.bindingId === "string" && rule.apiEffect.bindingId.length > 0, `${id} must bind an asset binding`);
}

function assertCanonicalSink(
    sinks: SinkRule[],
    description: string,
    fragments: string[],
    endpoint: string,
    pathSegments?: string[],
): void {
    const rule = sinks.find(candidate => {
        const canonical = canonicalId(candidate);
        return fragments.every(fragment => canonical.includes(fragment))
            && endpointEquals(candidate.target, endpoint, pathSegments);
    });
    assert(rule, `missing official sink rule for ${description}`);
    assertCanonicalRule(rule, description, "sink");
}

function assertCanonicalTransfer(
    transfers: TransferRule[],
    description: string,
    fragments: string[],
    from: string,
    to: string,
): void {
    const rule = transfers.find(candidate => {
        const canonical = canonicalId(candidate);
        return fragments.every(fragment => canonical.includes(fragment))
            && candidate.from === from
            && candidate.to === to;
    });
    assert(rule, `missing official transfer rule for ${description}`);
    assertCanonicalRule(rule, description, "transfer");
}

function main(): void {
    const assets = [
        loadAsset("src/models/kernel/rules/sinks/official_declarations.rules.json"),
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

    const sinks = lowered.ruleSet.sinks;
    const transfers = lowered.ruleSet.transfers;

    assertCanonicalSink(sinks, "formProvider.updateForm arg1", ["formProvider", "updateForm"], "arg1");
    assertCanonicalSink(sinks, "formProvider.requestPublishForm arg1", ["formProvider", "requestPublishForm"], "arg1");
    assertCanonicalSink(sinks, "ArkUI Text arg0", ["component:Text", "TextInterface", "call"], "arg0");
    assertCanonicalSink(sinks, "ArkUI Image arg0", ["component:Image", "ImageInterface", "call"], "arg0");
    assertCanonicalSink(sinks, "ArkUI Video src", ["component:Video", "VideoInterface", "call"], "arg0", ["src"]);
    assertCanonicalSink(sinks, "CanvasRenderer.fillText arg0", ["CanvasRenderer", "fillText"], "arg0");
    assertCanonicalSink(sinks, "CanvasRenderer.strokeText arg0", ["CanvasRenderer", "strokeText"], "arg0");
    assertCanonicalSink(sinks, "CanvasRenderer.drawImage arg0", ["CanvasRenderer", "drawImage"], "arg0");
    assertCanonicalSink(sinks, "promptAction.showToast arg0", ["promptAction", "showToast"], "arg0");
    assertCanonicalSink(sinks, "promptAction.showDialog arg0", ["promptAction", "showDialog"], "arg0");
    assertCanonicalTransfer(
        transfers,
        "formBindingData.createFormBindingData arg0 to result",
        ["formBindingData", "createFormBindingData"],
        "arg0",
        "result",
    );

    console.log(
        `PASS test_official_form_ui_asset_coverage sinks=${lowered.ruleSet.sinks.length} `
        + `transfers=${lowered.ruleSet.transfers.length}`,
    );
}

main();
