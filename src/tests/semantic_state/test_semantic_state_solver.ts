import * as assert from "assert";
import { SemanticStateWorklistSolver } from "../../core/kernel/semantic_state/SemanticStateWorklistSolver";
import { createSemanticCarrier, createDefaultSemanticSideState, SemanticCarrier, SemanticFact } from "../../core/kernel/semantic_state/SemanticStateTypes";
import { createSemanticFact } from "../../core/kernel/semantic_state/SemanticFact";
import { compileSemanticSolverEffect } from "../../core/kernel/semantic_state/SemanticEffectCompiler";
import { ArkAssignStmt, ArkIfStmt, ArkInvokeStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { Constant } from "../../../arkanalyzer/out/src/core/base/Constant";
import { ArkDeleteExpr } from "../../../arkanalyzer/out/src/core/base/Expr";
import { ArkArrayRef, ArkInstanceFieldRef } from "../../../arkanalyzer/out/src/core/base/Ref";

function makeStmt<T>(ctor: new (...args: any[]) => T, props: Record<string, any>): T {
    return Object.assign(Object.create(ctor.prototype), props);
}

function makeLocal(name: string): any {
    return {
        getName: () => name,
        getDeclaringStmt: () => undefined,
        toString: () => name,
    };
}

function makeConstant(text: string): any {
    return Object.assign(Object.create(Constant.prototype), {
        toString: () => text,
    });
}

function makeDeleteExpr(text: string): any {
    return Object.assign(Object.create(ArkDeleteExpr.prototype), {
        toString: () => `delete ${text}`,
    });
}

function makeField(base: string, field: string): any {
    return Object.assign(Object.create(ArkInstanceFieldRef.prototype), {
        getBase: () => makeLocal(base),
        getFieldName: () => field,
        toString: () => `${base}.${field}`,
    });
}

function makeArray(base: string, index: string): any {
    return Object.assign(Object.create(ArkArrayRef.prototype), {
        getBase: () => makeLocal(base),
        getIndex: () => ({ toString: () => index }),
        toString: () => `${base}[${index}]`,
    });
}

function makeAssign(left: any, right: any, text?: string): any {
    return makeStmt(ArkAssignStmt, {
        getLeftOp: () => left,
        getRightOp: () => right,
        containsInvokeExpr: () => false,
        toString: () => text || `${left} = ${right}`,
    });
}

function makeMethod(signature: string, block: any): any {
    return {
        getName: () => signature.split(".").pop() || signature,
        getSignature: () => ({ toString: () => signature }),
        getCfg: () => ({
            getStartingBlock: () => block,
        }),
    };
}

function buildBasicScene(method: any): any {
    return {
        getMethods: () => [method],
    };
}

function makeInvoke(signature: string, args: any[] = [], semanticEffect?: any): any {
    const invokeExpr = {
        getMethodSignature: () => ({ toString: () => signature }),
        getArgs: () => args,
        getSemanticEffect: () => semanticEffect,
        semanticEffect,
        toString: () => `${signature}(${args.map(arg => arg.toString ? arg.toString() : "arg").join(",")})`,
    };
    return makeStmt(ArkInvokeStmt, {
        containsInvokeExpr: () => true,
        getInvokeExpr: () => invokeExpr,
        toString: () => `invoke ${signature}`,
    });
}

function seed(methodSig: string, carrier: SemanticCarrier, extra: Partial<SemanticFact> = {}): SemanticFact {
    return createSemanticFact({
        source: "seed",
        carrier,
        tainted: extra.tainted ?? true,
        state: extra.state || "dirty",
        contextId: extra.contextId || 0,
        order: 0,
        sideState: extra.sideState || createDefaultSemanticSideState(),
        methodSignature: methodSig,
    });
}

function run(methodSig: string, stmts: any[], seeds: SemanticFact[], sinkSignatures: string[] = [], transitions: any[] = []) {
    const block = {
        getID: () => 1,
        toString: () => methodSig,
        getStmts: () => stmts,
        getSuccessors: () => [],
    };
    return new SemanticStateWorklistSolver().solve({
        scene: buildBasicScene(makeMethod(methodSig, block)),
        pag: {} as any,
        seeds,
        sinkSignatures,
        sinkRuleIds: sinkSignatures.map(signature => `rule:${signature}`),
        transitions,
    });
}

function assertHasDerived(result: any, carrierKey: string, reason?: string): void {
    assert.ok(result.derivedFacts.some((fact: SemanticFact) => fact.carrier.key === carrierKey && (!reason || fact.reason === reason)));
}

function testNativeMatrix(): void {
    const methodSig = "Semantic.native";
    const input = makeLocal("input");
    const output = makeLocal("output");
    const inputCarrier = createSemanticCarrier("same_lvalue", `local:${methodSig}:input`, "input");
    const outputCarrierKey = `local:${methodSig}:output`;

    const flow = run(methodSig, [
        makeAssign(output, input),
        makeInvoke("Sink.native", [output]),
    ], [seed(methodSig, inputCarrier)], ["Sink.native"]);
    assert.strictEqual(flow.sinkHitCount, 1);
    assertHasDerived(flow, outputCarrierKey, "assign-tainted");

    const clean = run(methodSig, [
        makeAssign(output, input),
        makeAssign(output, makeConstant("\"safe\"")),
        makeInvoke("Sink.native", [output]),
    ], [seed(methodSig, inputCarrier)], ["Sink.native"]);
    assert.strictEqual(clean.sinkHitCount, 0);
    assert.ok(clean.provenance.some((item: any) => item.reason === "assign-clean" && item.tainted === false));

    const latest = run(methodSig, [
        makeAssign(output, makeConstant("\"safe\"")),
        makeAssign(output, input),
        makeInvoke("Sink.native", [output]),
    ], [seed(methodSig, inputCarrier)], ["Sink.native"]);
    assert.strictEqual(latest.sinkHitCount, 1);

    const deleted = run(methodSig, [
        makeAssign(output, input),
        makeAssign(output, makeDeleteExpr("output")),
        makeInvoke("Sink.native", [output]),
    ], [seed(methodSig, inputCarrier)], ["Sink.native"]);
    assert.strictEqual(deleted.sinkHitCount, 0);
}

function testStorageAndSlotMatrix(): void {
    const methodSig = "Semantic.storage";
    const input = makeLocal("input");
    const out = makeLocal("out");
    const inputCarrier = createSemanticCarrier("same_lvalue", `local:${methodSig}:input`, "input");

    const fieldFlow = run(methodSig, [
        makeAssign(makeField("obj", "token"), input),
        makeAssign(out, makeField("obj", "token")),
        makeInvoke("Sink.storage", [out]),
    ], [seed(methodSig, inputCarrier)], ["Sink.storage"]);
    assert.strictEqual(fieldFlow.sinkHitCount, 1);

    const fieldMismatch = run(methodSig, [
        makeAssign(makeField("obj", "token"), input),
        makeAssign(out, makeField("obj", "other")),
        makeInvoke("Sink.storage", [out]),
    ], [seed(methodSig, inputCarrier)], ["Sink.storage"]);
    assert.strictEqual(fieldMismatch.sinkHitCount, 0);
    assert.ok(fieldMismatch.gaps.some((gap: any) => gap.blockedBy === "same_key"));

    const fieldCleanOverwrite = run(methodSig, [
        makeAssign(makeField("obj", "token"), input),
        makeAssign(makeField("obj", "token"), makeConstant("\"safe\"")),
        makeAssign(out, makeField("obj", "token")),
        makeInvoke("Sink.storage", [out]),
    ], [seed(methodSig, inputCarrier)], ["Sink.storage"]);
    assert.strictEqual(fieldCleanOverwrite.sinkHitCount, 0);

    const slotFlow = run(methodSig, [
        makeAssign(makeArray("slots", "0"), input),
        makeAssign(out, makeArray("slots", "0")),
        makeInvoke("Sink.slot", [out]),
    ], [seed(methodSig, inputCarrier)], ["Sink.slot"]);
    assert.strictEqual(slotFlow.sinkHitCount, 1);

    const slotUninitialized = run(methodSig, [
        makeAssign(out, makeArray("slots", "1")),
        makeInvoke("Sink.slot", [out]),
    ], [seed(methodSig, createSemanticCarrier("unique_slot", `slot:${methodSig}:slots[1]`, "slots[1]"))], ["Sink.slot"]);
    assert.strictEqual(slotUninitialized.sinkHitCount, 0);
    assert.ok(slotUninitialized.gaps.some((gap: any) => gap.blockedBy === "slot_initialized"));
}

function testHiddenChannelMatrix(): void {
    const methodSig = "Semantic.hidden";
    const eventCarrier = createSemanticCarrier("event", "event:login:cb", "login:cb", { channel: "login", callback: "cb" });
    const eventFlow = run(methodSig, [
        makeInvoke("Framework.emit", [], { family: "callback_event", operation: "emit", channel: "login", callback: "cb" }),
    ], [seed(methodSig, eventCarrier, { sideState: { ...createDefaultSemanticSideState(), eventState: "bound" } })]);
    assertHasDerived(eventFlow, "event:login:cb", "event-emit");

    const eventNoBind = run(methodSig, [
        makeInvoke("Framework.emit", [], { family: "callback_event", operation: "emit", channel: "login", callback: "cb" }),
    ], [seed(methodSig, eventCarrier)]);
    assert.ok(eventNoBind.gaps.some((gap: any) => gap.blockedBy === "binding_active"));

    const eventMismatch = run(methodSig, [
        makeInvoke("Framework.emit", [], { family: "callback_event", operation: "emit", channel: "other", callback: "cb" }),
    ], [seed(methodSig, eventCarrier, { sideState: { ...createDefaultSemanticSideState(), eventState: "bound" } })]);
    assert.ok(eventMismatch.gaps.some((gap: any) => gap.blockedBy === "same_channel"));

    const routeCarrier = createSemanticCarrier("route", "route:home:token", "home:token", { routeId: "home", paramKey: "token" });
    const routeFlow = run(methodSig, [
        makeInvoke("Framework.readRoute", [], { family: "router_param", operation: "read", routeId: "home", paramKey: "token" }),
    ], [seed(methodSig, routeCarrier)]);
    assertHasDerived(routeFlow, "route:home:token", "route-read");

    const routeMismatch = run(methodSig, [
        makeInvoke("Framework.readRoute", [], { family: "router_param", operation: "read", routeId: "home", paramKey: "other" }),
    ], [seed(methodSig, routeCarrier)]);
    assert.ok(routeMismatch.gaps.some((gap: any) => gap.blockedBy === "same_key"));

    const taskCarrier = createSemanticCarrier("task", "task:t1", "t1", { taskId: "t1" });
    const asyncFlow = run(methodSig, [
        makeInvoke("Framework.resume", [], { family: "async_task", operation: "resume", taskId: "t1" }),
    ], [seed(methodSig, taskCarrier, { sideState: { ...createDefaultSemanticSideState(), asyncState: "scheduled" } })]);
    assertHasDerived(asyncFlow, "task:t1", "async-resume");

    const asyncMismatch = run(methodSig, [
        makeInvoke("Framework.resume", [], { family: "async_task", operation: "resume", taskId: "t2" }),
    ], [seed(methodSig, taskCarrier, { sideState: { ...createDefaultSemanticSideState(), asyncState: "scheduled" } })]);
    assert.ok(asyncMismatch.gaps.some((gap: any) => gap.blockedBy === "same_key"));
}

function testBudgetProvenanceAndStage2(): void {
    const methodSig = "Semantic.stage2";
    const inputCarrier = createSemanticCarrier("same_lvalue", `local:${methodSig}:input`, "input");
    const outputCarrier = createSemanticCarrier("same_lvalue", `local:${methodSig}:output`, "output");
    const compiled = compileSemanticSolverEffect({
        id: "finite-storage",
        family: "keyed_storage",
        fromCarrier: inputCarrier,
        toCarrier: outputCarrier,
        state: "dirty",
        provenance: { source: "stage2", recordId: "effect-1", replayable: true },
    });
    assert.ok(compiled);

    const result = run(methodSig, [
        makeInvoke("Noop", []),
        makeInvoke("Sink.stage2", [makeLocal("output")]),
    ], [seed(methodSig, inputCarrier)], ["Sink.stage2"], [compiled!.transition]);
    assert.strictEqual(result.sinkHitCount, 1);
    assert.ok(result.derivedFacts.every((fact: SemanticFact) => result.provenance.some((record: any) => record.toFactId === fact.id)));
    assert.ok(result.stats.dequeues > 0);
    assert.ok(result.stats.transitionCounts["solver.finite-storage"] > 0);

    const invalid = compileSemanticSolverEffect({
        id: "invalid",
        family: "keyed_storage",
        fromCarrier: inputCarrier,
        toCarrier: outputCarrier,
        state: "dirty",
        freeTextReasoning: "trust this explanation",
        provenance: { source: "stage2", recordId: "effect-2", replayable: true },
    });
    assert.strictEqual(invalid, undefined);

    const truncated = new SemanticStateWorklistSolver().solve({
        scene: buildBasicScene(makeMethod(methodSig, {
            getID: () => 1,
            toString: () => "budget",
            getStmts: () => [makeInvoke("Noop", [])],
            getSuccessors: () => [],
        })),
        pag: {} as any,
        seeds: [seed(methodSig, inputCarrier)],
        budget: { maxDequeues: 0 },
    });
    assert.strictEqual(truncated.truncated, true);
    assert.strictEqual(truncated.truncation?.reason, "max_dequeues");
}

function testBranchGapWithoutPathPruning(): void {
    const methodSig = "Semantic.branch";
    const inputCarrier = createSemanticCarrier("same_lvalue", `local:${methodSig}:input`, "input");
    const sink = makeInvoke("Sink.branch", [makeLocal("input")]);
    const sinkBlock = {
        getID: () => 2,
        toString: () => "sink",
        getStmts: () => [sink],
        getSuccessors: () => [],
    };
    const startBlock = {
        getID: () => 1,
        toString: () => "start",
        getStmts: () => [makeStmt(ArkIfStmt, {
            getConditionExpr: () => ({ toString: () => "flag" }),
            containsInvokeExpr: () => false,
            toString: () => "if flag",
        })],
        getSuccessors: () => [sinkBlock],
    };
    const result = new SemanticStateWorklistSolver().solve({
        scene: buildBasicScene(makeMethod(methodSig, startBlock)),
        pag: {} as any,
        seeds: [seed(methodSig, inputCarrier)],
        sinkSignatures: ["Sink.branch"],
    });
    assert.strictEqual(result.sinkHitCount, 1);
    assert.ok(result.gaps.some((gap: any) => gap.reason === "branch-unknown"));
    assert.ok(!("pathConditions" in result));
}

function runAll(): void {
    testNativeMatrix();
    testStorageAndSlotMatrix();
    testHiddenChannelMatrix();
    testBudgetProvenanceAndStage2();
    testBranchGapWithoutPathPruning();
    console.log("test_semantic_state_solver=PASS");
}

if (require.main === module) {
    try {
        runAll();
    } catch (error) {
        console.error("test_semantic_state_solver=FAIL");
        console.error(error);
        process.exitCode = 1;
    }
}
