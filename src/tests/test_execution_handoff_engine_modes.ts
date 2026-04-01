import * as path from "path";
import {
    assert,
    createIsolatedCaseView,
    ensureDir,
} from "./helpers/ExecutionHandoffContractSupport";
import { buildInferenceScene } from "./helpers/ExecutionHandoffInferenceSupport";
import { buildEngineForCase, findCaseMethod, resolveCaseMethod } from "./helpers/SyntheticCaseHarness";
import type {
    DeferredHandoffMode,
    MainlineDeferredHandoffMode,
    ResearchDeferredHandoffMode,
} from "../core/orchestration/ExecutionHandoffModes";
import { TaintPropagationEngine } from "../core/orchestration/TaintPropagationEngine";

interface EngineModeCase {
    sourceDir: string;
    caseName: string;
    relativePath: string;
    mode: DeferredHandoffMode;
}

function buildEngineModeOptions(mode: DeferredHandoffMode): {
    deferredHandoffMode?: MainlineDeferredHandoffMode;
    researchDeferredHandoffMode?: ResearchDeferredHandoffMode;
} {
    if (mode === "contract_active") {
        return { deferredHandoffMode: mode as MainlineDeferredHandoffMode };
    }
    return { researchDeferredHandoffMode: mode as ResearchDeferredHandoffMode };
}

async function buildModeCase(spec: EngineModeCase, caseViewRoot: string) {
    const projectDir = createIsolatedCaseView(path.resolve(spec.sourceDir), spec.caseName, caseViewRoot);
    const scene = buildInferenceScene(projectDir);
    const entry = resolveCaseMethod(scene, spec.relativePath, spec.caseName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, `failed to resolve entry method for ${spec.caseName}`);
    const engine = await buildEngineForCase(scene, 1, entryMethod!, {
        verbose: false,
        engineOptions: {
            ...buildEngineModeOptions(spec.mode),
        },
    });
    return { engine, scene };
}

