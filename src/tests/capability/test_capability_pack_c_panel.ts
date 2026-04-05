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
    { id: "necessity", script: "../entry_model/test_entry_model_arkmain_necessity.js" },
    { id: "contract_core", script: "../entry_model/test_entry_model_contract_core.js" },
    { id: "callback_family_catalog", script: "../entry_model/test_entry_model_callback_family_catalog.js" },
    { id: "callback_provenance_coverage", script: "../entry_model/test_entry_model_callback_provenance_coverage.js" },
    { id: "owner_discovery", script: "../entry_model/test_entry_model_owner_discovery.js" },
    { id: "owner_family_contract_plane", script: "../entry_model/test_entry_model_owner_family_contract_plane.js" },
    { id: "lifecycle_contract_driven", script: "../harmony/test_harmony_lifecycle.js" },
    { id: "ordering_contract", script: "../entry_model/test_entry_model_ordering_contract.js" },
    { id: "framework_callback_boundary", script: "../entry_model/test_entry_model_framework_callback_boundary.js" },
    { id: "unknown_callback_source_hints", script: "../entry_model/test_entry_model_unknown_callback_source_hints.js" },
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

    console.log("====== Capability Pack C Panel ======");
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
