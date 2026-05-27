import { TaintFlow } from "../../core/kernel/model/TaintFlow";
import type { FactPredecessorRecord } from "../../core/kernel/propagation/PropagationTypes";
import { BaseEvidenceGraphRecorder, materializeFlowFromBaseEvidenceGraph } from "../../core/provenance";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function makeFact(id: string): any {
    const stmt = {
        toString: () => `${id}_stmt`,
        getCfg: () => ({
            getDeclaringMethod: () => ({
                getSignature: () => ({ toString: () => `@demo.${id}` }),
            }),
        }),
    };
    return { id, node: { getStmt: () => stmt } };
}

function main(): void {
    const recorder = new BaseEvidenceGraphRecorder();
    const atom: FactPredecessorRecord = { fromFactId: "source", toFactId: "sink", reason: "test-derive" };
    recorder.derive(atom);
    atom.reason = "mutated-after-derive";
    recorder.gap({
        id: "gap.manual",
        kind: "missing-currentness",
        flowId: "sink",
        producer: "test",
        reason: "missing currentness certificate for adjacent candidate",
    });

    const snapshot = recorder.snapshot();
    assert(snapshot.derivations[0].reason === "test-derive", "BaseEvidenceGraph must snapshot derivations immutably");
    snapshot.derivations[0].reason = "mutated-snapshot";
    assert(recorder.snapshot().derivations[0].reason === "test-derive", "snapshot mutation must not affect recorder");

    const flow = new TaintFlow("source.test", { toString: () => "sink_stmt" } as any, { sinkFactId: "sink" });
    const materialized = materializeFlowFromBaseEvidenceGraph(flow, recorder.snapshot(), {
        observedFactsById: new Map([
            ["source", makeFact("source")],
            ["sink", makeFact("sink")],
        ]),
    }, { maxDepth: 4, maxPaths: 4 });
    assert(!!materialized, "expected materialized path set from base evidence graph");
    assert(materialized.paths.length === 1, `expected one path, got ${materialized.paths.length}`);
    assert(materialized.paths[0].materializationStatus === "complete", "path materialization should be complete");
    assert((materialized.paths[0] as any).judgement === undefined, "PathView must not carry postsolve judgements");
    assert((materialized.paths[0] as any).status !== "kept" && (materialized.paths[0] as any).status !== "filtered", "PathView must not carry kept/filtered decisions");
    assert((materialized.gaps || []).some(gap => gap.id === "gap.manual"), "PathGap from base graph should be preserved");

    console.log("PASS test_provenance_evidence_graph_boundary");
}

main();
