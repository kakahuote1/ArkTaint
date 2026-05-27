import { runWorklistSolvingStage } from "../../core/orchestration/full_analysis/FullAnalysisStages";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function main(): void {
    let hookCalled = false;
    let solveCalled = false;
    const result = runWorklistSolvingStage({
        worklist: [] as any[],
        visited: new Set<string>(["seed"]),
        deps: {} as any,
        hooks: {
            run(input, delegate) {
                hookCalled = true;
                return delegate.run(input);
            },
        },
        solve(_worklist, visited) {
            solveCalled = true;
            visited.add("derived");
            return { visitedCount: visited.size };
        },
    });
    assert(hookCalled, "solving stage must execute through propagation hooks");
    assert(solveCalled, "solving stage must invoke solver delegate");
    assert(result.stage === "state-effect-solving", `unexpected stage ${result.stage}`);
    assert(result.status === "ok", `unexpected status ${result.status}`);
    assert(result.details?.visitedCount === 2, `expected visitedCount=2, got ${String(result.details?.visitedCount)}`);
    console.log("PASS test_full_analysis_stage_boundary");
}

main();
