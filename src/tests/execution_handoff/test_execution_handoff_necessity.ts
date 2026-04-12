import * as fs from "fs";
import * as path from "path";
import {
    assert,
    createIsolatedCaseView,
    ensureDir,
} from "../helpers/ExecutionHandoffContractSupport";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "../helpers/SyntheticCaseHarness";
import { buildInferenceScene } from "../helpers/ExecutionHandoffInferenceSupport";
import { detectSinks as runSinkDetector } from "../../core/kernel/rules/SinkDetector";

interface NecessityCaseSpec {
    sourceDir: string;
    caseName: string;
    relativePath: string;
    expectedContract: {
        carrierKind: string;
        pathLabels: string[];
        activation: "event(c)" | "settle(fulfilled)" | "settle(rejected)" | "settle(any)";
        ports: {
            payload: "payload0" | "payload+";
            env: "env0" | "envIn" | "envOut" | "envIO";
            completion: "none" | "promise_chain" | "await_site";
            preserve: "preserve0" | "settle(rejected)" | "settle(fulfilled)" | "settle(any)" | "mixed";
        };
    };
}

interface NecessityCaseResult {
    caseName: string;
    observedWithD: boolean;
    observedWithoutD: boolean;
    contractsWithD: number;
    contractsWithoutD: number;
}

const CASES: NecessityCaseSpec[] = [
    {
        sourceDir: "tests/adhoc/execution_handoff_semantic_event",
        caseName: "event_direct_capture_001_T",
        relativePath: "event_direct_capture_001_T.ets",
        expectedContract: {
            carrierKind: "returned",
            pathLabels: ["return", "register"],
            activation: "event(c)",
            ports: { payload: "payload0", env: "envIn", completion: "none", preserve: "preserve0" },
        },
    },
    {
        sourceDir: "tests/adhoc/execution_handoff_env_ports",
        caseName: "event_payload_param_004_T",
        relativePath: "event_payload_param_004_T.ets",
        expectedContract: {
            carrierKind: "returned",
            pathLabels: ["return", "register"],
            activation: "event(c)",
            ports: { payload: "payload+", env: "env0", completion: "none", preserve: "preserve0" },
        },
    },
    {
        sourceDir: "tests/adhoc/execution_handoff_env_ports",
        caseName: "event_payload_out_005_T",
        relativePath: "event_payload_out_005_T.ets",
        expectedContract: {
            carrierKind: "returned",
            pathLabels: ["return", "register"],
            activation: "event(c)",
            ports: { payload: "payload+", env: "envOut", completion: "none", preserve: "preserve0" },
        },
    },
    {
        sourceDir: "tests/adhoc/execution_handoff_env_ports",
        caseName: "event_payload_io_006_T",
        relativePath: "event_payload_io_006_T.ets",
        expectedContract: {
            carrierKind: "returned",
            pathLabels: ["return", "register"],
            activation: "event(c)",
            ports: { payload: "payload+", env: "envIO", completion: "none", preserve: "preserve0" },
        },
    },
    {
        sourceDir: "tests/adhoc/execution_handoff_semantic_async",
        caseName: "promise_finally_capture_005_T",
        relativePath: "promise_finally_capture_005_T.ets",
        expectedContract: {
            carrierKind: "returned",
            pathLabels: ["return", "settle_a", "resume"],
            activation: "settle(any)",
            ports: { payload: "payload0", env: "envIn", completion: "none", preserve: "settle(any)" },
        },
    },
    {
        sourceDir: "tests/adhoc/execution_handoff_semantic_async",
        caseName: "promise_catch_await_payload_003_T",
        relativePath: "promise_catch_await_payload_003_T.ets",
        expectedContract: {
            carrierKind: "returned",
            pathLabels: ["return", "settle_r", "resume"],
            activation: "settle(rejected)",
            ports: { payload: "payload+", env: "env0", completion: "await_site", preserve: "settle(fulfilled)" },
        },
    },
];

