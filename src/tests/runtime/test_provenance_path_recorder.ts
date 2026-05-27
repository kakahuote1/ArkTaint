import { materializeTaintFlowPaths } from "../../core/provenance/ProvenancePathRecorder";
import { ProvenancePathContext } from "../../core/provenance/ProvenancePathTypes";
import { currentnessEvidenceFromCertificate } from "../../core/provenance/CurrentnessEvidenceAdapter";
import { OclfsSolver, StateEffectBuilder } from "../../core/kernel/oclfs";
import { TaintFlow } from "../../core/kernel/model/TaintFlow";
import { FactPredecessorRecord } from "../../core/kernel/propagation/PropagationTypes";
import { aggregateFlowJudgement } from "../../core/orchestration/postsolve/PostsolveEvaluator";
import { evaluateCurrentnessCertificatePath } from "../../core/orchestration/postsolve/CurrentnessCertificateRefinement";

function makeStmt(text: string): any {
    return {
        toString: () => text,
    };
}

function makeFact(id: string, stmtText: string): any {
    const stmt = {
        toString: () => stmtText,
        getCfg: () => ({
            getDeclaringMethod: () => ({
                getSignature: () => ({
                    toString: () => `@test.${stmtText}`,
                }),
            }),
        }),
    };
    return {
        id,
        node: {
            getStmt: () => stmt,
        },
    };
}

function buildContext(records: FactPredecessorRecord[]): ProvenancePathContext {
    const observedFacts = new Map<string, any>([
        ["source", makeFact("source", "source_stmt")],
        ["tmp1", makeFact("tmp1", "tmp1_stmt")],
        ["tmp2", makeFact("tmp2", "tmp2_stmt")],
        ["tmp3", makeFact("tmp3", "tmp3_stmt")],
        ["sink", makeFact("sink", "sink_stmt")],
    ]);
    const predecessors = new Map<string, readonly FactPredecessorRecord[]>();
    for (const record of records) {
        const bucket = predecessors.get(record.toFactId) || [];
        predecessors.set(record.toFactId, [...bucket, record]);
    }
    return {
        observedFactsById: observedFacts,
        factPredecessorsByFactId: predecessors,
    };
}

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

