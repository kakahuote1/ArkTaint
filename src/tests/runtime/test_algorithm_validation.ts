import { Scene } from "../../../arkanalyzer/out/src/Scene";
import { SceneConfig } from "../../../arkanalyzer/out/src/Config";
import * as fs from "fs";
import * as path from "path";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";
import { registerMockSdkFiles } from "../helpers/TestSceneBuilder";

interface CaseSpec {
    file: string;
    name: string;
    expected: boolean;
    group: string;
    feature: string;
}

interface CaseResult extends CaseSpec {
    detected: boolean;
    pass: boolean;
    error?: string;
}

const CASE_GROUPS: Record<string, { group: string; feature: string }> = {
    a1_expr_project_cg: { group: "Algorithm A", feature: "Expression Layer: CG resolution" },
    a2_expr_funcvar: { group: "Algorithm A", feature: "Expression Layer: Function-type variable" },
    a3_expr_alias_chain: { group: "Algorithm A", feature: "Expression Layer: Alias chain resolve" },
    a4_param_ip_direct: { group: "Algorithm A", feature: "Parameter Layer: IP_direct filtering" },
    a5_ip_field: { group: "Algorithm A", feature: "Opt 1: IP_field store-then-invoke" },
    a6_fallback_resolve: { group: "Algorithm A", feature: "Expression Layer: Fallback resolve" },
    a7_call_return_edge: { group: "Algorithm A", feature: "CALL/RETURN edge propagation" },
    a8_sdk_options_pattern: { group: "Algorithm A", feature: "Opt 6: SDK options-pattern callback expansion" },
    b1_capture_fwd: { group: "Algorithm B", feature: "CAPTURE_FWD: Forward capture" },
    b2_capture_bwd: { group: "Algorithm B", feature: "Opt 3: CAPTURE_BWD: Backward capture" },
    b3_nested_closure: { group: "Algorithm B", feature: "Opt 2: Nested closure recursion" },
    b3_nested_closure_deep: { group: "Algorithm B", feature: "Opt 2: Deep nested closure (3-level)" },
    b4_capture_plus_callback: { group: "Algorithm A+B", feature: "Combined: Capture + Callback" },
    b5_bwd_via_callback: { group: "Algorithm A+B", feature: "Combined: CAPTURE_BWD + Callback" },
    b6_lazy_materialization: { group: "Optimization 5", feature: "PAG On-Demand Materialization" },
};

function classifyCase(caseName: string): { group: string; feature: string } {
    const prefix = caseName.replace(/_\d+_[TF]$/, "");
    return CASE_GROUPS[prefix] || { group: "Unknown", feature: prefix };
}

async function detectCase(scene: Scene, caseFile: string, caseName: string): Promise<boolean> {
    const entry = resolveCaseMethod(scene, caseFile, caseName);
    const entryMethod = findCaseMethod(scene, entry);
    if (!entryMethod) {
        throw new Error(`entry method not found: ${caseName}`);
    }

    const engine = await buildEngineForCase(scene, 1, entryMethod, { verbose: false });
    const seeds = collectCaseSeedNodes(engine, entryMethod, {
        sourceLocalNames: ["taint_src"],
        includeParameterLocals: true,
    });
    if (seeds.length === 0) {
        throw new Error(`no taint_src seeds found: ${caseName}`);
    }

    engine.propagateWithSeeds(seeds);
    return engine.detectSinks("Sink").length > 0;
}

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/demo/algorithm_validation");
    if (!fs.existsSync(sourceDir)) {
        throw new Error(`source dir not found: ${sourceDir}`);
    }

    const config = new SceneConfig();
    config.buildFromProjectDir(sourceDir);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);

    const caseFiles = fs.readdirSync(sourceDir)
        .filter(f => f.endsWith(".ets"))
        .sort();

    const results: CaseResult[] = [];
    for (const caseFile of caseFiles) {
        const caseName = path.basename(caseFile, ".ets");
        const expected = caseName.endsWith("_T");
        const { group, feature } = classifyCase(caseName);

        try {
            const detected = await detectCase(scene, caseFile, caseName);
            results.push({
                file: caseFile,
                name: caseName,
                expected,
                group,
                feature,
                detected,
                pass: detected === expected,
            });
        } catch (err: any) {
            results.push({
                file: caseFile,
                name: caseName,
                expected,
                group,
                feature,
                detected: false,
                pass: false,
                error: err.message || String(err),
            });
        }
    }

    const total = results.length;
    const passed = results.filter(r => r.pass).length;
    const failed = total - passed;

    console.log("╔═══════════════════════════════════════════════════════════════╗");
    console.log("║       Algorithm A + B  Validation Test Suite                 ║");
    console.log("╚═══════════════════════════════════════════════════════════════╝");
    console.log();
    console.log(`total_cases=${total}  passed=${passed}  failed=${failed}`);
    console.log();

    const groups = [...new Set(results.map(r => r.group))];
    for (const grp of groups) {
        const grpResults = results.filter(r => r.group === grp);
        const grpPassed = grpResults.filter(r => r.pass).length;
        console.log(`── ${grp} (${grpPassed}/${grpResults.length}) ──`);

        for (const r of grpResults) {
            const status = r.pass ? "PASS" : "FAIL";
            const mark = r.pass ? "✓" : "✗";
            const suffix = r.error ? ` [ERROR: ${r.error}]` : "";
            console.log(
                `  ${mark} ${status}  ${r.name}  ` +
                `expected=${r.expected ? "T" : "F"} detected=${r.detected}` +
                `  (${r.feature})${suffix}`
            );
        }
        console.log();
    }

    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`RESULT: ${failed === 0 ? "ALL PASSED" : `${failed} FAILED`}`);
    console.log("═══════════════════════════════════════════════════════════════");

    if (failed > 0) {
        process.exitCode = 1;
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
