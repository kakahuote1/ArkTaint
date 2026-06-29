import * as fs from "fs";
import * as path from "path";
import { AssetDocumentBase } from "../../core/assets/schema";
import { lowerRuleAssetsToRuleSet } from "../../core/rules/RuleAssetLowering";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SanitizerRule } from "../../core/rules/RuleSchema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function readKernelSanitizerRules(): SanitizerRule[] {
    const dir = path.resolve("src/models/kernel/rules/sanitizers");
    const files = fs.readdirSync(dir)
        .filter(fileName => fileName.endsWith(".rules.json"))
        .sort((a, b) => a.localeCompare(b));
    const out: SanitizerRule[] = [];
    for (const fileName of files) {
        const asset = JSON.parse(fs.readFileSync(path.join(dir, fileName), "utf-8")) as AssetDocumentBase;
        const ruleSet = lowerRuleAssetsToRuleSet([asset]).ruleSet;
        out.push(...(ruleSet.sanitizers || []));
    }
    return out;
}

async function main(): Promise<void> {
    const rawKernelSanitizers = readKernelSanitizerRules();
    assert(rawKernelSanitizers.length > 0, "expected kernel sanitizer asset records");
    for (const rule of rawKernelSanitizers) {
        assert(rule.apiEffect, `kernel sanitizer must carry apiEffect identity: ${rule.id}`);
        assert(typeof rule.family === "string" && rule.family.length > 0, `generated sanitizer missing family: ${rule.id}`);
    }
    const activeKernelSanitizers = rawKernelSanitizers.filter(rule => rule.enabled !== false);
    const disabledKernelSanitizers = rawKernelSanitizers.filter(rule => rule.enabled === false);

    const kernelLoaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverRuleSources: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const rawKernelIds = new Set(rawKernelSanitizers.map(rule => rule.id));
    const loadedKernelSanitizers = (kernelLoaded.ruleSet.sanitizers || [])
        .filter(rule => rawKernelIds.has(rule.id));
    const loadedKernelIds = new Set(loadedKernelSanitizers.map(rule => rule.id));
    assert(
        loadedKernelSanitizers.length === activeKernelSanitizers.length,
        `loaded kernel sanitizer mismatch: loaded=${loadedKernelSanitizers.length}, active_authored=${activeKernelSanitizers.length}`,
    );
    for (const rule of disabledKernelSanitizers) {
        assert(!loadedKernelIds.has(rule.id), `disabled kernel sanitizer should not load: ${rule.id}`);
    }

    const projectLoaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        projectRulePath: path.resolve("tests/rules/sanitizer_guard.rules.json"),
        autoDiscoverRuleSources: false,
    });
    const projectSanitizers = projectLoaded.ruleSet.sanitizers || [];
    const projectOnlySanitizers = projectSanitizers.filter(rule => !rawKernelIds.has(rule.id));
    const projectKernelSanitizers = projectSanitizers.filter(rule => rawKernelIds.has(rule.id));
    assert(projectOnlySanitizers.length > 0, "project sanitizer rules should still load");
    for (const rule of projectKernelSanitizers) {
        assert(rule.family && rule.family.trim().length > 0, `kernel sanitizer missing family after family normalization: ${rule.id}`);
    }
    assert(
        projectKernelSanitizers.length === activeKernelSanitizers.length,
        `project load should preserve active kernel sanitizers: loaded=${projectKernelSanitizers.length}, expected=${activeKernelSanitizers.length}`,
    );
    for (const rule of projectOnlySanitizers) {
        assert(rule.family && rule.family.trim().length > 0, `project sanitizer missing family after family normalization: ${rule.id}`);
        assert(typeof rule.family === "string" && rule.family.length > 0, `project sanitizer missing family: ${rule.id}`);
    }

    console.log("====== Framework Sanitizer Family Contract ======");
    console.log(`kernel_authoring_sanitizers=${rawKernelSanitizers.length}`);
    console.log(`kernel_active_sanitizers=${activeKernelSanitizers.length}`);
    console.log(`kernel_disabled_sanitizers=${disabledKernelSanitizers.length}`);
    console.log(`kernel_loaded_sanitizers=${loadedKernelSanitizers.length}`);
    console.log(`project_sanitizers=${projectOnlySanitizers.length}`);
    console.log("PASS kernel_sanitizer_asset_alignment");
    console.log("PASS project_sanitizer_family_preserved");
}

main().catch(error => {
    console.error("FAIL test_framework_sanitizer_family_contract");
    console.error(error);
    process.exit(1);
});

