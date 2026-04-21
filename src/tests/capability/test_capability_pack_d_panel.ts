import * as path from "path";
import { spawnSync } from "child_process";

interface SuiteSpec {
    id: string;
    script: string;
}

interface SuiteResult {
    id: string;
    ok: boolean;
    status: number | null;
}

const SUITES: SuiteSpec[] = [
    { id: "framework_source_ownership", script: "../rules/test_framework_source_ownership.js" },
    { id: "framework_callback_family_contract", script: "../rules/test_framework_callback_source_family_contract.js" },
    { id: "framework_api_family_contract", script: "../rules/test_framework_api_source_family_contract.js" },
    { id: "framework_source_exactness_gate", script: "../rules/test_framework_api_source_exactness_gate.js" },
    { id: "framework_api_unknown_sdk_resolution", script: "../rules/test_framework_api_source_unknown_sdk_resolution.js" },
    { id: "rule_governance_contract", script: "../rules/test_rule_governance_contract.js" },
    { id: "rule_governance_normalization", script: "../rules/test_rule_governance_normalization.js" },
    { id: "rule_governance_runtime_ingress", script: "../rules/test_rule_governance_runtime_ingress.js" },
];

function runSuite(suite: SuiteSpec): SuiteResult {
    const scriptPath = path.resolve(__dirname, suite.script);
    const result = spawnSync(process.execPath, [scriptPath], {
        encoding: "utf8",
    });

    if (result.stdout) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }

    return {
        id: suite.id,
        ok: result.status === 0,
        status: result.status,
    };
}

function main(): void {
    const results = SUITES.map(runSuite);
    const passCount = results.filter(result => result.ok).length;

    console.log("====== Capability Pack D Panel ======");
    console.log(`total_suites=${results.length}`);
    console.log(`pass_suites=${passCount}`);
    console.log(`fail_suites=${results.length - passCount}`);
    for (const result of results) {
        console.log(`${result.ok ? "PASS" : "FAIL"} suite=${result.id} status=${result.status ?? "null"}`);
    }

    if (passCount !== results.length) {
        process.exitCode = 1;
    }
}

main();
