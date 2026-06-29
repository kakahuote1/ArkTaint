import {
    collectSourceRuleSeeds,
    type SourceRuleSeedCollectionResult,
} from "../../core/kernel/rules/SourceRuleSeedCollector";
import {
    detectSinkEffects,
    type SinkDetectAuditEntry,
} from "../../core/kernel/rules/SinkDetector";

function compileOnly(): void {
    const collect: typeof collectSourceRuleSeeds = collectSourceRuleSeeds;
    const detect: typeof detectSinkEffects = detectSinkEffects;
    const sourceResult = {} as SourceRuleSeedCollectionResult;
    const sourceEndpointAudit = sourceResult.endpointResolutionAudit;
    const sinkAudit = {} as SinkDetectAuditEntry;
    const sinkDiagnosticReason: string = sinkAudit.reason;

    void collect;
    void detect;
    void sourceEndpointAudit;
    void sinkDiagnosticReason;
}

compileOnly();
