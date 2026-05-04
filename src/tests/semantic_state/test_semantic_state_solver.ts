import * as assert from "assert";
import { SemanticStateWorklistSolver } from "../../core/kernel/semantic_state/SemanticStateWorklistSolver";
import { createSemanticCarrier, createDefaultSemanticSideState } from "../../core/kernel/semantic_state/SemanticStateTypes";
import { createSemanticFact } from "../../core/kernel/semantic_state/SemanticFact";
import { ArkAssignStmt, ArkIfStmt, ArkInvokeStmt } from "../../../arkanalyzer/out/src/core/base/Stmt";
import { Constant } from "../../../arkanalyzer/out/src/core/base/Constant";
import { ArkDeleteExpr } from "../../../arkanalyzer/out/src/core/base/Expr";

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

function makeSinkInvoke(signature: string, arg: any): any {
    const invokeExpr = {
        getMethodSignature: () => ({ toString: () => signature }),
        getArgs: () => [arg],
        toString: () => `${signature}(${arg.toString ? arg.toString() : "arg"})`,
    };
    return makeStmt(ArkInvokeStmt, {
        containsInvokeExpr: () => true,
        getInvokeExpr: () => invokeExpr,
        toString: () => `invoke ${signature}`,
    });
}

function runAssignmentAndSinkCase(): void {
    const right = makeLocal("input");
    const left = makeLocal("output");
    const assign = makeStmt(ArkAssignStmt, {
        getLeftOp: () => left,
        getRightOp: () => right,
        containsInvokeExpr: () => false,
        toString: () => "output = input",
    });
    const sink = makeSinkInvoke("Sink.foo", left);
    const block = {
        getID: () => 1,
        toString: () => "b1",
        getStmts: () => [assign, sink],
        getSuccessors: () => [],
    };
    const methodSig = "TestCase.foo";
    const method = makeMethod(methodSig, block);
    const scene = buildBasicScene(method);
    const seed = createSemanticFact({
        source: "seed",
        carrier: createSemanticCarrier("same_lvalue", `local:${methodSig}:input`, "input"),
        tainted: true,
        state: "dirty",
        contextId: 0,
        order: 0,
        sideState: createDefaultSemanticSideState(),
        methodSignature: methodSig,
    });

    const solver = new SemanticStateWorklistSolver();
    const result = solver.solve({
        scene,
        pag: {} as any,
        seeds: [seed],
        sinkSignatures: ["Sink.foo"],
        sinkRuleIds: ["sink-rule"],
    });

    assert.strictEqual(result.enabled, true);
    assert.strictEqual(result.seedCount, 1);
    assert.strictEqual(result.sinkHitCount, 1);
    assert.strictEqual(result.candidateSeedCount >= 1, true);
    assert.strictEqual(result.provenanceCount >= 1, true);
    assert.strictEqual(result.gapCount, 0);
    assert.strictEqual(result.sinkHits[0].sinkSignature, "Sink.foo");
    assert.strictEqual(result.sinkHits[0].carrierKey, `local:${methodSig}:output`);
}

function runLatestWriteWinsCase(): void {
    const right = makeLocal("input");
    const left = makeLocal("output");
    const assignTainted = makeStmt(ArkAssignStmt, {
        getLeftOp: () => left,
        getRightOp: () => right,
        containsInvokeExpr: () => false,
        toString: () => "output = input",
    });
    const assignClean = makeStmt(ArkAssignStmt, {
        getLeftOp: () => left,
        getRightOp: () => makeConstant("\"safe\""),
        containsInvokeExpr: () => false,
        toString: () => "output = \"safe\"",
    });
    const sink = makeSinkInvoke("Sink.latest", left);
    const block = {
        getID: () => 1,
        toString: () => "latest",
        getStmts: () => [assignTainted, assignClean, sink],
        getSuccessors: () => [],
    };
    const methodSig = "TestCase.latest";
    const seed = createSemanticFact({
        source: "seed",
        carrier: createSemanticCarrier("same_lvalue", `local:${methodSig}:input`, "input"),
        tainted: true,
        state: "dirty",
        contextId: 0,
        order: 0,
        sideState: createDefaultSemanticSideState(),
        methodSignature: methodSig,
    });
    const result = new SemanticStateWorklistSolver().solve({
        scene: buildBasicScene(makeMethod(methodSig, block)),
        pag: {} as any,
        seeds: [seed],
        sinkSignatures: ["Sink.latest"],
        sinkRuleIds: ["sink-latest"],
    });

    assert.strictEqual(result.sinkHitCount, 0);
    assert.ok(result.provenance.some(item => item.reason === "assign-clean" && item.tainted === false));
}

