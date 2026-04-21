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
} from "../helpers/ExecutionHandoffContractSupport";
import {
    buildInferenceScene,
    collectFeatures,
    inferDeferred,
    inferResume,
    inferTau,
    InferenceFeatures,
    ResumeKind,
    TriggerToken,
} from "../helpers/ExecutionHandoffInferenceSupport";

type SceneLike = any;
type MethodLike = any;

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

interface InferenceRecord extends InferenceFeatures {
    id: string;
    outerMethod: string;
    futureUnit: string;
    inferredTau: TriggerToken;
    inferredResume: ResumeKind;
    inferredDeferred: boolean;
    expectedTau: TriggerToken;
    expectedResume: ResumeKind;
    expectedDeferred: boolean;
}

const POSITIVE_CASES: InferenceCaseSpec[] = [
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
        id: "call_returned_closure",
        sourceDir: "tests/adhoc/ordinary_callable_language",
        caseName: "nested_closure_capture_009_T",
        outerNeedle: "%dflt.nested_closure_capture_009_T(string)",
        unitNeedle: "%dflt.%AM1$makeLeak([secret])",
        witnessNeedle: "ptrinvoke fp",
        expectedTau: "call(c)",
        expectedResume: "none",
        expectedDeferred: false,
    },
    {
        id: "call_return_callable_payload",
        sourceDir: "tests/adhoc/ordinary_callable_language",
        caseName: "helper_return_callable_007_T",
        outerNeedle: "%dflt.helper_return_callable_007_T(string)",
        unitNeedle: "%dflt.%AM1$makeSinker(string)",
        witnessNeedle: "ptrinvoke fp",
        expectedTau: "call(c)",
        expectedResume: "none",
        expectedDeferred: false,
    },
    {
        id: "call_field_callable_payload",
        sourceDir: "tests/adhoc/ordinary_callable_language",
        caseName: "anonymous_object_field_callable_015_T",
        outerNeedle: "%dflt.anonymous_object_field_callable_015_T(string)",
        unitNeedle: "%dflt.%AM0$anonymous_object_field_callable_015_T(string)",
        witnessNeedle: "ptrinvoke fp",
        expectedTau: "call(c)",
        expectedResume: "none",
        expectedDeferred: false,
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
        id: "settle_catch_return_callable",
        sourceDir: "tests/adhoc/ordinary_async_language",
        caseName: "promise_catch_returned_callback_009_T",
        outerNeedle: "%dflt.promise_catch_returned_callback_009_T(string)",
        unitNeedle: "%dflt.%AM1$makeCatchSink(string)",
        witnessNeedle: ".catch()",
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

const NEGATIVE_CASES: InferenceCaseSpec[] = [
    {
        id: "direct_sync_hof_sort",
        sourceDir: "tests/demo/layer4_hard_negatives",
        caseName: "layer4_sync_hof_sort_001_F",
        outerNeedle: "Layer4SortPage.build()",
        unitNeedle: "Layer4SortPage.%AM0$build(number, number)",
        witnessNeedle: "sort(",
        expectedTau: "call(c)",
        expectedResume: "none",
        expectedDeferred: false,
    },
    {
        id: "direct_sync_helper",
        sourceDir: "tests/demo/layer4_hard_negatives",
        caseName: "layer4_samefile_sync_helper_004_F",
        outerNeedle: "Layer4SyncHelperPage.build()",
        unitNeedle: "Layer4SyncHelperPage.%AM0$build(string)",
        witnessNeedle: "transformPayload",
        expectedTau: "call(c)",
        expectedResume: "none",
        expectedDeferred: false,
    },
    {
        id: "direct_immediate_runner",
        sourceDir: "tests/demo/layer4_hard_negatives",
        caseName: "layer4_immediate_runner_005_F",
        outerNeedle: "Layer4ImmediateRunnerPage.build()",
        unitNeedle: "Layer4ImmediateRunnerPage.%AM0$build()",
        witnessNeedle: "ImmediateRunner.run(",
        expectedTau: "call(c)",
        expectedResume: "none",
        expectedDeferred: false,
    },
    {
        id: "direct_internal_constructor_executor",
        sourceDir: "tests/demo/layer4_hard_negatives",
        caseName: "layer4_internal_constructor_executor_007_F",
        outerNeedle: "Layer4InternalConstructorExecutorPage.aboutToAppear()",
        unitNeedle: "Layer4InternalConstructorExecutorPage.%AM0$aboutToAppear(",
        witnessNeedle: "InternalAsyncExecutor.constructor(",
        expectedTau: "call(c)",
        expectedResume: "none",
        expectedDeferred: false,
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

function analyzeCase(spec: InferenceCaseSpec, caseViewRoot: string): InferenceRecord {
    const projectDir = createIsolatedCaseView(path.resolve(spec.sourceDir), spec.caseName, caseViewRoot);
    const scene = buildInferenceScene(projectDir);
    const outer = resolveOuterMethod(scene, spec);
    const unit = resolveFutureUnit(scene, spec);
    const features = collectFeatures(scene, outer, unit, spec.witnessNeedle);
    const inferredTau = inferTau(features);
    const inferredResume = inferResume(features);
    const inferredDeferred = inferDeferred(features);

    assert(inferredTau === spec.expectedTau, `${spec.id} expected tau ${spec.expectedTau}, got ${inferredTau}`);
    assert(inferredResume === spec.expectedResume, `${spec.id} expected resume ${spec.expectedResume}, got ${inferredResume}`);
    assert(inferredDeferred === spec.expectedDeferred, `${spec.id} expected deferred=${spec.expectedDeferred}, got ${inferredDeferred}`);

    return {
        id: spec.id,
        outerMethod: methodSignature(outer),
        futureUnit: methodSignature(unit),
        inferredTau,
        inferredResume,
        inferredDeferred,
        expectedTau: spec.expectedTau,
        expectedResume: spec.expectedResume,
        expectedDeferred: spec.expectedDeferred,
        ...features,
    };
}

function main(): void {
    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_contract/latest");
    const caseViewRoot = path.join(outputDir, "inference_case_views");
    ensureDir(outputDir);
    ensureDir(caseViewRoot);

    const specs = [...POSITIVE_CASES, ...NEGATIVE_CASES];
    const records = specs.map(spec => analyzeCase(spec, caseViewRoot));
    const tauCounts = records.reduce<Record<TriggerToken, number>>(
        (acc, record) => {
            acc[record.inferredTau] += 1;
            return acc;
        },
        {
            "call(c)": 0,
            "event(c)": 0,
            "settle(fulfilled)": 0,
            "settle(rejected)": 0,
            "settle(any)": 0,
        },
    );
    const resumeCounts = records.reduce<Record<ResumeKind, number>>(
        (acc, record) => {
            acc[record.inferredResume] += 1;
            return acc;
        },
        {
            none: 0,
            promise_chain: 0,
            await_site: 0,
        },
    );
    const deferredCount = records.filter(record => record.inferredDeferred).length;

    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_contract_inference.json"),
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                totalCases: records.length,
                deferredCount,
                tauCounts,
                resumeCounts,
                records,
            },
            null,
            2,
        ),
        "utf8",
    );

    console.log("execution_handoff_contract_inference=PASS");
    console.log(`cases=${records.length}`);
    console.log(
        `tau call=${tauCounts["call(c)"]} event=${tauCounts["event(c)"]} fulfilled=${tauCounts["settle(fulfilled)"]} rejected=${tauCounts["settle(rejected)"]} any=${tauCounts["settle(any)"]}`,
    );
    console.log(
        `resume none=${resumeCounts.none} promise_chain=${resumeCounts.promise_chain} await_site=${resumeCounts.await_site} deferred=${deferredCount}`,
    );
}

try {
    main();
} catch (err) {
    console.error("execution_handoff_contract_inference=FAIL");
    console.error(err);
    process.exitCode = 1;
}
