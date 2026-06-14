export interface ExecutionHandoffBuildBudget {
    startedAtMs: number;
    maxElapsedMs?: number;
    phase?: string;
}

export class ExecutionHandoffBudgetExceededError extends Error {
    readonly code = "EXECUTION_HANDOFF_BUDGET_EXCEEDED";
    readonly elapsedMs: number;
    readonly maxElapsedMs: number;
    readonly phase: string;

    constructor(elapsedMs: number, maxElapsedMs: number, phase: string) {
        super(`execution handoff build exceeded ${maxElapsedMs}ms during ${phase} (elapsed=${elapsedMs}ms)`);
        this.name = "ExecutionHandoffBudgetExceededError";
        this.elapsedMs = elapsedMs;
        this.maxElapsedMs = maxElapsedMs;
        this.phase = phase;
    }
}

export function assertExecutionHandoffBudget(
    budget: ExecutionHandoffBuildBudget | undefined,
    phase: string,
): void {
    if (!budget?.maxElapsedMs || budget.maxElapsedMs <= 0) return;
    const elapsedMs = Date.now() - budget.startedAtMs;
    if (elapsedMs <= budget.maxElapsedMs) return;
    throw new ExecutionHandoffBudgetExceededError(elapsedMs, budget.maxElapsedMs, phase);
}
