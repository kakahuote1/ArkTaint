import * as fs from "fs";
import * as path from "path";

interface CliOptions {
    reportPath: string;
    outputPath: string;
}

interface TransferRuleLike {
    id?: string;
    match?: {
        kind?: string;
        value?: string;
    };
    from?: string;
    to?: string;
    fromRef?: {
        endpoint?: string;
        path?: string[];
    };
    toRef?: {
        endpoint?: string;
        path?: string[];
    };
}

interface CompareCaseResult {
    caseName: string;
    expected: boolean;
    detected: boolean;
    pass: boolean;
}

interface CompareScenarioDetail {
    scenarioId: string;
    caseResults: CompareCaseResult[];
}

interface CompareScenario {
    id: string;
    projectRulePath: string;
}

interface CompareReportLike {
    generatedAt?: string;
    scenarios: CompareScenario[];
    details?: {
        arktaint?: {
            fp?: number;
            fn?: number;
            perScenario?: CompareScenarioDetail[];
        };
        arktan?: {
            fp?: number;
            fn?: number;
            perScenario?: CompareScenarioDetail[];
        };
    };
}

interface DroppedRuleInfo {
    id: string;
    reason: string;
}

function parseArgs(argv: string[]): CliOptions {
    let reportPath = "tmp/phase55/compare_report.json";
    let outputPath = "tmp/phase55/gap_list.md";

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--report" && i + 1 < argv.length) {
            reportPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--report=")) {
            reportPath = arg.slice("--report=".length);
            continue;
        }
        if (arg === "--output" && i + 1 < argv.length) {
            outputPath = argv[++i];
            continue;
        }
        if (arg.startsWith("--output=")) {
            outputPath = arg.slice("--output=".length);
            continue;
        }
    }

    return {
        reportPath: path.resolve(reportPath),
        outputPath: path.resolve(outputPath),
    };
}

function parseEndpoint(endpoint: string): string | null {
    if (endpoint === "base" || endpoint === "result") {
        return endpoint;
    }
    if (/^arg\d+$/.test(endpoint)) {
        return String(Number(endpoint.slice(3)));
    }
    return null;
}

function readJsonFile(filePath: string): any {
    const raw = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
}

function collectDroppedTransferRules(projectRulePath: string): DroppedRuleInfo[] {
    if (!fs.existsSync(projectRulePath)) {
        return [{ id: "rule_file_missing", reason: `not_found:${projectRulePath}` }];
    }
    const raw = readJsonFile(projectRulePath);
    const transfers: TransferRuleLike[] = Array.isArray(raw?.transfers) ? raw.transfers : [];
    const out: DroppedRuleInfo[] = [];
    for (const rule of transfers) {
        const id = rule.id || "transfer.unknown";
        if (!rule.match || !rule.match.kind || !rule.match.value) {
            out.push({ id, reason: "unsupported_match_kind" });
            continue;
        }
        const fromEndpoint = rule.fromRef?.endpoint || rule.from || "";
        const toEndpoint = rule.toRef?.endpoint || rule.to || "";
        const from = parseEndpoint(String(fromEndpoint));
        const to = parseEndpoint(String(toEndpoint));
        if (!from || !to) {
            out.push({ id, reason: "unsupported_endpoint" });
            continue;
        }
    }
    return out;
}

function collectFnCases(perScenario: CompareScenarioDetail[] | undefined): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const scenario of perScenario || []) {
        const fnCases = scenario.caseResults
            .filter(c => c.expected && !c.detected)
            .map(c => c.caseName)
            .sort();
        out.set(scenario.scenarioId, fnCases);
    }
    return out;
}

function renderMarkdown(report: CompareReportLike): string {
    const arktaintFnMap = collectFnCases(report.details?.arktaint?.perScenario);
    const arktanFnMap = collectFnCases(report.details?.arktan?.perScenario);

    const scenarioDropped = report.scenarios.map(s => ({
        id: s.id,
        projectRulePath: s.projectRulePath,
        dropped: collectDroppedTransferRules(path.resolve(s.projectRulePath)),
    }));

    const arktaintFnTotal = report.details?.arktaint?.fn ?? 0;
    const arktanFnTotal = report.details?.arktan?.fn ?? 0;
    const droppedTotal = scenarioDropped.reduce((acc, s) => acc + s.dropped.length, 0);

    const lines: string[] = [];
    lines.push("# Phase 5.5.6 Gap List");
    lines.push("");
    lines.push(`- generated_from_compare_report: ${report.generatedAt || "unknown"}`);
    lines.push(`- arktaint_fn_total: ${arktaintFnTotal}`);
    lines.push(`- arktan_fn_total: ${arktanFnTotal}`);
    lines.push(`- dropped_transfer_rules_total: ${droppedTotal}`);
    lines.push("");

    lines.push("## Gap Summary");
    lines.push(`- gap_1_fn_pending: ${arktaintFnTotal > 0 ? "yes" : "no"}`);
    lines.push(`- gap_2_mapping_pending: ${droppedTotal > 0 ? "yes" : "no"}`);
    lines.push("");

    lines.push("## ArkTaint FN Cases");
    for (const scenario of report.scenarios) {
        const fnCases = arktaintFnMap.get(scenario.id) || [];
        lines.push(`- ${scenario.id}: fn=${fnCases.length}`);
        for (const caseName of fnCases) {
            lines.push(`  - ${caseName}`);
        }
    }
    lines.push("");

    lines.push("## Arktan FN Cases (Reference)");
    for (const scenario of report.scenarios) {
        const fnCases = arktanFnMap.get(scenario.id) || [];
        lines.push(`- ${scenario.id}: fn=${fnCases.length}`);
        for (const caseName of fnCases) {
            lines.push(`  - ${caseName}`);
        }
    }
    lines.push("");

    lines.push("## Dropped Transfer Rules");
    for (const scenario of scenarioDropped) {
        lines.push(`- ${scenario.id}: dropped=${scenario.dropped.length}`);
        lines.push(`  - projectRulePath: ${scenario.projectRulePath}`);
        for (const dr of scenario.dropped) {
            lines.push(`  - ${dr.id} (${dr.reason})`);
        }
    }
    lines.push("");

    lines.push("## Next Actions");
    if (arktaintFnTotal > 0) {
        lines.push("- Fix ArkTaint FN cases one by one and keep regression green, target FN=0.");
    } else {
        lines.push("- FN gap closed: keep FN=0 via verify/smoke/generalization regression gates.");
    }
    if (droppedTotal > 0) {
        lines.push("- Extend compare runner mapping for dropped rules, target dropped=0.");
    } else {
        lines.push("- Mapping gap closed: keep dropped_transfer_rules_total=0 for future rule sets.");
    }
    lines.push("- Re-run two full comparison rounds (with --runStability) and archive round reports.");

    return lines.join("\n");
}

function main(): void {
    const options = parseArgs(process.argv.slice(2));
    if (!fs.existsSync(options.reportPath)) {
        throw new Error(`report not found: ${options.reportPath}`);
    }
    const report: CompareReportLike = readJsonFile(options.reportPath);
    const markdown = renderMarkdown(report);
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, markdown, "utf-8");
    console.log(`gap_list_md=${options.outputPath}`);
}

main();
