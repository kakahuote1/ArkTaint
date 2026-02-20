import type { TransferExecutionStats } from "./ConfigBasedTransferExecutor";

export interface TransferProfileSnapshot {
    factCount: number;
    invokeSiteCount: number;
    ruleCheckCount: number;
    ruleMatchCount: number;
    endpointCheckCount: number;
    endpointMatchCount: number;
    dedupSkipCount: number;
    resultCount: number;
    elapsedMs: number;
    elapsedShare: number;
}

export interface WorklistProfileSnapshot {
    elapsedMs: number;
    dequeueCount: number;
    enqueueAttemptCount: number;
    enqueueSuccessCount: number;
    dedupDropCount: number;
    maxQueueSize: number;
    byReason: Array<{
        reason: string;
        attempts: number;
        successes: number;
        dedupDrops: number;
    }>;
    transfer: TransferProfileSnapshot;
}

interface ReasonCounter {
    attempts: number;
    successes: number;
    dedupDrops: number;
}

export class WorklistProfiler {
    private readonly startAt = Date.now();
    private dequeueCount = 0;
    private enqueueAttemptCount = 0;
    private enqueueSuccessCount = 0;
    private dedupDropCount = 0;
    private maxQueueSize = 0;
    private readonly reasonCounters: Map<string, ReasonCounter> = new Map();
    private transferFactCount = 0;
    private transferInvokeSiteCount = 0;
    private transferRuleCheckCount = 0;
    private transferRuleMatchCount = 0;
    private transferEndpointCheckCount = 0;
    private transferEndpointMatchCount = 0;
    private transferDedupSkipCount = 0;
    private transferResultCount = 0;
    private transferElapsedMs = 0;

    public onQueueSize(queueSize: number): void {
        if (queueSize > this.maxQueueSize) {
            this.maxQueueSize = queueSize;
        }
    }

    public onDequeue(queueSizeAfterPop: number): void {
        this.dequeueCount++;
        this.onQueueSize(queueSizeAfterPop);
    }

    public onEnqueueAttempt(reason: string): void {
        this.enqueueAttemptCount++;
        const counter = this.getOrCreateReasonCounter(reason);
        counter.attempts++;
    }

    public onEnqueueSuccess(reason: string, queueSizeAfterPush: number): void {
        this.enqueueSuccessCount++;
        const counter = this.getOrCreateReasonCounter(reason);
        counter.successes++;
        this.onQueueSize(queueSizeAfterPush);
    }

    public onDedupDrop(reason: string): void {
        this.dedupDropCount++;
        const counter = this.getOrCreateReasonCounter(reason);
        counter.dedupDrops++;
    }

    public onTransferStats(stats: TransferExecutionStats): void {
        this.transferFactCount += stats.factCount;
        this.transferInvokeSiteCount += stats.invokeSiteCount;
        this.transferRuleCheckCount += stats.ruleCheckCount;
        this.transferRuleMatchCount += stats.ruleMatchCount;
        this.transferEndpointCheckCount += stats.endpointCheckCount;
        this.transferEndpointMatchCount += stats.endpointMatchCount;
        this.transferDedupSkipCount += stats.dedupSkipCount;
        this.transferResultCount += stats.resultCount;
        this.transferElapsedMs += stats.elapsedMs;
    }

    public snapshot(): WorklistProfileSnapshot {
        const byReason = Array.from(this.reasonCounters.entries())
            .map(([reason, counter]) => ({
                reason,
                attempts: counter.attempts,
                successes: counter.successes,
                dedupDrops: counter.dedupDrops,
            }))
            .sort((a, b) => {
                if (b.attempts !== a.attempts) return b.attempts - a.attempts;
                return a.reason.localeCompare(b.reason);
            });

        const elapsedMs = Date.now() - this.startAt;
        const elapsedShare = elapsedMs > 0
            ? Number((this.transferElapsedMs / elapsedMs).toFixed(6))
            : 0;

        return {
            elapsedMs,
            dequeueCount: this.dequeueCount,
            enqueueAttemptCount: this.enqueueAttemptCount,
            enqueueSuccessCount: this.enqueueSuccessCount,
            dedupDropCount: this.dedupDropCount,
            maxQueueSize: this.maxQueueSize,
            byReason,
            transfer: {
                factCount: this.transferFactCount,
                invokeSiteCount: this.transferInvokeSiteCount,
                ruleCheckCount: this.transferRuleCheckCount,
                ruleMatchCount: this.transferRuleMatchCount,
                endpointCheckCount: this.transferEndpointCheckCount,
                endpointMatchCount: this.transferEndpointMatchCount,
                dedupSkipCount: this.transferDedupSkipCount,
                resultCount: this.transferResultCount,
                elapsedMs: this.transferElapsedMs,
                elapsedShare,
            },
        };
    }

    private getOrCreateReasonCounter(reason: string): ReasonCounter {
        let counter = this.reasonCounters.get(reason);
        if (!counter) {
            counter = { attempts: 0, successes: 0, dedupDrops: 0 };
            this.reasonCounters.set(reason, counter);
        }
        return counter;
    }
}
