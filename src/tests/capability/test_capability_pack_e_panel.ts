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
    { id: "framework_sink_family_contract", script: "../rules/test_framework_sink_family_contract.js" },
    { id: "sink_inventory_boundary", script: "../rules/test_sink_inventory_boundary.js" },
    { id: "harmony_bench_rule_contract", script: "../harmony/test_harmony_bench_rule_contract.js" },
    { id: "sink_inventory_scoring_contract", script: "../rules/test_sink_inventory_scoring_contract.js" },
    { id: "smoke_sink_inventory_alignment", script: "../real_projects/test_smoke_sink_inventory_alignment.js" },
];

function runSuite(suite: SuiteSpec): SuiteResult {
    const scriptPath = path.resolve(__dirname, suite.script);
    const result = spawnSync(process.execPath, [scriptPath], {
        stdio: "inherit",
    });

    return {
        id: suite.id,
        ok: result.status === 0,
        status: result.status,
    };
}

function main(): void {
    const results = SUITES.map(runSuite);
    const passCount = results.filter(result => result.ok).length;

    console.log("====== Capability Pack E Panel ======");
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
