import {
    deriveFlowCountability,
    derivePathCountability,
    evaluatePostsolveFlow,
} from "../../core/orchestration/postsolve/PostsolveEvaluator";
import type { PostsolveJudgement } from "../../core/orchestration/postsolve/PostsolveTypes";
import type { MaterializedTaintFlow, ProvenancePath } from "../../core/provenance/ProvenancePathTypes";
import { TaintFlow } from "../../core/kernel/model/TaintFlow";
import type { FactPredecessorRecord } from "../../core/kernel/propagation/PropagationTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

const unresolved: PostsolveJudgement = {
    kind: "Unresolved",
    evidenceKinds: [],
};

const confirmed: PostsolveJudgement = {
    kind: "Confirmed",
    primaryReason: "path_confirmed",
    evidenceKinds: [],
};

const refuted: PostsolveJudgement = {
    kind: "Refuted-Strong",
    primaryReason: "all_paths_refuted",
    evidenceKinds: ["type_narrowing_guard"],
};

function path(input: Partial<ProvenancePath>): ProvenancePath {
    return {
        factIds: ["source", "sink"],
        edges: [],
        ...input,
    };
}

function materialized(input: Partial<MaterializedTaintFlow>): MaterializedTaintFlow {
    return {
        sinkFactId: "sink",
        status: "complete",
        materializationStatus: "complete",
        incompleteReasons: [],
        paths: [path({ status: "complete" })],
        ...input,
    };
}

function context(records: FactPredecessorRecord[]) {
    const predecessors = new Map<string, readonly FactPredecessorRecord[]>();
    for (const record of records) {
        const bucket = predecessors.get(record.toFactId) || [];
        predecessors.set(record.toFactId, [...bucket, record]);
    }
    return {
        observedFactsById: new Map(),
        factPredecessorsByFactId: predecessors,
    };
}

function main(): void {
    const completeUnresolved = derivePathCountability(path({ status: "complete" }), unresolved);
    assert(completeUnresolved.status === "near_hit_unresolved", `expected near_hit_unresolved, got ${completeUnresolved.status}`);
    assert(completeUnresolved.reason === "no_decisive_postsolve_evidence", `unexpected reason ${completeUnresolved.reason}`);

    const cycleOnly = derivePathCountability(path({
        status: "incomplete",
        incompleteReasons: ["cycle_skipped"],
    }), unresolved);
    assert(cycleOnly.status === "cycle_blocked", `expected cycle_blocked, got ${cycleOnly.status}`);
    assert(cycleOnly.reason === "cycle_skipped", `unexpected cycle reason ${cycleOnly.reason}`);

    const truncated = derivePathCountability(path({
        status: "truncated",
        truncated: true,
        incompleteReasons: ["cycle_skipped", "max_paths"],
    }), unresolved);
    assert(truncated.status === "truncated", `expected truncated, got ${truncated.status}`);
    assert(truncated.reason === "max_paths", `expected max_paths priority, got ${truncated.reason}`);

    const confirmedStatus = derivePathCountability(path({ status: "complete" }), confirmed);
    assert(confirmedStatus.status === "confirmed", `expected confirmed, got ${confirmedStatus.status}`);

    const refutedStatus = derivePathCountability(path({ status: "complete" }), refuted);
    assert(refutedStatus.status === "refuted", `expected refuted, got ${refutedStatus.status}`);

    const noPaths = deriveFlowCountability([], undefined, unresolved);
    assert(noPaths.status === "out_of_scope", `expected out_of_scope for no paths, got ${noPaths.status}`);

    const noPathsTruncated = deriveFlowCountability([], materialized({
        status: "truncated",
        materializationStatus: "truncated",
        incompleteReasons: ["max_paths"],
        paths: [],
    }), unresolved);
    assert(noPathsTruncated.status === "truncated", `expected no-path max_paths to be truncated, got ${noPathsTruncated.status}`);
    assert(noPathsTruncated.reason === "max_paths", `expected no-path max_paths reason, got ${noPathsTruncated.reason}`);

    const noPathsCycle = deriveFlowCountability([], materialized({
        status: "incomplete",
        materializationStatus: "incomplete",
        incompleteReasons: ["cycle_skipped"],
        paths: [],
    }), unresolved);
    assert(noPathsCycle.status === "cycle_blocked", `expected no-path cycle to be cycle_blocked, got ${noPathsCycle.status}`);
    assert(noPathsCycle.reason === "cycle_skipped", `expected no-path cycle reason, got ${noPathsCycle.reason}`);

    const flowTruncated = deriveFlowCountability([
        {
            countability: truncated,
            judgement: unresolved,
            status: "truncated",
            truncated: true,
            incompleteReasons: ["cycle_skipped", "max_paths"],
        },
    ], materialized({
        status: "truncated",
        materializationStatus: "truncated",
        incompleteReasons: ["cycle_skipped", "max_paths"],
    }), unresolved);
    assert(flowTruncated.status === "truncated", `expected flow truncated, got ${flowTruncated.status}`);
    assert(flowTruncated.reason === "max_paths", `expected flow max_paths reason, got ${flowTruncated.reason}`);

    const flowCycle = deriveFlowCountability([
        {
            countability: cycleOnly,
            judgement: unresolved,
            status: "incomplete",
            incompleteReasons: ["cycle_skipped"],
        },
    ], materialized({
        status: "incomplete",
        materializationStatus: "incomplete",
        incompleteReasons: ["cycle_skipped"],
    }), unresolved);
    assert(flowCycle.status === "cycle_blocked", `expected flow cycle_blocked, got ${flowCycle.status}`);

    const flowWithConfirmedPathAndBudgetLedger = deriveFlowCountability([
        {
            countability: confirmedStatus,
            judgement: confirmed,
            status: "complete",
            incompleteReasons: [],
        },
    ], materialized({
        status: "truncated",
        materializationStatus: "truncated",
        incompleteReasons: ["max_paths"],
        paths: [path({ status: "complete" })],
    }), confirmed);
    assert(
        flowWithConfirmedPathAndBudgetLedger.status === "confirmed",
        `expected a complete confirmed path to remain countable despite max_paths ledger, got ${flowWithConfirmedPathAndBudgetLedger.status}`,
    );

    const budgetedFlow = new TaintFlow("source.test", { toString: () => "sink_stmt" } as any, {
        sinkFactId: "sink",
    });
    const budgetedPostsolve = evaluatePostsolveFlow(budgetedFlow, {
        ...context([
            { fromFactId: "source", toFactId: "sink", reason: "seed" },
        ]),
        materializationOptions: {
            maxPaths: 0,
            maxDepth: 8,
        },
    });
    assert(budgetedPostsolve.countability.status === "truncated", `expected evaluated maxPaths=0 flow to be truncated, got ${budgetedPostsolve.countability.status}`);
    assert(
        (budgetedPostsolve as any).countabilityStatus === "truncated",
        `expected seed result to expose countabilityStatus, got ${(budgetedPostsolve as any).countabilityStatus}`,
    );
    assert(
        budgetedPostsolve.report.countabilityStatus === "truncated",
        `expected report to expose countabilityStatus, got ${budgetedPostsolve.report.countabilityStatus}`,
    );
    assert(
        budgetedPostsolve.skeleton?.materialization?.incompleteReasons.includes("max_paths"),
        `expected skeleton materialization ledger to preserve max_paths, got ${JSON.stringify(budgetedPostsolve.skeleton?.materialization?.incompleteReasons)}`,
    );

    console.log("PASS test_postsolve_countability_status");
}

main();
