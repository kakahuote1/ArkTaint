import * as fs from "fs";
import * as path from "path";
import { validateAssetDocument, type AssetDocumentBase } from "../../core/assets/schema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import type { SinkRule, SourceRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function loadAsset(relativePath: string): AssetDocumentBase {
    return JSON.parse(fs.readFileSync(path.resolve(relativePath), "utf-8").replace(/^\uFEFF/, ""));
}

function canonicalId(rule: SourceRule | SinkRule): string {
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

function assertCanonicalRule(rule: SourceRule | SinkRule, id: string, role: "source" | "sink"): void {
    const match = rule.match;
    assert(match.kind === "canonical_api_id_equals", `${id} must use canonical API identity`);
    assert(match.value.startsWith("api:official:"), `${id} must bind an official canonical API`);
    assert(rule.apiEffect?.role === role, `${id} must keep ${role} apiEffect role`);
    assert(rule.apiEffect?.canonicalApiId === match.value, `${id} apiEffect canonical id mismatch`);
    assert(typeof rule.apiEffect.assetId === "string" && rule.apiEffect.assetId.length > 0, `${id} must bind an asset`);
    assert(typeof rule.apiEffect.surfaceId === "string" && rule.apiEffect.surfaceId.length > 0, `${id} must bind a surface`);
    assert(typeof rule.apiEffect.bindingId === "string" && rule.apiEffect.bindingId.length > 0, `${id} must bind an asset binding`);
}

function assertCanonicalSource(
    sources: SourceRule[],
    description: string,
    fragments: string[],
    endpoint: string,
    pathSegments?: string[],
): void {
    const rule = sources.find(candidate => {
        const canonical = canonicalId(candidate);
        return fragments.every(fragment => canonical.includes(fragment))
            && endpointEquals(candidate.target, endpoint, pathSegments);
    });
    assert(rule, `missing official source rule for ${description}`);
    assertCanonicalRule(rule, description, "source");
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

function main(): void {
    const assets = [
        loadAsset("src/models/kernel/rules/sources/official_declarations.rules.json"),
        loadAsset("src/models/kernel/rules/sinks/official_declarations.rules.json"),
    ];

    for (const asset of assets) {
        const validation = validateAssetDocument(asset);
        assert(validation.valid, `${asset.id} must validate: ${validation.errors.join("; ")}`);
        assert(asset.status === "official", `${asset.id} must be official`);
        assert(asset.plane === "rule", `${asset.id} must be a rule asset`);
    }

    const lowered = lowerRuleAssetsToRuleSet(assets);
    assert(lowered.diagnostics.length === 0, `lowering diagnostics must be empty: ${lowered.diagnostics.join("; ")}`);
    const sources = lowered.ruleSet.sources;
    const sinks = lowered.ruleSet.sinks;

    assertCanonicalSource(
        sources,
        "PhotoViewPicker.select promise result photoUris",
        ["PhotoViewPicker", "select", "ret=Promise<PhotoSelectResult>"],
        "result",
        ["photoUris"],
    );
    assertCanonicalSource(
        sources,
        "PhotoViewPicker.select callback photoUris",
        ["PhotoViewPicker", "select", "AsyncCallback<PhotoSelectResult>"],
        "arg1",
        ["photoUris"],
    );
    assertCanonicalSource(
        sources,
        "DocumentViewPicker.select promise result",
        ["DocumentViewPicker", "select", "ret=Promise<Array<string>>"],
        "result",
    );
    assertCanonicalSource(
        sources,
        "DocumentViewPicker.select callback",
        ["DocumentViewPicker", "select", "AsyncCallback<Array<string>>"],
        "arg1",
    );
    assertCanonicalSource(
        sources,
        "AudioViewPicker.select promise result",
        ["AudioViewPicker", "select", "ret=Promise<Array<string>>"],
        "result",
    );
    assertCanonicalSource(
        sources,
        "AudioViewPicker.select callback",
        ["AudioViewPicker", "select", "AsyncCallback<Array<string>>"],
        "arg1",
    );

    assertCanonicalSink(sinks, "PhotoViewPicker.save arg0", ["PhotoViewPicker", "save"], "arg0");
    assertCanonicalSink(sinks, "DocumentViewPicker.save newFileNames", ["DocumentViewPicker", "save"], "arg0", ["newFileNames"]);
    assertCanonicalSink(sinks, "AudioViewPicker.save arg0", ["AudioViewPicker", "save"], "arg0");

    console.log(
        `PASS test_official_kv_picker_asset_coverage sources=${lowered.ruleSet.sources.length} `
        + `sinks=${lowered.ruleSet.sinks.length}`,
    );
}

main();
