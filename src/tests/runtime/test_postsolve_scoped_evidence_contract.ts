import { decidePostsolveJudgement } from "../../core/orchestration/postsolve/PostsolveEvaluator";
import type { PostsolveEvidence } from "../../core/orchestration/postsolve/PostsolveTypes";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function evidence(overrides: Partial<PostsolveEvidence>): PostsolveEvidence {
    return {
        kind: "test_evidence",
        polarity: "negative",
        strength: "strong",
        stability: "stable",
        scope: "path-segment",
        subject: {
            pathId: "path.1",
            pathSegmentId: "segment.1",
            sinkFactId: "sink",
        },
        preconditions: {
            pathComplete: true,
        },
        sourceEvidenceIds: ["evidence.1"],
        meta: { reason: "test" },
        ...overrides,
    };
}

function main(): void {
    const scopedStrong = decidePostsolveJudgement([evidence({})]);
    assert(scopedStrong.kind === "Refuted-Strong", `expected scoped strong refutation, got ${scopedStrong.kind}`);

    const diagnosticStrong = decidePostsolveJudgement([evidence({
        scope: "diagnostic",
        subject: {},
    })]);
    assert(diagnosticStrong.kind === "Unresolved", `diagnostic evidence must not refute path, got ${diagnosticStrong.kind}`);

    const missingSegment = decidePostsolveJudgement([evidence({
        scope: "path-segment",
        subject: { pathId: "path.1", sinkFactId: "sink" },
    })]);
    assert(missingSegment.kind === "Unresolved", `path-segment evidence without segment subject must not refute, got ${missingSegment.kind}`);

    const incompletePath = decidePostsolveJudgement([evidence({
        preconditions: { pathComplete: false },
    })]);
    assert(incompletePath.kind === "Refuted-Weak", `failed strong precondition should degrade to weak, got ${incompletePath.kind}`);

    const mayCurrentness = decidePostsolveJudgement([evidence({
        kind: "currentness_certificate",
        polarity: "neutral",
        strength: "weak",
        stability: "overridable",
        meta: { reason: "may-live", verdict: "may-live" },
    })]);
    assert(mayCurrentness.kind === "Unresolved", `neutral may-live currentness must not refute, got ${mayCurrentness.kind}`);

    console.log("PASS test_postsolve_scoped_evidence_contract");
}

main();
