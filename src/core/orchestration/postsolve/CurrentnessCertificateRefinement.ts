import { TaintFlow } from "../../kernel/model/TaintFlow";
import { ProvenancePath } from "../../provenance/ProvenancePathTypes";
import { PostsolveContext, PostsolveEvidence } from "./PostsolveTypes";

export function evaluateCurrentnessCertificatePath(
    flow: TaintFlow,
    path: ProvenancePath,
    context: PostsolveContext,
): PostsolveEvidence[] {
    const evidenceById = context.currentnessEvidenceById;
    if (!evidenceById) return [];

    const out: PostsolveEvidence[] = [];
    for (const evidenceId of path.currentnessEvidenceIds || []) {
        const evidence = evidenceById.get(evidenceId);
        if (!evidence) continue;
        const pathComplete = path.status === "complete" || path.status === "bounded-complete";
        const base = {
            scope: "path-segment" as const,
            subject: {
                pathId: path.id,
                pathSegmentId: evidence.candidateFlowId,
                stateCell: evidence.consumerCell.id,
                sourceLabel: evidence.label,
                sinkFactId: flow.sinkFactId,
                sinkNodeId: flow.sinkNodeId,
                sinkArgEndpoint: flow.sinkEndpoint,
            },
            position: {
                pathIndex: 0,
                factId: flow.sinkFactId,
            },
            target: {
                sinkFactId: flow.sinkFactId || "",
                sinkNodeId: flow.sinkNodeId,
            },
            sourceEvidenceIds: [evidence.id],
        };

        if (evidence.verdict === "live") {
            out.push({
                kind: "currentness_certificate",
                polarity: "positive",
                strength: "strong",
                stability: "stable",
                ...base,
                preconditions: {
                    pathComplete,
                },
                meta: {
                    reason: evidence.primaryReason,
                    verdict: evidence.verdict,
                    proofStatus: evidence.proofStatus,
                    sliceCompleteness: evidence.sliceCompleteness,
                },
            });
            continue;
        }

        if (evidence.verdict === "dead" || evidence.verdict === "blocked-mismatch") {
            out.push({
                kind: "currentness_certificate",
                polarity: "negative",
                strength: evidence.proofStatus === "refutation-proof" ? "strong" : "weak",
                stability: "stable",
                requiredForRefutation: true,
                ...base,
                preconditions: {
                    pathComplete,
                    endpointResolved: evidence.verdict === "blocked-mismatch",
                },
                meta: {
                    reason: evidence.primaryReason,
                    verdict: evidence.verdict,
                    proofStatus: evidence.proofStatus,
                    sliceCompleteness: evidence.sliceCompleteness,
                    blockedByEffectIds: evidence.blockedByEffectIds || [],
                },
            });
            continue;
        }

        out.push({
            kind: "currentness_certificate",
            polarity: "neutral",
            strength: "weak",
            stability: "overridable",
            ...base,
            preconditions: {
                pathComplete,
            },
            meta: {
                reason: evidence.primaryReason,
                verdict: evidence.verdict,
                proofStatus: evidence.proofStatus,
                sliceCompleteness: evidence.sliceCompleteness,
                uncertaintyReasons: evidence.uncertaintyReasons || [],
            },
        });
    }
    return out;
}
