import { result, type ValidationResult } from "./CommonTypes";
import type {
    CoverageLedger,
    CoverageLedgerEntry,
    CoverageLedgerStatus,
    CoverageSummary,
    ObservedSurface,
} from "./CoverageTypes";

export function createCoverageLedger(
    projectId: string,
    runId: string,
    observedSurfaces: ObservedSurface[],
    entries: CoverageLedgerEntry[],
): CoverageLedger {
    return {
        projectId,
        runId,
        entries,
        summary: summarizeCoverage(entries, observedSurfaces.length),
    };
}

export function summarizeCoverage(
    entries: CoverageLedgerEntry[],
    totalObservedSurfaces = entries.length,
): CoverageSummary {
    const count = (status: CoverageLedgerStatus) => entries.filter(entry => entry.coverageStatus === status).length;
    return {
        totalObservedSurfaces,
        exactCovered: count("covered-exact-role"),
        partialCovered: count("covered-partial"),
        roleMissing: count("covered-surface-but-role-missing"),
        notCovered: count("not-covered"),
        identityUnresolved: count("identity-unresolved"),
        conflicts: count("covered-conflict"),
        ignoredByPolicy: count("ignored-by-policy"),
        sentToLLM: entries.filter(entry => entry.decision === "send-to-llm").length,
        needMoreEvidence: count("need-more-evidence"),
    };
}

export function validateCoverageLedger(
    ledger: CoverageLedger,
    observedSurfaces: ObservedSurface[],
): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const observedIds = new Set(observedSurfaces.map(surface => surface.observedSurfaceId));
    const seen = new Set<string>();

    for (const entry of ledger.entries) {
        if (!entry.observedSurfaceId) {
            errors.push("coverage ledger entry is missing observedSurfaceId");
            continue;
        }
        if (!observedIds.has(entry.observedSurfaceId)) {
            errors.push(`coverage ledger entry references unknown observed surface ${entry.observedSurfaceId}`);
        }
        if (seen.has(entry.observedSurfaceId)) {
            errors.push(`duplicate coverage ledger entry for observed surface ${entry.observedSurfaceId}`);
        }
        seen.add(entry.observedSurfaceId);
        if (!entry.reason || entry.reason.trim().length === 0) {
            errors.push(`coverage ledger entry ${entry.observedSurfaceId} must explain its terminal status`);
        }
        if (!entry.decision) {
            errors.push(`coverage ledger entry ${entry.observedSurfaceId} is missing candidate decision`);
        }
        if (entry.decision === "skip-llm"
            && entry.coverageStatus !== "covered-exact-role"
            && entry.coverageStatus !== "ignored-by-policy") {
            errors.push(`coverage ledger entry ${entry.observedSurfaceId} cannot skip LLM with status ${entry.coverageStatus}`);
        }
        if (entry.decision === "ignore" && entry.coverageStatus !== "ignored-by-policy") {
            errors.push(`coverage ledger entry ${entry.observedSurfaceId} cannot ignore non-policy status ${entry.coverageStatus}`);
        }
        if (entry.decision === "send-to-llm"
            && (entry.coverageStatus === "covered-exact-role" || entry.coverageStatus === "ignored-by-policy")) {
            errors.push(`coverage ledger entry ${entry.observedSurfaceId} cannot send terminal covered/ignored status to LLM`);
        }
        if (entry.coverageStatus === "ignored-by-policy" && (!entry.reason || entry.reason.trim().length === 0)) {
            errors.push(`ignored observed surface ${entry.observedSurfaceId} must have an ignored reason`);
        }
        if (entry.coverageStatus === "covered-exact-role") {
            if (!entry.matchedAssetIds?.length || !entry.matchedBindingIds?.length) {
                errors.push(`covered ledger entry ${entry.observedSurfaceId} must reference matched asset and binding ids`);
            }
        }
    }

    for (const observedId of observedIds) {
        if (!seen.has(observedId)) {
            errors.push(`observed surface ${observedId} has no coverage ledger entry`);
        }
    }

    if (ledger.summary.totalObservedSurfaces !== observedSurfaces.length) {
        errors.push(`ledger summary totalObservedSurfaces=${ledger.summary.totalObservedSurfaces} does not match observed count=${observedSurfaces.length}`);
    }

    return result(errors, warnings);
}
