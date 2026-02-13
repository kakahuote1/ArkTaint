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

        return {
            elapsedMs: Date.now() - this.startAt,
            dequeueCount: this.dequeueCount,
            enqueueAttemptCount: this.enqueueAttemptCount,
            enqueueSuccessCount: this.enqueueSuccessCount,
            dedupDropCount: this.dedupDropCount,
            maxQueueSize: this.maxQueueSize,
            byReason,
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