function ablateExecutionHandoff(engine: any): void {
    engine.executionHandoffSnapshot = undefined;
    engine.executionHandoffDeferredSiteKeys = undefined;
    engine.syntheticInvokeEdgeMap = new Map();
    engine.syntheticInvokeLazyMaterializer = undefined;

    const cacheEntry = engine.activePagCacheEntry;
    if (!cacheEntry) return;
    cacheEntry.executionHandoffSnapshot = undefined;
    cacheEntry.executionHandoffDeferredSiteKeys = undefined;
    cacheEntry.syntheticInvokeEdgeMap = new Map();
    cacheEntry.syntheticInvokeLazyMaterializer = undefined;
    cacheEntry.syntheticInvokeEdgeMapReady = true;
}

function contractHasSyntheticEdge(engine: any, contract: any): boolean {
    const expectedCaller = contract.callerSignature || "";
    const expectedUnitName = extractUnitName(contract.unitSignature || "");
    for (const edges of engine.syntheticInvokeEdgeMap?.values?.() || []) {
        for (const edge of edges) {
            if (!edge.callerSignature || edge.callerSignature !== expectedCaller) continue;
            if ((edge.calleeMethodName || "") === expectedUnitName) {
                return true;
            }
        }
    }
    return false;
}

function extractUnitName(unitSignature: string): string {
    const lastDot = unitSignature.lastIndexOf(".");
    const paren = unitSignature.indexOf("(", Math.max(lastDot, 0));
    if (lastDot < 0 || paren < 0 || paren <= lastDot + 1) {
        return unitSignature;
    }
    return unitSignature.slice(lastDot + 1, paren);
}

function computeStrictReachableMethodSignatures(engine: any): Set<string> {
    const reachable = new Set<string>(engine.explicitEntryScopeMethodSignatures || []);
    const syntheticAdj = new Map<string, Set<string>>();
    for (const edges of engine.syntheticInvokeEdgeMap?.values?.() || []) {
        for (const edge of edges) {
            if (edge.type !== "call" && edge.type !== 0) continue;
            if (!edge.callerSignature || !edge.calleeSignature) continue;
            if (!syntheticAdj.has(edge.callerSignature)) {
                syntheticAdj.set(edge.callerSignature, new Set<string>());
            }
            syntheticAdj.get(edge.callerSignature)!.add(edge.calleeSignature);
        }
    }

    const queue = [...reachable];
    const visited = new Set<string>(reachable);
    for (let head = 0; head < queue.length; head++) {
        const sig = queue[head];
        const syntheticCallees = syntheticAdj.get(sig) || new Set<string>();
        for (const callee of syntheticCallees) {
            if (visited.has(callee)) continue;
            visited.add(callee);
            reachable.add(callee);
            queue.push(callee);
        }
    }
    return reachable;
}

function detectScopedSinkReachability(engine: any): boolean {
    const allowedMethodSignatures = computeStrictReachableMethodSignatures(engine);
    return runSinkDetector(
        engine.scene,
        engine.cg,
        engine.pag,
        engine.tracker,
        "Sink",
        () => {},
        {
            fieldToVarIndex: engine.fieldToVarIndex,
            allowedMethodSignatures,
        },
    ).length > 0;
}

