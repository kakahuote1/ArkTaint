import * as fs from "fs";
import * as path from "path";

interface CoverageCounter {
    baseline: number;
    masked: number;
}

interface BlindSpotReport {
    generatedAt: string;
    sourceDir: string;
    caseCount: number;
    candidateCount: number;
    sdkBackedCandidateCount: number;
    baselineRecognizedCount: number;
    maskedRecognizedCount: number;
    baselineCatalogClassifiedCount: number;
    maskedCatalogBlindSpotSuccessCount: number;
    uncataloguedSdkDiscoveryCount: number;
    coverageByBaselineSlotFamily: Record<string, CoverageCounter>;
}

interface FamilyCoverageRow {
    family: string;
    represented: number;
    maskedRecognized: number;
    independentCoverage: number | null;
    status: "covered" | "blind_spot" | "unrepresented";
}

interface CoverageReport {
    generatedAt: string;
    blindSpotReportPath: string;
    sdkBackedCandidateCount: number;
    baselineRecognizedCount: number;
    maskedRecognizedCount: number;
    baselineCatalogClassifiedCount: number;
    uncataloguedSdkDiscoveryCount: number;
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
    const blindSpotReportPath = path.resolve("tmp/test_runs/entry_model/callback_blind_spot_probe/latest/callback_blind_spot_report.json");
    if (!fs.existsSync(blindSpotReportPath)) {
        throw new Error(`missing blind-spot report: ${blindSpotReportPath}`);
    }
    const blindSpot = JSON.parse(fs.readFileSync(blindSpotReportPath, "utf8")) as BlindSpotReport;

    const rows: FamilyCoverageRow[] = TARGET_FAMILIES.map(family => {
        const counter = blindSpot.coverageByBaselineSlotFamily[family];
        const represented = counter?.baseline || 0;
        const maskedRecognized = counter?.masked || 0;
        return {
            family,
            represented,
            maskedRecognized,
            independentCoverage: represented > 0 ? maskedRecognized / represented : null,
            status: represented === 0
                ? "unrepresented"
                : maskedRecognized === represented
                    ? "covered"
                    : "blind_spot",
        };
    });

    const report: CoverageReport = {
        generatedAt: new Date().toISOString(),
        blindSpotReportPath,
        sdkBackedCandidateCount: blindSpot.sdkBackedCandidateCount,
        baselineRecognizedCount: blindSpot.baselineRecognizedCount,
        maskedRecognizedCount: blindSpot.maskedRecognizedCount,
        baselineCatalogClassifiedCount: blindSpot.baselineCatalogClassifiedCount,
        uncataloguedSdkDiscoveryCount: blindSpot.uncataloguedSdkDiscoveryCount,
        representedFamilyCount: rows.filter(row => row.status !== "unrepresented").length,
        unrepresentedFamilyCount: rows.filter(row => row.status === "unrepresented").length,
        rows,
    };

    if (report.sdkBackedCandidateCount === 0) {
        throw new Error("Callback provenance coverage report found no sdkBacked candidates.");
    }
    if (report.baselineCatalogClassifiedCount === 0) {
        throw new Error("Callback provenance coverage report found no baseline catalog-classified sdk callbacks.");
    }
    if (report.uncataloguedSdkDiscoveryCount === 0) {
        throw new Error("Callback provenance coverage report found no uncatalogued sdk discoveries.");
    }
    if (!rows.some(row => row.status === "covered")) {
        throw new Error("Callback provenance coverage report found no family independently covered by sdk_provenance.");
    }

    const outputDir = path.resolve("tmp/test_runs/entry_model/callback_provenance_coverage/latest");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "callback_provenance_coverage_report.json");
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

    console.log(`Callback provenance coverage report written to ${outputPath}`);
    console.log(
        `sdk_backed=${report.sdkBackedCandidateCount}, represented_families=${report.representedFamilyCount}, `
        + `unrepresented_families=${report.unrepresentedFamilyCount}, uncatalogued=${report.uncataloguedSdkDiscoveryCount}`,
    );
    for (const row of rows) {
        const coverageText = row.independentCoverage === null ? "n/a" : row.independentCoverage.toFixed(2);
        console.log(`${row.family}: represented=${row.represented}, masked=${row.maskedRecognized}, coverage=${coverageText}, status=${row.status}`);
    }
}

main();

