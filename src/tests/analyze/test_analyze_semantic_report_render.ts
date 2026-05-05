import * as assert from "assert";
import { renderMarkdownReport } from "../../cli/analyzeReport";

function run(): void {
    const report = {
        generatedAt: "2026-05-04T00:00:00.000Z",
        repo: "repo",
        sourceDirs: ["tests/demo/semantic"],
        profile: "default",
        reportMode: "full",
        k: 1,
        maxEntries: 1,
        ruleLayers: ["kernel", "project"],
        ruleLayerStatus: [],
        summary: {
            totalEntries: 1,
            okEntries: 1,
            withSeeds: 1,
            withFlows: 1,
            totalFlows: 1,
            statusCount: { ok: 1 },
            ruleHits: { source: {}, sink: {}, transfer: {} },
            ruleHitEndpoints: { source: {}, sink: {}, transfer: {} },
            transferProfile: {
                factCount: 1,
                invokeSiteCount: 1,
                ruleCheckCount: 1,
                ruleMatchCount: 1,
                endpointCheckCount: 1,
                endpointMatchCount: 1,
                dedupSkipCount: 0,
                resultCount: 1,
                elapsedMs: 1,
                elapsedShareAvg: 1,
                noCandidateCallsites: [],
            },
            detectProfile: {
                detectCallCount: 1,
                methodsVisited: 1,
                reachableMethodsVisited: 1,
                stmtsVisited: 1,
                invokeStmtsVisited: 1,
                signatureMatchedInvokeCount: 1,
                constraintRejectedInvokeCount: 0,
                sinksChecked: 1,
                candidateCount: 1,
                taintCheckCount: 1,
                defReachabilityCheckCount: 1,
                fieldPathCheckCount: 1,
                fieldPathHitCount: 0,
                sanitizerGuardCheckCount: 1,
                sanitizerGuardHitCount: 0,
                signatureMatchMs: 1,
                candidateResolveMs: 1,
                taintEvalMs: 1,
                sanitizerGuardMs: 1,
                traversalMs: 1,
                totalMs: 1,
            },
            semanticState: {
                enabled: true,
                truncated: false,
                stats: { dequeues: 1, visited: 1, elapsedMs: 1, transitionCounts: { "native.assignment": 1 } },
                seedCount: 2,
                sinkHitCount: 1,
                candidateSeedCount: 2,
                provenanceCount: 1,
                gapCount: 1,
                sinkHits: [
                    { factId: "f1", carrierKey: "carrier-1", source: "seed", sinkSignature: "Sink.foo", sinkRuleId: "sink-1" },
                ],
                candidateSeeds: [
                    { factId: "f1", carrierKey: "carrier-1", source: "seed", reason: "seed" },
                ],
                derivedFacts: [],
                provenance: [
                    { fromFactId: "f1", toFactId: "f2", transitionId: "native.assignment", reason: "assign-tainted", carrierKey: "carrier-1", tainted: true },
                ],
                gaps: [
                    { factId: "f1", carrierKey: "carrier-1", transitionId: "native.branch", reason: "branch-unknown", blockedBy: "unresolved-branch-condition" },
                ],
            },
            memoryProfile: undefined,
            pagNodeResolutionAudit: undefined,
            executionHandoffAudit: undefined,
            diagnostics: undefined,
            diagnosticItems: [],
            moduleAudit: undefined,
            pluginAudit: undefined,
            arkMainSeeds: undefined,
            ruleFeedback: {
                zeroHitRules: { source: {}, sink: {}, transfer: {} },
                ruleHitRanking: { source: [], sink: [], transfer: [] },
                uncoveredHighFrequencyInvokes: [],
                noCandidateCallsites: [],
            },
        },
        entries: [],
    };

    const markdown = renderMarkdownReport(report as any);
    assert.ok(markdown.includes("semanticState: enabled=true, truncated=false, seeds=2, sinkHits=1, candidateSeeds=2, provenance=1, gaps=1"));
    assert.ok(markdown.includes("semantic sink hits: Sink.foo@carrier-1"));
    assert.ok(markdown.includes("semantic candidate seeds: seed@carrier-1"));
    assert.ok(markdown.includes("semantic provenance: native.assignment:assign-tainted"));
    assert.ok(markdown.includes("semantic gaps: native.branch:unresolved-branch-condition"));
    assert.ok(!markdown.includes("semantic path conditions"));

    console.log("test_analyze_semantic_report_render=PASS");
}

if (require.main === module) {
    try {
        run();
    } catch (error) {
        console.error("test_analyze_semantic_report_render=FAIL");
        console.error(error);
        process.exitCode = 1;
    }
}
