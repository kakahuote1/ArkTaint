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
    const contractIds = new Set<string>();
    for (const contract of FRAMEWORK_SANITIZER_FAMILY_CONTRACTS) {
        assert(contract.family.startsWith("sanitizer."), `sanitizer family must use sanitizer.* namespace: ${contract.family}`);
        assert(contract.description.trim().length > 0, `sanitizer family missing description: ${contract.family}`);
        assert(contract.schemas.length > 0, `sanitizer family missing schemas: ${contract.family}`);
        for (const schema of contract.schemas) {
            assert(schema.id.startsWith("sanitizer."), `sanitizer schema must use sanitizer.* namespace: ${schema.id}`);
            contractIds.add(schema.id);
        }
    }
    const rawKernelIds = new Set(rawKernelSanitizers.map(rule => rule.id));
    for (const id of contractIds) {
        assert(rawKernelIds.has(id), `sanitizer contract has no authoring rule: ${id}`);
    }
    for (const rule of generatedKernelSanitizers) {
        assert(isFrameworkSanitizerCatalogRule(rule), `generated sanitizer is not recognized by catalog: ${rule.id}`);
        assert(rule.family && rule.family.startsWith("sanitizer."), `generated sanitizer missing sanitizer family: ${rule.id}`);
        assert(rule.tier === "A" || rule.tier === "B" || rule.tier === "C", `generated sanitizer missing tier: ${rule.id}`);
    }

    const kernelLoaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        autoDiscoverLayers: false,
        allowMissingProject: true,
        allowMissingCandidate: true,
    });
    const loadedKernelCatalogSanitizers = (kernelLoaded.ruleSet.sanitizers || []).filter(rule => isFrameworkSanitizerCatalogRule(rule));
    assert(
        loadedKernelCatalogSanitizers.length === generatedKernelSanitizers.length,
        `loaded kernel sanitizer catalog mismatch: loaded=${loadedKernelCatalogSanitizers.length}, generated=${generatedKernelSanitizers.length}`,
    );

    const projectLoaded = loadRuleSet({
        kernelRulePath: path.resolve("tests/rules/minimal.rules.json"),
        ruleCatalogPath: path.resolve("src/models"),
        projectRulePath: path.resolve("tests/rules/sanitizer_guard.rules.json"),
        autoDiscoverLayers: false,
    });
    const projectSanitizers = projectLoaded.ruleSet.sanitizers || [];
    const projectOnlySanitizers = projectSanitizers.filter(rule => !isFrameworkSanitizerCatalogRule(rule));
    const projectKernelCatalogSanitizers = projectSanitizers.filter(rule => isFrameworkSanitizerCatalogRule(rule));
    assert(projectOnlySanitizers.length > 0, "project sanitizer rules should still load");
    assert(
        projectKernelCatalogSanitizers.length === generatedKernelSanitizers.length,
        `project load should preserve kernel catalog sanitizers: loaded=${projectKernelCatalogSanitizers.length}, expected=${generatedKernelSanitizers.length}`,
    );
    for (const rule of projectOnlySanitizers) {
        assert(rule.family && rule.family.trim().length > 0, `project sanitizer missing family after governance normalization: ${rule.id}`);
        assert(rule.tier === "A" || rule.tier === "B" || rule.tier === "C", `project sanitizer missing tier: ${rule.id}`);
    }

    console.log("====== Framework Sanitizer Family Contract ======");
    console.log(`kernel_contract_families=${FRAMEWORK_SANITIZER_FAMILY_CONTRACTS.length}`);
    console.log(`kernel_authoring_sanitizers=${rawKernelSanitizers.length}`);
    console.log(`kernel_catalog_sanitizers=${loadedKernelCatalogSanitizers.length}`);
    console.log(`project_sanitizers=${projectOnlySanitizers.length}`);
    console.log("PASS kernel_sanitizer_catalog_alignment");
    console.log("PASS project_sanitizer_governance_preserved");
}

main().catch(error => {
    console.error("FAIL test_framework_sanitizer_family_contract");
    console.error(error);
    process.exit(1);
});

