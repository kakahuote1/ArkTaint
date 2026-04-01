import { buildTestScene } from "./helpers/TestSceneBuilder";
import {
    buildEngineForCase,
    collectCaseSeedNodes,
    findCaseMethod,
    resolveCaseMethod,
} from "./helpers/SyntheticCaseHarness";
import { resolveMethodsFromCallable } from "../core/substrate/queries/CalleeResolver";
import { resolveKnownFrameworkCallbackRegistration } from "../core/entry/shared/FrameworkCallbackClassifier";
import { buildSyntheticInvokeEdges } from "../core/kernel/builders/SyntheticInvokeEdgeBuilder";
import { buildCaptureEdgeMap } from "../core/kernel/builders/CallEdgeMapBuilder";
import { CallEdgeType } from "../core/kernel/context/TaintContext";
import * as path from "path";

type SceneLike = any;
type MethodLike = any;

const CALLABLE_RESOLVE_OPTIONS = {
    maxCandidates: 8,
    enableLocalBacktrace: true,
    maxBacktraceSteps: 5,
    maxVisitedDefs: 16,
};

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function stmtTexts(method: MethodLike): string[] {
    const cfg = method.getCfg?.();
    assert(!!cfg, `method has no cfg: ${method.getSignature?.().toString?.() || method.getName?.()}`);
    return cfg.getStmts().map((stmt: any) => stmt.toString());
}

function findMethod(scene: SceneLike, signatureNeedle: string): MethodLike {
    const methods = scene
        .getMethods()
        .filter((m: MethodLike) => (m.getSignature?.().toString?.() || "").includes(signatureNeedle));
    assert(methods.length > 0, `expected method containing "${signatureNeedle}"`);
    return methods[0];
}

function findInvokeStmt(method: MethodLike, needle: string): any {
    const cfg = method.getCfg?.();
    assert(!!cfg, `method has no cfg: ${method.getSignature?.().toString?.() || method.getName?.()}`);
    const stmt = cfg.getStmts().find((s: any) => s.toString().includes(needle));
    assert(!!stmt, `expected invoke stmt containing "${needle}"`);
    return stmt;
}

function paramBindingCounts(method: MethodLike): { payloadCount: number; captureCount: number } {
    const regex = /^\s*([^=\s]+)\s*=\s*parameter(\d+):/;
    let payloadCount = 0;
    let captureCount = 0;
    for (const text of stmtTexts(method)) {
        const match = text.match(regex);
        if (!match) continue;
        if (match[1].startsWith("%closures")) {
            captureCount += 1;
        } else {
            payloadCount += 1;
        }
    }
    return { payloadCount, captureCount };
}

async function detectCase(relativeDir: string, fileName: string, caseName: string): Promise<boolean> {
    const scene = buildTestScene(path.resolve(relativeDir));
    const entry = resolveCaseMethod(scene, fileName, caseName);
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, `entry method not found: ${caseName}`);
    const engine = await buildEngineForCase(scene, 1, entryMethod, { verbose: false });
    const seeds = collectCaseSeedNodes(engine, entryMethod, {
        sourceLocalNames: ["taint_src"],
        includeParameterLocals: true,
    });
    assert(seeds.length > 0, `no seeds found for ${caseName}`);
    engine.propagateWithSeeds(seeds);
    return engine.detectSinks("Sink").length > 0;
}

async function propositionEventRegistrationInstantiatesContract(): Promise<void> {
    const scene = buildTestScene(path.resolve("tests/demo/harmony_callback_registration"));
    const buildMethod = findMethod(scene, "CallbackPage001.build()");
    const onClickStmt = findInvokeStmt(buildMethod, ".onClick(");
    const invokeExpr = onClickStmt.getInvokeExpr();
    const explicitArgs = invokeExpr.getArgs ? invokeExpr.getArgs() : [];

    const match = resolveKnownFrameworkCallbackRegistration({
        scene,
        invokeExpr,
        explicitArgs,
        sourceMethod: buildMethod,
    });
    assert(!!match, "onClick registration should be recognized as a framework callback handoff");
    assert(
        Array.isArray(match.callbackArgIndexes) && match.callbackArgIndexes.includes(0),
        "recognized callback registration should expose callback arg slot 0",
    );

    const recovered = resolveMethodsFromCallable(scene, explicitArgs[0], CALLABLE_RESOLVE_OPTIONS);
    const signatures = recovered.map((m: any) => m.getSignature?.().toString?.() || "");
    assert(
        signatures.some(sig => sig.includes("CallbackPage001.%AM0$build(any)")),
        "callback carrier should recover the future-execution method unit %AM0$build(any)",
    );
}

