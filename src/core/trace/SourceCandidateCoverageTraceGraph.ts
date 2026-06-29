import type { Scene } from "../../../arkanalyzer/out/src/Scene";
import { buildTraceGraph, FullTraceRun, TraceGate, TraceGraph } from "./TraceGraph";

export type SourceCoverageCandidateKind = "formal_parameter";

export interface SourceCoverageCandidate {
    kind: SourceCoverageCandidateKind;
    subject: string;
    ownerClass?: string;
    targetName: string;
    methodNames: string[];
    methodSignatures: string[];
    paramIndex?: number;
    paramName?: string;
    endpoint?: string;
    reason: string;
}

export interface SourceCandidateCoverageTraceGraphInput {
    run: FullTraceRun;
    sourceDir?: string;
    candidates: readonly SourceCoverageCandidate[];
}

export function collectSourceCoverageCandidates(scene: Scene): SourceCoverageCandidate[] {
    void scene;
    return [];
}

export function buildSourceCandidateCoverageTraceGraph(
    input: SourceCandidateCoverageTraceGraphInput,
): TraceGraph {
    const gates: TraceGate[] = [];
    const pushGate = (gate: Omit<TraceGate, "id">): void => {
        gates.push({
            id: `gate:${gates.length + 1}`,
            ...gate,
        });
    };

    pushGate({
        stage: "preanalysis",
        producer: "preanalysis",
        gateKind: "observed_surface",
        scope: `preanalysis:source_candidates:${input.sourceDir || "."}`,
        attempted: true,
        matched: input.candidates.length > 0,
        emitted: input.candidates.length > 0,
        skippedReason: input.candidates.length > 0 ? undefined : "no_source_coverage_candidates",
        evidence: {
            sourceDir: input.sourceDir,
            candidateCount: input.candidates.length,
            traceRole: "source-candidate-coverage-summary",
        },
    });

    for (const candidate of input.candidates) {
        const evidence = candidateEvidence(candidate, input.sourceDir);
        pushGate({
            label: `program-gap:${candidate.subject}`,
            stage: "preanalysis",
            producer: "preanalysis",
            gateKind: "observed_surface",
            scope: `preanalysis:program_source_candidate:${candidate.subject}`,
            attempted: true,
            matched: true,
            emitted: true,
            evidence,
        });
        pushGate({
            label: `program-gap:${candidate.subject}`,
            stage: "coverage_ledger",
            producer: "coverage_ledger",
            gateKind: "coverage_query",
            scope: `coverage_ledger:program_source_candidate:${candidate.subject}`,
            attempted: true,
            matched: false,
            emitted: false,
            evidence: {
                ...evidence,
                role: "source",
                endpoint: candidate.endpoint || "unknown",
                coverageStatus: "not-covered",
                reason: "current_assets_do_not_seed_source_candidate",
                traceRole: "source-candidate-gap",
            },
        });
        pushGate({
            label: `program-gap:${candidate.subject}`,
            stage: "source_seed",
            producer: "rule",
            gateKind: "seed",
            scope: `source_seed:program_source_candidate:${candidate.subject}`,
            attempted: true,
            matched: false,
            emitted: false,
            skippedReason: "source_candidate_not_seeded_by_current_assets",
            evidence,
        });
    }

    return buildTraceGraph(input.run, [], [], gates);
}

function candidateEvidence(candidate: SourceCoverageCandidate, sourceDir?: string): Record<string, unknown> {
    return {
        sourceDir,
        identityStatus: "program-evidence-only",
        canonicalApiId: undefined,
        sourceCandidateKind: candidate.kind,
        ownerClass: candidate.ownerClass,
        targetName: candidate.targetName,
        methodNames: candidate.methodNames,
        methodSignatures: candidate.methodSignatures,
        paramIndex: candidate.paramIndex,
        paramName: candidate.paramName,
        endpoint: candidate.endpoint,
        reason: candidate.reason,
    };
}
