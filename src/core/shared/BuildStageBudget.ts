export interface BuildStageBudget {
    startedAtMs: number;
    maxElapsedMs?: number;
    label: string;
}

export class BuildStageBudgetExceededError extends Error {
    readonly code = "BUILD_STAGE_BUDGET_EXCEEDED";
    readonly label: string;
    readonly phase: string;
    readonly elapsedMs: number;
    readonly maxElapsedMs: number;

    constructor(label: string, phase: string, elapsedMs: number, maxElapsedMs: number) {
        super(`${label} exceeded ${maxElapsedMs}ms during ${phase} (elapsed=${elapsedMs}ms)`);
        this.name = "BuildStageBudgetExceededError";
        this.label = label;
        this.phase = phase;
        this.elapsedMs = elapsedMs;
        this.maxElapsedMs = maxElapsedMs;
    }
}

export function assertBuildStageBudget(
    budget: BuildStageBudget | undefined,
    phase: string,
): void {
    if (!budget?.maxElapsedMs || budget.maxElapsedMs <= 0) return;
    const elapsedMs = Date.now() - budget.startedAtMs;
    if (elapsedMs <= budget.maxElapsedMs) return;
    throw new BuildStageBudgetExceededError(budget.label, phase, elapsedMs, budget.maxElapsedMs);
}
