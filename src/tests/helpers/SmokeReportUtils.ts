import {
    CliOptions,
    EntrySmokeResult,
    ProjectSmokeResult,
    SmokeReport,
    SourceDirSelectionStats,
    SourceDirSummary,
} from "./SmokeTypes";

function sumCounts(counts: Record<string, number>): number {
    return Object.values(counts || {}).reduce((sum, value) => sum + value, 0);
}

function hasInventoryFlow(entry: EntrySmokeResult): boolean {
    return (entry.flowRuleTraces?.length || 0) > 0
        || sumCounts(entry.sinkRuleHits) > 0
        || entry.flowCount > 0;
}

function inventoryFlowCount(entry: EntrySmokeResult): number {
    if ((entry.flowRuleTraces?.length || 0) > 0) {
        return entry.flowRuleTraces.length;
    }
    const sinkHitCount = sumCounts(entry.sinkRuleHits);
    return sinkHitCount > 0 ? sinkHitCount : entry.flowCount;
}

function mergeCounts(dst: Record<string, number>, src: Record<string, number>): void {
    for (const [key, value] of Object.entries(src || {})) {
        dst[key] = (dst[key] || 0) + value;
    }
}

export function createSourceSummary(
    sourceDir: string,
    results: EntrySmokeResult[],
    selection: SourceDirSelectionStats
): SourceDirSummary {
    const statusCount: Record<string, number> = {};
    let analyzed = 0;
    let withSeeds = 0;
    let withFlows = 0;
    let totalFlows = 0;

    for (const r of results) {
        statusCount[r.status] = (statusCount[r.status] || 0) + 1;
        analyzed++;
        if (r.seedCount > 0) withSeeds++;
        if (hasInventoryFlow(r)) withFlows++;
        totalFlows += inventoryFlowCount(r);
    }

    const entryCoverageRate = selection.filteredTotal > 0
        ? Number((analyzed / selection.filteredTotal).toFixed(4))
        : 0;
    const fileCoverageRate = selection.filteredFileCount > 0
        ? Number((selection.selectedFileCount / selection.filteredFileCount).toFixed(4))
        : 0;

    return {
        sourceDir,
        candidatePoolTotal: selection.poolTotal,
        candidateAfterPathFilter: selection.filteredTotal,
        selected: selection.selected.length,
        entryCoverageRate,
        filePoolTotal: selection.poolFileCount,
        fileAfterPathFilter: selection.filteredFileCount,
        fileCovered: selection.selectedFileCount,
        fileCoverageRate,
        analyzed,
        withSeeds,
        withFlows,
        totalFlows,
        statusCount,
    };
}

export function aggregateReport(options: CliOptions, projects: ProjectSmokeResult[]): SmokeReport {
    const sinkRuleHits: Record<string, number> = {};
    const sinkFamilyHits: Record<string, number> = {};
    const sinkEndpointHits: Record<string, number> = {};
    const sinkFlowByKeyword: Record<string, number> = {};
    const sinkFlowBySignature: Record<string, number> = {};
    let totalAnalyzedEntries = 0;
    let totalEntriesWithSeeds = 0;
    let totalEntriesWithFlows = 0;
    let totalFlows = 0;
    let fatalProjectCount = 0;

    for (const p of projects) {
        totalAnalyzedEntries += p.analyzed;
        totalEntriesWithSeeds += p.withSeeds;
        totalEntriesWithFlows += p.withFlows;
        totalFlows += p.totalFlows;
        if (p.fatalErrors.length > 0) fatalProjectCount++;

        mergeCounts(sinkRuleHits, p.sinkRuleHits);
        mergeCounts(sinkFamilyHits, p.sinkFamilyHits);
        mergeCounts(sinkEndpointHits, p.sinkEndpointHits);
        for (const keyword of Object.keys(p.sinkFlowByKeyword)) {
            sinkFlowByKeyword[keyword] = (sinkFlowByKeyword[keyword] || 0) + p.sinkFlowByKeyword[keyword];
        }
        for (const signature of Object.keys(p.sinkFlowBySignature)) {
            sinkFlowBySignature[signature] = (sinkFlowBySignature[signature] || 0) + p.sinkFlowBySignature[signature];
        }
    }

    return {
        generatedAt: new Date().toISOString(),
        options,
        projects,
        totalProjects: projects.length,
        totalAnalyzedEntries,
        totalEntriesWithSeeds,
        totalEntriesWithFlows,
        totalFlows,
        sinkRuleHits,
        sinkFamilyHits,
        sinkEndpointHits,
        sinkFlowByKeyword,
        sinkFlowBySignature,
        fatalProjectCount,
    };
}

