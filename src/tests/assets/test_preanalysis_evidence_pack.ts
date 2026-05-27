import {
    buildPreAnalysisEvidencePack,
    type PreAnalysisSlicePackage,
} from "../../core/preanalysis";
import type { CoverageLedgerEntry, ObservedSurface } from "../../core/assets/schema";

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

const observedSurfaces: ObservedSurface[] = [
    {
        observedSurfaceId: "obs.known",
        rawKind: "call",
        location: { file: "Index.ets", line: 1 },
        analyzerEvidence: { calleeSignature: "@ohos.console: console.[static]log(string)" },
        resolutionStatus: "resolved",
    },
    {
        observedSurfaceId: "obs.project.logger",
        rawKind: "call",
        location: { file: "Logger.ets", line: 7 },
        analyzerEvidence: { receiverType: "Logger", argCount: 1 },
        resolutionStatus: "partial",
    },
];

const ledgerEntries: CoverageLedgerEntry[] = [
    {
        observedSurfaceId: "obs.known",
        coverageStatus: "covered-exact-role",
        matchedAssetIds: ["asset.console"],
        matchedBindingIds: ["binding.console.sink"],
        role: "sink",
        decision: "skip-llm",
        reason: "official asset covers the exact role",
    },
    {
        observedSurfaceId: "obs.project.logger",
        coverageStatus: "not-covered",
        decision: "send-to-llm",
        reason: "project logger has no reviewed project asset",
    },
];

const loggerSlice: PreAnalysisSlicePackage = {
    slicePackageId: "slice.logger",
    observedSurfaceId: "obs.project.logger",
    anchorId: "anchor.logger",
    observations: ["candidateBoundary=project_or_third_party_wrapper_evidence"],
    snippets: [{ label: "method", code: "Logger.info(token);" }],
};

function main(): void {
    const pack = buildPreAnalysisEvidencePack({
        projectId: "project-a",
        runId: "run-1",
        observedSurfaces,
        ledgerEntries,
        semanticFlowSlicePackages: [loggerSlice],
    });
    assert(pack.coverageLedger.summary.sentToLLM === 1, "expected one send-to-LLM ledger entry");
    assert(pack.semanticFlowSlicePackages.length === 1, "expected one LLM slice package");

    let wrongSliceThrew = false;
    try {
        buildPreAnalysisEvidencePack({
            projectId: "project-a",
            runId: "run-2",
            observedSurfaces,
            ledgerEntries,
            semanticFlowSlicePackages: [{
                ...loggerSlice,
                slicePackageId: "slice.known",
                observedSurfaceId: "obs.known",
            }],
        });
    } catch {
        wrongSliceThrew = true;
    }
    assert(wrongSliceThrew, "slice package must not attach to skip-llm ledger entries");

    let missingLedgerThrew = false;
    try {
        buildPreAnalysisEvidencePack({
            projectId: "project-a",
            runId: "run-3",
            observedSurfaces,
            ledgerEntries: ledgerEntries.slice(1),
            semanticFlowSlicePackages: [loggerSlice],
        });
    } catch {
        missingLedgerThrew = true;
    }
    assert(missingLedgerThrew, "every observed surface must have a ledger entry");

    console.log("PASS test_preanalysis_evidence_pack");
}

main();
