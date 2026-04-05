import * as fs from "fs";
import * as path from "path";
import {
    assert,
    captureBindings,
    ensureDir,
    findMethod,
    getScene,
    payloadBindings,
    stmtTexts,
} from "../helpers/ExecutionHandoffContractSupport";

type SceneLike = any;
type MethodLike = any;

interface CoverageRow {
    id: string;
    sourceDir: string;
    outerMethod: string;
    futureUnit: string;
    triggerToken: string;
    payloadPorts: number;
    capturePorts: number;
    resumeKind: "none" | "promise_chain" | "await_site";
    witnessStmt: string;
}

function witnessStmt(method: MethodLike, needle: string): string {
    const text = stmtTexts(method).find(stmt => stmt.includes(needle));
    assert(!!text, `expected stmt containing "${needle}"`);
    return text!;
}

function collectRow(
    id: string,
    sourceDir: string,
    outerNeedle: string,
    unitNeedle: string,
    witnessNeedle: string,
    triggerToken: CoverageRow["triggerToken"],
    resumeKind: CoverageRow["resumeKind"],
): CoverageRow {
    const scene: SceneLike = getScene(sourceDir);
    const outer = findMethod(scene, outerNeedle);
    const unit = findMethod(scene, unitNeedle);
    return {
        id,
        sourceDir,
        outerMethod: outer.getSignature?.().toString?.() || outerNeedle,
        futureUnit: unit.getSignature?.().toString?.() || unitNeedle,
        triggerToken,
        payloadPorts: payloadBindings(unit).length,
        capturePorts: captureBindings(unit).length,
        resumeKind,
        witnessStmt: witnessStmt(outer, witnessNeedle),
    };
}

function main(): void {
    const rows: CoverageRow[] = [
        collectRow(
            "event_direct_registration",
            "tests/demo/harmony_callback_registration",
            "CallbackPage001.build()",
            "CallbackPage001.%AM0$build(any)",
            ".onClick(",
            "event(c)",
            "none",
        ),
        collectRow(
            "event_helper_forwarding",
            "tests/demo/harmony_callback_registration",
            "CallbackPage002.build()",
            "CallbackPage002.%AM0$build(any)",
            "registerClick",
            "event(c)",
            "none",
        ),
        collectRow(
            "call_returned_closure",
            "tests/adhoc/ordinary_callable_language",
            "%dflt.nested_closure_capture_009_T(string)",
            "%dflt.%AM1$makeLeak([secret])",
            "ptrinvoke fp",
            "call(c)",
            "none",
        ),
        collectRow(
            "call_return_callable_payload",
            "tests/adhoc/ordinary_callable_language",
            "%dflt.helper_return_callable_007_T(string)",
            "%dflt.%AM1$makeSinker(string)",
            "makeSinker()",
            "call(c)",
            "none",
        ),
        collectRow(
            "call_field_callable_payload",
            "tests/adhoc/ordinary_callable_language",
            "%dflt.anonymous_object_field_callable_015_T(string)",
            "%dflt.%AM0$anonymous_object_field_callable_015_T(string)",
            "ptrinvoke fp",
            "call(c)",
            "none",
        ),
        collectRow(
            "settle_then_reject_payload",
            "tests/adhoc/ordinary_async_language",
            "%dflt.promise_then_reject_callback_007_T(string)",
            "%dflt.%AM1$promise_then_reject_callback_007_T(string)",
            ".then()",
            "settle(rejected)",
            "promise_chain",
        ),
        collectRow(
            "settle_catch_return_callable",
            "tests/adhoc/ordinary_async_language",
            "%dflt.promise_catch_returned_callback_009_T(string)",
            "%dflt.%AM1$makeCatchSink(string)",
            ".catch()",
            "settle(rejected)",
            "promise_chain",
        ),
        collectRow(
            "settle_finally_empty_payload",
            "tests/adhoc/ordinary_async_language",
            "%dflt.promise_finally_passthrough_011_T(string)",
            "%dflt.%AM0$promise_finally_passthrough_011_T()",
            ".finally()",
            "settle(any)",
            "await_site",
        ),
        collectRow(
            "await_resume_observation",
            "tests/adhoc/ordinary_async_language",
            "%dflt.await_catch_chain_013_T(string)",
            "%dflt.%AM0$await_catch_chain_013_T(string)",
            "await ",
            "settle(rejected)",
            "await_site",
        ),
    ];

    const byId = new Map(rows.map(row => [row.id, row]));
    assert(byId.get("event_direct_registration")?.payloadPorts === 1, "direct registration should expose one payload port");
    assert(byId.get("event_direct_registration")?.capturePorts === 0, "direct registration should not depend on capture");

    assert(byId.get("event_helper_forwarding")?.payloadPorts === 1, "helper forwarding should preserve one payload port");
    assert(byId.get("event_helper_forwarding")?.capturePorts === 0, "helper forwarding should stay payload-driven");

    assert(byId.get("call_returned_closure")?.payloadPorts === 0, "returned closure should not expose payload ports");
    assert(byId.get("call_returned_closure")?.capturePorts === 1, "returned closure should expose one capture ingress");

    assert(byId.get("call_return_callable_payload")?.payloadPorts === 1, "returned callable should expose one payload port");
    assert(byId.get("call_return_callable_payload")?.capturePorts === 0, "returned callable should not depend on capture in this sample");

    assert(byId.get("call_field_callable_payload")?.payloadPorts === 1, "field-stored callable should expose one payload port");
    assert(byId.get("call_field_callable_payload")?.capturePorts === 0, "field-stored callable should not depend on capture in this sample");

    assert(byId.get("settle_then_reject_payload")?.payloadPorts === 1, "reject continuation should expose one payload port");
    assert(byId.get("settle_then_reject_payload")?.capturePorts === 0, "reject continuation should not require capture in this sample");

    assert(byId.get("settle_catch_return_callable")?.payloadPorts === 1, "returned catch continuation should expose one payload port");
    assert(byId.get("settle_catch_return_callable")?.capturePorts === 0, "returned catch continuation should stay payload-driven");

    assert(byId.get("settle_finally_empty_payload")?.payloadPorts === 0, "finally contract should expose no payload ports");
    assert(byId.get("settle_finally_empty_payload")?.capturePorts === 0, "this finally contract should expose no capture ports");

    assert(byId.get("await_resume_observation")?.resumeKind === "await_site", "await chain should be observed as an await-site resume");
    assert(byId.get("await_resume_observation")?.payloadPorts === 1, "await chain continuation should still consume one payload port before resuming");

    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_contract/latest");
    ensureDir(outputDir);
    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_contract_coverage.json"),
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                totalRows: rows.length,
                rows,
            },
            null,
            2,
        ),
        "utf8",
    );

    console.log("execution_handoff_contract_coverage=PASS");
    console.log(`rows=${rows.length}`);
}

try {
    main();
} catch (err) {
    console.error("execution_handoff_contract_coverage=FAIL");
    console.error(err);
    process.exitCode = 1;
}