export function renderMarkdownReport(report: SmokeReport): string {
    const lines: string[] = [];
    lines.push("# Real Project Smoke Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- manifest: ${report.options.manifestPath}`);
    lines.push(`- k: ${report.options.k}`);
    lines.push(`- maxEntries: ${report.options.maxEntries}`);
    lines.push(`- projects: ${report.totalProjects}`);
    lines.push(`- analyzed arkMain units: ${report.totalAnalyzedEntries}`);
    lines.push(`- entries with seeds: ${report.totalEntriesWithSeeds}`);
    lines.push(`- entries with flows: ${report.totalEntriesWithFlows}`);
    lines.push(`- total flows: ${report.totalFlows}`);
    lines.push(`- fatal projects: ${report.fatalProjectCount}`);
    lines.push("");

    lines.push("## Sink Flow Totals (Rule)");
    lines.push("");
    for (const sinkRuleId of Object.keys(report.sinkRuleHits).sort()) {
        lines.push(`- ${sinkRuleId}: ${report.sinkRuleHits[sinkRuleId]}`);
    }
    lines.push("");

    lines.push("## Sink Flow Totals (Family)");
    lines.push("");
    for (const family of Object.keys(report.sinkFamilyHits).sort()) {
        lines.push(`- ${family}: ${report.sinkFamilyHits[family]}`);
    }
    lines.push("");

    lines.push("## Sink Flow Totals (Endpoint)");
    lines.push("");
    for (const endpoint of Object.keys(report.sinkEndpointHits).sort()) {
        lines.push(`- ${endpoint}: ${report.sinkEndpointHits[endpoint]}`);
    }
    lines.push("");

    for (const project of report.projects) {
        lines.push(`## Project: ${project.id}`);
        lines.push("");
        lines.push(`- repoPath: ${project.repoPath}`);
        lines.push(`- repoUrl: ${project.repoUrl || "N/A"}`);
        lines.push(`- license: ${project.license || "N/A"}`);
        lines.push(`- sourceMode: ${project.sourceMode || "N/A"}`);
        lines.push(`- priority: ${project.priority || "N/A"}`);
        lines.push(`- commit: ${project.commit || "N/A"}`);
        lines.push(`- tags: ${(project.tags || []).join(", ") || "N/A"}`);
        lines.push(`- sourceDirs: ${project.sourceDirs.join(", ")}`);
        lines.push(`- sinkSignatures: ${project.sinkSignatures.join(", ") || "N/A"}`);
        if (typeof project.effectiveMaxEntries === "number") {
            lines.push(`- effectiveMaxEntries: ${project.effectiveMaxEntries}`);
        }
        lines.push(`- analyzed: ${project.analyzed}`);
        lines.push(`- withSeeds: ${project.withSeeds}`);
        lines.push(`- withFlows: ${project.withFlows}`);
        lines.push(`- totalFlows: ${project.totalFlows}`);
        const topProjectSinkRules = Object.entries(project.sinkRuleHits)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        if (topProjectSinkRules.length > 0) {
            lines.push(`- sinkRuleHits(top): ${topProjectSinkRules.map(([id, count]) => `${id}:${count}`).join(", ")}`);
        }
        if (project.fatalErrors.length > 0) {
            lines.push("- fatalErrors:");
            for (const err of project.fatalErrors) {
                lines.push(`  - ${err}`);
            }
        }
        lines.push("");
        lines.push("### Source Summaries");
        for (const s of project.sourceSummaries) {
            lines.push(`- ${s.sourceDir}: pool=${s.candidatePoolTotal}, filtered=${s.candidateAfterPathFilter}, selected=${s.selected}, entryCoverage=${(s.entryCoverageRate * 100).toFixed(1)}%, fileCoverage=${(s.fileCoverageRate * 100).toFixed(1)}%, analyzed=${s.analyzed}, withSeeds=${s.withSeeds}, withFlows=${s.withFlows}, totalFlows=${s.totalFlows}, status=${JSON.stringify(s.statusCount)}`);
        }
        lines.push("");

        const topEntries = [...project.entries]
            .sort((a, b) => {
                const bInventory = inventoryFlowCount(b);
                const aInventory = inventoryFlowCount(a);
                if (bInventory !== aInventory) return bInventory - aInventory;
                if (b.seedCount !== a.seedCount) return b.seedCount - a.seedCount;
                return b.score - a.score;
            })
            .slice(0, 8);
        lines.push("### Top ArkMain Units");
        for (const e of topEntries) {
            const strategyText = e.seedStrategies.length > 0 ? e.seedStrategies.join(",") : "N/A";
            lines.push(`- ${e.entryName} @ ${e.entryPathHint || "N/A"} | status=${e.status} | flows=${inventoryFlowCount(e)} | seeds=${e.seedCount} | seedBy=${strategyText} | score=${e.score}`);
            const topSinkRules = Object.entries(e.sinkRuleHits)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);
            if (topSinkRules.length > 0) {
                lines.push(`  - sinkRuleHits: ${topSinkRules.map(([id, count]) => `${id}:${count}`).join(", ")}`);
            }
            if (e.sinkSamples.length > 0) {
                for (const sample of e.sinkSamples.slice(0, 3)) {
                    lines.push(`  - ${sample}`);
                }
            }
        }
        lines.push("");
    }

    return lines.join("\n");
}

