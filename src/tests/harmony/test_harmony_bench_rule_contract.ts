import * as fs from "fs";
import * as path from "path";

interface RuleContract {
    kernelRule: string;
    ruleCatalog: string;
    project: string;
    default?: string;
    framework?: string;
}

interface BenchCategory {
    id: string;
    name: string;
    sourceDir: string;
    rules: RuleContract;
    cases: Array<{ case_id: string; file: string; entry: string }>;
}

interface BenchManifest {
    name: string;
    categories: BenchCategory[];
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function readManifest(filePath: string): BenchManifest {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as BenchManifest;
}

function validateManifest(filePath: string): number {
    const absPath = path.resolve(filePath);
    const manifest = readManifest(absPath);
    assert(Array.isArray(manifest.categories) && manifest.categories.length > 0, `manifest has no categories: ${filePath}`);

    let categoryCount = 0;
    for (const category of manifest.categories) {
        categoryCount += 1;
        const rules = category.rules;
        assert(rules && typeof rules === "object", `${filePath}:${category.id} missing rules object`);
        assert(!("default" in rules), `${filePath}:${category.id} still uses legacy rules.default`);
        assert(!("framework" in rules), `${filePath}:${category.id} still uses legacy rules.framework`);
        assert(typeof rules.kernelRule === "string" && rules.kernelRule.trim().length > 0, `${filePath}:${category.id} missing rules.kernelRule`);
        assert(typeof rules.ruleCatalog === "string" && rules.ruleCatalog.trim().length > 0, `${filePath}:${category.id} missing rules.ruleCatalog`);
        assert(typeof rules.project === "string" && rules.project.trim().length > 0, `${filePath}:${category.id} missing rules.project`);

        const sourceDirAbs = path.resolve(category.sourceDir);
        assert(fs.existsSync(sourceDirAbs), `${filePath}:${category.id} sourceDir missing: ${sourceDirAbs}`);

        for (const refPath of [rules.kernelRule, rules.ruleCatalog, rules.project]) {
            const abs = path.resolve(refPath);
            assert(fs.existsSync(abs), `${filePath}:${category.id} rule path missing: ${abs}`);
        }

        for (const caseInfo of category.cases || []) {
            const caseAbs = path.join(sourceDirAbs, caseInfo.file);
            assert(fs.existsSync(caseAbs), `${filePath}:${category.id}/${caseInfo.case_id} case file missing: ${caseAbs}`);
        }
    }
    return categoryCount;
}

async function main(): Promise<void> {
    const manifestFiles = [
        "tests/benchmark/HarmonyBench/manifest.json",
        "tests/benchmark/HarmonyBench/gates/c12_c14_gate.manifest.json",
    ];

    let totalCategories = 0;
    for (const manifestFile of manifestFiles) {
        totalCategories += validateManifest(manifestFile);
    }

    console.log("====== HarmonyBench Rule Contract ======");
    console.log(`manifests=${manifestFiles.length}`);
    console.log(`categories=${totalCategories}`);
    console.log("rule_contract=PASS");
}

main().catch(error => {
    console.error("FAIL test_harmony_bench_rule_contract");
    console.error(error);
    process.exit(1);
});