function runDeleteBeforeReadCase(): void {
    const right = makeLocal("input");
    const left = makeLocal("output");
    const assignTainted = makeStmt(ArkAssignStmt, {
        getLeftOp: () => left,
        getRightOp: () => right,
        containsInvokeExpr: () => false,
        toString: () => "output = input",
    });
    const deleteOutput = makeStmt(ArkAssignStmt, {
        getLeftOp: () => left,
        getRightOp: () => makeDeleteExpr("output"),
        containsInvokeExpr: () => false,
        toString: () => "output = delete output",
    });
    const sink = makeSinkInvoke("Sink.delete", left);
    const block = {
        getID: () => 1,
        toString: () => "delete",
        getStmts: () => [assignTainted, deleteOutput, sink],
        getSuccessors: () => [],
    };
    const methodSig = "TestCase.delete";
    const seed = createSemanticFact({
        source: "seed",
        carrier: createSemanticCarrier("same_lvalue", `local:${methodSig}:input`, "input"),
        tainted: true,
        state: "dirty",
        contextId: 0,
        order: 0,
        sideState: createDefaultSemanticSideState(),
        methodSignature: methodSig,
    });
    const result = new SemanticStateWorklistSolver().solve({
        scene: buildBasicScene(makeMethod(methodSig, block)),
        pag: {} as any,
        seeds: [seed],
        sinkSignatures: ["Sink.delete"],
        sinkRuleIds: ["sink-delete"],
    });

    assert.strictEqual(result.sinkHitCount, 0);
    assert.ok(result.provenance.some(item => item.reason === "delete-before-read" && item.tainted === false));
}

function runBranchAndBudgetCases(): void {
    const condStmt = makeStmt(ArkIfStmt, {
        getConditionExpr: () => ({ toString: () => "flag" }),
        containsInvokeExpr: () => false,
        toString: () => "if flag",
    });
    const block = {
        getID: () => 1,
        toString: () => "b2",
        getStmts: () => [condStmt],
        getSuccessors: () => [{ getID: () => 2, toString: () => "b3", getStmts: () => [], getSuccessors: () => [] }],
    };
    const methodSig = "TestCase.branch";
    const method = makeMethod(methodSig, block);
    const scene = buildBasicScene(method);
    const seed = createSemanticFact({
        source: "seed",
        carrier: createSemanticCarrier("same_lvalue", `local:${methodSig}:flag`, "flag"),
        tainted: true,
        state: "dirty",
        contextId: 0,
        order: 0,
        sideState: createDefaultSemanticSideState(),
        methodSignature: methodSig,
    });

    const solver = new SemanticStateWorklistSolver();
    const branchResult = solver.solve({
        scene,
        pag: {} as any,
        seeds: [seed],
        sinkSignatures: [],
        sinkRuleIds: [],
    });
    assert.ok(branchResult.gapCount >= 1);
    assert.ok(branchResult.gaps.some(item => item.reason === "branch-unknown"));
    assert.ok(branchResult.pathConditions.some(item => item.normalizedCondition === "flag" && item.assumption === "true"));

    const truncated = solver.solve({
        scene,
        pag: {} as any,
        seeds: [seed],
        sinkSignatures: [],
        sinkRuleIds: [],
        budget: { maxDequeues: 0 },
    });
    assert.strictEqual(truncated.truncated?.reason, "max_dequeues");
}

