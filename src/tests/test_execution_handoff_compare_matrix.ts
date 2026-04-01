import * as fs from "fs";
import * as path from "path";
import {
    assert,
    ensureDir,
} from "./helpers/ExecutionHandoffContractSupport";
import {
    activeExecutionHandoffCompareCases,
    executionHandoffCompareManifestPath,
    executionHandoffCompareOutputTag,
    loadExecutionHandoffCompareManifest,
    normalizeCompareFactors,
    type ExecutionHandoffCompareCase,
} from "./helpers/ExecutionHandoffCompareManifest";

interface TwinGroupReport {
    twinGroup: string;
    layers: string[];
    cases: string[];
    factorKey: string;
}

interface PairwiseCoverageRow {
    left: string;
    right: string;
    coveredPairs: number;
    pairs: string[];
}

function buildTwinGroups(cases: ExecutionHandoffCompareCase[]): Map<string, ExecutionHandoffCompareCase[]> {
    const out = new Map<string, ExecutionHandoffCompareCase[]>();
    for (const item of cases) {
        if (!out.has(item.twinGroup)) {
            out.set(item.twinGroup, []);
        }
        out.get(item.twinGroup)!.push(item);
    }
    return out;
}

function distinctValues(cases: ExecutionHandoffCompareCase[], key: keyof ExecutionHandoffCompareCase["factors"]): string[] {
    return [...new Set(cases.map(item => String(item.factors[key])))]
        .sort((a, b) => a.localeCompare(b));
}

function buildPairwiseCoverage(
    cases: ExecutionHandoffCompareCase[],
    left: keyof ExecutionHandoffCompareCase["factors"],
    right: keyof ExecutionHandoffCompareCase["factors"],
): PairwiseCoverageRow {
    const pairs = [...new Set(cases.map(item => `${item.factors[left]} x ${item.factors[right]}`))]
        .sort((a, b) => a.localeCompare(b));
    return {
        left: String(left),
        right: String(right),
        coveredPairs: pairs.length,
        pairs,
    };
}

function renderMarkdown(report: {
    manifestPath: string;
    scopeName: string;
    activeCaseCount: number;
    twinGroupCount: number;
    coveredValues: Record<string, string[]>;
    uncoveredValues: Record<string, Array<string | number | boolean>>;
    pairwiseCoverage: PairwiseCoverageRow[];
    twinGroups: TwinGroupReport[];
}): string {
    const lines: string[] = [];
    lines.push("# Execution Handoff Compare Factor Matrix");
    lines.push("");
    lines.push("## Active Scope");
    lines.push("");
    lines.push(`- manifest: \`${report.manifestPath}\``);
    lines.push(`- scope: \`${report.scopeName}\``);
    lines.push(`- cases: \`${report.activeCaseCount}\``);
    lines.push(`- twin groups: \`${report.twinGroupCount}\``);
    lines.push("");
    lines.push("## Covered Values");
    lines.push("");
    for (const [key, values] of Object.entries(report.coveredValues)) {
        lines.push(`- \`${key}\`: ${values.join(", ")}`);
    }
    lines.push("");
    lines.push("## Uncovered Global Values");
    lines.push("");
    for (const [key, values] of Object.entries(report.uncoveredValues)) {
        lines.push(`- \`${key}\`: ${values.length > 0 ? values.join(", ") : "<none>"}`);
    }
    lines.push("");
    lines.push("## Pairwise Coverage");
    lines.push("");
    for (const row of report.pairwiseCoverage) {
        lines.push(`- \`${row.left} x ${row.right}\`: ${row.coveredPairs} pairs`);
    }
    lines.push("");
    lines.push("## Twin Groups");
    lines.push("");
    for (const item of report.twinGroups) {
        lines.push(`- \`${item.twinGroup}\`: cases=${item.cases.join(", ")}, layers=${item.layers.join(", ")}`);
    }
    return lines.join("\n");
}

