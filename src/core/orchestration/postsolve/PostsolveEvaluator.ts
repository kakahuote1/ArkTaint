import { TaintFlow } from "../../kernel/model/TaintFlow";
import { evaluateTypeNarrowingGuardPath } from "./TypeNarrowingGuardRefinement";
import { materializeTaintFlowPaths } from "./WitnessMaterializer";
import { buildPostsolveSkeleton } from "./PostsolveSkeleton";
import {
    PostsolveContext,
    PostsolveEvidence,
    PostsolveFlowResult,
    PostsolveJudgement,
    PostsolveReport,
    PostsolveSeedResult,
} from "./PostsolveTypes";

export function evaluatePostsolveFlow(
    flow: TaintFlow,
    context: PostsolveContext,
): PostsolveSeedResult {
    const witness = flow.sinkFactId
        ? materializeTaintFlowPaths(flow, context, {
            maxPaths: 128,
            maxDepth: 128,
        })
        : undefined;
    const skeleton = buildPostsolveSkeleton(witness, context);
    const pathResults = (witness?.paths || []).map(path => {
        const evidence = evaluateTypeNarrowingGuardPath(flow, path, context);
        const judgement = decidePostsolveJudgement(evidence);
        return {
            factIds: [...path.factIds],
            truncated: path.truncated,
            evidence,
            judgement,
        };
    });

    const judgement = aggregateFlowJudgement(pathResults);
    const evidenceSummary = buildEvidenceSummary(pathResults, judgement);
    const report: PostsolveReport = {
        sinkFactId: flow.sinkFactId || "",
        witness,
        skeleton,
        evidence: flattenPathEvidence(pathResults),
        judgement,
        temporalFingerprint: witness
            ? {
                sinkFactId: witness.sinkFactId,
                pathCount: witness.paths.length,
            }
            : undefined,
    };

    return {
        sinkFactId: flow.sinkFactId || "",
        witness,
        skeleton,
        judgement,
        pathResults,
        evidenceSummary,
        report,
    };
}

export function materializePostsolveFlowResult(
    flow: TaintFlow,
    seedResult: PostsolveSeedResult,
): PostsolveFlowResult {
    return {
        flow: {
            source: flow.source,
            sinkText: flow.sink?.toString?.() || "",
            sinkFactId: flow.sinkFactId,
            sinkNodeId: flow.sinkNodeId,
            sinkFieldPath: flow.sinkFieldPath,
        },
        skeleton: seedResult.skeleton,
        paths: seedResult.pathResults.map(path => ({
            factIds: [...path.factIds],
            truncated: path.truncated,
            evidence: [...path.evidence],
            judgement: path.judgement,
        })),
        evidenceSummary: seedResult.evidenceSummary,
        judgement: seedResult.judgement,
        report: seedResult.report,
    };
}

export function decidePostsolveJudgement(evidence: PostsolveEvidence[]): PostsolveJudgement {
    const evidenceKinds = [...new Set(evidence.map(item => item.kind))];
    const strongNegative = evidence.find(item => item.polarity === "negative" && item.strength === "strong");
    if (strongNegative) {
        return {
            kind: "Refuted-Strong",
            primaryReason: String(strongNegative.meta.reason || strongNegative.kind),
            evidenceKinds,
        };
    }
    const weakNegative = evidence.find(item => item.polarity === "negative");
    if (weakNegative) {
        return {
            kind: "Refuted-Weak",
            primaryReason: String(weakNegative.meta.reason || weakNegative.kind),
            evidenceKinds,
        };
    }
    const positive = evidence.find(item => item.polarity === "positive");
    if (positive) {
        return {
            kind: "Confirmed",
            primaryReason: String(positive.meta.reason || positive.kind),
            evidenceKinds,
        };
    }
    return {
        kind: "Unresolved",
        evidenceKinds,
    };
}

export function aggregateFlowJudgement(
    pathResults: Array<{
        evidence: PostsolveEvidence[];
        judgement: PostsolveJudgement;
    }>,
): PostsolveJudgement {
    if (pathResults.length === 0) {
        return {
            kind: "Unresolved",
            evidenceKinds: [],
        };
    }

    const allRefutedStrong = pathResults.every(item => item.judgement.kind === "Refuted-Strong");
    if (allRefutedStrong) {
        const evidenceKinds = [...new Set(pathResults.flatMap(item => item.judgement.evidenceKinds))];
        return {
            kind: "Refuted-Strong",
            primaryReason: String(pathResults.find(item => item.judgement.primaryReason)?.judgement?.primaryReason || "all_paths_refuted"),
            evidenceKinds,
        };
    }

    const hasRefuted = pathResults.some(item =>
        item.judgement.kind === "Refuted-Strong" || item.judgement.kind === "Refuted-Weak",
    );
    const allRefuted = pathResults.every(item =>
        item.judgement.kind === "Refuted-Strong" || item.judgement.kind === "Refuted-Weak",
    );
    const hasConfirmed = pathResults.some(item => item.judgement.kind === "Confirmed");
    const evidenceKinds = [...new Set(pathResults.flatMap(item => item.judgement.evidenceKinds))];

    if (allRefuted) {
        return {
            kind: "Refuted-Weak",
            primaryReason: String(pathResults.find(item => item.judgement.primaryReason)?.judgement?.primaryReason || "all_paths_refuted_weak"),
            evidenceKinds,
        };
    }

    if (hasConfirmed && !hasRefuted) {
        return {
            kind: "Confirmed",
            primaryReason: String(pathResults.find(item => item.judgement.primaryReason)?.judgement?.primaryReason || "path_confirmed"),
            evidenceKinds,
        };
    }

    if (hasRefuted) {
        return {
            kind: "Unresolved",
            primaryReason: "not_all_paths_refuted",
            evidenceKinds,
        };
    }

    return {
        kind: "Unresolved",
        evidenceKinds,
    };
}

function buildEvidenceSummary(
    pathResults: Array<{
        evidence: PostsolveEvidence[];
        judgement: PostsolveJudgement;
    }>,
    flowJudgement: PostsolveJudgement,
): {
    evidenceKinds: string[];
    primaryReason?: string;
} {
    return {
        evidenceKinds: [...new Set(pathResults.flatMap(item => item.evidence.map(e => e.kind)))],
        primaryReason: flowJudgement.primaryReason,
    };
}

function flattenPathEvidence(
    pathResults: Array<{
        evidence: PostsolveEvidence[];
    }>,
): PostsolveEvidence[] {
    const dedup = new Map<string, PostsolveEvidence>();
    for (const item of pathResults) {
        for (const evidence of item.evidence) {
            const key = JSON.stringify([
                evidence.kind,
                evidence.polarity,
                evidence.strength,
                evidence.stability,
                evidence.target?.sinkFactId,
                evidence.target?.sinkNodeId,
                evidence.meta,
            ]);
            if (!dedup.has(key)) {
                dedup.set(key, evidence);
            }
        }
    }
    return [...dedup.values()];
}
