import * as fs from "fs";
import * as path from "path";
import { SinkRule } from "../../core/rules/RuleSchema";
import { TaintPropagationEngine } from "../../core/orchestration/TaintPropagationEngine";
import {
    assert,
    createIsolatedCaseView,
    ensureDir,
} from "../helpers/ExecutionHandoffContractSupport";
import { buildTestScene } from "../helpers/TestSceneBuilder";
import {
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";

interface NecessityCaseSpec {
    sourceDir: string;
    caseName: string;
    relativePath: string;
    expectsAutoSources: "lifecycle" | "router" | "unknown_callback";
}

interface NecessityModeResult {
    entryModel: "arkMain" | "explicit";
    autoSourceHintCount: number;
    seedCount: number;
    flowCount: number;
}

interface NecessityCaseResult {
    caseName: string;
    category: NecessityCaseSpec["expectsAutoSources"];
    withArkMain: NecessityModeResult;
    withoutArkMain: NecessityModeResult;
}

const CASES: NecessityCaseSpec[] = [
    {
        sourceDir: "tests/demo/harmony_lifecycle",
        caseName: "lifecycle_want_direct_001_T",
        relativePath: "lifecycle_want_direct_001_T.ets",
        expectsAutoSources: "lifecycle",
    },
    {
        sourceDir: "tests/demo/harmony_lifecycle",
        caseName: "lifecycle_extension_formbinding_013_T",
        relativePath: "lifecycle_extension_formbinding_013_T.ets",
        expectsAutoSources: "lifecycle",
    },
    {
        sourceDir: "tests/demo/harmony_lifecycle",
        caseName: "lifecycle_abilitystage_oncreate_015_T",
        relativePath: "lifecycle_abilitystage_oncreate_015_T.ets",
        expectsAutoSources: "lifecycle",
    },
    {
        sourceDir: "tests/demo/harmony_lifecycle",
        caseName: "lifecycle_router_getparams_009_T",
        relativePath: "lifecycle_router_getparams_009_T.ets",
        expectsAutoSources: "router",
    },
    {
        sourceDir: "tests/demo/sdk_structural_fallback_realworld",
        caseName: "push_sdk_callback_001_T",
        relativePath: "push_sdk_callback_001_T.ets",
        expectsAutoSources: "unknown_callback",
    },
    {
        sourceDir: "tests/demo/sdk_structural_fallback_realworld",
        caseName: "payment_sdk_callback_002_T",
        relativePath: "payment_sdk_callback_002_T.ets",
        expectsAutoSources: "unknown_callback",
    },
];

const SINK_RULES: SinkRule[] = [
    {
        id: "sink.arkmain.necessity.arg0",
        target: { endpoint: "arg0" },
        match: { kind: "method_name_equals", value: "Sink" },
    },
];

async function runMode(
    projectDir: string,
    spec: NecessityCaseSpec,
    entryModel: "arkMain" | "explicit",
): Promise<NecessityModeResult> {
    const scene = buildTestScene(projectDir);
    const resolvedEntry = resolveCaseMethod(scene, spec.relativePath, spec.caseName);
    const entryMethod = findCaseMethod(scene, resolvedEntry);
    assert(!!entryMethod, `failed to resolve entry method for ${spec.caseName}`);

    const engine = new TaintPropagationEngine(scene, 1);
    engine.verbose = false;
    await engine.buildPAG({
        entryModel,
        syntheticEntryMethods: entryModel === "explicit" ? [entryMethod!] : undefined,
    });

    const reachable = engine.computeReachableMethodSignatures();
    engine.setActiveReachableMethodSignatures(reachable);

    const seedInfo = engine.propagateWithSourceRules([]);
    const flows = engine.detectSinksByRules(SINK_RULES);
    return {
        entryModel,
        autoSourceHintCount: engine.getAutoSourceHintRules().length,
        seedCount: seedInfo.seedCount,
        flowCount: flows.length,
    };
}

async function analyzeCase(spec: NecessityCaseSpec, caseViewRoot: string): Promise<NecessityCaseResult> {
    const projectDir = createIsolatedCaseView(path.resolve(spec.sourceDir), spec.caseName, caseViewRoot);
    const withArkMain = await runMode(projectDir, spec, "arkMain");
    const withoutArkMain = await runMode(projectDir, spec, "explicit");

    assert(
        withArkMain.autoSourceHintCount > 0,
        `${spec.caseName}: expected arkMain to export auto source hints`,
    );
    assert(
        withArkMain.seedCount > 0,
        `${spec.caseName}: expected arkMain to seed at least one source`,
    );
    assert(
        withArkMain.flowCount > 0,
        `${spec.caseName}: expected arkMain to detect sink flow`,
    );

    assert(
        withoutArkMain.autoSourceHintCount === 0,
        `${spec.caseName}: explicit mode should not export arkMain auto source hints`,
    );
    assert(
        withoutArkMain.seedCount === 0,
        `${spec.caseName}: explicit mode should not seed source facts without arkMain`,
    );
    assert(
        withoutArkMain.flowCount === 0,
        `${spec.caseName}: explicit mode should not detect sink flow without arkMain`,
    );

    return {
        caseName: spec.caseName,
        category: spec.expectsAutoSources,
        withArkMain,
        withoutArkMain,
    };
}

async function main(): Promise<void> {
    const outputDir = path.resolve("tmp/test_runs/research/arkmain_necessity/latest");
    const caseViewRoot = path.join(outputDir, "case_views");
    ensureDir(outputDir);
    ensureDir(caseViewRoot);

    const results: NecessityCaseResult[] = [];
    for (const spec of CASES) {
        results.push(await analyzeCase(spec, caseViewRoot));
    }

    fs.writeFileSync(
        path.join(outputDir, "arkmain_necessity.json"),
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                totalCases: results.length,
                results,
            },
            null,
            2,
        ),
        "utf8",
    );

    console.log("arkmain_necessity=PASS");
    console.log(`cases=${results.length}`);
}

main().catch(error => {
    console.error("arkmain_necessity=FAIL");
    console.error(error);
    process.exit(1);
});
