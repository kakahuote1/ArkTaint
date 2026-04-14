import { parseArgs } from "../../cli/analyzeCliOptions";
import * as path from "path";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const parsed = parseArgs([
        "--repo", "tests/demo/rule_transfer_variants",
        "--sourceDir", ".",
        "--model-root", "src/models",
        "--enable-model", "sdk_alpha:rules,sdk_beta:rules",
        "--disable-model", "sdk_beta:rules",
    ]);

    assert(
        parsed.ruleOptions.ruleCatalogPath === path.resolve("src/models"),
        "model-root should map into ruleOptions.ruleCatalogPath",
    );
    assert(
        JSON.stringify(parsed.enabledModels || []) === JSON.stringify(["sdk_alpha:rules", "sdk_beta:rules"]),
        "enable-model should parse CSV values",
    );
    assert(
        JSON.stringify(parsed.disabledModels || []) === JSON.stringify(["sdk_beta:rules"]),
        "disable-model should parse CSV values",
    );

    console.log("====== Analyze Rule Pack Flags ======");
    console.log("model_root_flag=PASS");
    console.log("enable_model_flag=PASS");
    console.log("disable_model_flag=PASS");
}

main().catch(error => {
    console.error("FAIL test_analyze_rule_pack_flags");
    console.error(error);
    process.exit(1);
});

