import { materializeTaintFlowPaths } from "../../core/orchestration/postsolve/WitnessMaterializer";
import { PostsolveContext } from "../../core/orchestration/postsolve/PostsolveTypes";
import { TaintFlow } from "../../core/kernel/model/TaintFlow";
import { FactPredecessorRecord } from "../../core/kernel/propagation/PropagationTypes";

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

function buildContext(records: FactPredecessorRecord[]): PostsolveContext {
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
    assert(!!materialized, "expected materialized witness paths");
    const paths = materialized!.paths;
    assert(paths.length === 2, `expected 2 paths, got ${paths.length}`);

    const normalized = paths
        .map(path => path.factIds.join(" -> "))
        .sort();
    assert(
        normalized[0] === "source -> tmp1 -> tmp3 -> sink"
        || normalized[1] === "source -> tmp1 -> tmp3 -> sink",
        `expected left path, got ${JSON.stringify(normalized)}`
    );
    assert(
        normalized[0] === "source -> tmp2 -> tmp3 -> sink"
        || normalized[1] === "source -> tmp2 -> tmp3 -> sink",
        `expected right path, got ${JSON.stringify(normalized)}`
    );
    assert(paths.every(path => path.edges.length === path.factIds.length - 1), "expected edge count to match path length");

    console.log("PASS test_witness_materializer");
    console.log(`path_count=${paths.length}`);
    for (const path of normalized) {
        console.log(`path=${path}`);
    }
}

main().catch(err => {
    console.error("FAIL test_witness_materializer");
    console.error(err);
    process.exitCode = 1;
});