export function printConsoleSummary(report: SmokeReport): void {
    console.log("\n====== Real Project Smoke Summary ======");
    console.log(`projects=${report.totalProjects}`);
    console.log(`analyzed_entries=${report.totalAnalyzedEntries}`);
    console.log(`entries_with_seeds=${report.totalEntriesWithSeeds}`);
    console.log(`entries_with_flows=${report.totalEntriesWithFlows}`);
    console.log(`total_flows=${report.totalFlows}`);
    console.log(`fatal_projects=${report.fatalProjectCount}`);

    console.log("\n------ projects ------");
    for (const p of report.projects) {
        const coverage =
            p.sourceSummaries.length > 0
                ? p.sourceSummaries.reduce((acc, s) => acc + s.entryCoverageRate, 0) / p.sourceSummaries.length
                : 0;
        console.log(`  ${p.id.padEnd(30)} priority=${(p.priority || "N/A").padEnd(6)} analyzed=${String(p.analyzed).padEnd(3)} withSeeds=${String(p.withSeeds).padEnd(3)} withFlows=${String(p.withFlows).padEnd(3)} totalFlows=${String(p.totalFlows).padEnd(3)} cov=${(coverage * 100).toFixed(1)}% fatal=${p.fatalErrors.length}`);
    }

    console.log("\n------ sink flow totals (rule) ------");
    for (const sinkRuleId of Object.keys(report.sinkRuleHits).sort()) {
        console.log(`  ${sinkRuleId.padEnd(40)} ${report.sinkRuleHits[sinkRuleId]}`);
    }
    console.log("\n------ sink flow totals (endpoint) ------");
    for (const endpoint of Object.keys(report.sinkEndpointHits).sort()) {
        console.log(`  ${endpoint.padEnd(20)} ${report.sinkEndpointHits[endpoint]}`);
    }
}
