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
    { id: "object_path", script: "../precision/test_object_path_precision_matrix.js" },
    { id: "object_update", script: "../precision/test_object_update_precision.js" },
    { id: "object_container_bridge", script: "../precision/test_object_container_bridge_precision.js" },
    { id: "object_accessor", script: "../precision/test_object_accessor_precision.js" },
    { id: "arkmain_stateful_object", script: "../precision/test_arkmain_stateful_object_precision.js" },
    { id: "array_precision", script: "../precision/test_array_precision_matrix.js" },
    { id: "container_model", script: "../precision/test_container_model_precision.js" },
    { id: "result_container", script: "../precision/test_result_container_precision.js" },
    { id: "object_container_invalidation", script: "../precision/test_object_container_invalidation_precision.js" },
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

    console.log("====== Capability Pack B Panel ======");
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
