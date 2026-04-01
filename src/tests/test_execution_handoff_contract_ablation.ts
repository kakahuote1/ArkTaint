import * as fs from "fs";
import * as path from "path";
import {
    assert,
    createIsolatedCaseView,
    ensureDir,
    findMethod,
    findMethodByStmt,
    meaningfulFutureUnits,
    methodSignature,
} from "./helpers/ExecutionHandoffContractSupport";
import {
    buildInferenceScene,
    collectFeatures,
    inferDeferred,
    inferResume,
    inferTau,
    InferenceFeatures,
    ResumeKind,
    TriggerToken,
} from "./helpers/ExecutionHandoffInferenceSupport";

type SceneLike = any;
type MethodLike = any;

type AblationKey =
    | "registrationReachability"
    | "invokeName"
    | "matchingArgIndexes"
    | "payloadPorts"
    | "hasAwaitResume";

interface InferenceCaseSpec {
    id: string;
    sourceDir: string;
    caseName: string;
    witnessNeedle: string;
    outerNeedle?: string;
    unitNeedle?: string;
    expectedTau: TriggerToken;
    expectedResume: ResumeKind;
    expectedDeferred: boolean;
}

interface AblationRecord {
    ablation: AblationKey;
    driftedCases: Array<{
        id: string;
        tauBefore: TriggerToken;
        tauAfter: TriggerToken;
        resumeBefore: ResumeKind;
        resumeAfter: ResumeKind;
        deferredBefore: boolean;
        deferredAfter: boolean;
    }>;
}

const CASES: InferenceCaseSpec[] = [
    {
        id: "event_direct_registration",
        sourceDir: "tests/demo/harmony_callback_registration",
        caseName: "callback_direct_build_001_T",
        outerNeedle: "CallbackPage001.build()",
        unitNeedle: "CallbackPage001.%AM0$build(any)",
        witnessNeedle: ".onClick(",
        expectedTau: "event(c)",
        expectedResume: "none",
        expectedDeferred: true,
    },
    {
        id: "event_helper_forwarding",
        sourceDir: "tests/demo/harmony_callback_registration",
        caseName: "callback_helper_samefile_002_T",
        outerNeedle: "%dflt.registerClick(",
        unitNeedle: "CallbackPage002.%AM0$build(any)",
        witnessNeedle: ".onClick(",
        expectedTau: "event(c)",
        expectedResume: "none",
        expectedDeferred: true,
    },
    {
        id: "event_nested_forwarding",
        sourceDir: "tests/demo/harmony_callback_registration",
        caseName: "callback_helper_crossfile_003_T",
        outerNeedle: "%dflt.registerClick(",
        unitNeedle: "CallbackPage003.%AM0$build(any)",
        witnessNeedle: ".onClick(",
        expectedTau: "event(c)",
        expectedResume: "none",
        expectedDeferred: true,
    },
    {
        id: "settle_then_fulfilled_payload",
        sourceDir: "tests/adhoc/ordinary_async_language",
        caseName: "promise_then_callback_alias_001_T",
        outerNeedle: "%dflt.promise_then_callback_alias_001_T(string)",
        witnessNeedle: ".then()",
        expectedTau: "settle(fulfilled)",
        expectedResume: "promise_chain",
        expectedDeferred: true,
    },
    {
        id: "settle_then_rejected_payload",
        sourceDir: "tests/adhoc/ordinary_async_language",
        caseName: "promise_then_reject_callback_007_T",
        outerNeedle: "%dflt.promise_then_reject_callback_007_T(string)",
        unitNeedle: "%dflt.%AM1$promise_then_reject_callback_007_T(string)",
        witnessNeedle: ".then()",
        expectedTau: "settle(rejected)",
        expectedResume: "promise_chain",
        expectedDeferred: true,
    },
    {
        id: "settle_finally_empty_payload",
        sourceDir: "tests/adhoc/ordinary_async_language",
        caseName: "promise_finally_passthrough_011_T",
        outerNeedle: "%dflt.promise_finally_passthrough_011_T(string)",
        unitNeedle: "%dflt.%AM0$promise_finally_passthrough_011_T()",
        witnessNeedle: ".finally()",
        expectedTau: "settle(any)",
        expectedResume: "await_site",
        expectedDeferred: true,
    },
    {
        id: "await_resume_observation",
        sourceDir: "tests/adhoc/ordinary_async_language",
        caseName: "await_catch_chain_013_T",
        outerNeedle: "%dflt.await_catch_chain_013_T(string)",
        unitNeedle: "%dflt.%AM0$await_catch_chain_013_T(string)",
        witnessNeedle: ".catch()",
        expectedTau: "settle(rejected)",
        expectedResume: "await_site",
        expectedDeferred: true,
    },
];

