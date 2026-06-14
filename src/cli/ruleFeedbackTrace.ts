import { FullTraceRun, TraceGate, TraceGraph, buildTraceGraph } from "../core/trace/TraceGraph";
import { AnalyzeReport } from "./analyzeTypes";
import {
    ClassifiedNoCandidateCallsite,
    NoCandidateCallsiteClassificationArtifacts,
} from "./ruleFeedback";

export interface CurrentAssetCandidateTraceGraphInput {
    run: FullTraceRun;
    report: AnalyzeReport;
    artifacts: NoCandidateCallsiteClassificationArtifacts;
}

export function buildCurrentAssetCandidateTraceGraph(input: CurrentAssetCandidateTraceGraphInput): TraceGraph {
    const gates: TraceGate[] = [];
    const pushGate = (gate: Omit<TraceGate, "id">): void => {
        gates.push({
            id: `gate:${gates.length + 1}`,
            ...gate,
        });
    };

    pushGate({
        stage: "coverage_ledger",
        producer: "coverage_ledger",
        gateKind: "coverage_query",
        scope: "coverage_ledger:current_assets_api_modeling_candidates",
        attempted: true,
        matched: input.artifacts.apiModelingCandidates.length > 0,
        emitted: input.artifacts.apiModelingCandidates.length > 0,
        skippedReason: input.artifacts.apiModelingCandidates.length > 0 ? undefined : "no_api_modeling_candidates",
        evidence: {
            totalClassified: input.artifacts.items.length,
            apiModelingCandidateCount: input.artifacts.apiModelingCandidates.length,
            categoryCount: input.artifacts.categoryCount,
        },
    });

    for (const item of input.artifacts.items) {
        const subject = candidateSubject(item);
        pushGate({
            label: subject,
            stage: "preanalysis",
            producer: "preanalysis",
            gateKind: "observed_surface",
            scope: `preanalysis:no_candidate_callsite:${subject}`,
            attempted: true,
            matched: true,
            emitted: true,
            evidence: candidateEvidence(item, {
                repo: input.report.repo,
                sourceDirs: input.report.sourceDirs,
                traceRole: "observed-no-candidate-callsite",
            }),
        });
    }

    for (const item of input.artifacts.apiModelingCandidates) {
        const subject = candidateSubject(item);
        pushGate({
            label: subject,
            stage: "coverage_ledger",
            producer: "coverage_ledger",
            gateKind: "coverage_query",
            scope: `coverage_ledger:api_modeling_candidate:${subject}`,
            attempted: true,
            matched: false,
            emitted: false,
            evidence: candidateEvidence(item, {
                role: resolveCandidateRole(item),
                endpoint: resolveCandidateEndpoint(item),
                reason: "current_assets_not_covered_by_reviewed_replayed_or_official_asset",
                coverageStatus: "not-covered",
                traceRole: "api-modeling-candidate-gap",
            }),
        });
        pushGate({
            label: subject,
            stage: "semanticflow",
            producer: "semanticflow",
            gateKind: "candidate",
            scope: `semanticflow:current_assets_candidate:${subject}`,
            attempted: true,
            matched: true,
            emitted: false,
            skippedReason: "semanticflow_not_invoked_for_current_assets_trace",
            evidence: candidateEvidence(item, {
                role: resolveCandidateRole(item),
                endpoint: resolveCandidateEndpoint(item),
                reason: "queued_for_bounded_semanticflow_after_coverage_gap_review",
                traceRole: "semanticflow-candidate-queued",
            }),
        });
    }

    const zeroHitRules = input.report.summary.ruleFeedback?.zeroHitRules;
    const sourceZeroHitAuditByRuleId = new Map<string, any>();
    for (const entry of input.report.summary.ruleFeedback?.sourceZeroHitAudit || []) {
        const ruleId = String((entry as any)?.ruleId || "");
        if (!ruleId) continue;
        sourceZeroHitAuditByRuleId.set(ruleId, entry);
    }
    for (const ruleId of Object.keys(zeroHitRules?.source || {}).sort((a, b) => a.localeCompare(b))) {
        pushZeroHitRuleGate(pushGate, input.report, "source", ruleId, sourceZeroHitAuditByRuleId.get(ruleId));
    }
    for (const ruleId of Object.keys(zeroHitRules?.sink || {}).sort((a, b) => a.localeCompare(b))) {
        pushZeroHitRuleGate(pushGate, input.report, "sink", ruleId);
    }
    for (const ruleId of Object.keys(zeroHitRules?.transfer || {}).sort((a, b) => a.localeCompare(b))) {
        pushZeroHitRuleGate(pushGate, input.report, "transfer", ruleId);
    }

    return buildTraceGraph(input.run, [], [], gates);
}

