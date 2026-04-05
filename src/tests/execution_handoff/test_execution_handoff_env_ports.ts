import * as path from "path";
import { assert, createIsolatedCaseView, ensureDir } from "../helpers/ExecutionHandoffContractSupport";
import { buildInferenceScene } from "../helpers/ExecutionHandoffInferenceSupport";
import { buildEngineForCase, findCaseMethod, resolveCaseMethod } from "../helpers/SyntheticCaseHarness";

async function buildCase(caseName: string, caseViewRoot: string) {
    const projectDir = createIsolatedCaseView(
        path.resolve("tests/adhoc/execution_handoff_env_ports"),
        caseName,
        caseViewRoot,
    );
    const scene = buildInferenceScene(projectDir);
    const entry = resolveCaseMethod(scene, `${caseName}.ets`, caseName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, `failed to resolve entry for ${caseName}`);
    const engine = await buildEngineForCase(scene, 1, entryMethod!, {
        verbose: false,
        engineOptions: {},
    });
    return engine.getExecutionHandoffContractSnapshot();
}

function requireEventEnv(snapshot: any, expectedEnv: "envIn" | "envOut" | "envIO"): void {
    assert(!!snapshot, "expected contract snapshot");
    const contract = snapshot.contracts.find((item: any) => item.activation === "event(c)");
    assert(!!contract, "expected event handoff contract");
    assert(contract.ports.env === expectedEnv, `expected env=${expectedEnv}, got ${contract.ports.env}`);
}

async function main(): Promise<void> {
    const caseViewRoot = path.resolve("tmp/test_runs/research/execution_handoff_env_ports/latest/case_views");
    ensureDir(caseViewRoot);

    requireEventEnv(await buildCase("event_env_in_001_T", caseViewRoot), "envIn");
    requireEventEnv(await buildCase("event_env_out_002_T", caseViewRoot), "envOut");
    requireEventEnv(await buildCase("event_env_io_003_T", caseViewRoot), "envIO");

    console.log("execution_handoff_env_ports=PASS");
}

main().catch(err => {
    console.error("execution_handoff_env_ports=FAIL");
    console.error(err);
    process.exitCode = 1;
});
