import {
    CandidateSelectionResult,
    CliOptions,
    EntrySmokeResult,
    ProjectSmokeResult,
    SmokeReport,
    SourceDirSummary,
} from "./SmokeTypes";

export function createSourceSummary(
    sourceDir: string,
    results: EntrySmokeResult[],
    selection: CandidateSelectionResult
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
        if (r.flowCount > 0) withFlows++;
        totalFlows += r.flowCount;
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
        sinkFlowByKeyword,
        sinkFlowBySignature,
        fatalProjectCount,
    };
}

export function renderMarkdownReport(report: SmokeReport): string {
    const lines: string[] = [];
    lines.push("# Phase 4.3 Smoke Report");
    lines.push("");
    lines.push(`- generatedAt: ${report.generatedAt}`);
    lines.push(`- manifest: ${report.options.manifestPath}`);
    lines.push(`- k: ${report.options.k}`);
    lines.push(`- maxEntries: ${report.options.maxEntries}`);
    lines.push(`- projects: ${report.totalProjects}`);
    lines.push(`- analyzed entries: ${report.totalAnalyzedEntries}`);
    lines.push(`- entries with seeds: ${report.totalEntriesWithSeeds}`);
    lines.push(`- entries with flows: ${report.totalEntriesWithFlows}`);
    lines.push(`- total flows: ${report.totalFlows}`);
    lines.push(`- fatal projects: ${report.fatalProjectCount}`);
    lines.push("");

    lines.push("## Sink Flow Totals (Keyword)");
    lines.push("");
    for (const keyword of Object.keys(report.sinkFlowByKeyword).sort()) {
        lines.push(`- ${keyword}: ${report.sinkFlowByKeyword[keyword]}`);
    }
    lines.push("");

    lines.push("## Sink Flow Totals (Signature)");
    lines.push("");
    for (const signature of Object.keys(report.sinkFlowBySignature).sort()) {
        lines.push(`- ${signature}: ${report.sinkFlowBySignature[signature]}`);
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
        lines.push(`- analyzed: ${project.analyzed}`);
        lines.push(`- withSeeds: ${project.withSeeds}`);
        lines.push(`- withFlows: ${project.withFlows}`);
        lines.push(`- totalFlows: ${project.totalFlows}`);
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
                if (b.flowCount !== a.flowCount) return b.flowCount - a.flowCount;
                if (b.seedCount !== a.seedCount) return b.seedCount - a.seedCount;
                return b.score - a.score;
            })
            .slice(0, 8);
        lines.push("### Top Entries");
        for (const e of topEntries) {
            const strategyText = e.seedStrategies.length > 0 ? e.seedStrategies.join(",") : "N/A";
            lines.push(`- ${e.entryName} @ ${e.entryPathHint || "N/A"} | status=${e.status} | flows=${e.flowCount} | seeds=${e.seedCount} | seedBy=${strategyText} | score=${e.score}`);
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
    console.log("\n====== Phase 4.3 Smoke Summary ======");
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

    console.log("\n------ sink flow totals ------");
    for (const keyword of Object.keys(report.sinkFlowByKeyword).sort()) {
        console.log(`  ${keyword.padEnd(20)} ${report.sinkFlowByKeyword[keyword]}`);
    }
    console.log("\n------ sink flow totals (signature) ------");
    for (const signature of Object.keys(report.sinkFlowBySignature).sort()) {
        console.log(`  ${signature.padEnd(32)} ${report.sinkFlowBySignature[signature]}`);
    }
}