function pushZeroHitRuleGate(
    pushGate: (gate: Omit<TraceGate, "id">) => void,
    report: AnalyzeReport,
    role: "source" | "sink" | "transfer",
    ruleId: string,
    diagnostic?: any,
): void {
    const layer = findRuleLayerForRuleId(report, role, ruleId);
    const stage = role === "source"
        ? "source_seed"
        : role === "sink"
            ? "sink_candidate"
            : "rule";
    const gateKind = role === "source"
        ? "seed"
        : role === "sink"
            ? "sink_candidate"
            : "propagation";
    const skippedReason = role === "source"
        ? "source_rule_zero_hit"
        : role === "sink"
            ? "sink_rule_zero_hit"
            : "transfer_rule_zero_hit";
    pushGate({
        label: `${role}_rule:${ruleId}`,
        stage,
        producer: "rule",
        gateKind,
        scope: `${role}_rule:${ruleId}`,
        attempted: true,
        matched: false,
        emitted: false,
        skippedReason,
        evidence: {
            ruleId,
            role,
            layerName: layer?.name,
            layerPath: layer?.path,
            packId: layer?.packId,
            reason: skippedReason,
            traceRole: "zero-hit-rule",
            zeroHitReason: diagnostic?.reason,
            allowedMethodFilterActive: diagnostic?.allowedMethodFilterActive,
            matchedCallsiteCount: diagnostic?.matchedCallsiteCount,
            matchedAllowedCallsiteCount: diagnostic?.matchedAllowedCallsiteCount,
            matchedExcludedCallsiteCount: diagnostic?.matchedExcludedCallsiteCount,
            sampleCallsites: diagnostic?.sampleCallsites,
        },
    });
}

function findRuleLayerForRuleId(
    report: AnalyzeReport,
    role: "source" | "sink" | "transfer",
    ruleId: string,
): AnalyzeReport["ruleLayerStatus"][number] | undefined {
    if (role === "source") {
        return report.ruleLayerStatus.find(layer => (layer.sourceRuleIds || []).includes(ruleId));
    }
    if (role === "sink") {
        return report.ruleLayerStatus.find(layer => (layer.sinkRuleIds || []).includes(ruleId));
    }
    return undefined;
}

function candidateSubject(item: ClassifiedNoCandidateCallsite): string {
    return stableToken([
        item.callee_signature,
        item.method,
        item.invokeKind,
        String(item.argCount),
        item.sourceFile,
        String((item as any).semanticFocus || ""),
    ].join("|"));
}

function candidateEvidence(
    item: ClassifiedNoCandidateCallsite,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    const anyItem = item as any;
    const evidence: Record<string, unknown> = {
        calleeSignature: item.callee_signature,
        method: item.method,
        invokeKind: item.invokeKind,
        argCount: item.argCount,
        sourceFile: item.sourceFile,
        count: item.count,
        topEntries: item.topEntries,
        category: item.category,
        candidateOrigin: anyItem.candidateOrigin,
        semanticFocus: anyItem.semanticFocus,
        importSource: anyItem.importSource,
        callbackProperties: anyItem.callbackProperties,
        reason: item.reason,
        evidence: item.evidence,
        ...extra,
    };
    for (const key of [
        "typeHint",
        "callerFiles",
        "callbackArgIndexes",
        "callbackProperties",
        "contextSlices",
        "ownerSnippet",
        "methodSnippet",
        "carrierRoots",
        "carrierObservations",
        "carrierMethodSnippets",
        "carrierSnippet",
        "methodExamples",
    ]) {
        if (anyItem[key] !== undefined) {
            evidence[key] = anyItem[key];
        }
    }
    return evidence;
}

function resolveCandidateRole(item: ClassifiedNoCandidateCallsite): string {
    const focus = String((item as any).semanticFocus || "").toLowerCase();
    if (focus.includes("source")) return "source";
    if (focus.includes("sink")) return "sink";
    if (focus.includes("callback")) return "entry";
    if (focus.includes("storage") || focus.includes("handoff")) return "handoff";
    return "unknown";
}

function resolveCandidateEndpoint(item: ClassifiedNoCandidateCallsite): string {
    if (item.argCount > 0) return "arg[*]";
    const focus = String((item as any).semanticFocus || "").toLowerCase();
    if (focus.includes("return") || focus.includes("result")) return "return";
    return "unknown";
}

function stableToken(value: string): string {
    return value
        .replace(/\\/g, "/")
        .replace(/[^A-Za-z0-9_.:/@-]+/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 220);
}
