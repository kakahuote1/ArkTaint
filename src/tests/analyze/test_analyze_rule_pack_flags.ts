import { parseArgs } from "../../cli/analyzeCliOptions";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const parsed = parseArgs([
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        "--ruleCatalog", "src/rules",
        "--enable-rule-pack", "sdk_alpha,sdk_beta",
        "--disable-rule-pack", "sdk_beta",
    ]);

    assert(parsed.ruleOptions.ruleCatalogPath === "src/rules", "ruleCatalog should map into ruleOptions.ruleCatalogPath");
    assert(
        JSON.stringify(parsed.ruleOptions.enabledRulePacks || []) === JSON.stringify(["sdk_alpha", "sdk_beta"]),
        "enable-rule-pack should parse CSV values",
    );
    assert(
        JSON.stringify(parsed.ruleOptions.disabledRulePacks || []) === JSON.stringify(["sdk_beta"]),
        "disable-rule-pack should parse CSV values",
    );

    console.log("====== Analyze Rule Pack Flags ======");
    console.log("rule_catalog_flag=PASS");
    console.log("enable_rule_pack_flag=PASS");
    console.log("disable_rule_pack_flag=PASS");
}

main().catch(error => {
    console.error("FAIL test_analyze_rule_pack_flags");
    console.error(error);
    process.exit(1);
});