async function analyzeCase(spec: NecessityCaseSpec, caseViewRoot: string): Promise<NecessityCaseResult> {
    const projectDir = createIsolatedCaseView(path.resolve(spec.sourceDir), spec.caseName, caseViewRoot);
    const sceneWithoutD = buildInferenceScene(projectDir);
    const entryWithoutD = resolveCaseMethod(sceneWithoutD, spec.relativePath, spec.caseName);
    const entryMethodWithoutD = findCaseMethod(sceneWithoutD, entryWithoutD);
    assert(!!entryMethodWithoutD, `failed to resolve entry for ${spec.caseName} without D`);

    const engineWithoutD = await buildEngineForCase(sceneWithoutD, 1, entryMethodWithoutD!, {
        verbose: false,
        entryModel: "explicit",
    });
    ablateExecutionHandoff(engineWithoutD as any);
    const seedsWithoutD = collectCaseSeedNodes(engineWithoutD, entryMethodWithoutD!, {
        sourceLocalNames: ["taint_src"],
        includeParameterLocals: true,
    });
    assert(seedsWithoutD.length > 0, `no seeds found for ${spec.caseName} without D`);
    engineWithoutD.propagateWithSeeds(seedsWithoutD);
    const observedWithoutD = detectScopedSinkReachability(engineWithoutD as any);
    const contractsWithoutD = engineWithoutD.getExecutionHandoffContractSnapshot()?.totalContracts || 0;

    const sceneWithD = buildInferenceScene(projectDir);
    const entryWithD = resolveCaseMethod(sceneWithD, spec.relativePath, spec.caseName);
    const entryMethodWithD = findCaseMethod(sceneWithD, entryWithD);
    assert(!!entryMethodWithD, `failed to resolve entry for ${spec.caseName} with D`);

    const engineWithD = await buildEngineForCase(sceneWithD, 1, entryMethodWithD!, {
        verbose: false,
        entryModel: "explicit",
    });
    const seedsWithD = collectCaseSeedNodes(engineWithD, entryMethodWithD!, {
        sourceLocalNames: ["taint_src"],
        includeParameterLocals: true,
    });
    assert(seedsWithD.length > 0, `no seeds found for ${spec.caseName} with D`);
    engineWithD.propagateWithSeeds(seedsWithD);
    const observedWithD = detectScopedSinkReachability(engineWithD as any);
    const contractsWithD = engineWithD.getExecutionHandoffContractSnapshot()?.totalContracts || 0;

    assert(
        observedWithoutD === false,
        `${spec.caseName}: expected no sink reachability without D`,
    );
    assert(
        observedWithD === true,
        `${spec.caseName}: expected sink reachability with D`,
    );

    assert(
        contractsWithoutD === 0,
        `${spec.caseName}: expected no execution handoff contracts without D, got ${contractsWithoutD}`,
    );
    assert(
        contractsWithD === 1,
        `${spec.caseName}: expected exactly one exported execution handoff contract with D, got ${contractsWithD}`,
    );
    const contractWithD = engineWithD.getExecutionHandoffContractSnapshot()!.contracts[0];
    assert(
        contractWithD.carrierKind === spec.expectedContract.carrierKind,
        `${spec.caseName}: expected carrierKind=${spec.expectedContract.carrierKind}, got ${contractWithD.carrierKind}`,
    );
    assert(
        JSON.stringify(contractWithD.pathLabels) === JSON.stringify(spec.expectedContract.pathLabels),
        `${spec.caseName}: expected path=${JSON.stringify(spec.expectedContract.pathLabels)}, got ${JSON.stringify(contractWithD.pathLabels)}`,
    );
    assert(
        contractWithD.activation === spec.expectedContract.activation,
        `${spec.caseName}: expected activation=${spec.expectedContract.activation}, got ${contractWithD.activation}`,
    );
    assert(
        JSON.stringify(contractWithD.ports) === JSON.stringify(spec.expectedContract.ports),
        `${spec.caseName}: expected ports=${JSON.stringify(spec.expectedContract.ports)}, got ${JSON.stringify(contractWithD.ports)}`,
    );
    assert(
        contractHasSyntheticEdge(engineWithD as any, contractWithD),
        `${spec.caseName}: expected at least one D-owned synthetic edge for exported contract ${contractWithD.unitSignature}`,
    );

    return {
        caseName: spec.caseName,
        observedWithD,
        observedWithoutD,
        contractsWithD,
        contractsWithoutD,
    };
}

async function main(): Promise<void> {
    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_necessity/latest");
    const caseViewRoot = path.join(outputDir, "case_views");
    ensureDir(outputDir);
    ensureDir(caseViewRoot);

    const results: NecessityCaseResult[] = [];
    for (const spec of CASES) {
        results.push(await analyzeCase(spec, caseViewRoot));
    }

    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_necessity.json"),
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

    console.log("execution_handoff_necessity=PASS");
    console.log(`cases=${results.length}`);
}

main().catch(err => {
    console.error("execution_handoff_necessity=FAIL");
    console.error(err);
    process.exitCode = 1;
});
