import type {
    TransferExecutionStats,
    TransferNoCandidateCallsite,
} from "../rules/ConfigBasedTransferExecutor";

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
    noCandidateCallsites: TransferNoCandidateCallsite[];
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
    bySection: Array<{
        section: string;
        calls: number;
        elapsedMs: number;
        avgMs: number;
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
    private readonly sectionCounters: Map<string, { calls: number; elapsedMs: number }> = new Map();
    private transferFactCount = 0;
    private transferInvokeSiteCount = 0;
    private transferRuleCheckCount = 0;
    private transferRuleMatchCount = 0;
    private transferEndpointCheckCount = 0;
    private transferEndpointMatchCount = 0;
    private transferDedupSkipCount = 0;
    private transferResultCount = 0;
    private transferElapsedMs = 0;
    private readonly transferNoCandidateCallsiteMap = new Map<string, TransferNoCandidateCallsite>();

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
        for (const site of stats.noCandidateCallsites || []) {
            const key = `${site.calleeSignature}|${site.method}|${site.invokeKind}|${site.argCount}|${site.sourceFile}`;
            const existing = this.transferNoCandidateCallsiteMap.get(key);
            if (existing) {
                existing.count += site.count;
            } else {
                this.transferNoCandidateCallsiteMap.set(key, { ...site });
            }
        }
    }

    public measure<T>(section: string, fn: () => T): T {
        const startedAt = process.hrtime.bigint();
        try {
            return fn();
        } finally {
            this.onSectionElapsed(section, Number(process.hrtime.bigint() - startedAt) / 1_000_000);
        }
    }

    public onSectionElapsed(section: string, elapsedMs: number): void {
        if (!section || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
        const current = this.sectionCounters.get(section) || { calls: 0, elapsedMs: 0 };
        current.calls += 1;
        current.elapsedMs += elapsedMs;
        this.sectionCounters.set(section, current);
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
        const noCandidateCallsites = [...this.transferNoCandidateCallsiteMap.values()]
            .sort((a, b) => b.count - a.count || a.calleeSignature.localeCompare(b.calleeSignature))
            .slice(0, 200);
        const bySection = [...this.sectionCounters.entries()]
            .map(([section, counter]) => ({
                section,
                calls: counter.calls,
                elapsedMs: Number(counter.elapsedMs.toFixed(3)),
                avgMs: counter.calls > 0 ? Number((counter.elapsedMs / counter.calls).toFixed(3)) : 0,
            }))
            .sort((a, b) => b.elapsedMs - a.elapsedMs || a.section.localeCompare(b.section));

        return {
            elapsedMs,
            dequeueCount: this.dequeueCount,
            enqueueAttemptCount: this.enqueueAttemptCount,
            enqueueSuccessCount: this.enqueueSuccessCount,
            dedupDropCount: this.dedupDropCount,
            maxQueueSize: this.maxQueueSize,
            byReason,
            bySection,
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
                noCandidateCallsites,
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