async function propositionReturnCarriedCallableCanBeRecovered(): Promise<void> {
    const scene = buildTestScene(path.resolve("tests/adhoc/ordinary_async_language"));
    const outer = findMethod(scene, "%dflt.promise_catch_returned_callback_009_T(string)");
    const catchStmt = findInvokeStmt(outer, ".catch()");
    const invokeExpr = catchStmt.getInvokeExpr();
    const callbackArg = invokeExpr.getArgs()[0];

    const recovered = resolveMethodsFromCallable(scene, callbackArg, CALLABLE_RESOLVE_OPTIONS);
    const signatures = recovered.map((m: any) => m.getSignature?.().toString?.() || "");
    assert(
        signatures.some(sig => sig.includes("%dflt.%AM1$makeCatchSink(string)")),
        "return-carried callback value should recover the returned future method unit %AM1$makeCatchSink(string)",
    );

    const detected = await detectCase(
        "tests/adhoc/ordinary_async_language",
        "promise_catch_returned_callback_009_T.ets",
        "promise_catch_returned_callback_009_T",
    );
    assert(detected, "return-carried callback contract should still produce a taint flow");
}

async function propositionSyntheticActivationEdgesExist(): Promise<void> {
    const scene = buildTestScene(path.resolve("tests/demo/algorithm_validation"));
    const entry = resolveCaseMethod(scene, "b4_capture_plus_callback_001_T.ets", "b4_capture_plus_callback_001_T");
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, "entry method not found for b4_capture_plus_callback_001_T");
    const engine = await buildEngineForCase(scene, 1, entryMethod, { verbose: false });
    const edgeMap = buildSyntheticInvokeEdges(scene, engine.cg, engine.pag, () => {});

    let found = false;
    for (const edges of edgeMap.values()) {
        for (const edge of edges) {
            if (
                edge.type === CallEdgeType.CALL
                && (edge.calleeSignature || "").includes("%AM1$b4_capture_plus_callback_001_T")
            ) {
                found = true;
                break;
            }
        }
        if (found) break;
    }

    assert(found, "combined callback+capture case should materialize a synthetic activation CALL edge into the future unit");

    const detected = await detectCase(
        "tests/demo/algorithm_validation",
        "b4_capture_plus_callback_001_T.ets",
        "b4_capture_plus_callback_001_T",
    );
    assert(detected, "synthetic activation contract should produce an end-to-end taint flow");
}

async function propositionCaptureIngressEdgesExist(): Promise<void> {
    const scene = buildTestScene(path.resolve("tests/demo/algorithm_validation"));
    const entry = resolveCaseMethod(scene, "b1_capture_fwd_001_T.ets", "b1_capture_fwd_001_T");
    const entryMethod = findCaseMethod(scene, entry);
    assert(!!entryMethod, "entry method not found for b1_capture_fwd_001_T");
    const engine = await buildEngineForCase(scene, 1, entryMethod, { verbose: false });
    const captureMap = buildCaptureEdgeMap(scene, engine.cg, engine.pag, () => {});

    let foundForwardCapture = false;
    for (const edges of captureMap.values()) {
        for (const edge of edges) {
            if (
                edge.direction === "forward"
                && edge.callerMethodName === "b1_capture_fwd_001_T"
                && edge.calleeMethodName.includes("%AM0$b1_capture_fwd_001_T")
            ) {
                foundForwardCapture = true;
                break;
            }
        }
        if (foundForwardCapture) break;
    }

    assert(foundForwardCapture, "capture-driven contract should materialize forward capture edges into the future unit");

    const detected = await detectCase(
        "tests/demo/algorithm_validation",
        "b1_capture_fwd_001_T.ets",
        "b1_capture_fwd_001_T",
    );
    assert(detected, "capture-driven contract should produce an end-to-end taint flow");
}

async function propositionFinallyIsResumeDriven(): Promise<void> {
    const scene = buildTestScene(path.resolve("tests/adhoc/ordinary_async_language"));
    const outer = findMethod(scene, "%dflt.promise_finally_passthrough_011_T(string)");
    const finallyStmt = findInvokeStmt(outer, ".finally()");
    const invokeExpr = finallyStmt.getInvokeExpr();
    const callbackArg = invokeExpr.getArgs()[0];
    const recovered = resolveMethodsFromCallable(scene, callbackArg, CALLABLE_RESOLVE_OPTIONS);
    assert(recovered.length > 0, "finally callback should still recover a future method unit");

    const finallyUnit = recovered[0];
    const counts = paramBindingCounts(finallyUnit);
    assert(counts.payloadCount === 0, "finally callback unit should expose no payload ports in this sample");
    assert(counts.captureCount === 0, "this finally sample should not rely on closure env");
    assert(
        stmtTexts(outer).some(text => text.includes("result = await %1")),
        "outer method should resume at an await site after finally",
    );

    const detected = await detectCase(
        "tests/adhoc/ordinary_async_language",
        "promise_finally_passthrough_011_T.ets",
        "promise_finally_passthrough_011_T",
    );
    assert(detected, "finally+await contract should still produce an end-to-end taint flow");
}

async function main(): Promise<void> {
    await propositionEventRegistrationInstantiatesContract();
    await propositionReturnCarriedCallableCanBeRecovered();
    await propositionSyntheticActivationEdgesExist();
    await propositionCaptureIngressEdgesExist();
    await propositionFinallyIsResumeDriven();
    console.log("execution_handoff_contract_proof=PASS");
}

main().catch(err => {
    console.error("execution_handoff_contract_proof=FAIL");
    console.error(err);
    process.exitCode = 1;
});

