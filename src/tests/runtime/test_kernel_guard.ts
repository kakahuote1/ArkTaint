/**
 * Kernel guard: cheap invariants on top of the algorithm demo corpus.
 *
 * - Repeatability: two fresh engines on the same Scene must agree on detect/no-detect.
 *   If they disagree, suspect shared mutable state or order-dependent logic (fix there,
 *   not by special-casing one case file).
 * - Bounded sinks on positive cases: catches runaway propagation / duplicate sinks.
 *
 * Optional perf (off by default; set ARKTAINT_PERF_GUARD=1):
 *   ARKTAINT_PERF_GUARD_MS caps median wall time per case (default 45000).
 *
 * Requires root `npm install` (Node typings) and `arkanalyzer` deps
 * (`ohos-typescript`); root package.json postinstall installs arkanalyzer.
 */
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

const SOURCE_DIR = path.resolve("tests/demo/algorithm_validation");
/** Representative mix: straight-line T/F, nested, callback combine. */
const CASE_FILES = [
    "a1_expr_project_cg_001_T.ets",
    "a1_expr_project_cg_002_F.ets",
    "b3_nested_closure_deep_003_T.ets",
    "b4_capture_plus_callback_001_T.ets",
    "a4_param_ip_direct_002_F.ets",
];
const MAX_SINKS_POSITIVE = 500;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function runOnce(
    scene: Scene,
    caseFile: string,
    caseName: string,
): Promise<{ detected: boolean; sinkCount: number }> {
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
    assert(seeds.length > 0, `no taint_src seeds: ${caseName}`);
    engine.propagateWithSeeds(seeds);
    const sinks = engine.detectSinks("Sink");
    return { detected: sinks.length > 0, sinkCount: sinks.length };
}

async function assertRepeatable(scene: Scene, caseFile: string): Promise<void> {
    const caseName = path.basename(caseFile, ".ets");
    const first = await runOnce(scene, caseFile, caseName);
    const second = await runOnce(scene, caseFile, caseName);
    assert(
        first.detected === second.detected,
        `nondeterministic detection for ${caseName}: ` +
            `first=${first.detected} second=${second.detected} ` +
            `(investigate shared mutable Scene/engine state, not this .ets alone)`,
    );
    assert(
        first.sinkCount === second.sinkCount,
        `nondeterministic sink count for ${caseName}: ${first.sinkCount} vs ${second.sinkCount}`,
    );
    const expectedPositive = caseName.endsWith("_T");
    if (expectedPositive) {
        assert(first.detected, `expected leak for ${caseName}`);
        assert(
            first.sinkCount <= MAX_SINKS_POSITIVE,
            `sink explosion for ${caseName}: ${first.sinkCount} (cap ${MAX_SINKS_POSITIVE})`,
        );
    } else {
        assert(!first.detected, `expected no leak for ${caseName}`);
    }
}

function median(nums: number[]): number {
    const s = [...nums].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
}

async function main(): Promise<void> {
    if (!fs.existsSync(SOURCE_DIR)) {
        throw new Error(`missing demo dir: ${SOURCE_DIR}`);
    }

    const config = new SceneConfig();
    config.buildFromProjectDir(SOURCE_DIR);
    const scene = new Scene();
    scene.buildSceneFromProjectDir(config);
    scene.inferTypes();
    registerMockSdkFiles(scene);

    for (const caseFile of CASE_FILES) {
        const full = path.join(SOURCE_DIR, caseFile);
        assert(fs.existsSync(full), `missing case file: ${caseFile}`);
        await assertRepeatable(scene, caseFile);
    }

    if (process.env.ARKTAINT_PERF_GUARD === "1") {
        const cap = Number(process.env.ARKTAINT_PERF_GUARD_MS || "45000");
        const sample = CASE_FILES[0]!;
        const caseName = path.basename(sample, ".ets");
        const timings: number[] = [];
        for (let i = 0; i < 5; i++) {
            const t0 = performance.now();
            await runOnce(scene, sample, caseName);
            timings.push(performance.now() - t0);
        }
        const med = median(timings);
        assert(
            med <= cap,
            `perf guard: median ${med.toFixed(0)}ms > cap ${cap}ms for ${sample}`,
        );
        console.log(`perf_guard median_ms=${med.toFixed(0)} cap_ms=${cap}`);
    }

    console.log("PASS test_kernel_guard");
}

main().catch(err => {
    console.error("FAIL test_kernel_guard");
    console.error(err);
    process.exit(1);
});
