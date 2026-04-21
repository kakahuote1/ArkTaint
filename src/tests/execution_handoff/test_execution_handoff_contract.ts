import * as path from "path";
import { buildTestScene } from "../helpers/TestSceneBuilder";

type SceneLike = any;
type MethodLike = any;

interface ParamBinding {
    local: string;
    index: number;
    raw: string;
}

const sceneCache = new Map<string, SceneLike>();

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function getScene(relativeDir: string): SceneLike {
    const resolved = path.resolve(relativeDir);
    const cached = sceneCache.get(resolved);
    if (cached) {
        return cached;
    }
    const scene = buildTestScene(resolved);
    sceneCache.set(resolved, scene);
    return scene;
}

function findMethod(scene: SceneLike, signatureNeedle: string): MethodLike {
    const methods = scene
        .getMethods()
        .filter((m: MethodLike) => (m.getSignature?.().toString?.() || "").includes(signatureNeedle));
    assert(methods.length > 0, `expected method containing "${signatureNeedle}"`);
    return methods[0];
}

function stmtTexts(method: MethodLike): string[] {
    const cfg = method.getCfg?.();
    assert(!!cfg, `method has no cfg: ${method.getSignature?.().toString?.() || method.getName?.()}`);
    return cfg.getStmts().map((stmt: any) => stmt.toString());
}

function paramBindings(method: MethodLike): ParamBinding[] {
    const regex = /^\s*([^=\s]+)\s*=\s*parameter(\d+):/;
    return stmtTexts(method)
        .map(raw => {
            const match = raw.match(regex);
            if (!match) {
                return undefined;
            }
            return {
                local: match[1],
                index: Number(match[2]),
                raw,
            };
        })
        .filter((item): item is ParamBinding => !!item);
}

function payloadBindings(method: MethodLike): ParamBinding[] {
    return paramBindings(method).filter(binding => !binding.local.startsWith("%closures"));
}

function captureBindings(method: MethodLike): ParamBinding[] {
    return paramBindings(method).filter(binding => binding.local.startsWith("%closures"));
}

function assertStmtIncludes(method: MethodLike, needle: string, label?: string): void {
    const texts = stmtTexts(method);
    assert(
        texts.some(text => text.includes(needle)),
        `${label || method.getSignature?.().toString?.() || method.getName?.()} missing stmt containing "${needle}"`,
    );
}

function assertStmtMatches(method: MethodLike, matcher: (text: string) => boolean, label: string): void {
    const texts = stmtTexts(method);
    assert(texts.some(matcher), `${label} missing expected structural stmt`);
}

function assertMethodUnit(method: MethodLike, label?: string): void {
    const sig = method.getSignature?.().toString?.() || "";
    assert(sig.includes("%AM"), `${label || sig} should resolve to a lowered future-execution method unit (%AM...)`);
}

function testDirectRegistrationBuildsPayloadOnlyUnit(): void {
    const scene = getScene("tests/demo/harmony_callback_registration");
    const buildMethod = findMethod(scene, "CallbackPage001.build()");
    const unit = findMethod(scene, "CallbackPage001.%AM0$build(any)");

    assertStmtIncludes(buildMethod, "onClick", "CallbackPage001.build");
    assertStmtIncludes(buildMethod, "%AM0$build", "CallbackPage001.build");
    assertMethodUnit(unit, "CallbackPage001.%AM0$build");

    const payload = payloadBindings(unit);
    const capture = captureBindings(unit);
    assert(payload.length === 1 && payload[0].local === "payload", "direct registration unit should expose one payload port");
    assert(capture.length === 0, "direct registration unit should not depend on closure env");
}

function testHelperForwardingPreservesHandoffShape(): void {
    const scene = getScene("tests/demo/harmony_callback_registration");
    const caller = findMethod(scene, "CallbackPage002.build()");
    const helper = findMethod(scene, "%dflt.registerClick(@harmony_callback_registration/taint_mock.ts: Button, @harmony_callback_registration/helpers.ts: %dflt.%AM0(any))");
    const unit = findMethod(scene, "CallbackPage002.%AM0$build(any)");

    assertStmtIncludes(caller, "registerClick", "CallbackPage002.build");
    assertStmtIncludes(caller, "%AM0$build", "CallbackPage002.build");
    assertStmtIncludes(helper, "callback = parameter1", "registerClick helper");
    assertStmtMatches(
        helper,
        text => text.includes("onClick(") && text.includes(">(callback)"),
        "registerClick helper",
    );
    assertMethodUnit(unit, "CallbackPage002.%AM0$build");

    const payload = payloadBindings(unit);
    const capture = captureBindings(unit);
    assert(payload.length === 1 && payload[0].local === "payload", "helper forwarding should preserve the payload-bearing method unit");
    assert(capture.length === 0, "helper forwarding unit should stay payload-driven");
}

function testReturnedClosureUsesCaptureIngress(): void {
    const scene = getScene("tests/adhoc/ordinary_callable_language");
    const factory = findMethod(scene, "%dflt.makeLeak(string)");
    const unit = findMethod(scene, "%dflt.%AM1$makeLeak([secret])");

    assertStmtIncludes(factory, "return %AM1$makeLeak", "makeLeak factory");
    assertMethodUnit(unit, "returned closure unit");

    const payload = payloadBindings(unit);
    const capture = captureBindings(unit);
    assert(payload.length === 0, "returned closure unit should not consume normal payload params");
    assert(capture.length === 1 && capture[0].local === "%closures0", "returned closure unit should expose one closure-env ingress");
    assertStmtIncludes(unit, "%closures0.secret", "returned closure unit");
}

