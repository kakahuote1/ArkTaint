import type { TaintFact } from "../../kernel/model/TaintFact";
import type { WorklistSolverDeps } from "../../kernel/propagation/WorklistSolver";

export type FullAnalysisStageKind =
    | "entry-recovery"
    | "effect-instantiation"
    | "ir-effect-extraction"
    | "deferred-execution"
    | "state-effect-solving"
    | "sink-hit"
    | "evidence-flush";

export interface FullAnalysisStageResult {
    stage: FullAnalysisStageKind;
    status: "ok" | "skipped" | "failed";
    details?: Record<string, unknown>;
}

export interface WorklistPropagationHooks {
    run(
        input: { worklist: TaintFact[]; visited: Set<string>; deps: WorklistSolverDeps },
        delegate: { run(input: { worklist: TaintFact[]; visited: Set<string>; deps: WorklistSolverDeps }): { visitedCount: number } },
    ): { visitedCount: number };
}

export interface WorklistSolvingStageInput {
    worklist: TaintFact[];
    visited: Set<string>;
    deps: WorklistSolverDeps;
    hooks: WorklistPropagationHooks;
    solve: (worklist: TaintFact[], visited: Set<string>, deps: WorklistSolverDeps) => { visitedCount: number };
}

export function runWorklistSolvingStage(input: WorklistSolvingStageInput): FullAnalysisStageResult {
    const result = input.hooks.run(
        {
            worklist: input.worklist,
            visited: input.visited,
            deps: input.deps,
        },
        {
            run: stageInput => input.solve(stageInput.worklist, stageInput.visited, stageInput.deps),
        },
    );
    return {
        stage: "state-effect-solving",
        status: "ok",
        details: {
            visitedCount: result.visitedCount,
        },
    };
}
