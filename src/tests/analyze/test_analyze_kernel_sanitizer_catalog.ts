import * as fs from "fs";
import * as path from "path";
import type { AssetDocumentBase } from "../../core/assets/schema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import { loadRuleSet } from "../../core/rules/RuleLoader";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const officialPath = path.resolve("src/models/kernel/rules/sanitizers/official_declarations.rules.json");
    const officialAsset = JSON.parse(fs.readFileSync(officialPath, "utf-8")) as AssetDocumentBase;
    const officialBindings = (officialAsset.bindings || []).filter(binding => binding.role === "sanitizer");

    assert(officialBindings.length === 11, `expected 11 official sanitizer audit records, got ${officialBindings.length}`);
    assert(
        officialBindings.every(binding => binding.metadata?.enabled === false),
        "official crypto sanitizer records must remain disabled after OSAN-002",
    );

    const loweredOfficial = lowerRuleAssetsToRuleSet([officialAsset]).ruleSet.sanitizers || [];
    assert(loweredOfficial.length === officialBindings.length, "lowering should preserve disabled sanitizer records for auditability");
    assert(
        loweredOfficial.every(rule => rule.enabled === false && rule.apiEffect?.role === "sanitizer"),
        "lowered official sanitizer records must be disabled and keep sanitizer apiEffect identity",
    );

    const loaded = loadRuleSet({
        ruleCatalogPath: path.resolve("src/models"),
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const activeOfficial = (loaded.ruleSet.sanitizers || [])
        .filter(rule => rule.apiEffect?.assetId === officialAsset.id);
    assert(activeOfficial.length === 0, `disabled official sanitizers must not load, got ${activeOfficial.length}`);

    console.log("PASS test_analyze_kernel_sanitizer_catalog");
    console.log(`official_sanitizer_audit_records=${officialBindings.length}`);
    console.log(`active_official_sanitizers=${activeOfficial.length}`);
}

main().catch(error => {
    console.error("FAIL test_analyze_kernel_sanitizer_catalog");
    console.error(error);
    process.exit(1);
});