function testAnonymousFieldCallableStillTargetsMethodUnit(): void {
    const scene = getScene("tests/adhoc/ordinary_callable_language");
    const outer = findMethod(scene, "%dflt.anonymous_object_field_callable_015_T(string)");
    const unit = findMethod(scene, "%dflt.%AM0$anonymous_object_field_callable_015_T(string)");

    assertStmtIncludes(outer, ".run>", "anonymous object field callable outer method");
    assertStmtIncludes(outer, "ptrinvoke fp", "anonymous object field callable outer method");
    assertMethodUnit(unit, "anonymous object field callable unit");

    const payload = payloadBindings(unit);
    const capture = captureBindings(unit);
    assert(payload.length === 1 && payload[0].local === "data", "anonymous object field callable should still lower to a payload-driven method unit");
    assert(capture.length === 0, "anonymous object field callable should not require closure env in this case");
}

function testPromiseContinuationAndReturnedCallbackSharePayloadShape(): void {
    const scene = getScene("tests/adhoc/ordinary_async_language");
    const thenOuter = findMethod(scene, "%dflt.promise_then_reject_callback_007_T(string)");
    const thenSuccess = findMethod(scene, "%dflt.%AM0$promise_then_reject_callback_007_T()");
    const thenReject = findMethod(scene, "%dflt.%AM1$promise_then_reject_callback_007_T(string)");
    const catchFactory = findMethod(scene, "%dflt.makeCatchSink()");
    const catchOuter = findMethod(scene, "%dflt.promise_catch_returned_callback_009_T(string)");
    const catchUnit = findMethod(scene, "%dflt.%AM1$makeCatchSink(string)");

    assertStmtIncludes(thenOuter, ".then()", "promise_then_reject_callback_007_T outer method");
    assertStmtIncludes(thenOuter, "%AM1$promise_then_reject_callback_007_T", "promise_then_reject_callback_007_T outer method");
    assertMethodUnit(thenSuccess, "then success continuation");
    assertMethodUnit(thenReject, "then reject continuation");
    assert(payloadBindings(thenSuccess).length === 0, "fulfilled branch unit should have no payload port in this sample");
    assert(payloadBindings(thenReject).length === 1 && payloadBindings(thenReject)[0].local === "reason", "reject branch unit should expose one payload port");

    assertStmtIncludes(catchFactory, "return %AM1$makeCatchSink", "makeCatchSink factory");
    assertStmtIncludes(catchOuter, "staticinvoke <@ordinary_async_language/promise_catch_returned_callback_009_T.ets: %dflt.makeCatchSink()>()", "promise_catch_returned_callback_009_T outer method");
    assertStmtIncludes(catchOuter, ".catch()>(%0)", "promise_catch_returned_callback_009_T outer method");
    assertMethodUnit(catchUnit, "returned catch continuation");
    assert(payloadBindings(catchUnit).length === 1 && payloadBindings(catchUnit)[0].local === "reason", "returned catch callback should still be a payload-driven unit");
}

function testFinallyIsCaptureFreeButResumeSensitive(): void {
    const scene = getScene("tests/adhoc/ordinary_async_language");
    const finallyOuter = findMethod(scene, "%dflt.promise_finally_passthrough_011_T(string)");
    const finallyUnit = findMethod(scene, "%dflt.%AM0$promise_finally_passthrough_011_T()");
    const awaitOuter = findMethod(scene, "%dflt.await_catch_chain_013_T(string)");
    const awaitUnit = findMethod(scene, "%dflt.%AM0$await_catch_chain_013_T(string)");

    assertStmtIncludes(finallyOuter, ".finally()", "promise_finally_passthrough_011_T outer method");
    assertStmtIncludes(finallyOuter, "result = await %1", "promise_finally_passthrough_011_T outer method");
    assertMethodUnit(finallyUnit, "finally continuation unit");
    assert(payloadBindings(finallyUnit).length === 0, "finally unit should not expose payload ports");
    assert(captureBindings(finallyUnit).length === 0, "this finally sample should not rely on closure capture");

    assertStmtIncludes(awaitOuter, "result = await %1", "await_catch_chain_013_T outer method");
    assertMethodUnit(awaitUnit, "await catch continuation unit");
    assert(payloadBindings(awaitUnit).length === 1 && payloadBindings(awaitUnit)[0].local === "reason", "await chain continuation should still return through a payload port before resuming");
    assertStmtIncludes(awaitUnit, "return reason", "await catch continuation unit");
}

function main(): void {
    testDirectRegistrationBuildsPayloadOnlyUnit();
    testHelperForwardingPreservesHandoffShape();
    testReturnedClosureUsesCaptureIngress();
    testAnonymousFieldCallableStillTargetsMethodUnit();
    testPromiseContinuationAndReturnedCallbackSharePayloadShape();
    testFinallyIsCaptureFreeButResumeSensitive();
    console.log("execution_handoff_contract_tests=PASS");
}

try {
    main();
} catch (err) {
    console.error("execution_handoff_contract_tests=FAIL");
    console.error(err);
    process.exitCode = 1;
}
