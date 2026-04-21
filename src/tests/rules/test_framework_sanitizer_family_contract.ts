import * as fs from "fs";
import * as path from "path";
import {
    buildFrameworkSanitizerRules,
    FRAMEWORK_SANITIZER_FAMILY_CONTRACTS,
    isFrameworkSanitizerCatalogRule,
} from "../../core/rules/FrameworkSanitizerCatalog";
import { loadRuleSet } from "../../core/rules/RuleLoader";
import { SanitizerRule, TaintRuleSet } from "../../core/rules/RuleSchema";

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
        const ruleSet = JSON.parse(fs.readFileSync(path.join(dir, fileName), "utf-8")) as TaintRuleSet;
        out.push(...(ruleSet.sanitizers || []));
    }
    return out;
}

async function main(): Promise<void> {
    const rawKernelSanitizers = readKernelSanitizerRules();
    const generatedKernelSanitizers = buildFrameworkSanitizerRules(rawKernelSanitizers);
    assert(
        FRAMEWORK_SANITIZER_FAMILY_CONTRACTS.length === 0,
        "kernel sanitizer family catalog should stay empty until official sanitizer contracts exist",
    );
    assert(rawKernelSanitizers.length === 0, "kernel sanitizer authoring inventory should currently be empty");
    assert(generatedKernelSanitizers.length === 0, "kernel sanitizer catalog should not synthesize phantom rules");

    const kernelLoaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const loadedKernelCatalogSanitizers = (kernelLoaded.ruleSet.sanitizers || []).filter(rule => isFrameworkSanitizerCatalogRule(rule));
    assert(loadedKernelCatalogSanitizers.length === 0, "loaded kernel sanitizers should not contain phantom framework catalog rules");

    const projectLoaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        projectRulePath: path.resolve("tests/rules/sanitizer_guard.rules.json"),
        autoDiscoverLayers: false,
    });
    const projectSanitizers = projectLoaded.ruleSet.sanitizers || [];
    assert(projectSanitizers.length > 0, "project sanitizer rules should still load");
    assert(projectSanitizers.every(rule => !isFrameworkSanitizerCatalogRule(rule)), "project sanitizers must not be misclassified as kernel catalog rules");
    for (const rule of projectSanitizers) {
        assert(rule.family && rule.family.trim().length > 0, `project sanitizer missing family after governance normalization: ${rule.id}`);
        assert(rule.tier === "A" || rule.tier === "B" || rule.tier === "C", `project sanitizer missing tier: ${rule.id}`);
    }

    console.log("====== Framework Sanitizer Family Contract ======");
    console.log(`kernel_contract_families=${FRAMEWORK_SANITIZER_FAMILY_CONTRACTS.length}`);
    console.log(`kernel_authoring_sanitizers=${rawKernelSanitizers.length}`);
    console.log(`kernel_catalog_sanitizers=${loadedKernelCatalogSanitizers.length}`);
    console.log(`project_sanitizers=${projectSanitizers.length}`);
    console.log("PASS kernel_sanitizer_catalog_alignment");
    console.log("PASS project_sanitizer_governance_preserved");
}

main().catch(error => {
    console.error("FAIL test_framework_sanitizer_family_contract");
    console.error(error);
    process.exit(1);
});