async function main(): Promise<void> {
    const caseViewRoot = path.resolve("tmp/test_runs/research/execution_handoff_contract/latest/engine_mode_case_views");
    ensureDir(caseViewRoot);

    const guardProjectDir = createIsolatedCaseView(
        path.resolve("tests/demo/harmony_callback_registration"),
        "callback_direct_build_001_T",
        path.join(caseViewRoot, "_guard"),
    );
    const guardScene = buildInferenceScene(guardProjectDir);
    const guardEntry = resolveCaseMethod(
        guardScene,
        "callback_direct_build_001_T.ets",
        "callback_direct_build_001_T",
    );
    const guardEntryMethod = findCaseMethod(guardScene, guardEntry);
    assert(!!guardEntryMethod, "failed to resolve guard entry method");
    let guardRejected = false;
    try {
        const disallowed = new TaintPropagationEngine(guardScene, 1, {
            researchDeferredHandoffMode: "paper_like",
        });
        disallowed.verbose = false;
        await disallowed.buildPAG({ syntheticEntryMethods: [guardEntryMethod!] });
    } catch (err) {
        guardRejected = true;
    }
    assert(guardRejected, "mainline engine path should reject compare-only deferred handoff modes");

    const mainlineDefault = await buildEngineForCase(guardScene, 1, guardEntryMethod!, {
        verbose: false,
    });
    const defaultSnapshot = mainlineDefault.getExecutionHandoffContractSnapshot();
    assert(!!defaultSnapshot, "default engine path should now run contract_active");
    assert(
        defaultSnapshot!.contracts.some(contract => contract.kernel.activation === "event(c)"),
        "default engine path should infer event contracts",
    );

    const paperLikeDirect = await buildModeCase({
        sourceDir: "tests/demo/harmony_callback_registration",
        caseName: "callback_direct_build_001_T",
        relativePath: "callback_direct_build_001_T.ets",
        mode: "paper_like",
    }, caseViewRoot);
    const paperLikeDirectSnapshot = paperLikeDirect.engine.getExecutionHandoffContractSnapshot();
    assert(!!paperLikeDirectSnapshot, "paper_like should expose handoff snapshot");
    assert(paperLikeDirectSnapshot!.totalContracts === 0, "paper_like compare-only mode should not participate in mainline handoff inference");
    const paperLikeDirectEdges = paperLikeDirect.engine.getSyntheticInvokeEdgeSnapshot();
    assert(
        !paperLikeDirectEdges.calleeSignatures.some(sig => sig.includes("CallbackPage001.%AM0$build(any)")),
        "paper_like compare-only mode should not emit contract-driven callback edges",
    );

    const activeEvent = await buildModeCase({
        sourceDir: "tests/demo/harmony_callback_registration",
        caseName: "callback_direct_build_001_T",
        relativePath: "callback_direct_build_001_T.ets",
        mode: "contract_active",
    }, caseViewRoot);
    const activeEventSnapshot = activeEvent.engine.getExecutionHandoffContractSnapshot();
    assert(!!activeEventSnapshot, "contract_active should expose handoff snapshot");
    assert(
        activeEventSnapshot!.contracts.some(contract => contract.kernel.activation === "event(c)"),
        "contract_active should preserve event inference",
    );
    const activeEventContract = activeEventSnapshot!.contracts.find(contract => contract.kernel.activation === "event(c)");
    assert(!!activeEventContract, "contract_active should export an event contract");
    assert(activeEventContract!.kernel.domain === "deferred", "event contract should export deferred semantic kernel domain");
    assert(activeEventContract!.kernel.activation === "event(c)", "event contract should export event semantic activation");
    const activeEventEdges = activeEvent.engine.getSyntheticInvokeEdgeSnapshot();
    assert(
        activeEventEdges.calleeSignatures.some(sig => sig.includes("CallbackPage001.%AM0$build(any)")),
        "contract_active should emit direct event callback contract edges",
    );

    const activeRejected = await buildModeCase({
        sourceDir: "tests/adhoc/ordinary_async_language",
        caseName: "promise_then_reject_callback_007_T",
        relativePath: "promise_then_reject_callback_007_T.ets",
        mode: "contract_active",
    }, caseViewRoot);
    const activeRejectedSnapshot = activeRejected.engine.getExecutionHandoffContractSnapshot();
    assert(!!activeRejectedSnapshot, "contract_active rejected case should expose snapshot");
    assert(
        activeRejectedSnapshot!.contracts.some(contract => contract.kernel.activation === "settle(rejected)"),
        "contract_active should infer rejected continuation contracts",
    );
    const rejectedContract = activeRejectedSnapshot!.contracts.find(contract =>
        contract.kernel.activation === "settle(rejected)",
    );
    assert(!!rejectedContract, "rejected continuation should export semantic kernel activation");
    assert(rejectedContract!.ports.payload === "payload+", "rejected continuation should export payload+ port summary");
    assert(rejectedContract!.ports.completion === "promise_chain", "rejected continuation should export promise-chain completion");

    const activeCatch = await buildModeCase({
        sourceDir: "tests/adhoc/ordinary_async_language",
        caseName: "promise_catch_returned_callback_009_T",
        relativePath: "promise_catch_returned_callback_009_T.ets",
        mode: "contract_active",
    }, caseViewRoot);
    const activeCatchSnapshot = activeCatch.engine.getExecutionHandoffContractSnapshot();
    assert(!!activeCatchSnapshot, "contract_active catch case should expose snapshot");
    const catchContract = activeCatchSnapshot!.contracts.find(contract =>
        contract.kernel.activation === "settle(rejected)" && contract.ports.preserve === "settle(fulfilled)",
    );
    assert(!!catchContract, "catch continuation should be identified by rejected activation plus fulfilled preserve");

    const activeFieldCapture = await buildModeCase({
        sourceDir: "tests/adhoc/execution_handoff_compare_perturbation",
        caseName: "event_field_capture_009_T",
        relativePath: "event_field_capture_009_T.ets",
        mode: "contract_active",
    }, caseViewRoot);
    const activeFieldCaptureSnapshot = activeFieldCapture.engine.getExecutionHandoffContractSnapshot();
    assert(!!activeFieldCaptureSnapshot, "contract_active field-carried event case should expose snapshot");
    const fieldCaptureContract = activeFieldCaptureSnapshot!.contracts.find(contract =>
        contract.kernel.activation === "event(c)"
        && contract.unitSignature.includes("event_field_capture_009_T")
        && contract.unitSignature.includes("%AM0$%instInit()"),
    );
    assert(!!fieldCaptureContract, "field-carried event case should export the lowered callable unit");
    assert(fieldCaptureContract!.ports.env === "envIn", "field-carried callback should export envIn port summary");

    const paperLikeRelay = await buildModeCase({
        sourceDir: "tests/demo/harmony_callback_registration",
        caseName: "callback_helper_crossfile_003_T",
        relativePath: "callback_helper_crossfile_003_T.ets",
        mode: "paper_like",
    }, caseViewRoot);
    const paperLikeRelaySnapshot = paperLikeRelay.engine.getExecutionHandoffContractSnapshot();
    assert(!!paperLikeRelaySnapshot, "paper_like relay case should expose snapshot");
    assert(
        paperLikeRelaySnapshot!.totalContracts === 0,
        "paper_like compare-only mode should exclude relay event contracts from mainline inference",
    );
    const paperLikeRelayEdges = paperLikeRelay.engine.getSyntheticInvokeEdgeSnapshot();
    assert(
        !paperLikeRelayEdges.calleeSignatures.some(sig => sig.includes("CallbackPage003.%AM0$build(any)")),
        "paper_like should not emit relay callback contract edges",
    );

    console.log("execution_handoff_engine_modes=PASS");
}

main().catch(err => {
    console.error("execution_handoff_engine_modes=FAIL");
    console.error(err);
    process.exitCode = 1;
});