function readStringFlag(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    if (index >= 0 && index + 1 < process.argv.length) {
        return process.argv[index + 1];
    }
    return undefined;
}

function main(): void {
    const manifestPath = readStringFlag("--manifest") || executionHandoffCompareManifestPath();
    const manifest = loadExecutionHandoffCompareManifest(manifestPath);
    const activeCases = activeExecutionHandoffCompareCases(manifest);
    const outputTag = executionHandoffCompareOutputTag(manifest);
    const outputDir = path.resolve("tmp/test_runs/research/execution_handoff_compare", outputTag, "latest");
    ensureDir(outputDir);

    assert(activeCases.length > 0, "execution handoff compare manifest should expose active cases");

    for (const item of activeCases) {
        const caseFile = path.resolve(manifest.sourceDir, `${item.caseName}.ets`);
        assert(fs.existsSync(caseFile), `missing compare case file: ${caseFile}`);
    }

    const twinGroups = buildTwinGroups(activeCases);
    const twinReports: TwinGroupReport[] = [];
    for (const [twinGroup, items] of twinGroups.entries()) {
        assert(items.length === 2, `${twinGroup} should have exactly 2 twins`);
        const positives = items.filter(item => item.polarity === "positive");
        const negatives = items.filter(item => item.polarity === "negative");
        assert(positives.length === 1, `${twinGroup} should have exactly one positive twin`);
        assert(negatives.length === 1, `${twinGroup} should have exactly one negative twin`);
        const factorKeys = [...new Set(items.map(item => normalizeCompareFactors(item.factors)))];
        assert(factorKeys.length === 1, `${twinGroup} twins must share identical semantic factors`);
        twinReports.push({
            twinGroup,
            layers: [...new Set(items.map(item => item.layer))].sort((a, b) => a.localeCompare(b)),
            cases: items.map(item => item.caseName).sort((a, b) => a.localeCompare(b)),
            factorKey: factorKeys[0],
        });
    }

    const coveredValues = {
        carrier: distinctValues(activeCases, "carrier"),
        trigger: distinctValues(activeCases, "trigger"),
        payload: distinctValues(activeCases, "payload"),
        capture: distinctValues(activeCases, "capture"),
        resume: distinctValues(activeCases, "resume"),
        relayDepth: distinctValues(activeCases, "relayDepth"),
        bindingSite: distinctValues(activeCases, "bindingSite"),
        deferred: distinctValues(activeCases, "deferred"),
    };

    const uncoveredValues = Object.fromEntries(
        Object.entries(manifest.globalFactorUniverse).map(([key, values]) => {
            const covered = new Set((coveredValues as Record<string, string[]>)[key]?.map(String) || []);
            return [key, values.filter(value => !covered.has(String(value)))];
        }),
    );

    const pairwiseCoverage = [
        buildPairwiseCoverage(activeCases, "trigger", "relayDepth"),
        buildPairwiseCoverage(activeCases, "carrier", "trigger"),
        buildPairwiseCoverage(activeCases, "carrier", "bindingSite"),
        buildPairwiseCoverage(activeCases, "trigger", "deferred"),
    ];

    const report = {
        generatedAt: new Date().toISOString(),
        manifestPath: path.resolve(manifestPath),
        scopeName: manifest.activeCompareScope.name,
        activeCaseCount: activeCases.length,
        twinGroupCount: twinReports.length,
        coveredValues,
        uncoveredValues,
        pairwiseCoverage,
        twinGroups: twinReports,
    };

    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_compare_matrix.json"),
        JSON.stringify(report, null, 2),
        "utf8",
    );
    fs.writeFileSync(
        path.join(outputDir, "execution_handoff_compare_matrix.md"),
        renderMarkdown(report),
        "utf8",
    );

    console.log("execution_handoff_compare_matrix=PASS");
}

try {
    main();
} catch (err) {
    console.error("execution_handoff_compare_matrix=FAIL");
    console.error(err);
    process.exitCode = 1;
}
