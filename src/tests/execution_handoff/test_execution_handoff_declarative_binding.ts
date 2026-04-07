import * as path from "path";
import {
    assert,
    createIsolatedCaseView,
    ensureDir,
} from "../helpers/ExecutionHandoffContractSupport";
import { buildInferenceScene } from "../helpers/ExecutionHandoffInferenceSupport";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";

interface DeclarativeBindingCaseSpec {
    caseName: string;
    unitName: string;
    expectContract: boolean;
    activationLabel?: "declare";
    carrierKind?: "field";
    env?: "envIn";
    expectedFlow: boolean;
}

const CASES: DeclarativeBindingCaseSpec[] = [
    {
        caseName: "reactive_watch_capture_001_T",
        unitName: "onTokenChanged",
        expectContract: true,
        activationLabel: "declare",
        carrierKind: "field",
        env: "envIn",
        expectedFlow: true,
    },
    {
        caseName: "reactive_monitor_capture_003_T",
        unitName: "onTokenMonitorChanged",
        expectContract: true,
        activationLabel: "declare",
        carrierKind: "field",
        env: "envIn",
        expectedFlow: true,
    },
    {
        caseName: "reactive_watch_safe_002_F",
        unitName: "onTokenChanged",
        expectContract: true,
        activationLabel: "declare",
        carrierKind: "field",
        env: "envIn",
        expectedFlow: false,
    },
    {
        caseName: "reactive_monitor_safe_004_F",
        unitName: "onTokenMonitorChanged",
        expectContract: true,
        activationLabel: "declare",
        carrierKind: "field",
        env: "envIn",
        expectedFlow: false,
    },
    {
        caseName: "reactive_watch_unqualified_005_F",
        unitName: "onTokenChanged",
        expectContract: false,
        expectedFlow: false,
    },
];

async function main(): Promise<void> {
    const sourceDir = path.resolve("tests/adhoc/execution_handoff_semantic_reactive");
    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_declarative_binding/latest");
    const caseViewRoot = path.join(outputDir, "case_views");
    ensureDir(caseViewRoot);

    for (const spec of CASES) {
        const projectDir = createIsolatedCaseView(sourceDir, spec.caseName, caseViewRoot);
        const scene = buildInferenceScene(projectDir);
        const entry = resolveCaseMethod(scene, `${spec.caseName}.ets`, spec.caseName);
        const entryMethod = findCaseMethod(scene, entry);
        assert(!!entryMethod, `missing entry method for ${spec.caseName}`);

        const engine = await buildEngineForCase(scene, 1, entryMethod!, {
            verbose: false,
            entryModel: "explicit",
        });
        const snapshot = engine.getExecutionHandoffContractSnapshot();
        assert(!!snapshot, `${spec.caseName} should export a snapshot object`);

        const handlerContract = snapshot!.contracts.find(item => item.unitSignature.includes(`.${spec.unitName}(`));
        if (spec.expectContract) {
            assert(snapshot!.totalContracts > 0, `${spec.caseName} should export at least one deferred contract`);
            assert(!!handlerContract, `${spec.caseName} should export a contract for ${spec.unitName}`);
            assert(handlerContract!.activation === "event(c)", `${spec.caseName} should recover event(c) activation`);
            assert(handlerContract!.activationLabel === spec.activationLabel, `${spec.caseName} should classify declarative bindings with activationLabel=${spec.activationLabel}`);
            assert(handlerContract!.carrierKind === spec.carrierKind, `${spec.caseName} should project field carrier kind`);
            assert(handlerContract!.ports.payload === "payload0", `${spec.caseName} declarative handler should expose no payload ports`);
            assert(handlerContract!.ports.env === spec.env, `${spec.caseName} should expose envIn from this-field reads`);
        } else {
            assert(!handlerContract, `${spec.caseName} should not export a declarative contract for ${spec.unitName}`);
        }

        const reachable = engine.computeReachableMethodSignatures();
        const reachableHandler = [...reachable].some(signature => signature.includes(`.${spec.unitName}(`));
        if (spec.expectContract) {
            assert(
                reachableHandler,
                `${spec.caseName} should make ${spec.unitName} reachable through deferred binding`,
            );
        } else {
            assert(
                !reachableHandler,
                `${spec.caseName} should not make ${spec.unitName} reachable through declarative binding`,
            );
        }

        const seeds = collectCaseSeedNodes(engine, entryMethod!, {
            sourceLocalNames: ["taint_src"],
            includeParameterLocals: true,
        });
        assert(seeds.length > 0, `${spec.caseName} should expose source seeds`);
        engine.propagateWithSeeds(seeds);
        const detected = engine.detectSinks("Sink").length > 0;
        assert(
            detected === spec.expectedFlow,
            `${spec.caseName} expected flow=${spec.expectedFlow}, got ${detected}`,
        );
    }

    console.log("execution_handoff_declarative_binding=PASS");
    console.log(`cases=${CASES.length}`);
}

main().catch(err => {
    console.error("execution_handoff_declarative_binding=FAIL");
    console.error(err);
    process.exitCode = 1;
});
