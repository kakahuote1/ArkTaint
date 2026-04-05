import * as fs from "fs";
import * as path from "path";

interface DatasetAggregate {
    countsBySlotFamily: Record<string, number>;
}

interface DiagnosticReport {
    generatedAt: string;
    datasets: Record<string, DatasetAggregate>;
}

interface FamilyCoverageRow {
    family: string;
    observed: number;
    status: "covered" | "unrepresented";
}

interface CoverageReport {
    generatedAt: string;
    diagnosticReportPath: string;
    representedFamilyCount: number;
    unrepresentedFamilyCount: number;
    rows: FamilyCoverageRow[];
}

const TARGET_FAMILIES = [
    "ui_direct_slot",
    "gesture_direct_slot",
    "system_direct_slot",
    "subscription_event_slot",
    "completion_callback_slot",
] as const;

function main(): void {
    const diagnosticReportPath = path.resolve("tmp/test_runs/entry_model/callback_provenance_diagnostic/latest/callback_provenance_report.json");
    if (!fs.existsSync(diagnosticReportPath)) {
        throw new Error(`missing callback provenance diagnostic report: ${diagnosticReportPath}`);
    }
    const diagnostic = JSON.parse(fs.readFileSync(diagnosticReportPath, "utf8")) as DiagnosticReport;

    const observedByFamily = new Map<string, number>();
    for (const aggregate of Object.values(diagnostic.datasets)) {
        for (const [family, count] of Object.entries(aggregate.countsBySlotFamily || {})) {
            observedByFamily.set(family, (observedByFamily.get(family) || 0) + count);
        }
    }

    const rows: FamilyCoverageRow[] = TARGET_FAMILIES.map(family => {
        const observed = observedByFamily.get(family) || 0;
        return {
            family,
            observed,
            status: observed > 0 ? "covered" : "unrepresented",
        };
    });

    const report: CoverageReport = {
        generatedAt: new Date().toISOString(),
        diagnosticReportPath,
        representedFamilyCount: rows.filter(row => row.status === "covered").length,
        unrepresentedFamilyCount: rows.filter(row => row.status === "unrepresented").length,
        rows,
    };

    if (rows.some(row => row.status === "unrepresented")) {
        const missing = rows.filter(row => row.status === "unrepresented").map(row => row.family).join(", ");
        throw new Error(`Callback provenance coverage report found unrepresented families: ${missing}`);
    }

    const outputDir = path.resolve("tmp/test_runs/entry_model/callback_provenance_coverage/latest");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "callback_provenance_coverage_report.json");
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

    console.log(`Callback provenance coverage report written to ${outputPath}`);
    console.log(
        `represented_families=${report.representedFamilyCount}, `
        + `unrepresented_families=${report.unrepresentedFamilyCount}`,
    );
    for (const row of rows) {
        console.log(`${row.family}: observed=${row.observed}, status=${row.status}`);
    }
}

main();
