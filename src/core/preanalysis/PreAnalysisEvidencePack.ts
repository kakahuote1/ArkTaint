import type { CoverageLedger, CoverageLedgerEntry, ObservedSurface, SourceLocation } from "../assets/schema";
import { createCoverageLedger, validateCoverageLedger } from "../assets/schema";

export interface PreAnalysisSlicePackage {
    slicePackageId: string;
    observedSurfaceId: string;
    anchorId: string;
    observations: string[];
    snippets: Array<{
        label: string;
        code: string;
        location?: SourceLocation;
    }>;
    notes?: string[];
}

export interface PreAnalysisEvidencePack {
    projectId: string;
    runId: string;
    observedSurfaces: ObservedSurface[];
    coverageLedger: CoverageLedger;
    semanticFlowSlicePackages: PreAnalysisSlicePackage[];
}

export interface BuildPreAnalysisEvidencePackInput {
    projectId: string;
    runId: string;
    observedSurfaces: ObservedSurface[];
    ledgerEntries: CoverageLedgerEntry[];
    semanticFlowSlicePackages?: PreAnalysisSlicePackage[];
}

export function buildPreAnalysisEvidencePack(input: BuildPreAnalysisEvidencePackInput): PreAnalysisEvidencePack {
    const coverageLedger = createCoverageLedger(
        input.projectId,
        input.runId,
        input.observedSurfaces,
        input.ledgerEntries,
    );
    const validation = validateCoverageLedger(coverageLedger, input.observedSurfaces);
    if (!validation.valid) {
        throw new Error(`invalid preanalysis coverage ledger: ${validation.errors.join("; ")}`);
    }
    validateSlicePackages(input.semanticFlowSlicePackages || [], coverageLedger.entries);
    return {
        projectId: input.projectId,
        runId: input.runId,
        observedSurfaces: [...input.observedSurfaces],
        coverageLedger,
        semanticFlowSlicePackages: [...(input.semanticFlowSlicePackages || [])],
    };
}

function validateSlicePackages(
    slicePackages: PreAnalysisSlicePackage[],
    entries: CoverageLedgerEntry[],
): void {
    const byObservedId = new Map(entries.map(entry => [entry.observedSurfaceId, entry]));
    const seen = new Set<string>();
    const errors: string[] = [];
    for (const slice of slicePackages) {
        if (!slice.slicePackageId) {
            errors.push("semantic flow slice package is missing slicePackageId");
        }
        if (seen.has(slice.slicePackageId)) {
            errors.push(`duplicate semantic flow slice package ${slice.slicePackageId}`);
        }
        seen.add(slice.slicePackageId);
        const ledger = byObservedId.get(slice.observedSurfaceId);
        if (!ledger) {
            errors.push(`semantic flow slice package ${slice.slicePackageId} references unknown observed surface ${slice.observedSurfaceId}`);
            continue;
        }
        if (ledger.decision !== "send-to-llm") {
            errors.push(`semantic flow slice package ${slice.slicePackageId} is attached to non-LLM ledger decision ${ledger.decision}`);
        }
        if (!slice.anchorId) {
            errors.push(`semantic flow slice package ${slice.slicePackageId} is missing anchorId`);
        }
        if (slice.observations.length === 0 && slice.snippets.length === 0) {
            errors.push(`semantic flow slice package ${slice.slicePackageId} must contain observations or snippets`);
        }
    }
    if (errors.length > 0) {
        throw new Error(`invalid preanalysis evidence pack: ${errors.join("; ")}`);
    }
}