function resolveOuterMethod(scene: SceneLike, spec: InferenceCaseSpec): MethodLike {
    if (spec.outerNeedle) {
        return findMethod(scene, spec.outerNeedle);
    }
    return findMethodByStmt(scene, spec.witnessNeedle);
}

function resolveFutureUnit(scene: SceneLike, spec: InferenceCaseSpec): MethodLike {
    if (spec.unitNeedle) {
        return findMethod(scene, spec.unitNeedle);
    }
    const units = meaningfulFutureUnits(scene, spec.caseName);
    assert(units.length === 1, `expected exactly one meaningful future unit for ${spec.caseName}, got ${units.length}`);
    return units[0];
}

function ablate(features: InferenceFeatures, key: AblationKey): InferenceFeatures {
    switch (key) {
        case "registrationReachability":
            return { ...features, localRegistration: false, registrationReachabilityDepth: null };
        case "invokeName":
            return { ...features, invokeName: null };
        case "matchingArgIndexes":
            return { ...features, matchingArgIndexes: [] };
        case "payloadPorts":
            return { ...features, payloadPorts: Math.max(features.payloadPorts, 1) };
        case "hasAwaitResume":
            return { ...features, hasAwaitResume: false };
    }
}

function analyzeCase(spec: InferenceCaseSpec, caseViewRoot: string): { id: string; features: InferenceFeatures } {
    const projectDir = createIsolatedCaseView(path.resolve(spec.sourceDir), spec.caseName, caseViewRoot);
    const scene = buildInferenceScene(projectDir);
    const outer = resolveOuterMethod(scene, spec);
    const unit = resolveFutureUnit(scene, spec);
    const features = collectFeatures(scene, outer, unit, spec.witnessNeedle);

    assert(inferTau(features) === spec.expectedTau, `${spec.id} baseline tau mismatch`);
    assert(inferResume(features) === spec.expectedResume, `${spec.id} baseline resume mismatch`);
    assert(inferDeferred(features) === spec.expectedDeferred, `${spec.id} baseline deferred mismatch`);

    return { id: spec.id, features };
}

function main(): void {
    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_contract/latest");
    const caseViewRoot = path.join(outputDir, "ablation_case_views");
    ensureDir(outputDir);
    ensureDir(caseViewRoot);

    const baselines = CASES.map(spec => analyzeCase(spec, caseViewRoot));
    const ablations: AblationKey[] = [
        "registrationReachability",
        "invokeName",
        "matchingArgIndexes",
        "payloadPorts",
        "hasAwaitResume",
    ];

    const records: AblationRecord[] = ablations.map(ablationKey => {
        const driftedCases = baselines.flatMap(({ id, features }) => {
            const mutated = ablate(features, ablationKey);
            const tauBefore = inferTau(features);
            const tauAfter = inferTau(mutated);
            const resumeBefore = inferResume(features);
            const resumeAfter = inferResume(mutated);
            const deferredBefore = inferDeferred(features);
            const deferredAfter = inferDeferred(mutated);
            if (tauBefore === tauAfter && resumeBefore === resumeAfter && deferredBefore === deferredAfter) {
                return [];
            }
            return [{
                id,
                tauBefore,
                tauAfter,
                resumeBefore,
                resumeAfter,
                deferredBefore,
                deferredAfter,
            }];
        });
        assert(driftedCases.length > 0, `ablation ${ablationKey} should alter at least one inference result`);
        return { ablation: ablationKey, driftedCases };
    });

    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_contract_ablation.json"),
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                totalCases: baselines.length,
                records,
            },
            null,
            2,
        ),
        "utf8",
    );

    console.log("execution_handoff_contract_ablation=PASS");
    console.log(`ablations=${records.length}`);
}

try {
    main();
} catch (err) {
    console.error("execution_handoff_contract_ablation=FAIL");
    console.error(err);
    process.exitCode = 1;
}