async function main(): Promise<void> {
    const flow = new TaintFlow("source.test", makeStmt("sink_stmt"), {
        sinkFactId: "sink",
    });
    const context = buildContext([
        { fromFactId: "tmp3", toFactId: "sink", reason: "to_sink" },
        { fromFactId: "tmp1", toFactId: "tmp3", reason: "left_path" },
        { fromFactId: "tmp2", toFactId: "tmp3", reason: "right_path" },
        { fromFactId: "source", toFactId: "tmp1", reason: "seed_left" },
        { fromFactId: "source", toFactId: "tmp2", reason: "seed_right" },
    ]);

    const materialized = materializeTaintFlowPaths(flow, context, { maxPaths: 8, maxDepth: 8 });
    assert(!!materialized, "expected materialized provenance paths");
    const paths = materialized!.paths;
    assert(paths.length === 2, `expected 2 paths, got ${paths.length}`);

    const normalized = paths
        .map(path => path.factIds.join(" -> "))
        .sort();
    assert(
        normalized[0] === "source -> tmp1 -> tmp3 -> sink"
        || normalized[1] === "source -> tmp1 -> tmp3 -> sink",
        `expected left path, got ${JSON.stringify(normalized)}`,
    );
    assert(
        normalized[0] === "source -> tmp2 -> tmp3 -> sink"
        || normalized[1] === "source -> tmp2 -> tmp3 -> sink",
        `expected right path, got ${JSON.stringify(normalized)}`,
    );
    assert(paths.every(path => path.edges.length === path.factIds.length - 1), "expected edge count to match path length");
    assert(materialized!.status === "complete", `expected complete materialization, got ${materialized!.status}`);
    assert(materialized!.incompleteReasons.length === 0, "expected no incomplete reasons for complete materialization");

    const limitedByDepth = materializeTaintFlowPaths(flow, context, { maxPaths: 8, maxDepth: 1 });
    assert(!!limitedByDepth, "expected depth-limited materialization");
    assert(limitedByDepth!.status === "truncated", `expected depth-limited materialization to be truncated, got ${limitedByDepth!.status}`);
    assert(limitedByDepth!.materializationStatus === "truncated", `expected depth-limited materializationStatus to be truncated, got ${limitedByDepth!.materializationStatus}`);
    assert(
        limitedByDepth!.incompleteReasons.includes("max_depth"),
        `expected max_depth incomplete reason, got ${JSON.stringify(limitedByDepth!.incompleteReasons)}`,
    );
    assert(
        limitedByDepth!.paths.some(path => path.truncated && path.status === "truncated"),
        "expected at least one truncated incomplete path",
    );

    const limitedByPaths = materializeTaintFlowPaths(flow, context, { maxPaths: 1, maxDepth: 8 });
    assert(!!limitedByPaths, "expected path-limited materialization");
    assert(limitedByPaths!.status === "truncated", `expected path-limited materialization to be truncated, got ${limitedByPaths!.status}`);
    assert(limitedByPaths!.materializationStatus === "truncated", `expected path-limited materializationStatus to be truncated, got ${limitedByPaths!.materializationStatus}`);
    assert(
        limitedByPaths!.incompleteReasons.includes("max_paths"),
        `expected max_paths incomplete reason, got ${JSON.stringify(limitedByPaths!.incompleteReasons)}`,
    );
    assert(limitedByPaths!.paths.length === 1, `expected one materialized path under maxPaths=1, got ${limitedByPaths!.paths.length}`);

    const guardedJudgement = aggregateFlowJudgement([
        {
            evidence: [],
            judgement: {
                kind: "Refuted-Strong",
                primaryReason: "test_refutation",
                evidenceKinds: ["test"],
            },
        },
    ], limitedByPaths!);
    assert(
        guardedJudgement.kind === "Unresolved",
        `expected incomplete materialization to prevent strong flow refutation, got ${guardedJudgement.kind}`,
    );
    assert(
        guardedJudgement.primaryReason === "incomplete_path_materialization",
        `expected incomplete_path_materialization, got ${guardedJudgement.primaryReason}`,
    );

    const builder = new StateEffectBuilder({ origin: "provenance-currentness-test" });
    const x1 = builder.value("x", "1");
    const xSlot = builder.localSlot("x");
    const xRead = builder.value("x", "read");
    const oclfs = new OclfsSolver().solve([
        builder.source(x1, "secret"),
        builder.store(xSlot, x1, "secret"),
        builder.storeClean(xSlot),
        builder.load(xSlot, xRead),
        builder.sink(xRead, "network"),
    ]);
    const dead = oclfs.certificates.find(cert => cert.verdict === "dead");
    assert(!!dead, "expected a dead currentness certificate");
    const evidence = currentnessEvidenceFromCertificate(dead!);
    assert(evidence.kind === "currentness", `expected currentness evidence, got ${evidence.kind}`);
    assert(evidence.producer === "algorithm_e_oclfs", `unexpected currentness producer ${evidence.producer}`);
    assert(evidence.decisionScope === "candidate-flow", `unexpected currentness scope ${evidence.decisionScope}`);
    assert(evidence.verdict === "dead", `expected dead currentness evidence, got ${evidence.verdict}`);

    const currentnessContext: ProvenancePathContext = {
        ...buildContext([
            {
                fromFactId: "source",
                toFactId: "sink",
                reason: "oclfs-currentness",
                currentnessCertificateIds: [evidence.id],
            },
        ]),
        currentnessEvidenceById: new Map([[evidence.id, evidence]]),
    };
    const currentnessFlow = materializeTaintFlowPaths(flow, currentnessContext, { maxPaths: 2, maxDepth: 2 });
    assert(!!currentnessFlow, "expected materialized currentness path");
    assert(
        currentnessFlow!.paths.some(path => (path.currentnessEvidenceIds || []).includes(evidence.id)),
        "expected PathView to carry currentness evidence ids from predecessor records",
    );
    const currentnessPostsolveEvidence = evaluateCurrentnessCertificatePath(
        flow,
        currentnessFlow!.paths[0],
        currentnessContext,
    );
    assert(
        currentnessPostsolveEvidence.some(item =>
            item.kind === "currentness_certificate"
            && item.polarity === "negative"
            && item.scope === "path-segment"
            && item.sourceEvidenceIds.includes(evidence.id)),
        "expected Algorithm F currentness interpreter to emit scoped negative evidence",
    );

    console.log("PASS test_provenance_path_recorder");
    console.log(`path_count=${paths.length}`);
    for (const path of normalized) {
        console.log(`path=${path}`);
    }
}

main().catch(err => {
    console.error("FAIL test_provenance_path_recorder");
    console.error(err);
    process.exitCode = 1;
});