function runPathContradictionPruningCase(): void {
    const input = makeLocal("input");
    const cond = () => ({ toString: () => "flag" });
    const firstIf = makeStmt(ArkIfStmt, {
        getConditionExpr: cond,
        containsInvokeExpr: () => false,
        toString: () => "if flag",
    });
    const secondIf = makeStmt(ArkIfStmt, {
        getConditionExpr: cond,
        containsInvokeExpr: () => false,
        toString: () => "if flag",
    });
    const sink = makeSinkInvoke("Sink.path", input);
    const sinkBlock = {
        getID: () => 4,
        toString: () => "sinkPath",
        getStmts: () => [sink],
        getSuccessors: () => [],
    };
    const safeBlock = {
        getID: () => 3,
        toString: () => "safePath",
        getStmts: () => [],
        getSuccessors: () => [],
    };
    const trueBlock = {
        getID: () => 2,
        toString: () => "truePath",
        getStmts: () => [secondIf],
        getSuccessors: () => [safeBlock, sinkBlock],
    };
    const falseBlock = {
        getID: () => 5,
        toString: () => "falsePath",
        getStmts: () => [],
        getSuccessors: () => [],
    };
    const startBlock = {
        getID: () => 1,
        toString: () => "startPath",
        getStmts: () => [firstIf],
        getSuccessors: () => [trueBlock, falseBlock],
    };
    const methodSig = "TestCase.path";
    const seed = createSemanticFact({
        source: "seed",
        carrier: createSemanticCarrier("same_lvalue", `local:${methodSig}:input`, "input"),
        tainted: true,
        state: "dirty",
        contextId: 0,
        order: 0,
        sideState: createDefaultSemanticSideState(),
        methodSignature: methodSig,
    });

    const result = new SemanticStateWorklistSolver().solve({
        scene: buildBasicScene(makeMethod(methodSig, startBlock)),
        pag: {} as any,
        seeds: [seed],
        sinkSignatures: ["Sink.path"],
        sinkRuleIds: ["sink-path"],
    });

    assert.strictEqual(result.sinkHitCount, 0);
    assert.ok(result.pathConditions.some(item => item.normalizedCondition === "flag" && item.assumption === "true"));
    assert.ok(result.pathConditions.some(item => item.normalizedCondition === "flag" && item.assumption === "false"));
    assert.ok(result.gaps.some(item => item.reason === "path-infeasible" && item.blockedBy === "contradictory-path-condition"));
}

function runPathConditionInvalidationCase(): void {
    const input = makeLocal("input");
    const flag = makeLocal("flag");
    const cond = () => ({ toString: () => "flag" });
    const firstIf = makeStmt(ArkIfStmt, {
        getConditionExpr: cond,
        containsInvokeExpr: () => false,
        toString: () => "if flag",
    });
    const resetFlag = makeStmt(ArkAssignStmt, {
        getLeftOp: () => flag,
        getRightOp: () => makeConstant("false"),
        containsInvokeExpr: () => false,
        toString: () => "flag = false",
    });
    const secondIf = makeStmt(ArkIfStmt, {
        getConditionExpr: cond,
        containsInvokeExpr: () => false,
        toString: () => "if flag",
    });
    const sink = makeSinkInvoke("Sink.reassignedPath", input);
    const sinkBlock = {
        getID: () => 4,
        toString: () => "reassignedSink",
        getStmts: () => [sink],
        getSuccessors: () => [],
    };
    const emptyBlock = {
        getID: () => 3,
        toString: () => "reassignedEmpty",
        getStmts: () => [],
        getSuccessors: () => [],
    };
    const trueBlock = {
        getID: () => 2,
        toString: () => "reassignedTrue",
        getStmts: () => [resetFlag, secondIf],
        getSuccessors: () => [emptyBlock, sinkBlock],
    };
    const falseBlock = {
        getID: () => 5,
        toString: () => "reassignedFalse",
        getStmts: () => [],
        getSuccessors: () => [],
    };
    const startBlock = {
        getID: () => 1,
        toString: () => "reassignedStart",
        getStmts: () => [firstIf],
        getSuccessors: () => [trueBlock, falseBlock],
    };
    const methodSig = "TestCase.pathReassigned";
    const seed = createSemanticFact({
        source: "seed",
        carrier: createSemanticCarrier("same_lvalue", `local:${methodSig}:input`, "input"),
        tainted: true,
        state: "dirty",
        contextId: 0,
        order: 0,
        sideState: createDefaultSemanticSideState(),
        methodSignature: methodSig,
    });

    const result = new SemanticStateWorklistSolver().solve({
        scene: buildBasicScene(makeMethod(methodSig, startBlock)),
        pag: {} as any,
        seeds: [seed],
        sinkSignatures: ["Sink.reassignedPath"],
        sinkRuleIds: ["sink-reassigned-path"],
    });

    assert.strictEqual(result.sinkHitCount, 1);
    assert.ok(!result.gaps.some(item => item.reason === "path-infeasible"));
}

function run(): void {
    runAssignmentAndSinkCase();
    runLatestWriteWinsCase();
    runDeleteBeforeReadCase();
    runBranchAndBudgetCases();
    runPathContradictionPruningCase();
    runPathConditionInvalidationCase();
    console.log("test_semantic_state_solver=PASS");
}

if (require.main === module) {
    try {
        run();
    } catch (error) {
        console.error("test_semantic_state_solver=FAIL");
        console.error(error);
        process.exitCode = 1;
    }
}
